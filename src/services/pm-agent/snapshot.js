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
const cardTextLog = require('../card-text-log');
const stageLog = require('../stage-log');
const activityLog = require('../bc-activity-log');
const { getServiceAuth, getUserAuth } = require('../basecamp-token');

const COMMENT_HORIZON_DAYS = 90; // първоначален прозорец за коментари/съобщения назад
const TEXT_LOG_MAX_PER_SYNC = 200; // таван на записите в дневника на текста за един цикъл
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

// Нови таблици/колони за Docs&Files и изтриване на съобщения/задачи — миграциите
// не се прилагат автоматично при deploy (само от кода), затова се подсигуряват
// в движение, по същия начин като card-text-log.js/stage-log.js.
let snapSchemaReady = null;
function ensureSnapshotSchema() {
  if (!snapSchemaReady) {
    snapSchemaReady = execute(`
      CREATE TABLE IF NOT EXISTS bc_vault_snap (
        item_id       BIGINT PRIMARY KEY,
        project_id    BIGINT NOT NULL,
        vault_id      BIGINT,
        kind          TEXT NOT NULL,
        title         TEXT NOT NULL DEFAULT '',
        content       TEXT NOT NULL DEFAULT '',
        app_url       TEXT NOT NULL DEFAULT '',
        bc_created_at TIMESTAMPTZ,
        bc_updated_at TIMESTAMPTZ,
        active        BOOLEAN NOT NULL DEFAULT TRUE,
        synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`)
      .then(() => Promise.all([
        execute('CREATE INDEX IF NOT EXISTS idx_bc_vault_snap_project ON bc_vault_snap(project_id)'),
        execute('ALTER TABLE bc_messages_snap ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE'),
        execute('ALTER TABLE bc_todos_snap ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE'),
      ]))
      .catch((err) => {
        snapSchemaReady = null;
        throw err;
      });
  }
  return snapSchemaReady;
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

// ---------- Docs & Files (Vault) — създаване/редакция/изтриване ----------
//
// Basecamp не дава "since" за vault-а — за да засечем изтриване трябва да
// обходим ЦЯЛАТА папкова структура и да сравним какво сме видели с активния
// снапшот. Затова тече по същата рядка стъпка като campfire-а (веднъж на час),
// не на всеки 15 мин — иначе на всеки цикъл ще бомбардираме Basecamp с толкова
// заявки, колкото файлове+папки имат ВСИЧКИ проекти.
const VAULT_MAX_DEPTH = 6;
const VAULT_CONCURRENCY = 2;

async function syncVaultDocument(auth, projectId, vaultId, d, parentTitle, ctx) {
  const prev = await queryOne(
    `SELECT bc_updated_at, title, content FROM bc_vault_snap WHERE item_id = $1`, [d.id]);
  const listUpdated = d.updated_at ? new Date(d.updated_at).toISOString() : '';
  const prevUpdated = prev && prev.bc_updated_at ? new Date(prev.bc_updated_at).toISOString() : '';
  const changed = !prev || listUpdated !== prevUpdated;

  let full = d;
  if (changed) {
    try {
      full = await bc.getDocument(auth.token, auth.account, projectId, d.id);
    } catch (err) {
      console.warn('[pm-agent] getDocument failed:', d.id, err.message);
    }
  }

  try {
    if (!prev) {
      await activityLog.logEvent({
        projectId, recordingType: 'Document', recordingId: d.id, event: 'created',
        title: full.title || '', parentTitle, appUrl: bc.normalizeAppUrl(full.app_url || ''),
        bcUpdatedAt: full.updated_at || null,
      });
    } else if (changed) {
      const who = await cardTextLog.findEditor(auth, projectId, d.id, full.updated_at);
      await activityLog.logDiff({
        projectId, recordingType: 'Document', recordingId: d.id, prevRow: prev, currRow: full,
        who, appUrl: bc.normalizeAppUrl(full.app_url || ''), parentTitle, bcUpdatedAt: full.updated_at,
      });
    }
  } catch (err) {
    console.warn('[pm-agent] doc activity log failed:', d.id, err.message);
  }

  await execute(
    `INSERT INTO bc_vault_snap (item_id, project_id, vault_id, kind, title, content, app_url, bc_created_at, bc_updated_at, active, synced_at)
     VALUES ($1,$2,$3,'document',$4,$5,$6,$7,$8,TRUE,NOW())
     ON CONFLICT (item_id) DO UPDATE SET title=$4, content=$5, app_url=$6, bc_updated_at=$8, active=TRUE, synced_at=NOW()`,
    [d.id, projectId, vaultId, full.title || '', full.content || '',
     bc.normalizeAppUrl(full.app_url || ''), full.created_at || null, full.updated_at || null]
  );
}

// Файловете (Uploads) са двоични — не се диф-ва съдържание, само заглавие/име.
async function syncVaultUpload(auth, projectId, vaultId, u, parentTitle) {
  const title = String(u.title || u.filename || '').trim();
  const prev = await queryOne(`SELECT title FROM bc_vault_snap WHERE item_id = $1`, [u.id]);

  try {
    if (!prev) {
      await activityLog.logEvent({
        projectId, recordingType: 'Upload', recordingId: u.id, event: 'created',
        title, parentTitle, appUrl: bc.normalizeAppUrl(u.app_url || ''), bcUpdatedAt: u.updated_at || null,
      });
    } else if (String(prev.title || '').trim() !== title) {
      await activityLog.logDiff({
        projectId, recordingType: 'Upload', recordingId: u.id,
        prevRow: { title: prev.title }, currRow: { title }, who: null,
        appUrl: bc.normalizeAppUrl(u.app_url || ''), parentTitle, bcUpdatedAt: u.updated_at, hasContent: false,
      });
    }
  } catch (err) {
    console.warn('[pm-agent] upload activity log failed:', u.id, err.message);
  }

  await execute(
    `INSERT INTO bc_vault_snap (item_id, project_id, vault_id, kind, title, app_url, bc_created_at, bc_updated_at, active, synced_at)
     VALUES ($1,$2,$3,'upload',$4,$5,$6,$7,TRUE,NOW())
     ON CONFLICT (item_id) DO UPDATE SET title=$4, app_url=$5, bc_updated_at=$7, active=TRUE, synced_at=NOW()`,
    [u.id, projectId, vaultId, title, bc.normalizeAppUrl(u.app_url || ''), u.created_at || null, u.updated_at || null]
  );
}

// Обхожда една папка + рекурсивно подпапките ѝ. `ctx.errors` брои провалени
// заявки — ако има поне една, по-нагоре НЕ се засича изтриване (частичен обход
// би объркал реално съществуващ файл с изтрит).
async function syncVaultFolder(auth, projectId, vaultId, parentTitle, depth, ctx) {
  // Твърде дълбоко — не се обхожда по-нататък. Брои се като грешка (не просто
  // пропуск), иначе тези файлове биха изчезнали от `seen` и следващият цикъл
  // би ги отчел за „изтрити", макар да просто не сме стигнали до тях.
  if (depth > VAULT_MAX_DEPTH) { ctx.errors += 1; return; }
  let docs = [];
  let uploads = [];
  let folders = [];
  try {
    docs = await bc.getVaultDocuments(auth.token, auth.account, projectId, vaultId);
  } catch (err) { ctx.errors += 1; console.warn('[pm-agent] vault docs failed:', vaultId, err.message); }
  try {
    uploads = await bc.getVaultUploads(auth.token, auth.account, projectId, vaultId);
  } catch (err) { ctx.errors += 1; console.warn('[pm-agent] vault uploads failed:', vaultId, err.message); }
  try {
    folders = await bc.getVaultFolders(auth.token, auth.account, projectId, vaultId);
  } catch (err) { ctx.errors += 1; console.warn('[pm-agent] vault folders failed:', vaultId, err.message); }

  for (const d of docs) {
    ctx.seen.push(d.id);
    try { await syncVaultDocument(auth, projectId, vaultId, d, parentTitle, ctx); }
    catch (err) { console.warn('[pm-agent] vault document sync failed:', d.id, err.message); }
  }
  for (const u of uploads) {
    ctx.seen.push(u.id);
    try { await syncVaultUpload(auth, projectId, vaultId, u, parentTitle); }
    catch (err) { console.warn('[pm-agent] vault upload sync failed:', u.id, err.message); }
  }
  await mapLimit(folders, VAULT_CONCURRENCY, (f) =>
    syncVaultFolder(auth, projectId, f.id, f.title || parentTitle, depth + 1, ctx));
}

// Синхронизира целия Docs&Files инструмент на един проект (ако е включен).
async function syncProjectVault(auth, project) {
  const projectId = project.id;
  const vault = dockTool(project, 'vault');
  if (!vault || !vault.id) return { docs: 0 };
  const ctx = { seen: [], errors: 0 };
  try {
    await syncVaultFolder(auth, projectId, vault.id, project.name || '', 0, ctx);
  } catch (err) {
    ctx.errors += 1;
    console.warn('[pm-agent] vault sync failed:', projectId, err.message);
  }
  if (ctx.errors === 0 && ctx.seen.length) {
    try {
      const dropped = await query(
        `SELECT item_id, kind, title, app_url FROM bc_vault_snap
          WHERE project_id = $1 AND active = TRUE AND item_id != ALL($2::bigint[])`,
        [projectId, ctx.seen]
      );
      for (const row of dropped) {
        await activityLog.logEvent({
          projectId, recordingType: row.kind === 'upload' ? 'Upload' : 'Document', recordingId: row.item_id,
          event: 'deleted', title: row.title || '', appUrl: row.app_url || '',
        });
      }
      if (dropped.length) {
        await execute('UPDATE bc_vault_snap SET active = FALSE WHERE project_id = $1 AND item_id != ALL($2::bigint[])',
          [projectId, ctx.seen]);
      }
    } catch (err) {
      console.warn('[pm-agent] vault drop detection failed:', projectId, err.message);
    }
  }
  return { docs: ctx.seen.length };
}

// ---------- Message board — създаване/редакция/изтриване ----------
async function syncProjectMessageBoard(auth, project) {
  const projectId = project.id;
  const board = dockTool(project, 'message_board');
  if (!board || !board.id) return { messages: 0 };
  let messages = [];
  try {
    messages = await bc.getMessages(auth.token, auth.account, projectId, board.id);
  } catch (err) {
    console.warn('[pm-agent] messages fetch failed:', projectId, err.message);
    return { messages: 0 };
  }

  const seen = [];
  for (const m of messages) {
    seen.push(m.id);
    const prev = await queryOne(
      `SELECT bc_updated_at, subject, content FROM bc_messages_snap WHERE message_id = $1`, [m.id]);
    const listUpdated = m.updated_at ? new Date(m.updated_at).toISOString() : '';
    const prevUpdated = prev && prev.bc_updated_at ? new Date(prev.bc_updated_at).toISOString() : '';
    const changed = !prev || listUpdated !== prevUpdated;
    try {
      if (!prev) {
        await activityLog.logEvent({
          projectId, recordingType: 'Message', recordingId: m.id, event: 'created',
          title: m.subject || m.title || '', parentTitle: board.title || project.name || '',
          appUrl: bc.normalizeAppUrl(m.app_url || ''), bcUpdatedAt: m.updated_at || null,
        });
      } else if (changed) {
        const who = await cardTextLog.findEditor(auth, projectId, m.id, m.updated_at);
        await activityLog.logDiff({
          projectId, recordingType: 'Message', recordingId: m.id,
          prevRow: { title: prev.subject, content: prev.content },
          currRow: { title: m.subject || m.title || '', content: m.content || '' },
          who, appUrl: bc.normalizeAppUrl(m.app_url || ''), parentTitle: board.title || project.name || '',
          bcUpdatedAt: m.updated_at,
        });
      }
    } catch (err) {
      console.warn('[pm-agent] message activity log failed:', m.id, err.message);
    }
    await upsertMessage({ ...m, bucket: { id: projectId } });
  }

  if (seen.length) {
    try {
      const dropped = await query(
        `SELECT message_id, subject, app_url FROM bc_messages_snap
          WHERE project_id = $1 AND active = TRUE AND message_id != ALL($2::bigint[])`,
        [projectId, seen]
      );
      for (const row of dropped) {
        await activityLog.logEvent({
          projectId, recordingType: 'Message', recordingId: row.message_id, event: 'deleted',
          title: row.subject || '', appUrl: row.app_url || '',
        });
      }
      if (dropped.length) {
        await execute('UPDATE bc_messages_snap SET active = FALSE WHERE project_id = $1 AND message_id != ALL($2::bigint[])',
          [projectId, seen]);
      }
    } catch (err) {
      console.warn('[pm-agent] message drop detection failed:', projectId, err.message);
    }
  }
  return { messages: seen.length };
}

// ---------- To-dos — създаване/редакция/завършване/изтриване (клиентски проекти) ----------
async function syncProjectTodos(auth, project) {
  const projectId = project.id;
  const todoset = dockTool(project, 'todoset');
  if (!todoset || !todoset.id) return { todos: 0 };
  let lists = [];
  try {
    lists = await bc.getTodoLists(auth.token, auth.account, projectId, todoset.id);
  } catch (err) {
    console.warn('[pm-agent] todolists fetch failed:', projectId, err.message);
    return { todos: 0 };
  }

  const seen = [];
  for (const list of lists) {
    let open = [];
    let done = [];
    try {
      open = await bc.getTodos(auth.token, auth.account, projectId, list.id, { completed: false });
      done = await bc.getTodos(auth.token, auth.account, projectId, list.id, { completed: true });
    } catch (err) {
      console.warn('[pm-agent] todos fetch failed:', list.id, err.message);
      continue; // тази задача-листа пропускаме, но продължаваме с останалите
    }
    const listMeta = { id: list.id, title: list.title || list.name || '' };
    for (const td of [...open, ...done]) {
      seen.push(td.id);
      const prev = await queryOne(
        `SELECT bc_updated_at, title, description, completed FROM bc_todos_snap WHERE todo_id = $1`, [td.id]);
      const listUpdated = td.updated_at ? new Date(td.updated_at).toISOString() : '';
      const prevUpdated = prev && prev.bc_updated_at ? new Date(prev.bc_updated_at).toISOString() : '';
      const changed = !prev || listUpdated !== prevUpdated;
      try {
        if (!prev) {
          await activityLog.logEvent({
            projectId, recordingType: 'Todo', recordingId: td.id, event: 'created',
            title: td.content || td.title || '', parentTitle: listMeta.title,
            appUrl: bc.normalizeAppUrl(td.app_url || ''), bcUpdatedAt: td.updated_at || null,
          });
        } else if (changed) {
          if (!prev.completed && td.completed) {
            await activityLog.logEvent({
              projectId, recordingType: 'Todo', recordingId: td.id, event: 'completed',
              title: td.content || td.title || '', parentTitle: listMeta.title,
              appUrl: bc.normalizeAppUrl(td.app_url || ''), bcUpdatedAt: td.updated_at || null,
            });
          }
          const who = await cardTextLog.findEditor(auth, projectId, td.id, td.updated_at);
          await activityLog.logDiff({
            projectId, recordingType: 'Todo', recordingId: td.id,
            prevRow: { title: prev.title, content: prev.description },
            currRow: { title: td.content || td.title || '', content: td.description || '' },
            who, appUrl: bc.normalizeAppUrl(td.app_url || ''), parentTitle: listMeta.title,
            bcUpdatedAt: td.updated_at,
          });
        }
      } catch (err) {
        console.warn('[pm-agent] todo activity log failed:', td.id, err.message);
      }
      await upsertTodo({ ...td, bucket: { id: projectId } }, listMeta);
    }
  }

  if (seen.length) {
    try {
      const dropped = await query(
        `SELECT todo_id, title, app_url FROM bc_todos_snap
          WHERE project_id = $1 AND active = TRUE AND todo_id != ALL($2::bigint[])`,
        [projectId, seen]
      );
      for (const row of dropped) {
        await activityLog.logEvent({
          projectId, recordingType: 'Todo', recordingId: row.todo_id, event: 'deleted',
          title: row.title || '', appUrl: row.app_url || '',
        });
      }
      if (dropped.length) {
        await execute('UPDATE bc_todos_snap SET active = FALSE WHERE project_id = $1 AND todo_id != ALL($2::bigint[])',
          [projectId, seen]);
      }
    } catch (err) {
      console.warn('[pm-agent] todo drop detection failed:', projectId, err.message);
    }
  }
  return { todos: seen.length };
}

// Docs&Files + message board за ВСИЧКИ проекти (Video Production и клиентските
// еднакво — dockTool() просто връща null, ако инструментът не е включен там).
// To-dos само там, където има todoset (Video Production работи с карти, не с тях).
async function syncAllProjectTools(auth, projects) {
  const stats = { vaultDocs: 0, boardMessages: 0, todos: 0 };
  await mapLimit(projects, 2, async (p) => {
    try {
      const r = await syncProjectVault(auth, p);
      stats.vaultDocs += r.docs || 0;
    } catch (err) { console.warn('[pm-agent] vault failed for project', p.id, err.message); }
    try {
      const r = await syncProjectMessageBoard(auth, p);
      stats.boardMessages += r.messages || 0;
    } catch (err) { console.warn('[pm-agent] message board failed for project', p.id, err.message); }
    try {
      const r = await syncProjectTodos(auth, p);
      stats.todos += r.todos || 0;
    } catch (err) { console.warn('[pm-agent] todos failed for project', p.id, err.message); }
  });
  return stats;
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
  let textChanges = 0;
  let dateChanges = 0;
  let stageChanges = 0;

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
            `SELECT bc_updated_at, comments_count, title, content, due_on, steps, board_title
               FROM bc_cards_snap WHERE card_id = $1`, [c.id]);
          const listUpdated = c.updated_at ? new Date(c.updated_at).toISOString() : '';
          const prevUpdated = prev && prev.bc_updated_at ? new Date(prev.bc_updated_at).toISOString() : '';
          const changed = !prev || listUpdated !== prevUpdated;

          // Дневникът на датите („Due on" + датите по стъпките) се сверява ВИНАГИ и
          // от списъчния payload — той вече носи due_on и steps, тоест не струва
          // нито една допълнителна заявка. Причината да не се пази за после:
          // смяна на дата по стъпка невинаги вдига `updated_at` на картата, така че
          // проверката „нищо ново" би я изпуснала завинаги.
          let dateLogged = 0;
          if (dateChanges < TEXT_LOG_MAX_PER_SYNC) {
            try {
              dateLogged = await cardTextLog.logCardDateChange(auth, c, prev, { projectId, boardTitle });
              dateChanges += dateLogged;
            } catch (err) {
              console.warn('[pm-agent] date log failed:', c.id, err.message);
            }
          }
          // Дневникът на етапите (кой отдел я е поел + кои стъпки са чекнати) —
          // също от списъчния payload, по същата причина като датите: местене
          // между дъски и чекване на стъпка невинаги вдигат `updated_at`.
          let stageLogged = 0;
          if (stageChanges < TEXT_LOG_MAX_PER_SYNC) {
            try {
              stageLogged = await stageLog.logStageTransitions(auth, c, prev, {
                projectId, boardTitle, columnTitle: list.title || '', onHold: g.onHold,
              });
              stageChanges += stageLogged;
            } catch (err) {
              console.warn('[pm-agent] stage log failed:', c.id, err.message);
            }
          }
          // Засечена ли е промяна по датите или етапите, картата задължително се
          // преписва — иначе снапшотът остава на старото и същата промяна се
          // записва пак на всеки 15 минути.
          if (!changed && !deep && !dateLogged && !stageLogged) continue; // нищо ново по картата
          let full = c;
          let fullFetched = false;
          try {
            full = await bc.getCard(auth.token, auth.account, projectId, c.id);
            fullFetched = true;
          } catch (err) {
            console.warn('[pm-agent] getCard failed:', c.id, err.message);
          }
          // Провали ли се getCard, остава списъчният payload — а той може да е без
          // `content`. Тогава се пази вече записаният текст: празно поле в снапшота
          // би минало за „изтрит текст" и на следващия sync би родило лъжлив запис.
          if (!fullFetched && prev && full.content == null) full = { ...full, content: prev.content };
          // Дневникът на текста — ПРЕДИ upsert-а, докато старата версия още стои в
          // снапшота. Само при успешен getCard: списъчният payload няма content и
          // празното поле би минало за „изтрит текст".
          // Таванът е предпазител: всяка засечена промяна пита Basecamp кой я е
          // направил, а един цикъл не бива да се превърне в стотици заявки.
          if (fullFetched && textChanges < TEXT_LOG_MAX_PER_SYNC) {
            try {
              textChanges += await cardTextLog.logCardTextChange(auth, full, prev, { projectId, boardTitle });
            } catch (err) {
              console.warn('[pm-agent] text log failed:', c.id, err.message);
            }
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
    // Отпадналите карти (изчезнали от активните дъски — местени в Trash,
    // архивирани или отказан проект) си остават в снапшота (active = FALSE),
    // но БЕЗ следа кой отдел ги е държал в момента на отпадането. Затова
    // последното им познато състояние се пази в дневника ПРЕДИ UPDATE-а.
    const dropped = await query(
      `SELECT card_id, project_id, title, app_url, board_title, column_title, due_on, assignees, on_hold
         FROM bc_cards_snap WHERE project_id = $1 AND active = TRUE AND card_id != ALL($2::bigint[])`,
      [projectId, seen]
    );
    for (const row of dropped) {
      try {
        await stageLog.logCardArchived(row);
      } catch (err) {
        console.warn('[pm-agent] archive log failed:', row.card_id, err.message);
      }
    }
    await execute(
      'UPDATE bc_cards_snap SET active = FALSE WHERE project_id = $1 AND card_id != ALL($2::bigint[])',
      [projectId, seen]
    );
  }
  return { cards: seen.length, comments: commentsFetched, textChanges, dateChanges, stageChanges };
}

