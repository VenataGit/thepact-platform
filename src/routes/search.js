const express = require('express');
const router = express.Router();
const { query } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

// GET /api/search?q=term
router.get('/', requireAuth, async (req, res) => {
  try {
    const q = req.query.q?.trim();
    if (!q || q.length < 2) return res.json({ cards: [], users: [] });

    const pattern = `%${q}%`;

    const [cards, users] = await Promise.all([
      query(
        `SELECT c.id, c.title, c.client_name, c.kp_number, c.video_number,
                b.title as board_title, col.title as column_title
         FROM cards c
         JOIN boards b ON c.board_id = b.id
         JOIN columns col ON c.column_id = col.id
         WHERE c.archived_at IS NULL
         AND (c.title ILIKE $1 OR c.client_name ILIKE $1 OR c.video_title ILIKE $1 OR c.content ILIKE $1)
         ORDER BY c.updated_at DESC LIMIT 20`,
        [pattern]
      ),
      query(
        `SELECT id, name, email, avatar_url, role FROM users
         WHERE is_active = TRUE AND (name ILIKE $1 OR email ILIKE $1) LIMIT 10`,
        [pattern]
      )
    ]);

    res.json({ cards, users });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
