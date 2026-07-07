// PM Agent — снапшот на Basecamp в локалната БД (Фаза 0).
//
// Защо: агентът анализира ВСИЧКО (карти + съдържание + коментари, клиентски
// проекти: съобщения/задачи/campfire). Ако четеше Basecamp на живо при всеки
// анализ, щеше да прави стотици заявки и да опира в rate limits. Затова държим
// снапшот в PostgreSQL и го опресняваме инкрементално (cron на 15 мин).
//
// Четене: с токена на админа (Венци) — вижда всички проекти, вкл. клиентските.
// Fallback: сервизния бот ThePactAlerts (ако той е добавен в проектите).
// Писане към Basecamp НЕ се случва тук — снапшотът е само четене.
const cron = require('node-cron');
const config = require('../../config');
const { query, queryOne, execute } = require('../../db/pool');
const bc = require('../basecamp');
const { getServiceAuth, getUserAuth } = require('../basecamp-token');

const COMMENT_HORIZON_DAYS = 90; // първоначален прозорец за коментари/съобщения назад
let running = false;
let runCounter = 0; // campfire sync — само на всеки 4-ти цикъл (час)

function initPmAgent() {
  try {
    cron.schedule('*/15 * * * *', () => {
      runSync({ trigger: 'cron' }).catch((err) => console.error('[pm-agent] sync error:', err.message));
    }, { timezone: 'Europe/Sofia' });
    console.log('  PM Agent: snapshot sync active (every 15 min)');
  } catch (err) {
    console.log('  PM Agent: skipped —', err.message);
  }
}

async function isEnabled() {
  const row = await queryOne("SELECT value FROM settings WHERE key = 'pm_agent_enabled'");
  return !row || row.value !== 'false'; // default: включен
}

// Токен за четене: админът (пълна видимост) → fallback ботът.
async function getReadAuth() {
  try {
    const row = await queryOne(
      `SELECT u.id FROM users u JOIN basecamp_tokens t ON t.user_id = u.id
       WHERE LOWER(u.email) = ANY($1::text[]) ORDER BY u.id LIMIT 1`,
      [config.ADMIN_EMAILS]
    );
    if (row) return await getUserAuth(row.id);
  } catch (err) {
    console.warn('[pm-agent] admin token unavailable, falling back to bot:', err.message);
  }
  return getServiceAuth();
}

// ---------- помощни ----------

async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

function isClientPerson(p) { return Boolean(p && p.client === true); }

function dockTool(project, name) {
  return (project.dock || []).find((t) => t.enabled && t.name === name) || null;
}

async function lastGoodSyncAt() {
  const row = await queryOne(
    "SELECT finished_at FROM agent_runs WHERE kind = 'sync' AND status = 'done' ORDER BY id DESC LIMIT 1"
  );
  return row && row.finished_at ? new Date(row.finished_at) : null;
}

// ---------- upserts ----------

async function upsertProject(p) {
  await execute(
    `INSERT INTO bc_projects (project_id, name, description, dock, clients_enabled, bc_updated_at, active, synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE, NOW())
     ON CONFLICT (project_id) DO UPDATE SET
       name = $2, description = $3, dock = $4, clients_enabled = $5, bc_updated_at = $6, active = TRUE, synced_at = NOW()`,
    [p.id, p.name || '', p.description || '', JSON.stringify(p.dock || []),
     Boolean(p.clients_enabled), p.updated_at || null]
  );
}

async function upsertCard(c, meta) {
  await execute(
    `INSERT INTO bc_cards_snap (card_id, project_id, board_id, board_title, column_title, title, content,
        due_on, completed, assignees, steps, comments_count, app_url, on_hold, bc_created_at, bc_updated_at, active, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,TRUE,NOW())
     ON CONFLICT (card_id) DO UPDATE SET
       project_id=$2, board_id=$3, board_title=$4, column_title=$5, title=$6, content=$7, due_on=$8,
       completed=$9, assignees=$10, steps=$11, comments_count=$12, app_url=$13, on_hold=$14,
       bc_created_at=$15, bc_updated_at=$16, active=TRUE, synced_at=NOW()`,
    [c.id, meta.projectId, meta.boardId, meta.boardTitle, meta.columnTitle, c.title || '', c.content || '',
     c.due_on || null, Boolean(c.completed),
     JSON.stringify((c.assignees || []).map((a) => ({ id: a.id, name: a.name }))),
     JSON.stringify((c.steps || []).map((s) => ({ title: s.title, due_on: s.due_on, completed: s.completed, assignees: (s.assignees || []).map((a) => a.name) }))),
     Number(c.comments_count) || 0, c.app_url || '', Boolean(meta.onHold), c.created_at || null, c.updated_at || null]
  );
}

