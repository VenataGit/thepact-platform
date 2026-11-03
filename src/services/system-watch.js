// Пазач на самата платформа (стабилност, 04.11.2026, задача „Аудит за платформата").
//
// Сигнал към Венци САМО когато нещо не работи — в същия чат като пулса на компютъра
// („Сигнал за неработеща система", виж pc-watch.js). По едно съобщение при проблем и
// едно „пак работи" при оправяне; никакви периодични отчети (Венци: „да не ме спамят").
//
// Какво следи (на 5 мин):
//   crashloop — платформата се рестартира в цикъл (≥5 старта за 15 мин; на 2–3.09 бяха ~980 за 2 дни)
//   errors    — скок на грешките (≥30 за 15 мин: необработени изключения + 5xx отговори)
//   bot       — ботът ThePactAlerts не може да влезе в Basecamp (тогава сигналът отива като push)
//   backup    — нощният бекъп на компютъра не е минал (пулсът носи D:\PlatformBackup\last-run.json)
//   lag       — сървърът „замръзва" (event loop p99 > 2 сек два пъти подред)
//   deploy    — тестовете спряха качване на живо (вика се от scripts/vps/deploy.sh)
// Грешките се пазят в app_errors (30 дни) — вече не изчезват при рестарт.
const cron = require('node-cron');
const { monitorEventLoopDelay } = require('perf_hooks');
const { query, queryOne, execute } = require('../db/pool');

const TZ = 'Europe/Sofia';
const CHECK_CRON = '*/5 * * * *';
const CRASH_STARTS = 5, CRASH_WINDOW_MIN = 15;
const ERR_OPEN = 30, ERR_CLOSE = 10, ERR_WINDOW_MIN = 15;
const BACKUP_MAX_AGE_H = 26;
const LAG_P99_MS = 2000;

const getSetting = async (key) => (await queryOne('SELECT value FROM settings WHERE key = $1', [key]))?.value ?? null;
const saveSetting = (key, value) => execute(
  `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
   ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`, [key, String(value)]);
const delSetting = (key) => execute('DELETE FROM settings WHERE key = $1', [key]);

