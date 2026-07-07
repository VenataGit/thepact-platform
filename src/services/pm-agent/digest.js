// PM Agent — дневен дайджест + watchdog „чакащи клиенти" (Фаза 4).
//
// Дайджест: cron (настройваем час, делнични дни) → Opus обобщава промените от
// последния дайджест + текущите рискове → Basecamp съобщение от ThePactAlerts
// с известие само до Венци.
// Watchdog: на всеки час, БЕЗ LLM (детерминистичен SQL) — клиент е писал
// (коментар/съобщение/campfire), екипът мълчи над N часа → аларма. Всеки
// клиентски запис алармира най-много веднъж (agent_alerts).
const cron = require('node-cron');
const config = require('../../config');
const { query, queryOne, execute } = require('../../db/pool');
const { callClaude, MODEL } = require('./claude');
const { isEnabled } = require('./snapshot');
const { sanitizeReportHtml, postReport, TODAY } = require('./audit');

const TZ = 'Europe/Sofia';
let digestJob = null;
let watchdogJob = null;
let digestRunning = false;

async function loadCfg() {
  const rows = await query("SELECT key, value FROM settings WHERE key LIKE 'pm_agent_%'");
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  return {
    digestEnabled: s.pm_agent_digest_enabled === 'true',
    digestTime: /^\d{1,2}:\d{2}$/.test(s.pm_agent_digest_time || '') ? s.pm_agent_digest_time : '08:30',
    digestWeekends: s.pm_agent_digest_weekends === 'true',
    watchdogEnabled: s.pm_agent_watchdog_enabled === 'true',
    watchdogHours: Math.max(1, parseInt(s.pm_agent_watchdog_hours) || 24),
  };
}

function initPmDigest() {
  restartPmDigest().catch((err) => console.log('  PM Agent digest: skipped —', err.message));
}

async function restartPmDigest() {
  if (digestJob) { digestJob.stop(); digestJob = null; }
  if (watchdogJob) { watchdogJob.stop(); watchdogJob = null; }
  const cfg = await loadCfg();
  if (cfg.digestEnabled) {
    const [h, m] = cfg.digestTime.split(':').map(Number);
    const dow = cfg.digestWeekends ? '*' : '1-5';
    digestJob = cron.schedule(`${m} ${h} * * ${dow}`, () => {
      runDigest({ trigger: 'cron' }).catch((err) => console.error('[pm-agent] digest error:', err.message));
    }, { timezone: TZ });
    console.log(`  PM Agent digest: active (${cfg.digestTime}, ${dow === '*' ? 'всеки ден' : 'делнични'})`);
  }
  if (cfg.watchdogEnabled) {
    watchdogJob = cron.schedule('7 * * * *', () => {
      runWatchdog().catch((err) => console.error('[pm-agent] watchdog error:', err.message));
    }, { timezone: TZ });
    console.log(`  PM Agent watchdog: active (на всеки час, праг ${cfg.watchdogHours}ч)`);
  }
}

// ---------- дайджест ----------

function ymd(d) {
  if (!d) return '';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '' : dt.toISOString().slice(0, 10);
}
function stripHtml(html) {
  return String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}
function cap(t, n) { const s = String(t || ''); return s.length > n ? `${s.slice(0, n)}…` : s; }

async function digestSince() {
  const row = await queryOne(
    "SELECT started_at FROM agent_runs WHERE kind = 'digest' AND status = 'done' ORDER BY id DESC LIMIT 1");
  const last = row && row.started_at ? new Date(row.started_at) : null;
  const dayAgo = new Date(Date.now() - 24 * 3600_000);
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000);
  const since = last || dayAgo;
  return since < weekAgo ? weekAgo : since;
}

