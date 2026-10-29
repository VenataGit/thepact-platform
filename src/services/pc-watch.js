// Пулс на компютъра в офиса (Венци, 29.10.2026, задача „Кредиси").
//
// Платформата НЕ може да „звънне" на компютъра — той е зад рутера в офиса. Затова е
// обратно: AI агентът там (ai-agent/worker.js, Task Scheduler всяка минута) чука на
// POST /api/ai-queue/heartbeat при всяко пускане, независимо дали е зает. Тук на 5 мин
// гледаме кога е било последното чукане: над 15 мин тишина → таг на Венци в Campfire
// на личния му проект. Докато не работи — сигнал на всеки 15 мин, най-много 3 пъти (Венци,
// 29.10.2026); после тишина. Като тръгне пак — едно „работи" и пак само при проблем.
// Ако компютърът чука, но не намира claude.exe, това също е повреда.
//
// Без AI, без токени: една заявка в минута + една SQL проверка на 5 мин.
const cron = require('node-cron');
const { queryOne, execute } = require('../db/pool');
const bc = require('./basecamp');
const { getServiceAuth } = require('./basecamp-token');
const { mentionOf } = require('./bc-team');

const STALE_MIN = 15;
const MAX_ALERTS = 3;        // най-много толкова сигнала за едно спиране
const REPEAT_MIN = 15;       // интервал между повторните сигнали
const TZ = 'Europe/Sofia';

const getSetting = async (key) => (await queryOne('SELECT value FROM settings WHERE key = $1', [key]))?.value ?? null;
const saveSetting = (key, value) => execute(
  `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
   ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
  [key, String(value)]
);

async function recordHeartbeat({ claudeOk, busy } = {}) {
  await saveSetting('pc_heartbeat_at', new Date().toISOString());
  await saveSetting('pc_heartbeat_info', JSON.stringify({ claudeOk: claudeOk !== false, busy: !!busy }));
}

function fmt(d) {
  return d.toLocaleString('bg-BG', { timeZone: TZ, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

async function notify(html) {
  const project = parseInt(await getSetting('dev_chat_bc_project')) || 47742842; // личният проект на Венци
  const chat = parseInt(await getSetting('dev_chat_bc_chat')) || 10005689776;
  // Имейлите в bc_people идват маскирани от Basecamp → търсим по person ID (Венци = 45460211).
  const personId = parseInt(await getSetting('pc_watch_bc_person')) || 45460211;
  const person = await queryOne('SELECT name, attachable_sgid FROM bc_people WHERE person_id = $1 LIMIT 1', [personId]);
  const auth = await getServiceAuth();
  await bc.createCampfireLine(auth.token, auth.account, project, chat, `${mentionOf(person, 'Венци')} ${html}`);
}

async function check() {
  const at = await getSetting('pc_heartbeat_at');
  if (!at) return; // още никога не е чукал — няма с какво да сравним
  const last = new Date(at);
  let info = {};
  try { info = JSON.parse(await getSetting('pc_heartbeat_info') || '{}'); } catch { /* */ }
  const silentMin = (Date.now() - last.getTime()) / 60000;
  const problem = silentMin > STALE_MIN
    ? `🔴 Компютърът в офиса не се обажда от ${Math.round(silentMin)} мин (последно: ${fmt(last)}). Изключен е, без интернет или агентът е спрял — AI функциите, dev опашката, папките и бекъпът не вървят.`
    : (info.claudeOk === false
      ? '🔴 Компютърът в офиса работи, но не намира Claude Code (claude.exe) — AI функциите и dev опашката не вървят.'
      : null);
  const sent = parseInt(await getSetting('pc_watch_alerts'), 10) || 0;
  if (problem) {
    if (sent >= MAX_ALERTS) return;
    const lastAlert = await getSetting('pc_watch_last_alert');
    if (sent && lastAlert && Date.now() - new Date(lastAlert).getTime() < (REPEAT_MIN - 1) * 60000) return;
    await notify(`${problem} (сигнал ${sent + 1} от ${MAX_ALERTS})`);
    await saveSetting('pc_watch_alerts', sent + 1);
    await saveSetting('pc_watch_last_alert', new Date().toISOString());
    console.warn(`[pc-watch] сигнал ${sent + 1}/${MAX_ALERTS}:`, problem);
  } else if (sent) {
    await notify('🟢 Компютърът в офиса пак работи — всичко е наред.');
    await saveSetting('pc_watch_alerts', 0);
    console.log('[pc-watch] възстановен');
  }
}

function initPcWatch() {
  cron.schedule('*/5 * * * *', () => {
    check().catch((e) => console.error('[pc-watch] проверка:', e.message));
  }, { timezone: TZ });
  console.log(`  PC watch: active (сигнал след ${STALE_MIN} мин тишина)`);
}

module.exports = { initPcWatch, recordHeartbeat, check };
