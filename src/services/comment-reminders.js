// „Подсети“ в коментари (задача „Известия в коментари“, 24.11.2026).
//
// Човек от екипа тагва ThePactAlerts в коментар под вътрешна задача и пише напр.
// „Подсети @Иван утре в 11:00“ или „Подсети ме в петък в 10“. Всяка минута четем
// новите коментари (както Content агента), Claude през абонамента (ai-queue)
// разчита кого и кога, и ботът потвърждава в задачата („Заявка №12 …“). В уречения
// час ботът пише нов коментар и тагва човека.
//
// Решения на Венци:
//  - няма посочен ден/час → ботът тагва заявителя и го моли да е конкретен;
//  - само хора от екипа и само вътрешни задачи (коментар, видим за клиента → нищо);
//  - отмяна: „@ThePactAlerts отмени 12“ — само от човека, който е заявил напомнянето;
//  - праща се точно когато е заявено (без местене в работно време).
//
// Напомнянията са в базата (bc_reminders) → рестарт/deploy не ги губи; ако сървърът е
// бил долу в уречения час, напомнянето излиза веднага щом тръгне.
const cron = require('node-cron');
const config = require('../config');
const { query, queryOne, execute } = require('../db/pool');
const bc = require('./basecamp');
const { getServiceAuth } = require('./basecamp-token');
const { plainText } = require('./kp-comment');
const { escHtml } = require('./bc-team');

const TZ = 'Europe/Sofia';
const CURSOR_KEY = 'rem_last_comment_at';
const MAX_ATTEMPTS = 5;
const REMIND_RE = /(?<!\p{L})(подсети|подсетете|подсещай|напомни|напомнете|напомняне)(?!\p{L})/iu;
const CANCEL_RE = /(?<!\p{L})(отмени|отменете|отмяна)(?!\p{L})/iu;

let tableReady = false;
let polling = false;
let firing = false;
let botSgidCache = '';

async function ensureTable() {
  if (tableReady) return;
  await execute(`
    CREATE TABLE IF NOT EXISTS bc_reminders (
      id SERIAL PRIMARY KEY,
      bc_comment_id BIGINT UNIQUE NOT NULL,
      bucket_id BIGINT NOT NULL,
      parent_id BIGINT NOT NULL,
      parent_title TEXT,
      requester_id BIGINT,
      requester_name TEXT,
      requester_sgid TEXT,
      request_text TEXT,
      candidates JSONB,
      targets JSONB,
      remind_at TIMESTAMPTZ,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'parsing',
      attempts INT NOT NULL DEFAULT 0,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sent_at TIMESTAMPTZ
    )`);
  await execute('CREATE INDEX IF NOT EXISTS bc_reminders_due_idx ON bc_reminders (status, remind_at)');
  tableReady = true;
}

// ---------- време (Europe/Sofia) ----------

function sofiaParts(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date);
  const o = {};
  for (const p of parts) o[p.type] = p.value;
  if (o.hour === '24') o.hour = '00';
  return o;
}

