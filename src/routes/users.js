const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { query, queryOne, execute } = require('../db/pool');
const { requireAuth, requireAdmin, requireMiniAdmin, invalidateUserCache } = require('../middleware/auth');
const { disconnectUser } = require('../ws/broadcast');
const config = require('../config');

// GET /api/users — list all users (admin or mini_admin)
router.get('/', requireAuth, requireMiniAdmin, async (req, res) => {
  try {
    const users = await query(
      'SELECT id, email, name, avatar_url, role, is_active, last_login_at, created_at FROM users ORDER BY name'
    );
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users/team — list all active users (any authenticated user)
router.get('/team', requireAuth, async (req, res) => {
  try {
    const users = await query(
      'SELECT id, name, avatar_url, role FROM users WHERE is_active = TRUE ORDER BY name'
    );
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/users — create user (admin or mini_admin)
router.post('/', requireAuth, requireMiniAdmin, async (req, res) => {
  try {
    const { email, password, name, role } = req.body;
    if (!email || !password || !name) return res.status(400).json({ error: 'email, password, name required' });
    const validRoles = ['admin', 'mini_admin', 'moderator', 'member'];
    const userRole = validRoles.includes(role) ? role : 'member';

    const existing = await queryOne('SELECT id FROM users WHERE email = $1', [email]);
    if (existing) return res.status(409).json({ error: 'Email already exists' });

    const hash = await bcrypt.hash(password, config.BCRYPT_ROUNDS);
    const user = await queryOne(
      'INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role, created_at',
      [email, hash, name, userRole]
    );
    res.status(201).json(user);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/users/:id/role — change user role (admin or mini_admin)
// mini_admin can only assign up to moderator, not admin or mini_admin
router.put('/:id/role', requireAuth, requireMiniAdmin, async (req, res) => {
  try {
    const { role } = req.body;
    const validRoles = ['admin', 'mini_admin', 'moderator', 'member'];
    if (!validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });

    // mini_admin cannot promote to admin or mini_admin
    if (req.user.role !== 'admin' && (role === 'admin' || role === 'mini_admin')) {
      return res.status(403).json({ error: 'Само админ може да дава тази роля' });
    }

    // mini_admin cannot change role of another admin or mini_admin
    if (req.user.role !== 'admin') {
      const target = await queryOne('SELECT role FROM users WHERE id = $1', [req.params.id]);
      if (target && (target.role === 'admin' || target.role === 'mini_admin')) {
        return res.status(403).json({ error: 'Не можеш да променяш ролята на този потребител' });
      }
    }

    const user = await queryOne(
      'UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 RETURNING id, email, name, role',
      [role, req.params.id]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/users/:id/active — toggle user active status (admin or mini_admin)
router.put('/:id/active', requireAuth, requireMiniAdmin, async (req, res) => {
  try {
    const { is_active } = req.body;
    const userId = parseInt(req.params.id);

    // mini_admin cannot deactivate admin or mini_admin
    if (req.user.role !== 'admin') {
      const target = await queryOne('SELECT role FROM users WHERE id = $1', [userId]);
      if (target && (target.role === 'admin' || target.role === 'mini_admin')) {
        return res.status(403).json({ error: 'Не можеш да променяш статуса на този потребител' });
      }
    }

    const user = await queryOne(
      'UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING id, email, name, role, is_active',
      [is_active, userId]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });

    // If deactivating: kick them out immediately
    if (!is_active) {
      invalidateUserCache(userId);
      disconnectUser(userId);
      // Remove their push subscriptions
      await execute('DELETE FROM push_subscriptions WHERE user_id = $1', [userId]);
    }

    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
