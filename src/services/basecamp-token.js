// Resolves a valid Basecamp access token for API calls.
// Default: act as the logged-in USER (their own token from basecamp_tokens).
// The ThePactAlerts service token is also available (getServiceAuth) and reserved
// for future bot-driven tools — not used by the dashboard.
const { queryOne, execute } = require('../db/pool');
const bc = require('./basecamp');

// Refresh the access token if it is expired / about to expire. Returns a usable token.
// `table`/`idCol` are fixed literals (never user input), so the interpolation is safe.
async function refreshIfNeeded(row, table, idCol, idVal) {
  let token = row.access_token;
  const exp = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (exp && exp < Date.now() + 60_000 && row.refresh_token) {
    try {
      const t = await bc.refreshAccessToken(row.refresh_token);
      token = t.access_token;
      const expiresAt = t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null;
      await execute(`UPDATE ${table} SET access_token = $1, expires_at = $2, updated_at = NOW() WHERE ${idCol} = $3`, [token, expiresAt, idVal]);
    } catch { /* keep the existing token if refresh fails */ }
  }
  return token;
}

// The logged-in user's own Basecamp token + account.
async function getUserAuth(userId) {
  const row = await queryOne('SELECT * FROM basecamp_tokens WHERE user_id = $1', [userId]);
  if (!row) {
    const e = new Error('Няма Basecamp връзка за този профил — влез отново.');
    e.code = 'NO_USER_TOKEN';
    throw e;
  }
  const token = await refreshIfNeeded(row, 'basecamp_tokens', 'user_id', userId);
  return { token, account: row.basecamp_account_id };
}

// The shared ThePactAlerts service token (reserved for future bot-driven tools).
async function getServiceAuth() {
  const row = await queryOne('SELECT * FROM basecamp_service_account WHERE id = 1');
  if (!row) throw new Error('ThePactAlerts сервизен акаунт не е свързан.');
  const token = await refreshIfNeeded(row, 'basecamp_service_account', 'id', 1);
  return { token, account: row.account_id };
}

module.exports = { getUserAuth, getServiceAuth };