async function upsertComment(rec) {
  const bucket = rec.bucket || {};
  const parent = rec.parent || {};
  await execute(
    `INSERT INTO bc_comments_snap (comment_id, project_id, parent_id, parent_type, parent_title,
        creator_id, creator_name, creator_is_client, content, app_url, bc_created_at, bc_updated_at, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
     ON CONFLICT (comment_id) DO UPDATE SET
       parent_title=$5, creator_name=$7, creator_is_client=$8, content=$9, bc_updated_at=$12, synced_at=NOW()`,
    [rec.id, bucket.id || 0, parent.id || 0, parent.type || '', parent.title || '',
     rec.creator ? rec.creator.id : null, rec.creator ? rec.creator.name || '' : '',
     isClientPerson(rec.creator), rec.content || '', rec.app_url || '',
     rec.created_at || null, rec.updated_at || null]
  );
}

async function upsertMessage(rec) {
  const bucket = rec.bucket || {};
  await execute(
    `INSERT INTO bc_messages_snap (message_id, project_id, subject, content, creator_id, creator_name,
        creator_is_client, comments_count, app_url, bc_created_at, bc_updated_at, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
     ON CONFLICT (message_id) DO UPDATE SET
       subject=$3, content=$4, creator_name=$6, creator_is_client=$7, comments_count=$8, bc_updated_at=$11, synced_at=NOW()`,
    [rec.id, bucket.id || 0, rec.subject || rec.title || '', rec.content || '',
     rec.creator ? rec.creator.id : null, rec.creator ? rec.creator.name || '' : '',
     isClientPerson(rec.creator), Number(rec.comments_count) || 0, rec.app_url || '',
     rec.created_at || null, rec.updated_at || null]
  );
}

async function upsertTodo(rec, listMeta) {
  const bucket = rec.bucket || {};
  const parent = rec.parent || {};
  await execute(
    `INSERT INTO bc_todos_snap (todo_id, project_id, todolist_id, todolist_title, title, description,
        due_on, completed, assignees, creator_name, creator_is_client, comments_count, app_url,
        bc_created_at, bc_updated_at, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
     ON CONFLICT (todo_id) DO UPDATE SET
       todolist_title=$4, title=$5, description=$6, due_on=$7, completed=$8, assignees=$9,
       comments_count=$12, bc_updated_at=$15, synced_at=NOW()`,
    [rec.id, bucket.id || 0,
     (listMeta && listMeta.id) || parent.id || null, (listMeta && listMeta.title) || parent.title || '',
     rec.content || rec.title || '', rec.description || '',
     rec.due_on || null, Boolean(rec.completed),
     JSON.stringify((rec.assignees || []).map((a) => ({ id: a.id, name: a.name }))),
     rec.creator ? rec.creator.name || '' : '', isClientPerson(rec.creator),
     Number(rec.comments_count) || 0, rec.app_url || '', rec.created_at || null, rec.updated_at || null]
  );
}

async function upsertCampfireLine(line, projectId, campfireId) {
  await execute(
    `INSERT INTO bc_campfire_lines_snap (line_id, project_id, campfire_id, creator_id, creator_name,
        creator_is_client, content, bc_created_at, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
     ON CONFLICT (line_id) DO NOTHING`,
    [line.id, projectId, campfireId, line.creator ? line.creator.id : null,
     line.creator ? line.creator.name || '' : '', isClientPerson(line.creator),
     line.content || '', line.created_at || null]
  );
}

// ---------- sync стъпки ----------

async function syncProjects(auth) {
  const projects = await bc.getProjects(auth.token, auth.account);
  for (const p of projects) await upsertProject(p);
  if (projects.length) {
    await execute('UPDATE bc_projects SET active = FALSE WHERE project_id != ALL($1::bigint[])',
      [projects.map((p) => p.id)]);
  }
  return projects;
}

