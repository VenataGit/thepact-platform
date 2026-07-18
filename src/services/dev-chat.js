// Чат бот — „Campfire чат в личния проект на Венци → Claude Code на PC-то му".
//
// Истинските Basecamp Pings (лични съобщения) не се излагат през публичното API,
// затова каналът е Campfire чатът на личния проект на Венци (в него са само той и
// ботът ThePactAlerts → на практика личен). Всеки нов ред, който Венци напише там,
// влиза в опашката dev_chat. Watcher-ът на компютъра му го тегли през /api/dev-chat,
// пуска Claude в разговорен режим (една продължаваща сесия) и връща отговора в чата.
//
// Дедуп: курсорът dev_chat_last_line (settings) пази последния обработен line id.
// Първият полл е само baseline (запомня текущия максимум, не отговаря на стари редове).
// Ботът игнорира СВОИТЕ редове — иначе би отговарял на себе си (безкраен цикъл).
const cron = require('node-cron');
const config = require('../config');
const { query, queryOne, execute } = require('../db/pool');
const bc = require('./basecamp');
const { getServiceAuth } = require('./basecamp-token');

const TZ = 'Europe/Sofia';
let running = false;

function initDevChat() {
  try {
    cron.schedule('* * * * *', () => {
      pollOnce().catch((err) => console.error('[dev-chat] poll error:', err.message));
    }, { timezone: TZ });
    console.log('  Dev Chat: active (every minute)');
  } catch (err) {
    console.log('  Dev Chat: skipped —', err.message);
  }
}

async function loadCfg() {
  const rows = await query(
    "SELECT key, value FROM settings WHERE key IN ('dev_chat_enabled','dev_chat_bc_project','dev_chat_bc_chat','dev_chat_owner_email','dev_chat_last_line')"
  );
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  return {
    enabled: s.dev_chat_enabled !== 'false',                    // default включено
    project: parseInt(s.dev_chat_bc_project) || 47742842,       // личният проект на Венци
    chat: parseInt(s.dev_chat_bc_chat) || 10005689776,          // Campfire чатът в него
    ownerEmail: (s.dev_chat_owner_email || '').toLowerCase(),   // празно = всеки не-бот ред
    lastLine: s.dev_chat_last_line ? Number(s.dev_chat_last_line) : null,
  };
}

const saveSetting = (key, value) => execute(
  `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
   ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
  [key, String(value)]
);

function isBot(line) {
  return String(line.creator?.email_address || '').toLowerCase() === config.BASECAMP_SERVICE_EMAIL;
}

// Campfire content е rich HTML — за промпта го връщаме като чист текст.
function toPlain(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function pollOnce() {
  if (running) return;
  running = true;
  try {
    const cfg = await loadCfg();
    if (!cfg.enabled) return;

    // Backstop: заседнал running (watcher убит по средата / login счупен) → обратно в
    // опашката. Прагът е над лимита на сесията (60 мин), за да не пре-claim-нем жив run.
    await execute(
      "UPDATE dev_chat SET status = 'pending', updated_at = NOW() WHERE status = 'running' AND updated_at < NOW() - INTERVAL '70 minutes'"
    );

    const auth = await getServiceAuth();
    const lines = await bc.getCampfireLines(auth.token, auth.account, cfg.project, cfg.chat, 2);
    if (!Array.isArray(lines) || !lines.length) return;

    const maxId = lines.reduce((m, l) => Math.max(m, Number(l.id) || 0), 0);

    // Baseline: първо включване — запомни докъде сме, не отговаряй на стар чат.
    if (cfg.lastLine === null) {
      await saveSetting('dev_chat_last_line', maxId);
      console.log(`[dev-chat] baseline: курсор на ред ${maxId} (стар чат се пропуска)`);
      return;
    }

    // Нови редове от Венци (не от бота), възходящо по id.
    const fresh = lines
      .filter((l) => Number(l.id) > cfg.lastLine && !isBot(l))
      .filter((l) => !cfg.ownerEmail || String(l.creator?.email_address || '').toLowerCase() === cfg.ownerEmail)
      .sort((a, b) => Number(a.id) - Number(b.id));

    for (const l of fresh) {
      const text = toPlain(l.content);
      if (!text) continue; // празен ред / само стикер
      await execute(
        `INSERT INTO dev_chat (bc_line_id, message) VALUES ($1, $2)
         ON CONFLICT (bc_line_id) DO NOTHING`,
        [l.id, text.slice(0, 8000)]
      );
      console.log(`[dev-chat] нов въпрос от чата (ред ${l.id})`);
    }

    // Курсорът тръгва до максимума (вкл. редовете на бота) — без повторно четене.
    if (maxId > cfg.lastLine) await saveSetting('dev_chat_last_line', maxId);
  } finally {
    running = false;
  }
}

// Атомарно взимане на следващото чакащо съобщение (watcher-ът го заключва като running).
// attempts е и fencing токен (връща се при /complete). Session id-то на разговора е
// глобално (dev_chat_session_id) — една продължаваща сесия през всички съобщения.
async function claimNextChat() {
  const msg = await queryOne(
    `UPDATE dev_chat SET status = 'running', attempts = attempts + 1, updated_at = NOW()
     WHERE id = (SELECT id FROM dev_chat WHERE status = 'pending' ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
     RETURNING *`
  );
  if (!msg) return null;
  const s = await queryOne("SELECT value FROM settings WHERE key = 'dev_chat_session_id'");
  return { id: msg.id, message: msg.message, attempt: msg.attempts, session_id: s?.value || null };
}

module.exports = { initDevChat, pollOnce, claimNextChat, saveSetting, toPlain };
