// "Connect with Basecamp" login flow.
//   GET /auth/basecamp           -> redirect the user to Basecamp to authorize
//   GET /auth/basecamp/callback  -> exchange code, map to a platform user, issue our session JWT
//
// We map a Basecamp identity to a platform user by (1) existing basecamp_user_id,
// then (2) matching email (links the Basecamp identity to the existing account, keeping
// their role), then (3) auto-creating a new 'member'. After success we issue the SAME
// __pact_jwt cookie used by password login, so the rest of the app is unchanged.
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const config = require('../config');
const { queryOne, execute } = require('../db/pool');
const { signToken, setTokenCookie } = require('../middleware/auth');
const basecamp = require('../services/basecamp');

const STATE_COOKIE = 'bc_oauth_state';
const STATE_COOKIE_OPTS = {
  httpOnly: true,
  secure: config.IS_PRODUCTION,
  sameSite: 'lax',
  maxAge: 10 * 60 * 1000, // 10 minutes to complete the round-trip
  path: '/auth',
};

// GET /auth/basecamp — start the OAuth round-trip
router.get('/basecamp', (req, res) => {
  if (!basecamp.isConfigured()) {
    return res.status(503).send('Basecamp връзката още не е конфигурирана на сървъра.');
  }
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie(STATE_COOKIE, state, STATE_COOKIE_OPTS);
  res.redirect(basecamp.buildAuthorizeUrl(state));
});

// GET /auth/basecamp/callback — Basecamp redirects here with ?code & ?state
router.get('/basecamp/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) return res.redirect('/login.html?bc=denied');
    if (!code) return res.redirect('/login.html?bc=nocode');

    // CSRF: returned state must match the cookie we set before redirecting out.
    const expected = req.cookies?.[STATE_COOKIE];
    res.clearCookie(STATE_COOKIE, { path: '/auth' });
    if (!expected || state !== expected) return res.redirect('/login.html?bc=state');

    // 1. code -> tokens
    const tokens = await basecamp.exchangeCodeForToken(code);

    // 2. tokens -> identity + accounts
    const auth = await basecamp.getAuthorization(tokens.access_token);
    const ident = auth.identity || {};
    const email = String(ident.email_address || '').toLowerCase().trim();
    const name = [ident.first_name, ident.last_name].filter(Boolean).join(' ').trim() || email;
    const bcUserId = ident.id;
    const accounts = Array.isArray(auth.accounts) ? auth.accounts : [];
    const account = accounts.find((a) => a.product === 'bc3') || accounts[0] || null;
    const accountId = account ? account.id : null;

    if (!email || !bcUserId) return res.redirect('/login.html?bc=identity');

    // 3. Find or link the platform user.
    let user = await queryOne('SELECT * FROM users WHERE basecamp_user_id = $1', [bcUserId]);
    if (!user) {
      user = await queryOne('SELECT * FROM users WHERE email = $1', [email]);
      if (user) {
        // Link Basecamp to the existing account — keep their existing role.
        await execute(
          'UPDATE users SET basecamp_user_id = $1, basecamp_account_id = $2, updated_at = NOW() WHERE id = $3',
          [bcUserId, accountId, user.id]
        );
      } else {
        // First-time Basecamp user — auto-create as 'member'.
        user = await queryOne(
          `INSERT INTO users (email, name, role, basecamp_user_id, basecamp_account_id, is_active)
           VALUES ($1, $2, 'member', $3, $4, TRUE)
           RETURNING *`,
          [email, name, bcUserId, accountId]
        );
      }
    } else {
      await execute('UPDATE users SET basecamp_account_id = $1, updated_at = NOW() WHERE id = $2', [accountId, user.id]);
    }

    if (user.is_active === false) return res.redirect('/login.html?bc=inactive');

    // 4. Persist tokens (upsert; keep old refresh_token if Basecamp omits a new one).
    const expiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null;
    await execute(
      `INSERT INTO basecamp_tokens (user_id, access_token, refresh_token, expires_at, basecamp_account_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         access_token = EXCLUDED.access_token,
         refresh_token = COALESCE(EXCLUDED.refresh_token, basecamp_tokens.refresh_token),
         expires_at = EXCLUDED.expires_at,
         basecamp_account_id = EXCLUDED.basecamp_account_id,
         updated_at = NOW()`,
      [user.id, tokens.access_token, tokens.refresh_token || null, expiresAt, accountId]
    );

    await execute('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    // 5. Issue our own session JWT — identical to password login from here on.
    setTokenCookie(res, signToken(user));
    res.redirect('/');
  } catch (err) {
    console.error('[basecamp callback]', err.message);
    res.redirect('/login.html?bc=error');
  }
});

module.exports = router;
