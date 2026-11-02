// Дневно обобщение на overtime-а към личния проект на Венци в Basecamp (Венци, 02.11.2026 —
// вариант 2: „в конкретния ден или на следващия да видя дали този човек е съобразил времето
// си и дали е дошъл на време на следващия").
//
// Всеки ден в 09:00 (преди работното време в 10:00) — едно съобщение в Message Board на
// „Венцислав Калчев - бизнес" с всичко, въведено след предишното обобщение: новите записи
// (по човек, със сбора му за месеца) и изтритите. Ако няма нищо ново — нищо не се праща.
// Абонат е само Венци → само той получава известие.
//
// Настройки (таблица settings, по желание): overtime_digest_enabled ('false' спира),
// overtime_digest_bc_project, overtime_digest_bc_board, overtime_digest_bc_person.
// Без AI, без токени — една SQL заявка и едно съобщение на ден.
const cron = require('node-cron');
const { query, queryOne, execute } = require('../db/pool');
const bc = require('./basecamp');
const { getServiceAuth } = require('./basecamp-token');

const TZ = 'Europe/Sofia';
const DEFAULTS = {
  project: 47742842,     // „Венцислав Калчев - бизнес" (личният проект)
  board: 10404218914,    // „Message Board 2" — празен, само за overtime (да се преименува на „Overtime")
  person: 45460211,      // Венци (по person ID — имейлите в bc_people са маскирани)
};
const PAGE_URL = 'https://thepact.pro/#/overtime/admin';
const COMP = { pay: '💰 плащане', rest: '🏖 почивка' };
const DOW = ['неделя', 'понеделник', 'вторник', 'сряда', 'четвъртък', 'петък', 'събота'];