const fmt = (d) => new Date(d).toLocaleString('bg-BG', { timeZone: TZ, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const dur = (min) => { min = Math.max(0, Math.round(min)); if (min < 60) return `${min} мин`; const h = Math.floor(min / 60); return h < 24 ? `${h} ч ${min % 60} мин` : `${Math.floor(h / 24)} д ${h % 24} ч`; };
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------- грешки в базата ----------
let tableReady = null;
function ensureTable() {
  if (!tableReady) {
    tableReady = (async () => {
      await execute(`CREATE TABLE IF NOT EXISTS app_errors (
        id BIGSERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        source VARCHAR(40), message TEXT, detail TEXT)`);
      await execute('CREATE INDEX IF NOT EXISTS idx_app_errors_at ON app_errors(at)');
    })().catch((e) => { tableReady = null; throw e; });
  }
  return tableReady;
}

let pending = [];
function recordError(source, message, detail) {
  if (pending.length < 500) pending.push([String(source).slice(0, 40), String(message || '').slice(0, 2000), detail ? String(detail).slice(0, 4000) : null]);
}
async function flushErrors() {
  if (!pending.length) return;
  const batch = pending; pending = [];
  try {
    await ensureTable();
    const vals = [], params = [];
    batch.forEach((r, i) => { vals.push(`($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`); params.push(...r); });
    await execute(`INSERT INTO app_errors (source, message, detail) VALUES ${vals.join(',')}`, params);
  } catch (e) { console.error('[system-watch] запис на грешки:', e.message); }
}

// ---------- изпращане ----------
// Нормално: Campfire чатът (както pc-watch). Ако ботът не работи — push към админите.
async function send(lines, { viaPush = false } = {}) {
  if (!viaPush) {
    try { await require('./pc-watch').notify(lines); return; } catch (e) { console.error('[system-watch] Campfire сигнал:', e.message); }
  }
  try {
    const admins = await query("SELECT id FROM users WHERE role = 'admin' AND is_active IS NOT FALSE");
    const text = lines.join('\n').replace(/<[^>]+>/g, '').slice(0, 300);
    await require('./push').sendPushToUsers(admins.map((a) => a.id), { title: 'ThePact — системата не работи', body: text, url: '/' });
  } catch (e) { console.error('[system-watch] push сигнал:', e.message); }
}

// Един инцидент = едно съобщение при отваряне + едно при затваряне.
async function open(kind, lines, opts) {
  const key = `sysw_${kind}`;
  if (await getSetting(key)) return false;
  await saveSetting(key, JSON.stringify({ since: new Date().toISOString() }));
  await send(lines, opts);
  console.warn(`[system-watch] сигнал: ${kind}`);
  return true;
}
async function close(kind, lines, opts) {
  const key = `sysw_${kind}`;
  const raw = await getSetting(key);
  if (!raw) return false;
  let since = null; try { since = JSON.parse(raw).since; } catch { /* */ }
  await delSetting(key);
  const took = since ? ` Проблемът продължи около ${dur((Date.now() - new Date(since).getTime()) / 60000)} (от ${fmt(since)}).` : '';
  await send(lines.map((l, i) => (i === 0 ? l + took : l)), opts);
  console.log(`[system-watch] оправено: ${kind}`);
  return true;
}

// ---------- проверките ----------
async function checkCrashLoop() {
  let starts = [];
  try { starts = JSON.parse(await getSetting('sysw_starts') || '[]'); } catch { /* */ }
  const cutoff = Date.now() - CRASH_WINDOW_MIN * 60000;
  const recent = starts.filter((t) => new Date(t).getTime() > cutoff);
  if (recent.length >= CRASH_STARTS) {
    await open('crashloop', [
      `🔴 <strong>Платформата thepact.pro се рестартира в цикъл</strong> — ${recent.length} пъти за последните ${CRASH_WINDOW_MIN} мин.`,
      'Сайтът прекъсва за всички, WebSocket връзките падат, автоматичните задачи не довършват.',
      '<strong>Най-честите причини:</strong> счупен deploy (git pull не минава, а PM2 се рестартира), грешка при старт, свършила памет.',
      'Следващото съобщение тук ще е, когато се успокои.',
    ]);
  } else if (recent.length <= 1) {
    await close('crashloop', ['🟢 <strong>Платформата спря да се рестартира</strong> — работи нормално.']);
  }
}

async function checkErrors() {
  await flushErrors();
  await ensureTable();
  const row = await queryOne(`SELECT COUNT(*)::int AS n FROM app_errors WHERE at > NOW() - INTERVAL '${ERR_WINDOW_MIN} minutes'`);
  const n = row ? row.n : 0;
  if (n >= ERR_OPEN) {
    const top = await query(`SELECT source, LEFT(message, 140) AS m, COUNT(*)::int AS c FROM app_errors
      WHERE at > NOW() - INTERVAL '${ERR_WINDOW_MIN} minutes' GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 3`);
    await open('errors', [
      `🔴 <strong>Скок на грешките в платформата</strong> — ${n} за последните ${ERR_WINDOW_MIN} мин.`,
      '<strong>Най-честите:</strong>',
      ...top.map((t) => `${t.c}× [${esc(t.source)}] ${esc(t.m)}`),
      'Следващото съобщение тук ще е, когато спаднат.',
    ]);
  } else if (n < ERR_CLOSE) {
    await close('errors', ['🟢 <strong>Грешките в платформата спаднаха</strong> — всичко е нормално.']);
  }
}

let botFails = 0;
async function checkBot() {
  try {
    const bc = require('./basecamp');
    const { getServiceAuth } = require('./basecamp-token');
    const { token, account } = await getServiceAuth();
    await bc.authedGet(`${bc.API_BASE}/${account}/my/profile.json`, token);
    botFails = 0;
    await close('bot', ['🟢 <strong>Ботът ThePactAlerts пак влиза в Basecamp</strong> — известията работят.']);
  } catch (e) {
    if (/\(429\)/.test(e.message)) return; // лимит, не повреда
    botFails += 1;
    if (botFails >= 2) {
      await open('bot', [
        '🔴 Ботът ThePactAlerts НЕ може да влезе в Basecamp.',
        'Спират: известията от календара и таблиците, „Резултати", дневните отчети, коментарите от dev опашката.',
        `Грешка: ${e.message.slice(0, 160)}`,
        'Оправяне: thepact.pro → Настройки → свържи наново бота (влез в Basecamp като ThePactAlerts).',
      ], { viaPush: true });
    }
  }
}

async function checkBackup() {
  const at = await getSetting('pc_heartbeat_at');
  if (!at || Date.now() - new Date(at).getTime() > 20 * 60000) return; // компютърът мълчи → това е работа на pc-watch
  let info = {};
  try { info = JSON.parse(await getSetting('pc_heartbeat_info') || '{}'); } catch { /* */ }
  const b = info.backup;
  if (!b) return; // стар агент без тази информация
  const last = b.lastRun ? new Date(b.lastRun) : null;
  const ageH = last ? (Date.now() - last.getTime()) / 3600000 : Infinity;
  const bad = b.error || b.status !== 'ok' || ageH > BACKUP_MAX_AGE_H;
  if (bad) {
    await open('backup', [
      '🔴 <strong>Нощният бекъп на платформата НЕ е минал</strong> (D:\\PlatformBackup на офис компютъра).',
      last ? `Последен опит: ${fmt(last)} · статус: ${esc(b.status || '?')}` : `Не мога да прочета статуса: ${esc(b.error || 'няма last-run.json')}`,
      ...(b.problems && b.problems.length ? [`Проблеми: ${esc(b.problems.join('; '))}`] : []),
      '<strong>Най-честите причини:</strong> компютърът е бил изключен в 00:00, auto-logon не е минал след рестарт, SSH до сървъра не е минал.',
    ]);
  } else {
    await close('backup', [`🟢 <strong>Нощният бекъп пак минава</strong> — последен: ${fmt(last)}.`]);
  }
}

const loop = monitorEventLoopDelay({ resolution: 50 });
let lagHits = 0, lastP99 = 0;
async function checkLag() {
  lastP99 = Math.round(loop.percentile(99) / 1e6);
  loop.reset();
  lagHits = lastP99 > LAG_P99_MS ? lagHits + 1 : 0;
  if (lagHits >= 2) {
    await open('lag', [
      `🔴 <strong>Платформата „замръзва"</strong> — заявките чакат до ${(lastP99 / 1000).toFixed(1)} сек (две проверки подред).`,
      'Вероятна причина: тежка автоматична задача в същия процес като сайта.',
    ]);
  } else if (lagHits === 0 && lastP99 < LAG_P99_MS / 2) {
    await close('lag', ['🟢 <strong>Платформата пак отговаря бързо.</strong>']);
  }
}

async function runChecks() {
  for (const [name, fn] of [['crashloop', checkCrashLoop], ['errors', checkErrors], ['bot', checkBot], ['backup', checkBackup], ['lag', checkLag]]) {
    try { await fn(); } catch (e) { console.error(`[system-watch] ${name}:`, e.message); }
  }
}

async function recordStart() {
  let starts = [];
  try { starts = JSON.parse(await getSetting('sysw_starts') || '[]'); } catch { /* */ }
  starts.push(new Date().toISOString());
  await saveSetting('sysw_starts', JSON.stringify(starts.slice(-20)));
}

async function pruneErrors() {
  try { await ensureTable(); await execute("DELETE FROM app_errors WHERE at < NOW() - INTERVAL '30 days'"); } catch (e) { console.error('[system-watch] чистене:', e.message); }
}

function initSystemWatch() {
  loop.enable();
  require('../middleware/errorHandler').setErrorSink((source, message, detail) => recordError(source, message, detail));
  recordStart().then(checkCrashLoop).catch((e) => console.error('[system-watch] старт:', e.message));
  setInterval(() => { flushErrors().catch(() => {}); }, 30_000).unref();
  cron.schedule(CHECK_CRON, () => { runChecks(); }, { timezone: TZ });
  cron.schedule('17 4 * * *', () => { pruneErrors(); }, { timezone: TZ });
  console.log('  System watch: active (сигнал само при повреда)');
}

// Вика се от deploy скрипта на VPS-а (scripts/system-signal.js).
async function deploySignal(ok, detail) {
  if (ok) return close('deploy', ['🟢 <strong>Качването на живо пак минава</strong> — тестовете са зелени, новата версия е на thepact.pro.']);
  return open('deploy', [
    '🔴 <strong>Нова версия НЕ е качена на thepact.pro</strong> — тестовете не минаха, затова на живо остава старата (работеща) версия.',
    `Детайли: ${esc(String(detail || '').slice(0, 300))}`,
    'Нищо не е счупено за екипа. Ще се качи автоматично, щом тестовете минат.',
  ]);
}

// Вика се при старт след миграциите (server.js): счупена миграция спира всички следващи тихо.
async function migrationSignal(ok, detail) {
  if (ok) return close('migration', ['🟢 <strong>Миграциите на базата пак минават.</strong>']);
  return open('migration', [
    '🔴 <strong>Миграция на базата НЕ мина при старт</strong> — тя и всички следващи чакат, а функциите, които разчитат на тях, може да гърмят.',
    `Детайли: ${esc(String(detail || '').slice(0, 400))}`,
  ]);
}

const status = () => ({ eventLoopP99Ms: lastP99 });

module.exports = { initSystemWatch, recordError, deploySignal, migrationSignal, runChecks, status, flushErrors };
