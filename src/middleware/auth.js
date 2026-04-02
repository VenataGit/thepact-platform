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

    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
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
  requireAuth, requireModerator, requireAdmin, verifyFromCookieHeader
};
