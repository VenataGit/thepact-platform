const express = require('express');
const router = express.Router();
const { query, queryOne, execute } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

// GET /api/bookmarks — user's bookmarks
router.get('/', requireAuth, async (req, res) => {
  try {
    const bookmarks = await query(
      `SELECT * FROM bookmarks
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user.userId]
    );
    res.json(bookmarks);
  } catch (err) {
    console.error('Bookmarks list error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/bookmarks — create bookmark
router.post('/', requireAuth, async (req, res) => {
  try {
    const { target_type, target_id, title } = req.body;
    if (!target_type || !target_id) return res.status(400).json({ error: 'target_type and target_id required' });

    // Check for duplicate
    const existing = await queryOne(
      'SELECT id FROM bookmarks WHERE user_id = $1 AND target_type = $2 AND target_id = $3',
      [req.user.userId, target_type, target_id]
    );
    if (existing) return res.status(409).json({ error: 'Already bookmarked' });

    const bookmark = await queryOne(
      `INSERT INTO bookmarks (user_id, target_type, target_id, title)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.userId, target_type, target_id, title || null]
    );

    res.status(201).json(bookmark);
  } catch (err) {
    console.error('Bookmark create error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/bookmarks/:id — remove bookmark (only own)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const bookmark = await queryOne(
      'DELETE FROM bookmarks WHERE id = $1 AND user_id = $2 RETURNING *',
      [req.params.id, req.user.userId]
    );
    if (!bookmark) return res.status(404).json({ error: 'Bookmark not found' });

    res.json({ ok: true });
  } catch (err) {
    console.error('Bookmark delete error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