// Video Production картите — сурови payload-и (с content), не mapCard от дашборда.
async function syncTeamCards(auth, { deep = false } = {}) {
  const projectId = config.BASECAMP_TEAM_PROJECT_ID;
  const project = await bc.getProject(auth.token, auth.account, projectId);
  const tools = (project.dock || []).filter((t) => t.enabled && /kanban|card/i.test(t.name));
  const seen = [];
  let commentsFetched = 0;

  for (const t of tools) {
    const table = (await bc.authedGet(t.url, auth.token)).json;
    const boardTitle = t.title || table.title || '';
    const lists = table.lists || [];
    await mapLimit(lists, 3, async (list) => {
      const groups = [{ listId: list.id, onHold: false, count: list.cards_count }];
      if (list.on_hold && list.on_hold.cards_count > 0) {
        groups.push({ listId: list.on_hold.id, onHold: true, count: list.on_hold.cards_count });
      }
      for (const g of groups) {
        if (!g.count) continue;
        const cards = await bc.getColumnCards(auth.token, auth.account, projectId, g.listId);
        for (const c of cards) {
          seen.push(c.id);
          // Списъчният payload НЕ гарантира content/comments_count → при нова или
          // променена карта (updated_at) теглим пълната карта с getCard.
          const prev = await queryOne(
            'SELECT bc_updated_at, comments_count FROM bc_cards_snap WHERE card_id = $1', [c.id]);
          const listUpdated = c.updated_at ? new Date(c.updated_at).toISOString() : '';
          const prevUpdated = prev && prev.bc_updated_at ? new Date(prev.bc_updated_at).toISOString() : '';
          const changed = !prev || listUpdated !== prevUpdated;
          if (!changed && !deep) continue; // нищо ново по картата
          let full = c;
          try {
            full = await bc.getCard(auth.token, auth.account, projectId, c.id);
          } catch (err) {
            console.warn('[pm-agent] getCard failed:', c.id, err.message);
          }
          await upsertCard(full, {
            projectId, boardId: table.id, boardTitle, columnTitle: list.title || '', onHold: g.onHold,
          });
          // Коментарите — при нова карта, променен брой коментари или deep sync.
          const cc = Number(full.comments_count) || 0;
          const ccChanged = !prev || Number(prev.comments_count) !== cc;
          if (cc > 0 && (ccChanged || deep)) {
            try {
              const comments = await bc.getComments(auth.token, auth.account, projectId, c.id);
              for (const cm of comments) {
                await upsertComment({ ...cm, bucket: { id: projectId }, parent: { id: c.id, type: 'Kanban::Card', title: full.title || c.title } });
              }
              commentsFetched += comments.length;
            } catch (err) {
              console.warn('[pm-agent] card comments failed:', c.id, err.message);
            }
          }
        }
      }
    });
  }

  if (seen.length) {
    await execute(
      'UPDATE bc_cards_snap SET active = FALSE WHERE project_id = $1 AND card_id != ALL($2::bigint[])',
      [projectId, seen]
    );
  }
  return { cards: seen.length, comments: commentsFetched };
}

// Клиентските проекти: съобщения + отворени задачи (+ campfire периодично).
async function syncClientProjects(auth, projects, { withCampfires = false } = {}) {
  const teamId = String(config.BASECAMP_TEAM_PROJECT_ID);
  const others = projects.filter((p) => String(p.id) !== teamId);
  const stats = { messages: 0, todos: 0, campfireLines: 0 };

  await mapLimit(others, 3, async (p) => {
    try {
      const board = dockTool(p, 'message_board');
      if (board && board.id) {
        const messages = await bc.getMessages(auth.token, auth.account, p.id, board.id);
        for (const m of messages) await upsertMessage({ ...m, bucket: { id: p.id } });
        stats.messages += messages.length;
      }
      const todoset = dockTool(p, 'todoset');
      if (todoset && todoset.id) {
        const lists = await bc.getTodoLists(auth.token, auth.account, p.id, todoset.id);
        for (const list of lists) {
          const todos = await bc.getTodos(auth.token, auth.account, p.id, list.id);
          for (const td of todos) await upsertTodo({ ...td, bucket: { id: p.id } }, { id: list.id, title: list.title || list.name || '' });
          stats.todos += todos.length;
        }
      }
      if (withCampfires) {
        const chat = dockTool(p, 'chat');
        if (chat && chat.id) {
          const lines = await bc.getCampfireLines(auth.token, auth.account, p.id, chat.id, 2);
          for (const ln of lines) await upsertCampfireLine(ln, p.id, chat.id);
          stats.campfireLines += lines.length;
        }
      }
    } catch (err) {
      console.warn('[pm-agent] project sync failed:', p.name, err.message);
    }
  });
  return stats;
}