async function buildDigestCorpus(sinceIso) {
  const teamId = config.BASECAMP_TEAM_PROJECT_ID;
  const out = [];

  const cards = await query(
    `SELECT title, board_title, column_title, due_on, completed, app_url FROM bc_cards_snap
     WHERE project_id = $1 AND active AND bc_updated_at > $2 ORDER BY board_title LIMIT 120`, [teamId, sinceIso]);
  if (cards.length) {
    out.push('=== ПРОМЕНЕНИ/НОВИ КАРТИ (Video Production) ===');
    for (const c of cards) out.push(`- [${c.board_title} / ${c.column_title}] ${c.title}${c.completed ? ' [ЗАВЪРШЕНА]' : ''} | срок: ${ymd(c.due_on) || 'няма'} | ${c.app_url}`);
  }

  const comments = await query(
    `SELECT c.parent_title, c.creator_name, c.creator_is_client, c.content, c.app_url, p.name AS project
     FROM bc_comments_snap c LEFT JOIN bc_projects p ON p.project_id = c.project_id
     WHERE c.bc_created_at > $1 ORDER BY c.bc_created_at LIMIT 150`, [sinceIso]);
  if (comments.length) {
    out.push('\n=== НОВИ КОМЕНТАРИ (всички проекти) ===');
    for (const c of comments) out.push(`- [${c.project || '?'}] ${c.creator_name}${c.creator_is_client ? ' (КЛИЕНТ)' : ''} под "${c.parent_title}": ${cap(stripHtml(c.content), 350)} | ${c.app_url}`);
  }

  const messages = await query(
    `SELECT m.subject, m.creator_name, m.creator_is_client, m.content, m.app_url, p.name AS project
     FROM bc_messages_snap m LEFT JOIN bc_projects p ON p.project_id = m.project_id
     WHERE m.bc_created_at > $1 ORDER BY m.bc_created_at LIMIT 50`, [sinceIso]);
  if (messages.length) {
    out.push('\n=== НОВИ СЪОБЩЕНИЯ ===');
    for (const m of messages) out.push(`- [${m.project || '?'}] ${m.creator_name}${m.creator_is_client ? ' (КЛИЕНТ)' : ''}: "${m.subject}" — ${cap(stripHtml(m.content), 400)} | ${m.app_url}`);
  }

  const lines = await query(
    `SELECT l.creator_name, l.creator_is_client, l.content, p.name AS project
     FROM bc_campfire_lines_snap l LEFT JOIN bc_projects p ON p.project_id = l.project_id
     WHERE l.bc_created_at > $1 ORDER BY l.bc_created_at LIMIT 80`, [sinceIso]);
  if (lines.length) {
    out.push('\n=== НОВ CAMPFIRE ЧАТ ===');
    for (const l of lines) out.push(`- [${l.project || '?'}] ${l.creator_name}${l.creator_is_client ? ' (КЛИЕНТ)' : ''}: ${cap(stripHtml(l.content), 250)}`);
  }

  // Текущи рискове — винаги, независимо от промените.
  const overdue = await query(
    `SELECT title, board_title, column_title, due_on, app_url FROM bc_cards_snap
     WHERE project_id = $1 AND active AND NOT completed AND due_on < CURRENT_DATE
       AND column_title !~* '^(done|готово)' ORDER BY due_on LIMIT 40`, [teamId]);
  if (overdue.length) {
    out.push('\n=== ПРОСРОЧЕНИ КАРТИ (към момента) ===');
    for (const c of overdue) out.push(`- [${c.board_title} / ${c.column_title}] ${c.title} | срок: ${ymd(c.due_on)} | ${c.app_url}`);
  }
  const noDue = await query(
    `SELECT title, board_title, column_title, app_url FROM bc_cards_snap
     WHERE project_id = $1 AND active AND NOT completed AND due_on IS NULL
       AND column_title !~* '^(done|готово|not now)' LIMIT 40`, [teamId]);
  if (noDue.length) {
    out.push('\n=== КАРТИ БЕЗ СРОК ===');
    for (const c of noDue) out.push(`- [${c.board_title} / ${c.column_title}] ${c.title} | ${c.app_url}`);
  }

  const waiting = await findWaitingClients(24, { onlyNew: false });
  if (waiting.length) {
    out.push('\n=== КЛИЕНТИ БЕЗ ОТГОВОР ОТ ЕКИПА (24ч+) ===');
    for (const w of waiting) out.push(`- [${w.project}] ${w.who} (${w.kind}, ${ymd(w.at)}): ${cap(w.text, 300)}${w.url ? ` | ${w.url}` : ''}`);
  }

  return out.join('\n');
}

