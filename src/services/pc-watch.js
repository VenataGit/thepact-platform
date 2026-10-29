// Пулс на компютъра в офиса (Венци, 29.10.2026, задача „Кредиси").
//
// Платформата НЕ може да „звънне" на компютъра — той е зад рутера в офиса. Затова е
// обратно: AI агентът там (ai-agent/worker.js, Task Scheduler всяка минута) чука на
// POST /api/ai-queue/heartbeat при всяко пускане, независимо дали е зает. Тук на 5 мин
// гледаме кога е било последното чукане: над 15 мин тишина → таг на Венци в Campfire
// „Chat - Венцислав Калчев - бизнес" (личният проект) — чатът е САМО за тези сигнали. Докато не работи — сигнал на всеки 15 мин, най-много 3 пъти (Венци,
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

// Всичко, което агентът прати (host, uptime, Z:, свободно място…), се пази за сигнала.
async function recordHeartbeat(body = {}) {
  const info = { ...body, claudeOk: body.claudeOk !== false, busy: !!body.busy };
  await saveSetting('pc_heartbeat_at', new Date().toISOString());
  await saveSetting('pc_heartbeat_info', JSON.stringify(info));
}

function fmt(d) {
  return d.toLocaleString('bg-BG', { timeZone: TZ, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

function dur(min) {
  min = Math.max(0, Math.round(min));
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60), m = min % 60;
  return h < 24 ? `${h} ч ${m} мин` : `${Math.floor(h / 24)} д ${h % 24} ч`;
}

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Колко работа чака заради спирането (таблиците може да ги няма → null).
async function backlog() {
  const count = async (sql) => { try { return Number((await queryOne(sql)).n); } catch { return null; } };
  const lastAi = await queryOne("SELECT MAX(finished_at) AS t FROM ai_jobs WHERE status = 'done'").catch(() => null);
  return {
    ai: await count("SELECT COUNT(*) AS n FROM ai_jobs WHERE status IN ('pending','running')"),
    dev: await count("SELECT COUNT(*) AS n FROM dev_tasks WHERE status IN ('pending','running')"),
    folders: await count("SELECT COUNT(*) AS n FROM folder_jobs WHERE status IN ('pending','running')"),
    lastAiDone: lastAi && lastAi.t ? new Date(lastAi.t) : null,
  };
}

function machineLines(info) {
  const out = [];
  if (info.host) out.push(`Машина: ${esc(info.host)}`);
  if (info.uptimeMin != null) out.push(`Windows е работил ${dur(info.uptimeMin)} без рестарт (към последния пулс)`);
  if (info.zMounted != null) out.push(`Сървърът Z: ${info.zMounted ? 'беше достъпен' : 'НЕ беше достъпен'}`);
  if (info.freeGbC != null || info.freeGbD != null) out.push(`Свободно място: C: ${info.freeGbC ?? '?'} GB, D: ${info.freeGbD ?? '?'} GB`);
  out.push(`Claude Code: ${info.claudeOk === false ? 'НЕ е намерен' : 'намерен'}; агентът ${info.busy ? 'обработваше заявка' : 'беше свободен'}`);
  return out;
}

// Чатът е САМО за тези сигнали (Венци, 29.10.2026): „Chat - Венцислав Калчев - бизнес".
async function notify(lines) {
  const project = parseInt(await getSetting('pc_watch_bc_project')) || 47742842; // личният проект на Венци
  const chat = parseInt(await getSetting('pc_watch_bc_chat')) || 10005689776;
  // Имейлите в bc_people идват маскирани от Basecamp → търсим по person ID (Венци = 45460211).
  const personId = parseInt(await getSetting('pc_watch_bc_person')) || 45460211;
  const person = await queryOne('SELECT name, attachable_sgid FROM bc_people WHERE person_id = $1 LIMIT 1', [personId]);
  const auth = await getServiceAuth();
  await bc.createCampfireLine(auth.token, auth.account, project, chat, `${mentionOf(person, 'Венци')} ${lines.join('<br>')}`);
}

async function check() {
  const at = await getSetting('pc_heartbeat_at');
  if (!at) return; // още никога не е чукал — няма с какво да сравним
  const last = new Date(at);
  let info = {};
  try { info = JSON.parse(await getSetting('pc_heartbeat_info') || '{}'); } catch { /* */ }
  const silentMin = (Date.now() - last.getTime()) / 60000;
  const kind = silentMin > STALE_MIN ? 'silent' : (info.claudeOk === false ? 'noclaude' : null);
  const sent = parseInt(await getSetting('pc_watch_alerts'), 10) || 0;

  if (kind) {
    if (sent >= MAX_ALERTS) return;
    const lastAlert = await getSetting('pc_watch_last_alert');
    if (sent && lastAlert && Date.now() - new Date(lastAlert).getTime() < (REPEAT_MIN - 1) * 60000) return;
    if (!sent) await saveSetting('pc_watch_down_since', kind === 'silent' ? last.toISOString() : new Date().toISOString());
    const since = new Date((await getSetting('pc_watch_down_since')) || last.toISOString());
    const b = await backlog();
    const lines = [
      kind === 'silent'
        ? `🔴 <strong>Компютърът в офиса НЕ РАБОТИ</strong> — не се е обаждал от ${dur(silentMin)}.`
        : '🔴 <strong>Компютърът в офиса работи, но Claude Code НЕ Е НАМЕРЕН</strong> (claude.exe) — AI-то и dev опашката стоят.',
      `Сигнал ${sent + 1} от ${MAX_ALERTS}${sent + 1 < MAX_ALERTS ? ` (следващият след ${REPEAT_MIN} мин, ако не се оправи)` : ' — последен; следващото съобщение ще е, когато пак тръгне'}.`,
      `Последен пулс: ${fmt(last)} · проблемът е от: ${fmt(since)}`,
      '',
      '<strong>Последно известно за машината:</strong>',
      ...machineLines(info),
      '',
      '<strong>Какво чака:</strong>',
      `AI заявки: ${b.ai ?? '?'} · Dev задачи: ${b.dev ?? '?'} · Папки: ${b.folders ?? '?'}`,
      `Последна успешна AI заявка: ${b.lastAiDone ? fmt(b.lastAiDone) : 'няма данни'}`,
      '',
      '<strong>Какво спира:</strong> AI функциите (Content агент, обобщения), dev опашката, създаването на папки на Z:, нощният бекъп.',
      kind === 'silent'
        ? '<strong>Най-честите причини:</strong> изключен ток/компютър, рестарт от Windows Update без автоматичен вход, паднал интернет в офиса, спряна задача ThePactAIAgent.'
        : '<strong>Вероятна причина:</strong> обновяване/преинсталиране на Claude приложението — пътят до claude.exe се е сменил.',
    ];
    await notify(lines);
    await saveSetting('pc_watch_alerts', sent + 1);
    await saveSetting('pc_watch_last_alert', new Date().toISOString());
    console.warn(`[pc-watch] сигнал ${sent + 1}/${MAX_ALERTS}: ${kind}`);
  } else if (sent) {
    const since = await getSetting('pc_watch_down_since');
    const downMin = since ? (Date.now() - new Date(since).getTime()) / 60000 : null;
    const b = await backlog();
    await notify([
      '🟢 <strong>Компютърът в офиса пак работи</strong> — всичко е наред.',
      `Не работеше ${downMin != null ? `около ${dur(downMin)} (от ${fmt(new Date(since))})` : 'известно време'}; пулсът се върна в ${fmt(last)}.`,
      ...machineLines(info),
      `Чакащо за довършване: AI заявки ${b.ai ?? '?'} · Dev задачи ${b.dev ?? '?'} · Папки ${b.folders ?? '?'} — обработват се автоматично.`,
      `Следващо съобщение тук ще има само ако пак спре.`,
    ]);
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