const getSetting = async (key) => (await queryOne('SELECT value FROM settings WHERE key = $1', [key]))?.value ?? null;
const saveSetting = (key, value) => execute(
  `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
   ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
  [key, String(value)]
);
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function fmtH(m) {
  m = Number(m) || 0;
  if (!m) return '0 ч';
  const h = Math.floor(m / 60), mm = m % 60;
  return (h ? h + ' ч' : '') + (h && mm ? ' ' : '') + (mm ? mm + ' мин' : '');
}
// 'YYYY-MM-DD' → 'понеделник 02.11'
function fmtDay(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] + ' ' + String(d).padStart(2, '0') + '.' + String(m).padStart(2, '0');
}
const sofiaDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d); // YYYY-MM-DD
const dm = (s) => s.slice(8, 10) + '.' + s.slice(5, 7);

// Сглобява съобщението. added = нови записи (с month_total), removed = изтрити.
// Връща null, ако няма нищо за казване.
function buildDigest(added, removed, now = new Date()) {
  if (!added.length && !removed.length) return null;
  const today = sofiaDate(now);
  const total = added.reduce((s, e) => s + (Number(e.ot_minutes) || 0), 0);
  const parts = [];
  if (added.length) parts.push(added.length + (added.length === 1 ? ' нов запис' : ' нови записа') + ', ' + fmtH(total));
  if (removed.length) parts.push(removed.length + ' изтрит' + (removed.length === 1 ? '' : 'и'));
  const subject = '⏱ Overtime — ' + fmtDay(today) + ': ' + parts.join(', ');

  const html = [];
  // по човек, в реда на първата поява (заявката е подредена по име)
  const by = new Map();
  added.forEach((e) => { if (!by.has(e.user_id)) by.set(e.user_id, []); by.get(e.user_id).push(e); });
  by.forEach((list) => {
    const p = list[0];
    html.push('<strong>' + esc(p.name) + '</strong> — общо за месеца: ' + fmtH(p.month_total));
    html.push('<ul>' + list.map((e) => {
      const late = e.added_date !== e.work_date && e.added_date > e.work_date
        ? ' <em>(въведено на ' + dm(e.added_date) + ')</em>' : '';
      return '<li><strong>' + fmtDay(e.work_date) + '</strong> · ' + esc(e.time_from) + '–' + esc(e.time_to) +
        (e.time_to < e.time_from ? ' (след полунощ)' : '') + ' · <strong>' + fmtH(e.ot_minutes) + '</strong>' + late +
        '<br>' + esc(e.client) + ' · ' + esc(e.kind) + ' · ' + (COMP[e.comp] || '') +
        (e.note ? '<br><em>' + esc(e.note) + '</em>' : '') + '</li>';
    }).join('') + '</ul>');
  });
  if (removed.length) {
    html.push('<strong>🗑 Изтрити записи</strong>');
    html.push('<ul>' + removed.map((e) => '<li>' + esc(e.name) + ' · ' + fmtDay(e.work_date) + ' · ' + esc(e.time_from) + '–' + esc(e.time_to) +
      ' · ' + fmtH(e.ot_minutes) + ' · ' + esc(e.client) + ' <em>(въведен на ' + dm(e.added_date) + ', изтрит на ' + dm(e.deleted_date) + ')</em></li>').join('') + '</ul>');
  }
  html.push('<a href="' + PAGE_URL + '">Отвори Overtime → Админ</a>');
  return { subject, content: '<div>' + html.join('<br>') + '</div>' };
}

async function collect(since, until) {
  const cols = `o.id, o.user_id, u.name, to_char(o.work_date, 'YYYY-MM-DD') AS work_date, o.time_from, o.time_to,
                o.ot_minutes, o.client, o.kind, o.note, o.comp,
                to_char(o.created_at AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS added_date`;
  const added = await query(
    `SELECT ${cols},
            (SELECT COALESCE(SUM(x.ot_minutes), 0) FROM overtime_entries x
              WHERE x.user_id = o.user_id AND x.deleted_at IS NULL
                AND date_trunc('month', x.work_date) = date_trunc('month', o.work_date))::int AS month_total
       FROM overtime_entries o JOIN users u ON u.id = o.user_id
      WHERE o.deleted_at IS NULL AND o.created_at > $1 AND o.created_at <= $2
      ORDER BY u.name, o.work_date, o.time_from`,
    [since, until]
  );
  // изтрити в периода, но въведени преди него (въведен и изтрит между две обобщения = объркан
  // и веднага поправен запис — не е интересен)
  const removed = await query(
    `SELECT ${cols}, to_char(o.deleted_at AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS deleted_date
       FROM overtime_entries o JOIN users u ON u.id = o.user_id
      WHERE o.deleted_at > $1 AND o.deleted_at <= $2 AND o.created_at <= $1
      ORDER BY u.name, o.work_date`,
    [since, until]
  );
  return { added, removed };
}

async function runDigest(now = new Date()) {
  if ((await getSetting('overtime_digest_enabled')) === 'false') return { skipped: 'disabled' };
  await require('../routes/overtime').ensureSchema();
  const last = await getSetting('overtime_digest_last');
  const since = last ? new Date(last) : new Date(now.getTime() - 24 * 3600 * 1000);
  const { added, removed } = await collect(since.toISOString(), now.toISOString());
  const msg = buildDigest(added, removed, now);
  if (msg) {
    const project = parseInt(await getSetting('overtime_digest_bc_project')) || DEFAULTS.project;
    const board = parseInt(await getSetting('overtime_digest_bc_board')) || DEFAULTS.board;
    const person = parseInt(await getSetting('overtime_digest_bc_person')) || DEFAULTS.person;
    const auth = await getServiceAuth();
    await bc.createMessage(auth.token, auth.account, project, board, { ...msg, subscriptions: [person] });
  }
  // чак след успешно пращане — ако Basecamp откаже, утре влиза и днешното
  await saveSetting('overtime_digest_last', now.toISOString());
  return { added: added.length, removed: removed.length, sent: !!msg };
}

function initOvertimeDigest() {
  cron.schedule('0 9 * * *', () => {
    runDigest().then((r) => console.log('[overtime-digest]', JSON.stringify(r)))
      .catch((e) => console.error('[overtime-digest]', e.message));
  }, { timezone: TZ });
  console.log('  Overtime digest: active (всеки ден в 09:00)');
}

module.exports = { initOvertimeDigest, runDigest, buildDigest };
