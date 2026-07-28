// Екипът на The Pact = хората с достъп до Video Production проекта в Basecamp.
//
// Кешът bc_people (041_gcal_alerts_bc_people.sql) се пълни оттук. Досега това се
// случваше вътре в gcal-alerts.js — но само ако Календар известията са ВКЛЮЧЕНИ
// (ensurePeopleFresh се вика от syncAllFeeds, който излиза рано при enabled=false).
// Затова нови хора в екипа не се появяваха в платформата. Сега sync-ът е отделен
// сервиз със свой дневен cron (Админ → Екип и роли, `bc_team_sync_time`) и не
// зависи от никоя друга функционалност.
const cron = require('node-cron');
const config = require('../config');
const { query, queryOne, execute } = require('../db/pool');
const bc = require('./basecamp');
const { getServiceAuth, getUserAuth } = require('./basecamp-token');

let task = null;

// Токен за четене на хората: ботът ThePactAlerts (работи без никой да е логнат),
// а ако той не е в проекта — токенът на админа (Венци).
async function getReadAuth() {
  try {
    return await getServiceAuth();
  } catch (err) {
    console.warn('[bc-team] сервизният акаунт не е достъпен:', err.message);
  }
  const row = await queryOne(
    `SELECT u.id FROM users u JOIN basecamp_tokens t ON t.user_id = u.id
     WHERE LOWER(u.email) = ANY($1::text[]) ORDER BY u.id LIMIT 1`,
    [config.ADMIN_EMAILS]
  );
  if (!row) throw new Error('Няма Basecamp токен за четене на екипа (нито бот, нито админ).');
  return getUserAuth(row.id);
}

/**
 * Тегли хората от Video Production и обновява bc_people.
 * Клиентите и интеграциите (ботове) не са част от екипа.
 * Връща { count, added, deactivated } — имената, за да се вижда какво се е сменило.
 */
async function refreshTeam() {
  const auth = await getReadAuth();
  const people = await bc.getProjectPeople(auth.token, auth.account, config.BASECAMP_TEAM_PROJECT_ID);
  const team = people.filter((p) => !p.client && p.personable_type !== 'Integration');
  if (!team.length) {
    // Празен отговор почти винаги значи проблем с достъпа — по-добре да не изтрием кеша.
    throw new Error('Basecamp върна 0 души за Video Production — проверката е прекратена, кешът остава.');
  }

  const before = await query('SELECT person_id, name, active FROM bc_people');
  const knownActive = new Set(before.filter((r) => r.active).map((r) => String(r.person_id)));
  const known = new Set(before.map((r) => String(r.person_id)));

  for (const p of team) {
    await execute(
      `INSERT INTO bc_people (person_id, name, email, title, avatar_url, attachable_sgid, active, synced_at)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE, NOW())
       ON CONFLICT (person_id) DO UPDATE SET
         name = $2, email = $3, title = $4, avatar_url = $5, attachable_sgid = $6, active = TRUE, synced_at = NOW()`,
      [p.id, p.name || '', String(p.email_address || '').toLowerCase(), p.title || '',
       p.avatar_url || '', p.attachable_sgid || '']
    );
  }
  await execute('UPDATE bc_people SET active = FALSE WHERE person_id != ALL($1::bigint[])',
    [team.map((p) => p.id)]);

  const nowIds = new Set(team.map((p) => String(p.id)));
  const added = team.filter((p) => !known.has(String(p.id)) || !knownActive.has(String(p.id)))
    .map((p) => p.name || String(p.id));
  const deactivated = before.filter((r) => r.active && !nowIds.has(String(r.person_id)))
    .map((r) => r.name || String(r.person_id));

  console.log(`[bc-team] екип обновен: ${team.length} души` +
    (added.length ? ` · нови: ${added.join(', ')}` : '') +
    (deactivated.length ? ` · извън екипа: ${deactivated.join(', ')}` : ''));
  return { count: team.length, added, deactivated };
}

// Опресняване „при нужда" — ползва се от други сервизи преди да таргетират хора.
// Най-много един опит на 10 мин; пропуска, ако кешът е по-нов от 6 часа.
let _lastAttempt = 0;
async function ensureFresh() {
  if (Date.now() - _lastAttempt < 10 * 60_000) return;
  const row = await queryOne('SELECT MAX(synced_at) AS at FROM bc_people');
  const at = row && row.at ? new Date(row.at).getTime() : 0;
  if (Date.now() - at < 6 * 3600_000) return;
  _lastAttempt = Date.now();
  try {
    await refreshTeam();
  } catch (err) {
    console.warn('[bc-team] авто-опресняване се провали:', err.message);
  }
}

async function syncTime() {
  const row = await queryOne("SELECT value FROM settings WHERE key = 'bc_team_sync_time'");
  const v = row && row.value;
  return /^\d{1,2}:\d{2}$/.test(v || '') ? v : '07:30';
}

async function initBcTeamSync() {
  try {
    const time = await syncTime();
    const [h, m] = time.split(':');
    if (task) { task.stop(); task = null; }
    task = cron.schedule(`${parseInt(m, 10)} ${parseInt(h, 10)} * * *`, () => {
      refreshTeam().catch((err) => console.error('[bc-team] дневен sync се провали:', err.message));
    }, { timezone: 'Europe/Sofia' });
    console.log(`  BC team sync: active (всеки ден ${time} BG)`);
  } catch (err) {
    console.log('  BC team sync: skipped —', err.message);
  }
}

async function restartBcTeamSync() {
  await initBcTeamSync();
}

// Хората, които отговарят за създаването на контент плановете: активни хора от
// Basecamp с позиция, маркирана като kp_responsible (Админ → Екип и роли).
async function kpResponsiblePeople() {
  return query(
    `SELECT p.* FROM bc_people p
     JOIN positions pos ON pos.id = p.position_id
     WHERE p.active = TRUE AND pos.kp_responsible = TRUE
     ORDER BY p.name`
  );
}

// ---------- @mentions в Basecamp rich text ----------

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Истински таг (човекът получава известие) изисква attachable_sgid от Basecamp.
// Без него оставаме на дебело име — по-добре от нищо.
function mentionOf(person, fallbackName) {
  if (person && person.attachable_sgid) return `<bc-attachment sgid="${person.attachable_sgid}"></bc-attachment>`;
  return `<strong>${escHtml((person && person.name) || fallbackName || 'неизвестен')}</strong>`;
}

module.exports = {
  initBcTeamSync, restartBcTeamSync, refreshTeam, ensureFresh, syncTime,
  kpResponsiblePeople, getReadAuth, mentionOf, escHtml,
};
