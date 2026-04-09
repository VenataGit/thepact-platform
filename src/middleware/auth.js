const jwt = require('jsonwebtoken');
const config = require('../config');

const COOKIE_NAME = '__pact_jwt';
const COOKIE_OPTS = {
  httpOnly: true,
  secure: config.IS_PRODUCTION,
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: '/'
};

function signToken(user) {
  return jwt.sign(
    { userId: user.id, role: user.role, name: user.name },
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
// Also checks is_active in DB (cached for 60s to avoid hitting DB on every request)
const activeUserCache = new Map(); // userId -> { active: bool, checkedAt: ms }
const ACTIVE_CHECK_TTL = 60_000;   // re-check every 60 seconds

function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const payload = jwt.verify(token, config.JWT_SECRET);
    req.user = payload;

    // Sliding expiration: refresh if < 24h remaining
    const timeLeft = payload.exp - Date.now() / 1000;
    if (timeLeft < 86400) {
      const newToken = signToken({ id: payload.userId, role: payload.role, name: payload.name });
      setTokenCookie(res, newToken);
    }

    // Check if user is still active (cached, non-blocking for speed)
    const cached = activeUserCache.get(payload.userId);
    if (cached && Date.now() - cached.checkedAt < ACTIVE_CHECK_TTL) {
      if (!cached.active) {
        clearTokenCookie(res);
        return res.status(401).json({ error: 'Account deactivated' });
      }
      return next();
    }

    // Async DB check — don't block the request, but update cache
    const { queryOne: qo } = require('../db/pool');
    qo('SELECT is_active FROM users WHERE id = $1', [payload.userId])
      .then(user => {
        const isActive = user?.is_active !== false;
        activeUserCache.set(payload.userId, { active: isActive, checkedAt: Date.now() });
        if (!isActive) {
          // Force disconnect on next request (this one already passed)
          // Also clear their push subscriptions
          const { execute: exec } = require('../db/pool');
          exec('DELETE FROM push_subscriptions WHERE user_id = $1', [payload.userId]).catch(() => {});
        }
      })
      .catch(() => {}); // silent fail — don't break requests if DB hiccups

    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Call this when deactivating a user to immediately invalidate their cache
function invalidateUserCache(userId) {
  activeUserCache.set(userId, { active: false, checkedAt: Date.now() });
}

// Middleware: require moderator or admin role
function requireModerator(req, res, next) {
  if (req.user?.role !== 'admin' && req.user?.role !== 'moderator') {
    return res.status(403).json({ error: 'Moderator access required' });
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
    return jwt.verify(match[1], config.JWT_SECRET);
  } catch {
    return null;
  }
}

module.exports = {
  COOKIE_NAME, signToken, setTokenCookie, clearTokenCookie,
  requireAuth, requireModerator, requireAdmin, verifyFromCookieHeader,
  invalidateUserCache
};
