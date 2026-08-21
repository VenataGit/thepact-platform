// Регистрира (или поправя) Basecamp webhook-а, който храни авто-синхрона на датите.
//
// Защо е скрипт, а не бутон: Basecamp пуска webhook да се създава само от човек с
// админски права в проекта — сервизният бот ThePactAlerts получава 403. Затова се
// ползва запазеният OAuth токен на админ от платформата.
//
// Идемпотентно: ако вече има наш webhook — само се дописва каквото липсва (адрес,
// типове, активност). Чуждите webhook-и не се пипат.
//
//   node scripts/ensure-datesync-webhook.js          # регистрира/поправя
//   node scripts/ensure-datesync-webhook.js --dry    # само показва какво има
const config = require('../src/config');
const bc = require('../src/services/basecamp');
const { query } = require('../src/db/pool');
const { getUserAuth } = require('../src/services/basecamp-token');

const TYPES = ['Kanban::Card']; // само карти — стъпките си ги пише ботът, иначе се зацикля
const DRY = process.argv.includes('--dry');

// Адресът на платформата идва от OAuth redirect-а — така не се въвежда домейн на две места.
function publicBase() {
  return new URL(config.BASECAMP_REDIRECT_URI).origin;
}

function payloadUrl() {
  return `${publicBase()}/webhooks/basecamp/${config.BASECAMP_WEBHOOK_SECRET}`;
}

// Тайната е в пътя — никога не я изписваме в лог.
const mask = (url) => String(url || '').replace(/\/webhooks\/basecamp\/.*/, '/webhooks/basecamp/<тайната>');

// Админ с жива Basecamp връзка. Първо тези от ADMIN_EMAILS (Венци), после всеки друг админ.
async function adminUserId() {
  const rows = await query(
    `SELECT u.id, u.email, u.name
       FROM users u
       JOIN basecamp_tokens t ON t.user_id = u.id
      WHERE u.role = 'admin' AND u.is_active = TRUE
      ORDER BY (LOWER(u.email) = ANY($1::text[])) DESC, t.updated_at DESC
      LIMIT 1`,
    [config.ADMIN_EMAILS]
  );
  if (!rows.length) throw new Error('Няма админ със свързан Basecamp профил — влез веднъж в thepact.pro с „Влез с Basecamp".');
  return rows[0];
}

async function main() {
  if (!config.BASECAMP_WEBHOOK_SECRET) throw new Error('BASECAMP_WEBHOOK_SECRET липсва в .env — без него приемникът е изключен.');

  const admin = await adminUserId();
  const { token, account } = await getUserAuth(admin.id);
  const projectId = config.BASECAMP_TEAM_PROJECT_ID;
  const base = `${bc.API_BASE}/${account}/buckets/${projectId}/webhooks`;
  console.log(`Проект ${projectId}, от името на ${admin.name} <${admin.email}>`);

  const existing = (await bc.authedGet(`${base}.json`, token)).json || [];
  console.log(`Намерени webhook-и: ${existing.length}`);
  existing.forEach((w) => console.log(`  #${w.id} active=${w.active} types=${(w.types || []).join('/')} → ${mask(w.payload_url)}`));

  const ours = existing.find((w) => String(w.payload_url || '').includes('/webhooks/basecamp/'));
  const want = payloadUrl();
  const okUrl = ours && ours.payload_url === want;
  const okTypes = ours && TYPES.every((t) => (ours.types || []).includes(t));
  if (ours && okUrl && okTypes && ours.active) {
    console.log(`✅ Вече е наред — #${ours.id}`);
    return;
  }
  if (DRY) {
    console.log(ours ? `⚠️ Трябва поправка на #${ours.id} (адрес=${okUrl} типове=${okTypes} активен=${ours.active})` : '⚠️ Няма наш webhook — трябва да се създаде.');
    return;
  }

  const method = ours ? 'PUT' : 'POST';
  const url = ours ? `${base}/${ours.id}.json` : `${base}.json`;
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': config.BASECAMP_USER_AGENT, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ payload_url: want, types: TYPES, active: true }),
  });
  if (!r.ok) throw new Error(`Basecamp ${method} webhook → ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const saved = await r.json();
  console.log(`✅ ${ours ? 'Поправен' : 'Създаден'} webhook #${saved.id} active=${saved.active} types=${(saved.types || []).join('/')} → ${mask(saved.payload_url)}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error('❌', e.message); process.exit(1); });
