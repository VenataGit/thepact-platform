// "Connect with Basecamp" login flow.
//   GET /auth/basecamp           -> redirect the user to Basecamp to authorize
//   GET /auth/basecamp/callback  -> exchange code, map to a platform user, issue our session JWT
//
// We map a Basecamp identity to a platform user by (1) existing basecamp_user_id,
// then (2) matching email (links the identity to the existing team account, keeping
// their role). Unknown emails are DENIED (team-only). Service mode (an admin connecting
// the ThePactAlerts bot) stores the token instead of logging anyone in.
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const config = require('../config');
const { queryOne, execute } = require('../db/pool');
const jwt = require('jsonwebtoken');
const { signToken, setTokenCookie, requireAuth, requireAdmin } = require('../middleware/auth');
const basecamp = require('../services/basecamp');

const STATE_COOKIE = 'bc_oauth_state';
const MODE_COOKIE = 'bc_oauth_mode'; // 'service' when an admin connects the ThePactAlerts bot
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

// GET /auth/basecamp/service — admin connects the ThePactAlerts service account (one-time).
// Same OAuth flow, but the callback stores the resulting token as the shared bot token
// instead of logging anyone in. The admin must be signed into Basecamp AS the bot.
router.get('/basecamp/service', requireAuth, requireAdmin, (req, res) => {
  if (!basecamp.isConfigured()) {
    return res.status(503).send('Basecamp връзката още не е конфигурирана на сървъра.');
  }
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie(STATE_COOKIE, state, STATE_COOKIE_OPTS);
  res.cookie(MODE_COOKIE, 'service', STATE_COOKIE_OPTS);
  res.redirect(basecamp.buildAuthorizeUrl(state));
});

// GET /auth/basecamp/service/status — is the bot connected, and as whom?
router.get('/basecamp/service/status', requireAuth, requireAdmin, async (req, res) => {
  const row = await queryOne(
    'SELECT person_id, person_name, person_email, account_id, updated_at FROM basecamp_service_account WHERE id = 1'
  );
  res.json({ connected: !!row, service: row || null });
});

// GET /auth/basecamp/callback — Basecamp redirects here with ?code & ?state
router.get('/basecamp/callback', async (req, res) => {
  const mode = req.cookies?.[MODE_COOKIE];
  res.clearCookie(MODE_COOKIE, { path: '/auth' });
  const fail = (reason) => res.redirect(mode === 'service' ? `/?bc_service=${reason}` : `/login.html?bc=${reason}`);
  try {
    const { code, state, error } = req.query;
    if (error) return fail('denied');
    if (!code) return fail('nocode');

    // CSRF: returned state must match the cookie we set before redirecting out.
    const expected = req.cookies?.[STATE_COOKIE];
    res.clearCookie(STATE_COOKIE, { path: '/auth' });
    if (!expected || state !== expected) return fail('state');

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

    if (!email || !bcUserId) return fail('identity');

    // SERVICE MODE: store the ThePactAlerts bot token (no user login).
    if (mode === 'service') {
      let connectedBy = null;
      try { connectedBy = jwt.verify(req.cookies?.__pact_jwt || '', config.JWT_SECRET).userId; } catch { /* not fatal */ }
      const expiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null;
      await execute(
        `INSERT INTO basecamp_service_account
           (id, person_id, person_name, person_email, account_id, access_token, refresh_token, expires_at, connected_by, updated_at)
         VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (id) DO UPDATE SET
           person_id = EXCLUDED.person_id, person_name = EXCLUDED.person_name, person_email = EXCLUDED.person_email,
           account_id = EXCLUDED.account_id, access_token = EXCLUDED.access_token,
           refresh_token = COALESCE(EXCLUDED.refresh_token, basecamp_service_account.refresh_token),
           expires_at = EXCLUDED.expires_at, connected_by = EXCLUDED.connected_by, updated_at = NOW()`,
        [bcUserId, name, email, accountId, tokens.access_token, tokens.refresh_token || null, expiresAt, connectedBy]
      );
      console.log(`[basecamp] service account connected as ${email} (person ${bcUserId})`);
      return res.redirect('/?bc_service=ok');
    }

    // 3. Find or link the platform user.
    //    TEAM-ONLY: the Basecamp account also contains clients/guests, so we NEVER
    //    auto-create. Login is allowed only when the Basecamp email already belongs
    //    to an existing Pact team member (they were added to the platform by an admin).
    let user = await queryOne('SELECT * FROM users WHERE basecamp_user_id = $1', [bcUserId]);
    if (!user) {
      user = await queryOne('SELECT * FROM users WHERE email = $1', [email]);
      if (!user) {
        console.warn(`[basecamp] denied login for non-team email: ${email}`);
        return res.redirect('/login.html?bc=notteam');
      }
      // First Basecamp login for an existing team member — link identity, keep their role.
      await execute(
        'UPDATE users SET basecamp_user_id = $1, basecamp_account_id = $2, updated_at = NOW() WHERE id = $3',
        [bcUserId, accountId, user.id]
      );
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
    fail('error');
  }
});

module.exports = router;
