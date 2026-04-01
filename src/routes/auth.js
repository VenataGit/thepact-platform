const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const { queryOne } = require('../db/pool');
const { signToken, setTokenCookie, clearTokenCookie, requireAuth } = require('../middleware/auth');
const config = require('../config');

// POST /auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = await queryOne('SELECT * FROM users WHERE email = $1 AND is_active = TRUE', [email.toLowerCase().trim()]);
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid email or password' });

    // Update last login
    await queryOne('UPDATE users SET last_login_at = NOW() WHERE id = $1 RETURNING id', [user.id]);

    const token = signToken(user);
    setTokenCookie(res, token);

    res.json({ ok: true, user: { id: user.id, name: user.name, email: user.email, role: user.role, avatar_url: user.avatar_url } });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /auth/logout
router.post('/logout', (req, res) => {
  clearTokenCookie(res);
  res.json({ ok: true });
});

// GET /auth/status
router.get('/status', requireAuth, async (req, res) => {
  const user = await queryOne('SELECT id, name, email, role, avatar_url FROM users WHERE id = $1', [req.user.userId]);
  res.json({ authenticated: true, user });
});

// POST /auth/change-password
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const user = await queryOne('SELECT password_hash FROM users WHERE id = $1', [req.user.userId]);
    const match = await bcrypt.compare(currentPassword, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect' });

    const hash = await bcrypt.hash(newPassword, config.BCRYPT_ROUNDS);
    await queryOne('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2 RETURNING id', [hash, req.user.userId]);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