// Инкрементално: recordings API — всичко променено от последния sync (всички проекти).
async function syncRecordingsSince(auth, sinceIso) {
  const stats = { comments: 0, messages: 0, todos: 0 };
  try {
    const comments = await bc.getRecordingsSince(auth.token, auth.account, 'Comment', sinceIso);
    for (const rec of comments) await upsertComment(rec);
    stats.comments = comments.length;
  } catch (err) { console.warn('[pm-agent] comments sweep failed:', err.message); }
  try {
    const messages = await bc.getRecordingsSince(auth.token, auth.account, 'Message', sinceIso);
    for (const rec of messages) await upsertMessage(rec);
    stats.messages = messages.length;
  } catch (err) { console.warn('[pm-agent] messages sweep failed:', err.message); }
  try {
    const todos = await bc.getRecordingsSince(auth.token, auth.account, 'Todo', sinceIso);
    for (const rec of todos) await upsertTodo(rec, null);
    stats.todos = todos.length;
  } catch (err) { console.warn('[pm-agent] todos sweep failed:', err.message); }
  return stats;
}

// ---------- главните entry points ----------

// full=true (или празен снапшот) → пълен sync; иначе инкрементален.
async function runSync({ trigger = 'manual', full = false } = {}) {
  if (running) return { skipped: 'already-running' };
  if (trigger === 'cron' && !(await isEnabled())) return { skipped: 'disabled' };
  running = true;
  // ВСИЧКО след вдигането на флага е в try/finally — иначе една паднала
  // заявка оставя running=true завинаги и sync-ът умира тихо до рестарт.
  let runId = null;
  const started = Date.now();
  try {
    const runRow = await queryOne(
      "INSERT INTO agent_runs (kind, status, stats) VALUES ('sync', 'running', $1) RETURNING id",
      [JSON.stringify({ trigger })]
    );
    runId = runRow.id;
    const auth = await getReadAuth();
    const empty = !(await queryOne('SELECT 1 AS x FROM bc_projects LIMIT 1'));
    const isFull = full || empty;
    runCounter += 1;

    const projects = await syncProjects(auth);
    const cardStats = await syncTeamCards(auth, { deep: isFull });

    let clientStats = { messages: 0, todos: 0, campfireLines: 0 };
    let sweepStats = { comments: 0, messages: 0, todos: 0 };
    if (isFull) {
      clientStats = await syncClientProjects(auth, projects, { withCampfires: true });
      const horizon = new Date(Date.now() - COMMENT_HORIZON_DAYS * 24 * 3600_000).toISOString();
      sweepStats = await syncRecordingsSince(auth, horizon);
    } else {
      const last = await lastGoodSyncAt();
      // 30 мин застъпване — да не изпуснем нищо около границата.
      const since = last ? new Date(last.getTime() - 30 * 60_000).toISOString()
        : new Date(Date.now() - COMMENT_HORIZON_DAYS * 24 * 3600_000).toISOString();
      sweepStats = await syncRecordingsSince(auth, since);
      // Campfire — на всеки 4-ти цикъл (веднъж на час), защото няма "since" API.
      if (runCounter % 4 === 0) {
        clientStats = await syncClientProjects(auth, projects, { withCampfires: true });
      }
    }

    const stats = {
      trigger, full: isFull, seconds: Math.round((Date.now() - started) / 1000),
      projects: projects.length, ...cardStats,
      client: clientStats, sweep: sweepStats,
    };
    await execute("UPDATE agent_runs SET status = 'done', stats = $2, finished_at = NOW() WHERE id = $1",
      [runId, JSON.stringify(stats)]);
    console.log('[pm-agent] sync done:', JSON.stringify(stats));
    return stats;
  } catch (err) {
    if (runId) {
      await execute("UPDATE agent_runs SET status = 'error', error = $2, finished_at = NOW() WHERE id = $1",
        [runId, String(err.message || err).slice(0, 2000)]).catch(() => {});
    }
    throw err;
  } finally {
    running = false;
  }
}

function syncInProgress() { return running; }

async function snapshotCounts() {
  const q = async (sql) => { const r = await queryOne(sql); return Number(r ? r.n : 0); };
  return {
    projects: await q('SELECT COUNT(*) AS n FROM bc_projects WHERE active'),
    cards: await q('SELECT COUNT(*) AS n FROM bc_cards_snap WHERE active'),
    comments: await q('SELECT COUNT(*) AS n FROM bc_comments_snap'),
    messages: await q('SELECT COUNT(*) AS n FROM bc_messages_snap'),
    todos: await q('SELECT COUNT(*) AS n FROM bc_todos_snap'),
    campfireLines: await q('SELECT COUNT(*) AS n FROM bc_campfire_lines_snap'),
    lastSyncAt: (await lastGoodSyncAt()) || null,
  };
}

module.exports = { initPmAgent, runSync, snapshotCounts, getReadAuth, isEnabled, syncInProgress };
