const express = require('express');
const router = express.Router();
const { query } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

// GET /api/activity — recent activity feed
router.get('/', requireAuth, async (req, res) => {
  try {
    // Cap user-supplied limit/offset to prevent DoS via huge queries
    const rawLimit = parseInt(req.query.limit, 10);
    const limit = Math.min(Math.max(rawLimit > 0 ? rawLimit : 50, 1), 200);
    const rawOffset = parseInt(req.query.offset, 10);
    const offset = Math.min(Math.max(rawOffset >= 0 ? rawOffset : 0, 0), 10000);

    const items = await query(
      `SELECT a.*, u.avatar_url as user_avatar
       FROM activity_log a LEFT JOIN users u ON a.user_id = u.id
       ORDER BY a.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json(items);
  } catch (err) {
    console.error('[activity] list error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