async function runDigest({ trigger = 'cron' } = {}) {
  if (digestRunning) return { skipped: 'already-running' };
  if (trigger === 'cron' && !(await isEnabled())) return { skipped: 'disabled' };
  digestRunning = true;
  let runId = null;
  const stats = { trigger, model: MODEL };
  try {
    const runRow = await queryOne(
      "INSERT INTO agent_runs (kind, status, stats) VALUES ('digest', 'running', $1) RETURNING id",
      [JSON.stringify(stats)]);
    runId = runRow.id;

    const since = await digestSince();
    const corpus = await buildDigestCorpus(since.toISOString());
    if (!corpus.trim()) {
      await execute("UPDATE agent_runs SET status = 'done', stats = $2, finished_at = NOW() WHERE id = $1",
        [runId, JSON.stringify({ ...stats, empty: true })]);
      return { runId, empty: true };
    }

    const res = await callClaude({
      system: `Ти си PM Agent на The Pact. Пишеш кратък сутрешен дайджест за Венци (основателя). Днес е ${TODAY()}. Данните са промените от ${since.toLocaleString('bg-BG', { timeZone: 'Europe/Sofia' })} насам + текущите рискове.`,
      messages: [{
        role: 'user',
        content: `Направи дневен дайджест. Върни САМО HTML фрагмент (тагове: h2, strong, em, ul, ol, li, br, a href, p, div).
Структура: 1) "Най-важното" — 2-4 изречения; 2) "🔴 Изисква действие днес" (с линкове); 3) "🟡 Следи" ; 4) "Ново от вчера" — стегнат списък. Ако няма нищо в дадена секция — пропусни я. Никакви общи приказки; конкретика с линкове.\n\nДАННИ:\n\n${cap(corpus, 500_000)}`,
      }],
      maxTokens: 8000,
      effort: 'high',
    });
    stats.tokens = { input: res.usage.input_tokens, output: res.usage.output_tokens };
    stats.costUsd = Number((((res.usage.input_tokens || 0) * 5 + (res.usage.output_tokens || 0) * 25) / 1_000_000).toFixed(2));
    let html = sanitizeReportHtml(res.text);
    if (res.stopReason === 'max_tokens') html += '<br><strong>⚠ Дайджестът е отрязан по дължина.</strong>';

    let bcUrl = '';
    try {
      bcUrl = await postReport(html, `🤖 PM Дайджест — ${TODAY()}`);
    } catch (err) {
      console.error('[pm-agent] digest post failed:', err.message);
      stats.postError = err.message;
    }
    await execute(
      "UPDATE agent_runs SET status = 'done', report = $2, bc_message_url = $3, stats = $4, finished_at = NOW() WHERE id = $1",
      [runId, html, bcUrl, JSON.stringify(stats)]);
    console.log('[pm-agent] digest done:', JSON.stringify(stats));
    return { runId, bcUrl, stats };
  } catch (err) {
    if (runId) {
      await execute("UPDATE agent_runs SET status = 'error', error = $2, finished_at = NOW() WHERE id = $1",
        [runId, String(err.message || err).slice(0, 2000)]).catch(() => {});
    }
    throw err;
  } finally {
    digestRunning = false;
  }
}

// ---------- watchdog „чакащи клиенти" ----------

