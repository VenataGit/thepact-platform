// Basecamp 3/4 OAuth 2.0 + API helper (37signals "Launchpad").
// Docs: https://github.com/basecamp/api/blob/master/sections/authentication.md
//
// Auth flow:
//   1. redirect user -> buildAuthorizeUrl()
//   2. Basecamp redirects back with ?code -> exchangeCodeForToken(code)
//   3. getAuthorization(accessToken) -> identity + the accounts the user can access
//
// Basecamp is strict about the User-Agent header — it must identify the app + a contact.
const config = require('../config');

const AUTH_BASE = 'https://launchpad.37signals.com';

function isConfigured() {
  return Boolean(config.BASECAMP_CLIENT_ID && config.BASECAMP_CLIENT_SECRET);
}

function headers(extra = {}) {
  return { 'User-Agent': config.BASECAMP_USER_AGENT, Accept: 'application/json', ...extra };
}

// URL we send the user to so they can grant access. `state` guards against CSRF.
function buildAuthorizeUrl(state) {
  const params = new URLSearchParams({
    type: 'web_server',
    client_id: config.BASECAMP_CLIENT_ID,
    redirect_uri: config.BASECAMP_REDIRECT_URI,
  });
  if (state) params.set('state', state);
  return `${AUTH_BASE}/authorization/new?${params.toString()}`;
}

// Exchange the ?code from the callback for { access_token, refresh_token, expires_in }.
async function exchangeCodeForToken(code) {
  const params = new URLSearchParams({
    type: 'web_server',
    client_id: config.BASECAMP_CLIENT_ID,
    redirect_uri: config.BASECAMP_REDIRECT_URI,
    client_secret: config.BASECAMP_CLIENT_SECRET,
    code,
  });
  const res = await fetch(`${AUTH_BASE}/authorization/token?${params.toString()}`, {
    method: 'POST',
    headers: headers(),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Basecamp token exchange failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json();
}

// Refresh an expired access token using the stored refresh_token.
async function refreshAccessToken(refreshToken) {
  const params = new URLSearchParams({
    type: 'refresh',
    refresh_token: refreshToken,
    client_id: config.BASECAMP_CLIENT_ID,
    client_secret: config.BASECAMP_CLIENT_SECRET,
  });
  const res = await fetch(`${AUTH_BASE}/authorization/token?${params.toString()}`, {
    method: 'POST',
    headers: headers(),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Basecamp token refresh failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json();
}

// The authenticated user's identity + the list of Basecamp accounts they can access.
// Shape: { identity: { id, email_address, first_name, last_name }, accounts: [{ id, name, product, href }] }
async function getAuthorization(accessToken) {
  const res = await fetch(`${AUTH_BASE}/authorization.json`, {
    headers: headers({ Authorization: `Bearer ${accessToken}` }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Basecamp identity fetch failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json();
}

module.exports = {
  AUTH_BASE,
  isConfigured,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  getAuthorization,
};
