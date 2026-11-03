const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config');

const COOKIE_NAME = '__pact_jwt';
const COOKIE_OPTS = {
  httpOnly: true,
  secure: config.IS_PRODUCTION,
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: '/'
};

// oiat = кога е бил истинският вход. Опресняването го пренася, така че сесията живее
// най-много SESSION_MAX_AGE_S — после нов вход през Basecamp (и нова проверка на членството).
const SESSION_MAX_AGE_S = 30 * 24 * 3600;

function signToken(user, oiat) {
  return jwt.sign(
    { userId: user.id, role: user.role, name: user.name, oiat: oiat || Math.floor(Date.now() / 1000) },
    config.JWT_SECRET,
    { expiresIn: config.JWT_EXPIRES_IN }
  );
}

function setTokenCookie(res, token) {
  res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
}

function clearTokenCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

// Middleware: require any authenticated user
// Ролята, името и is_active идват ЖИВО от базата (кеш 60 сек), не от токена — иначе
// понижен/деактивиран човек запазва старите си права, докато токенът се опреснява.
const activeUserCache = new Map(); // userId -> { active, role, name, checkedAt }
const ACTIVE_CHECK_TTL = 60_000;   // re-check every 60 seconds

async function loadLiveUser(userId) {
  const cached = activeUserCache.get(userId);
  if (cached && Date.now() - cached.checkedAt < ACTIVE_CHECK_TTL) return cached;
  const { queryOne: qo, execute: exec } = require('../db/pool');
  const u = await qo('SELECT is_active, role, name FROM users WHERE id = $1', [userId]);
  const live = { active: !!u && u.is_active !== false, role: u?.role, name: u?.name, checkedAt: Date.now() };
  activeUserCache.set(userId, live);
  if (!live.active) exec('DELETE FROM push_subscriptions WHERE user_id = $1', [userId]).catch(() => {});
  return live;
}

function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return extensionTokenAuth(req, res, next);

  let payload;
  try {
    payload = jwt.verify(token, config.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  const oiat = payload.oiat || payload.iat;
  if (Date.now() / 1000 - oiat > SESSION_MAX_AGE_S) {
    clearTokenCookie(res);
    return res.status(401).json({ error: 'Session expired' });
  }

  // В тестовете базата е мокната с подредени отговори — там живата проверка е изключена
  // (освен в tests/auth-live.test.js, който я пуска с AUTH_LIVE_CHECK=1).
  const skipLive = process.env.NODE_ENV === 'test' && process.env.AUTH_LIVE_CHECK !== '1';
  const liveP = skipLive ? Promise.resolve({ active: true, role: payload.role, name: payload.name }) : loadLiveUser(payload.userId);
  liveP.then((live) => {
    if (!live.active) {
      clearTokenCookie(res);
      return res.status(401).json({ error: 'Account deactivated' });
    }
    req.user = { ...payload, role: live.role, name: live.name || payload.name };

    // Sliding expiration: refresh if < 24h remaining (с живата роля)
    const timeLeft = payload.exp - Date.now() / 1000;
    if (timeLeft < 86400) {
      setTokenCookie(res, signToken({ id: payload.userId, role: live.role, name: req.user.name }, oiat));
    }
    next();
  }).catch((e) => {
    console.error('[auth] live user check failed:', e.message);
    if (!res.headersSent) res.status(503).json({ error: 'Auth check failed' });
  });
}

// Call after changing a user's role/name so it applies on the next request
function refreshUserCache(userId) {
  activeUserCache.delete(Number(userId));
  activeUserCache.delete(String(userId));
}

// Call this when deactivating a user to immediately invalidate their cache
function invalidateUserCache(userId) {
  activeUserCache.set(userId, { active: false, checkedAt: Date.now() });
}

// --- Extension bearer tokens (The Pact Tools) ---
// Fallback auth path when there is no session cookie: Authorization: Bearer pt_<64 hex>.
// The token itself is never stored — only its SHA-256 hash (extension_tokens table).
// Role comes live from the users table, so role changes apply within the cache TTL.
const extTokenCache = new Map(); // tokenHash -> { user: payload|null, checkedAt: ms }
const EXT_TOKEN_TTL = 60_000;

function extensionTokenAuth(req, res, next) {
  const m = (req.headers.authorization || '').match(/^Bearer (pt_[a-f0-9]{64})$/);
  if (!m) return res.status(401).json({ error: 'Not authenticated' });
  const hash = crypto.createHash('sha256').update(m[1]).digest('hex');

  const cached = extTokenCache.get(hash);
  if (cached && Date.now() - cached.checkedAt < EXT_TOKEN_TTL) {
    if (!cached.user) return res.status(401).json({ error: 'Invalid token' });
    req.user = cached.user;
    return next();
  }

  const { queryOne, execute } = require('../db/pool');
  queryOne(
    `SELECT u.id, u.role, u.name
       FROM extension_tokens t
       JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND u.is_active IS NOT FALSE`,
    [hash]
  ).then((u) => {
    const user = u ? { userId: u.id, role: u.role, name: u.name, viaExtension: true } : null;
    extTokenCache.set(hash, { user, checkedAt: Date.now() });
    if (!user) return res.status(401).json({ error: 'Invalid token' });
    req.user = user;
    execute('UPDATE extension_tokens SET last_used_at = NOW() WHERE token_hash = $1', [hash]).catch(() => {});
    next();
  }).catch(() => res.status(500).json({ error: 'Auth check failed' }));
}

// Call after revoking a token so it stops working immediately (not after TTL)
function clearExtensionTokenCache() {
  extTokenCache.clear();
}

// Middleware: require moderator, mini_admin, or admin role
function requireModerator(req, res, next) {
  const r = req.user?.role;
  if (r !== 'admin' && r !== 'mini_admin' && r !== 'moderator') {
    return res.status(403).json({ error: 'Moderator access required' });
  }
  next();
}

// Middleware: require mini_admin or admin role
function requireMiniAdmin(req, res, next) {
  const r = req.user?.role;
  if (r !== 'admin' && r !== 'mini_admin') {
    return res.status(403).json({ error: 'Mini-admin access required' });
  }
  next();
}

// Middleware: require admin role
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Verify JWT from cookie string (for WebSocket upgrade)
function verifyFromCookieHeader(cookieHeader) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  try {
    const p = jwt.verify(match[1], config.JWT_SECRET);
    if (Date.now() / 1000 - (p.oiat || p.iat) > SESSION_MAX_AGE_S) return null;
    return p;
  } catch {
    return null;
  }
}

module.exports = {
  COOKIE_NAME, signToken, setTokenCookie, clearTokenCookie,
  requireAuth, requireModerator, requireMiniAdmin, requireAdmin, verifyFromCookieHeader,
  invalidateUserCache, refreshUserCache, clearExtensionTokenCache
};
