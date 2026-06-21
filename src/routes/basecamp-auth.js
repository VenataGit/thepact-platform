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

// GET /auth/basecamp/service — connect the ThePactAlerts service account (one-time).
// Public on purpose: the real gate is in the callback — we only store the token if the
// authorized Basecamp identity IS the known bot (config.BASECAMP_SERVICE_EMAIL). This avoids
// the chicken-and-egg of needing a platform admin session while signed into Basecamp as the bot.
router.get('/basecamp/service', (req, res) => {
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
  // Service mode renders an inline confirmation page (no SPA session involved).
  const servicePage = (ok, msg) => res.status(ok ? 200 : 400).send(
    '<!doctype html><meta charset="utf-8"><title>ThePactAlerts</title>' +
    '<body style="font-family:system-ui,sans-serif;background:#1a2730;color:#e8ecee;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center">' +
    '<div style="max-width:420px;padding:24px"><div style="font-size:44px">' + (ok ? '✅' : '⚠️') + '</div>' +
    '<h2 style="color:' + (ok ? '#46a374' : '#ef4444') + ';font-weight:600">' + msg + '</h2>' +
    '<p style="color:#8fa3b0">Можеш да затвориш този таб.</p></div>'
  );
  const failMsgs = { denied: 'Отказахте достъпа до Basecamp.', nocode: 'Връзката с Basecamp прекъсна.', state: 'Сесията изтече — опитай пак.', identity: 'Не успяхме да прочетем данните от Basecamp.', error: 'Грешка при свързване с Basecamp.' };
  const fail = (reason) => (mode === 'service' ? servicePage(false, failMsgs[reason] || 'Грешка.') : res.redirect(`/login.html?bc=${reason}`));
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
    if (!accountId) return fail('identity'); // no usable Basecamp account on this token

    // SERVICE MODE: store the ThePactAlerts bot token (no user login).
    if (mode === 'service') {
      // Gate: only accept the token if this IS the known bot account.
      if (config.BASECAMP_SERVICE_EMAIL && email !== config.BASECAMP_SERVICE_EMAIL) {
        console.warn(`[basecamp] service connect rejected — wrong account: ${email}`);
        return servicePage(false, `Влязъл си като „${email}", а трябва ThePactAlerts (${config.BASECAMP_SERVICE_EMAIL}). Влез в Basecamp като бота и опитай пак.`);
      }
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
      return servicePage(true, `ThePactAlerts е свързан успешно! (${email})`);
    }

    // 3. Authorize dynamically against Basecamp — NO manual platform user management.
    //    Allowed if the person is an internal team member (non-client) OR a member of the
    //    Video Production project. Clients/guests are denied. New team members are
    //    auto-provisioned on first login, so access depends entirely on Basecamp.
    let user = await queryOne('SELECT * FROM users WHERE basecamp_user_id = $1', [bcUserId]);
    if (!user) user = await queryOne('SELECT * FROM users WHERE LOWER(email) = $1', [email]);

    const member = await basecamp.isTeamMember(tokens.access_token, accountId, config.BASECAMP_TEAM_PROJECT_ID);
    if (!member.allowed) {
      // If Basecamp couldn't be reached, don't lock out an already-known user.
      if (member.errored && user) {
        console.warn(`[basecamp] membership check errored; allowing known user ${email}`);
      } else {
        console.warn(`[basecamp] denied login — not team/project member: ${email} (${member.reason})`);
        return res.redirect('/login.html?bc=notteam');
      }
    }

    if (!user) {
      // Auto-provision a brand-new team member straight from Basecamp.
      user = await queryOne(
        `INSERT INTO users (email, name, role, basecamp_user_id, basecamp_account_id, is_active)
         VALUES ($1, $2, 'member', $3, $4, TRUE)
         ON CONFLICT (email) DO UPDATE SET
           basecamp_user_id = EXCLUDED.basecamp_user_id,
           basecamp_account_id = EXCLUDED.basecamp_account_id,
           name = EXCLUDED.name,
           updated_at = NOW()
         RETURNING *`,
        [email, name, bcUserId, accountId]
      );
      console.log(`[basecamp] auto-provisioned ${email} (${member.reason})`);
    } else {
      await execute('UPDATE users SET basecamp_user_id = $1, basecamp_account_id = $2, updated_at = NOW() WHERE id = $3', [bcUserId, accountId, user.id]);
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
    res.redirect('/#/dashboard');
  } catch (err) {
    console.error('[basecamp callback]', err.message);
    fail('error');
  }
});

module.exports = router;