// „2026-11-25 11:00“ (часът в София) → Date (UTC). null при невалиден вход.
function sofiaToDate(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/.exec(String(str || '').trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offsetAt = (ms) => {
    const p = sofiaParts(new Date(ms));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms;
  };
  let ms = guess - offsetAt(guess);
  ms = guess - offsetAt(ms);
  return new Date(ms);
}

const WEEKDAYS = ['неделя', 'понеделник', 'вторник', 'сряда', 'четвъртък', 'петък', 'събота'];

function sofiaWeekday(date) {
  const p = sofiaParts(date);
  return WEEKDAYS[new Date(Date.UTC(+p.year, +p.month - 1, +p.day)).getUTCDay()];
}

// „25.11 (сряда) в 11:00“
function formatWhen(date) {
  const p = sofiaParts(date);
  return `${p.day}.${p.month} (${sofiaWeekday(date)}) в ${p.hour}:${p.minute}`;
}

function nowForPrompt(date = new Date()) {
  const p = sofiaParts(date);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}, ${sofiaWeekday(date)}`;
}

// ---------- текстът на коментара ----------

// Часовете, написани като ЧЧ:ММ (24 ч.), нормализирани до „09:30“.
function timesInText(text) {
  const out = [];
  const re = /(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/g;
  let m;
  while ((m = re.exec(String(text || '')))) out.push(`${m[1].padStart(2, '0')}:${m[2]}`);
  return out;
}

// Таговете в Basecamp rich text: <bc-attachment sgid=… content-type="application/vnd.basecamp.mention">…<figcaption>Име</figcaption>…
function extractMentions(html) {
  const out = [];
  const re = /<bc-attachment\b([^>]*)>([\s\S]*?)<\/bc-attachment>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    if (!/vnd\.basecamp\.mention/i.test(m[1])) continue;
    const sgid = (/\bsgid="([^"]+)"/i.exec(m[1]) || [])[1] || '';
    const caption = plainText((/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i.exec(m[2]) || [])[1] || '', 200);
    if (sgid) out.push({ sgid, caption });
  }
  return out;
}

// Текст за AI-а: таговете стават „@Име“, ботът — „@бот“.
function textWithMentions(html, botSgid, nameBySgid) {
  const replaced = String(html || '').replace(/<bc-attachment\b([^>]*)>([\s\S]*?)<\/bc-attachment>/gi, (all, attrs, inner) => {
    if (!/vnd\.basecamp\.mention/i.test(attrs)) return ' ';
    const sgid = (/\bsgid="([^"]+)"/i.exec(attrs) || [])[1] || '';
    if (botSgid && sgid === botSgid) return ' @бот ';
    const cap = plainText((/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i.exec(inner) || [])[1] || '', 200);
    return ` @${(nameBySgid && nameBySgid[sgid]) || cap || 'човек'} `;
  });
  return plainText(replaced, 4000);
}

/** 'cancel' | 'remind' | '' — какво иска коментарът (вика се и от Content агента). */
function commandOf(text) {
  const t = String(text || '');
  if (CANCEL_RE.test(t)) return 'cancel';
  if (REMIND_RE.test(t)) return 'remind';
  return '';
}

// ---------- Basecamp помощници ----------

async function botSgid(auth) {
  if (botSgidCache) return botSgidCache;
  const me = await bc.getMyProfile(auth.token, auth.account);
  botSgidCache = (me && me.attachable_sgid) || '';
  return botSgidCache;
}

const tag = (sgid, name) => (sgid ? `<bc-attachment sgid="${escHtml(sgid)}"></bc-attachment>` : `<strong>${escHtml(name || '')}</strong>`);

async function reply(auth, row, html) {
  await bc.createComment(auth.token, auth.account, row.bucket_id, row.parent_id, `<div>${html}</div>`);
}

// ---------- разчитане с AI ----------

const SYSTEM = `Разчиташ заявки за напомняне от коментари в Basecamp на българска видео агенция.
Някой е тагнал бота и иска да подсети човек (или себе си) да погледне задачата.
Върни САМО JSON, без друг текст:
{"targets":["ME" или ключ от списъка с хора], "when":"YYYY-MM-DD HH:MM" или null, "note":"кратко какво да се напомни или празно"}
Правила:
- targets: кои хора да бъдат подсетени. „подсети ме“/„напомни ми“ → "ME". Тагнат човек → неговия ключ (P1, P2…). Ако никой не е тагнат и не е ясно кой → ["ME"].
- when: местно време в София. Часът се пише САМО във формат ЧЧ:ММ по 24-часовия часовник (11:00, 15:00, 9:30).
  * Използвай точно часа ЧЧ:ММ от коментара — не го превръщай и не го допълвай.
  * Час без ЧЧ:ММ („в 3“, „в 15 часа“, „3 следобед“, „сутринта“, „след 2 часа“) → null.
  * Само час без ден („в 11:00“) → най-близкият бъдещ такъв час (днес, ако още не е минал, иначе утре).
  * Ден без час („утре“, „в петък“), неясно („по-късно“, „другата седмица“) или липсва → null.
- note: само ако в заявката има конкретика какво да се напомни; иначе "".`;

function buildPrompt(row) {
  const cands = row.candidates || [];
  const list = cands.filter((c) => c.key !== 'ME').map((c) => `${c.key} = ${c.name}`).join('\n') || '(няма тагнати хора)';
  return `Текущо време (София): ${nowForPrompt()}
Заявител (ME): ${row.requester_name}
Задача: ${row.parent_title || ''}
Тагнати хора:
${list}

Коментар:
${row.request_text}`;
}

function parseJson(text) {
  const s = String(text || '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

async function parseRequest(row) {
  const { callClaude } = require('./pm-agent/claude');
  const res = await callClaude({
    system: SYSTEM,
    messages: [{ role: 'user', content: buildPrompt(row) }],
    maxTokens: 1000,
    effort: 'low',
  });
  const j = parseJson(res.text);
  if (!j) throw new Error('AI не върна валиден JSON');
  return j;
}

// Обработва записа в статус 'parsing': AI → потвърждение или молба за конкретика.
async function processParsing(row) {
  let auth;
  try { auth = await getServiceAuth(); } catch { return; }
  let j;
  try {
    j = await parseRequest(row);
  } catch (e) {
    await execute("UPDATE bc_reminders SET status = 'error', error = $2 WHERE id = $1", [row.id, e.message]);
    await reply(auth, row, `${tag(row.requester_sgid, row.requester_name)} не успях да разчета заявката за напомняне (${escHtml(e.message)}). Тагни ме пак след малко.`).catch(() => {});
    return;
  }
  const cands = row.candidates || [];
  const byKey = Object.fromEntries(cands.map((c) => [c.key, c]));
  let targets = (Array.isArray(j.targets) ? j.targets : []).map((k) => byKey[String(k).trim()]).filter(Boolean);
  if (!targets.length) targets = [byKey.ME];
  targets = targets.filter((t, i) => targets.findIndex((x) => x.sgid === t.sgid && x.name === t.name) === i);
  // Часът трябва да е написан като ЧЧ:ММ (24 ч.) в самия коментар (Венци, 24.11.2026) —
  // и AI-ят не може да измисли друг час от написаните.
  const written = timesInText(row.request_text);
  let when = j.when ? sofiaToDate(j.when) : null;
  if (when) {
    const p = sofiaParts(when);
    if (!written.includes(`${p.hour}:${p.minute}`)) when = null;
  }
  const note = String(j.note || '').trim().slice(0, 500);

  if (!when) {
    await execute("UPDATE bc_reminders SET status = 'unclear', targets = $2 WHERE id = $1", [row.id, JSON.stringify(targets)]);
    await reply(auth, row, `${tag(row.requester_sgid, row.requester_name)} не разбрах кога точно да подсетя. Тагни ме пак и напиши ден и точен час във формат <strong>ЧЧ:ММ</strong> по 24-часовия часовник, напр. „Подсети … утре в 15:00“ или „в петък в 09:30“ (не „в 3“ или „в 15 часа“).`);
    return;
  }
  if (when.getTime() < Date.now() - 5 * 60_000) {
    await execute("UPDATE bc_reminders SET status = 'unclear', targets = $2, remind_at = $3 WHERE id = $1", [row.id, JSON.stringify(targets), when]);
    await reply(auth, row, `${tag(row.requester_sgid, row.requester_name)} ${escHtml(formatWhen(when))} вече е минало. Тагни ме пак и напиши бъдещ ден и час.`);
    return;
  }
  await execute("UPDATE bc_reminders SET status = 'pending', targets = $2, remind_at = $3, note = $4 WHERE id = $1",
    [row.id, JSON.stringify(targets), when, note]);
  const who = targets.map((t) => (t.key === 'ME' ? 'теб' : `<strong>${escHtml(t.name)}</strong>`)).join(', ');
  await reply(auth, row, `✅ Заявка №${row.id}: ще подсетя ${who} на <strong>${escHtml(formatWhen(when))}</strong>.` +
    (note ? `<br>Напомняне: ${escHtml(note)}` : '') +
    `<br><em>За отмяна: тагни ме и напиши „отмени ${row.id}“ (може само заявителят).</em>`);
}

// ---------- отмяна ----------

async function handleCancel(auth, c, base, text) {
  const num = (/(\d+)/.exec(text.replace(/@\S+/g, ' ')) || [])[1];
  const me = c.creator || {};
  let row;
  if (num) {
    row = await queryOne('SELECT * FROM bc_reminders WHERE id = $1', [Number(num)]);
    if (!row || row.status !== 'pending') {
      return reply(auth, base, `${tag(me.attachable_sgid, me.name)} няма чакащо напомняне №${escHtml(num)}.`);
    }
    if (String(row.requester_id) !== String(me.id)) {
      return reply(auth, base, `${tag(me.attachable_sgid, me.name)} напомняне №${row.id} може да отмени само <strong>${escHtml(row.requester_name)}</strong>, който го е заявил.`);
    }
  } else {
    const mine = await query(
      "SELECT * FROM bc_reminders WHERE status = 'pending' AND requester_id = $1 AND parent_id = $2 ORDER BY id",
      [me.id, base.parent_id]
    );
    if (!mine.length) return reply(auth, base, `${tag(me.attachable_sgid, me.name)} нямаш чакащи напомняния в тази задача.`);
    if (mine.length > 1) {
      return reply(auth, base, `${tag(me.attachable_sgid, me.name)} имаш няколко напомняния тук (${mine.map((r) => '№' + r.id).join(', ')}). Напиши „отмени“ и номера.`);
    }
    row = mine[0];
  }
  const done = await queryOne("UPDATE bc_reminders SET status = 'cancelled' WHERE id = $1 AND status = 'pending' RETURNING id", [row.id]);
  if (!done) return reply(auth, base, `${tag(me.attachable_sgid, me.name)} напомняне №${row.id} вече не чака.`);
  return reply(auth, base, `🗑️ Напомняне №${row.id} (${escHtml(formatWhen(new Date(row.remind_at)))}) е отменено.`);
}

// ---------- новите коментари ----------

async function pollOnce() {
  if (polling) return;
  polling = true;
  try {
    await ensureTable();
    const startedAt = new Date().toISOString();
    const cur = await queryOne('SELECT value FROM settings WHERE key = $1', [CURSOR_KEY]);
    const saveCursor = () => execute(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`, [CURSOR_KEY, startedAt]);
    if (!cur || !cur.value) { await saveCursor(); return; } // първи път = само baseline

    let auth;
    try { auth = await getServiceAuth(); } catch { return; }
    const sgid = await botSgid(auth).catch(() => '');
    if (!sgid) return;
    // 2 мин застъпване — дедупът е по id на коментара (bc_reminders.bc_comment_id).
    const since = new Date(new Date(cur.value).getTime() - 120_000).toISOString();
    const comments = await bc.getRecordingsSince(auth.token, auth.account, 'Comment', since, 3);

    for (const c of comments.reverse()) {
      if (String(c.creator?.email_address || '').toLowerCase() === config.BASECAMP_SERVICE_EMAIL) continue;
      if (!String(c.content || '').includes(sgid)) continue; // ботът трябва да е тагнат
      const people = await query('SELECT person_id, name, attachable_sgid FROM bc_people WHERE active = TRUE');
      const nameBySgid = Object.fromEntries(people.filter((p) => p.attachable_sgid).map((p) => [p.attachable_sgid, p.name]));
      const text = textWithMentions(c.content, sgid, nameBySgid);
      const cmd = commandOf(text);
      if (!cmd) continue; // не е за напомняне → Content агента си го поема

      const parent = c.parent || {};
      const creator = c.creator || {};
      // Дедуп + запис наведнъж: само първото виждане на коментара продължава.
      const ins = await queryOne(
        `INSERT INTO bc_reminders (bc_comment_id, bucket_id, parent_id, parent_title, requester_id, requester_name, requester_sgid, request_text, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ignored') ON CONFLICT (bc_comment_id) DO NOTHING RETURNING id`,
        [c.id, c.bucket?.id, parent.id, parent.title || '', creator.id, creator.name || '', creator.attachable_sgid || '', text]
      );
      if (!ins) continue;

      // Само хора от екипа и само вътрешни задачи (нищо, което клиентът вижда).
      const isTeam = people.some((p) => String(p.person_id) === String(creator.id));
      if (!isTeam || c.visible_to_clients) {
        await execute('UPDATE bc_reminders SET error = $2 WHERE id = $1',
          [ins.id, !isTeam ? 'заявителят не е от екипа' : 'коментарът е видим за клиента']);
        continue;
      }
      const base = { bucket_id: c.bucket?.id, parent_id: parent.id };

      if (cmd === 'cancel') {
        await execute("UPDATE bc_reminders SET status = 'cancel_cmd' WHERE id = $1", [ins.id]);
        await handleCancel(auth, c, base, text).catch((e) => console.error('[reminders] отмяна:', e.message));
        continue;
      }

      const candidates = [{ key: 'ME', name: creator.name || '', sgid: creator.attachable_sgid || '' }];
      extractMentions(c.content).filter((m) => m.sgid !== sgid).forEach((m) => {
        if (candidates.some((x) => x.sgid === m.sgid)) return;
        candidates.push({ key: `P${candidates.length}`, name: nameBySgid[m.sgid] || m.caption || 'човек', sgid: m.sgid });
      });
      const row = await queryOne(
        "UPDATE bc_reminders SET status = 'parsing', candidates = $2 WHERE id = $1 RETURNING *",
        [ins.id, JSON.stringify(candidates)]
      );
      // AI-ят може да отнеме минути (компютърът в офиса) — не спираме полла.
      processParsing(row).catch((e) => console.error('[reminders] разчитане:', e.message));
    }
    await saveCursor();
  } finally {
    polling = false;
  }
}

