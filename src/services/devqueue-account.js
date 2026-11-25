// Акаунтът, който движи ЛИЧНИЯ проект на Венци (25.11.2026) — неговият отделен „venata“ акаунт.
// Без имейл в кода: свързва се онзи, който има достъп до личния проект и НЕ е Венци/ThePactAlerts
// (проверката е в routes/basecamp-auth.js); после се разпознава по person id.
// Dev опашката (задачите + коментарите), Ping-ът с Венци и сигналите в чата на личния
// проект минават през него. ThePactAlerts (getServiceAuth) остава за всичко към екипа.
// Докато venata не е свързан (/auth/basecamp/devqueue), всичко пада обратно на ThePactAlerts —
// т.е. нищо не спира.
const { queryOne, execute } = require('../db/pool');
const bc = require('./basecamp');
const config = require('../config');
const { encryptToken, decryptToken } = require('./token-crypto');
const { getServiceAuth } = require('./basecamp-token');

// person id-та на двата бот акаунта — за isBotCreator (имейлите на другите често идват маскирани).
const botPersonIds = new Set();

let tableReady = false;
async function ensureTable() {
  if (tableReady) return;
  // Идемпотентно и тук (освен migration 075) — runner-ът на миграциите спира тихо при грешка.
  await execute(`CREATE TABLE IF NOT EXISTS basecamp_devqueue_account (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    person_id BIGINT, person_name TEXT, person_email TEXT, account_id BIGINT,
    access_token TEXT NOT NULL, refresh_token TEXT, expires_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW())`);
  await execute('ALTER TABLE dev_chat ADD COLUMN IF NOT EXISTS reply_as TEXT');
  // person id на ThePactAlerts — през токена на venata имейлът му може да идва маскиран.
  const svc = await queryOne('SELECT person_id FROM basecamp_service_account WHERE id = 1').catch(() => null);
  if (svc?.person_id) botPersonIds.add(Number(svc.person_id));
  tableReady = true;
}

// Токенът на venata или null, ако още не е свързан.
async function getDevQueueOnlyAuth() {
  await ensureTable();
  const row = await queryOne('SELECT * FROM basecamp_devqueue_account WHERE id = 1');
  if (!row) return null;
  if (row.person_id) botPersonIds.add(Number(row.person_id));
  let token = decryptToken(row.access_token);
  const exp = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (exp && exp < Date.now() + 60_000 && row.refresh_token) {
    try {
      const t = await bc.refreshAccessToken(decryptToken(row.refresh_token));
      token = t.access_token;
      const expiresAt = t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null;
      await execute('UPDATE basecamp_devqueue_account SET access_token = $1, expires_at = $2, updated_at = NOW() WHERE id = 1',
        [encryptToken(token), expiresAt]);
    } catch { /* остава старият токен */ }
  }
  return { token, account: config.BASECAMP_ACCOUNT_ID || row.account_id, devqueue: true };
}

// За личния проект: venata, ако е свързан, иначе ThePactAlerts.
async function getDevQueueAuth() {
  const own = await getDevQueueOnlyAuth();
  if (own) return own;
  return getServiceAuth();
}

// Коментар/ред от някой от двата бот акаунта (не от човек) — за да не се будим от собствения отговор.
function isBotCreator(creator) {
  const email = String(creator?.email_address || '').toLowerCase();
  if (email && email === config.BASECAMP_SERVICE_EMAIL) return true;
  return botPersonIds.has(Number(creator?.id));
}

async function saveDevQueueAccount({ personId, name, email, accountId, tokens }) {
  await ensureTable();
  const expiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null;
  await execute(
    `INSERT INTO basecamp_devqueue_account
       (id, person_id, person_name, person_email, account_id, access_token, refresh_token, expires_at, updated_at)
     VALUES (1, $1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (id) DO UPDATE SET
       person_id = EXCLUDED.person_id, person_name = EXCLUDED.person_name, person_email = EXCLUDED.person_email,
       account_id = EXCLUDED.account_id, access_token = EXCLUDED.access_token,
       refresh_token = COALESCE(EXCLUDED.refresh_token, basecamp_devqueue_account.refresh_token),
       expires_at = EXCLUDED.expires_at, updated_at = NOW()`,
    [personId, name, email, accountId, encryptToken(tokens.access_token), encryptToken(tokens.refresh_token) || null, expiresAt]
  );
  botPersonIds.add(Number(personId));
}

module.exports = { getDevQueueAuth, getDevQueueOnlyAuth, isBotCreator, saveDevQueueAccount, ensureTable };
