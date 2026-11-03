// Криптиране на Basecamp токените в базата (AES-256-GCM). Изтече ли дъмп/бекъп на базата
// (нощният бекъп отива на офис компютъра), токените в него са безполезни без ключа.
// Формат: "enc:v1:" + base64(iv[12] | tag[16] | ciphertext). Стари (некриптирани) стойности
// се четат както са и се криптират при следващия запис / при старт (encryptExistingTokens).
const crypto = require('crypto');
const config = require('../config');

const PREFIX = 'enc:v1:';
const KEY = config.TOKEN_ENC_KEY
  ? crypto.createHash('sha256').update(String(config.TOKEN_ENC_KEY)).digest()
  : Buffer.from(crypto.hkdfSync('sha256', String(config.JWT_SECRET), 'thepact-token-crypto', 'basecamp-tokens-v1', 32));

function encryptToken(plain) {
  if (plain == null || plain === '') return plain;
  const s = String(plain);
  if (s.startsWith(PREFIX)) return s;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([c.update(s, 'utf8'), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

function decryptToken(stored) {
  if (stored == null || stored === '') return stored;
  const s = String(stored);
  if (!s.startsWith(PREFIX)) return s; // стар запис — още некриптиран
  const raw = Buffer.from(s.slice(PREFIX.length), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

// Еднократно при старт: криптира останалите некриптирани токени (стойностите се пазят — само се шифроват).
async function encryptExistingTokens() {
  const { query, execute } = require('../db/pool');
  let n = 0;
  for (const [table, idCol] of [['basecamp_tokens', 'user_id'], ['basecamp_service_account', 'id']]) {
    let rows = [];
    try { rows = await query(`SELECT ${idCol} AS id, access_token, refresh_token FROM ${table}`); } catch { continue; }
    for (const r of rows) {
      const needA = r.access_token && !String(r.access_token).startsWith(PREFIX);
      const needR = r.refresh_token && !String(r.refresh_token).startsWith(PREFIX);
      if (!needA && !needR) continue;
      const a = needA ? encryptToken(r.access_token) : r.access_token;
      const rf = needR ? encryptToken(r.refresh_token) : r.refresh_token;
      if (decryptToken(a) !== r.access_token || decryptToken(rf) !== r.refresh_token) throw new Error('token crypto self-check failed');
      await execute(`UPDATE ${table} SET access_token = $1, refresh_token = $2 WHERE ${idCol} = $3`, [a, rf, r.id]);
      n++;
    }
  }
  if (n) console.log(`[token-crypto] encrypted ${n} stored Basecamp token row(s)`);
}

module.exports = { encryptToken, decryptToken, encryptExistingTokens };