// ---------- пращане в уречения час ----------

async function fireDue() {
  if (firing) return;
  firing = true;
  try {
    await ensureTable();
    const due = await query("SELECT id FROM bc_reminders WHERE status = 'pending' AND remind_at <= NOW() ORDER BY remind_at LIMIT 20");
    if (!due.length) return;
    let auth;
    try { auth = await getServiceAuth(); } catch { return; }
    for (const { id } of due) {
      const row = await queryOne("UPDATE bc_reminders SET status = 'sending' WHERE id = $1 AND status = 'pending' RETURNING *", [id]);
      if (!row) continue;
      const targets = Array.isArray(row.targets) && row.targets.length ? row.targets : [{ key: 'ME', name: row.requester_name, sgid: row.requester_sgid }];
      const self = targets.length === 1 && targets[0].key === 'ME';
      const html = `🔔 ${targets.map((t) => tag(t.sgid, t.name)).join(' ')} ` +
        (self ? 'напомняне, което си поиска: погледни тази задача.' : `напомняне от <strong>${escHtml(row.requester_name)}</strong>: погледни тази задача.`) +
        (row.note ? `<br>${escHtml(row.note)}` : '');
      try {
        await reply(auth, row, html);
        await execute("UPDATE bc_reminders SET status = 'sent', sent_at = NOW(), error = NULL WHERE id = $1", [id]);
      } catch (e) {
        const attempts = (row.attempts || 0) + 1;
        await execute('UPDATE bc_reminders SET status = $2, attempts = $3, error = $4 WHERE id = $1',
          [id, attempts >= MAX_ATTEMPTS ? 'error' : 'pending', attempts, e.message]);
        console.error(`[reminders] №${id}:`, e.message);
      }
    }
  } finally {
    firing = false;
  }
}

async function resumeAfterRestart() {
  await ensureTable();
  // 'sending' без резултат (сървърът е спрял по средата) → пак чака.
  await execute("UPDATE bc_reminders SET status = 'pending' WHERE status = 'sending'");
  const rows = await query("SELECT * FROM bc_reminders WHERE status = 'parsing' ORDER BY id");
  for (const r of rows) processParsing(r).catch((e) => console.error('[reminders] разчитане:', e.message));
}

function initCommentReminders() {
  try {
    resumeAfterRestart().catch((e) => console.warn('[reminders] resume:', e.message));
    cron.schedule('* * * * *', () => {
      pollOnce().catch((e) => console.error('[reminders] poll:', e.message));
      fireDue().catch((e) => console.error('[reminders] fire:', e.message));
    }, { timezone: TZ });
    console.log('  Comment reminders: active (every minute)');
  } catch (e) {
    console.log('  Comment reminders: skipped —', e.message);
  }
}

module.exports = {
  initCommentReminders, pollOnce, fireDue, commandOf, textWithMentions, extractMentions,
  sofiaToDate, formatWhen, parseJson, timesInText,
};