// Клиентски записи без последвала реакция от екипа. onlyNew=true връща само
// тези, за които още няма аларма (и е готово за insert в agent_alerts).
async function findWaitingClients(hours, { onlyNew = true } = {}) {
  const cutoff = `NOW() - INTERVAL '${Math.max(1, Math.floor(hours))} hours'`;
  const horizon = "NOW() - INTERVAL '14 days'";
  const newCond = onlyNew ? 'AND a.ref_key IS NULL' : '';
  const out = [];

  // 1) Клиентски коментар без по-късен екипен коментар под същия parent.
  const comments = await query(
    `SELECT c.comment_id, c.parent_title, c.creator_name, c.content, c.app_url, c.bc_created_at, p.name AS project, c.project_id
     FROM bc_comments_snap c
     LEFT JOIN bc_projects p ON p.project_id = c.project_id
     LEFT JOIN agent_alerts a ON a.ref_key = 'comment:' || c.comment_id
     WHERE c.creator_is_client AND c.bc_created_at < ${cutoff} AND c.bc_created_at > ${horizon} ${newCond}
       AND NOT EXISTS (SELECT 1 FROM bc_comments_snap c2 WHERE c2.parent_id = c.parent_id
                       AND NOT c2.creator_is_client AND c2.bc_created_at > c.bc_created_at)
     ORDER BY c.bc_created_at LIMIT 30`);
  for (const c of comments) {
    out.push({ refKey: `comment:${c.comment_id}`, kind: 'коментар', project: c.project || '?', projectId: c.project_id, who: c.creator_name, at: c.bc_created_at, text: stripHtml(c.content), url: c.app_url });
  }

  // 2) Клиентско съобщение без нито един екипен коментар след него.
  const messages = await query(
    `SELECT m.message_id, m.subject, m.creator_name, m.content, m.app_url, m.bc_created_at, p.name AS project, m.project_id
     FROM bc_messages_snap m
     LEFT JOIN bc_projects p ON p.project_id = m.project_id
     LEFT JOIN agent_alerts a ON a.ref_key = 'message:' || m.message_id
     WHERE m.creator_is_client AND m.bc_created_at < ${cutoff} AND m.bc_created_at > ${horizon} ${newCond}
       AND NOT EXISTS (SELECT 1 FROM bc_comments_snap c2 WHERE c2.parent_id = m.message_id
                       AND NOT c2.creator_is_client AND c2.bc_created_at > m.bc_created_at)
     ORDER BY m.bc_created_at LIMIT 20`);
  for (const m of messages) {
    out.push({ refKey: `message:${m.message_id}`, kind: 'съобщение', project: m.project || '?', projectId: m.project_id, who: m.creator_name, at: m.bc_created_at, text: `"${m.subject}" — ${stripHtml(m.content)}`, url: m.app_url });
  }

  // 3) Клиентски campfire ред без по-късен екипен ред в същия проект.
  const lines = await query(
    `SELECT l.line_id, l.creator_name, l.content, l.bc_created_at, p.name AS project, l.project_id
     FROM bc_campfire_lines_snap l
     LEFT JOIN bc_projects p ON p.project_id = l.project_id
     LEFT JOIN agent_alerts a ON a.ref_key = 'campfire:' || l.line_id
     WHERE l.creator_is_client AND l.bc_created_at < ${cutoff} AND l.bc_created_at > ${horizon} ${newCond}
       AND NOT EXISTS (SELECT 1 FROM bc_campfire_lines_snap l2 WHERE l2.project_id = l.project_id
                       AND NOT l2.creator_is_client AND l2.bc_created_at > l.bc_created_at)
     ORDER BY l.bc_created_at LIMIT 20`);
  for (const l of lines) {
    out.push({ refKey: `campfire:${l.line_id}`, kind: 'campfire', project: l.project || '?', projectId: l.project_id, who: l.creator_name, at: l.bc_created_at, text: stripHtml(l.content), url: '' });
  }

  return out;
}

function escHtml(t) {
  return String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function runWatchdog() {
  if (!(await isEnabled())) return { skipped: 'disabled' };
  const cfg = await loadCfg();
  if (!cfg.watchdogEnabled) return { skipped: 'watchdog-disabled' };
  const waiting = await findWaitingClients(cfg.watchdogHours, { onlyNew: true });
  if (!waiting.length) return { alerts: 0 };

  // Дедуп: маркираме ПРЕДИ публикацията (по-добре изгубена аларма от спам).
  for (const w of waiting) {
    await execute(
      'INSERT INTO agent_alerts (kind, ref_key, project_id) VALUES ($1, $2, $3) ON CONFLICT (ref_key) DO NOTHING',
      ['client_waiting', w.refKey, w.projectId || null]);
  }

  const byProject = new Map();
  for (const w of waiting) {
    if (!byProject.has(w.project)) byProject.set(w.project, []);
    byProject.get(w.project).push(w);
  }
  let html = '<div><strong>Клиенти чакат отговор от екипа:</strong></div><br>';
  for (const [project, items] of byProject) {
    html += `<div><strong>${escHtml(project)}</strong></div><ul>`;
    for (const w of items) {
      const link = w.url ? ` — <a href="${escHtml(w.url)}">отвори</a>` : '';
      html += `<li>${escHtml(w.who)} (${escHtml(w.kind)}, ${new Date(w.at).toLocaleString('bg-BG', { timeZone: 'Europe/Sofia' })}): ${escHtml(cap(w.text, 300))}${link}</li>`;
    }
    html += '</ul>';
  }
  let bcUrl = '';
  try {
    bcUrl = await postReport(html, `⚠️ Чакащи клиенти (${waiting.length}) — ${TODAY()}`);
  } catch (err) {
    console.error('[pm-agent] watchdog post failed:', err.message);
  }
  console.log(`[pm-agent] watchdog: ${waiting.length} аларми`);
  return { alerts: waiting.length, bcUrl };
}

module.exports = { initPmDigest, restartPmDigest, runDigest, runWatchdog };