// Campfire (чат) на клиентските проекти — периодично, само на всеки 4-ти цикъл
// (виж runSync). Съобщенията/задачите минаха в syncAllProjectTools, където се
// диф-логват и засичат изтритите, вместо да се презаписват тихо.
async function syncClientProjects(auth, projects, { withCampfires = false } = {}) {
  const teamId = String(config.BASECAMP_TEAM_PROJECT_ID);
  const others = projects.filter((p) => String(p.id) !== teamId);
  const stats = { campfireLines: 0 };
  if (!withCampfires) return stats;

  await mapLimit(others, 3, async (p) => {
    try {
      const chat = dockTool(p, 'chat');
      if (chat && chat.id) {
        const lines = await bc.getCampfireLines(auth.token, auth.account, p.id, chat.id, 2);
        for (const ln of lines) await upsertCampfireLine(ln, p.id, chat.id);
        stats.campfireLines += lines.length;
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
    await ensureSnapshotSchema();
    const auth = await getReadAuth();
    const empty = !(await queryOne('SELECT 1 AS x FROM bc_projects LIMIT 1'));
    const isFull = full || empty;
    runCounter += 1;

    const projects = await syncProjects(auth);
    const cardStats = await syncTeamCards(auth, { deep: isFull });

    let clientStats = { campfireLines: 0 };
    let sweepStats = { comments: 0, messages: 0, todos: 0 };
    let toolsStats = { vaultDocs: 0, boardMessages: 0, todos: 0 };
    if (isFull) {
      clientStats = await syncClientProjects(auth, projects, { withCampfires: true });
      toolsStats = await syncAllProjectTools(auth, projects);
      const horizon = new Date(Date.now() - COMMENT_HORIZON_DAYS * 24 * 3600_000).toISOString();
      sweepStats = await syncRecordingsSince(auth, horizon);
    } else {
      const last = await lastGoodSyncAt();
      // 30 мин застъпване — да не изпуснем нищо около границата.
      const since = last ? new Date(last.getTime() - 30 * 60_000).toISOString()
        : new Date(Date.now() - COMMENT_HORIZON_DAYS * 24 * 3600_000).toISOString();
      sweepStats = await syncRecordingsSince(auth, since);
      // Docs&Files, message board, to-dos, campfire — на всеки 4-ти цикъл (веднъж
      // на час): за да засечем изтриване трябва пълен обход, а не "since" заявка.
      if (runCounter % 4 === 0) {
        clientStats = await syncClientProjects(auth, projects, { withCampfires: true });
        toolsStats = await syncAllProjectTools(auth, projects);
      }
    }

    const stats = {
      trigger, full: isFull, seconds: Math.round((Date.now() - started) / 1000),
      projects: projects.length, ...cardStats,
      client: clientStats, sweep: sweepStats, tools: toolsStats,
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
