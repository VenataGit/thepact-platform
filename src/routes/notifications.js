const express = require('express');
const router = express.Router();
const { query, queryOne, execute } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

// GET /api/notifications — user's notifications
router.get('/', requireAuth, async (req, res) => {
  try {
    const items = await query(
      `SELECT * FROM notifications WHERE user_id = $1 ORDER BY is_read ASC, created_at DESC LIMIT 50`,
      [req.user.userId]
    );
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/notifications/unread-count
router.get('/unread-count', requireAuth, async (req, res) => {
  try {
    const result = await queryOne(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND is_read = FALSE',
      [req.user.userId]
    );
    res.json({ count: parseInt(result.count) });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/notifications/:id/read
router.put('/:id/read', requireAuth, async (req, res) => {
  try {
    await execute(
      'UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/notifications/:id/bookmark — toggle bookmark
router.put('/:id/bookmark', requireAuth, async (req, res) => {
  try {
    const n = await queryOne(
      'SELECT is_bookmarked FROM notifications WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.userId]
    );
    if (!n) return res.status(404).json({ error: 'Not found' });
    const newVal = !n.is_bookmarked;
    await execute(
      'UPDATE notifications SET is_bookmarked = $1, is_read = TRUE WHERE id = $2 AND user_id = $3',
      [newVal, req.params.id, req.user.userId]
    );
    res.json({ ok: true, is_bookmarked: newVal });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/notifications/reminder — create a "don't forget" reminder for a card
router.post('/reminder', requireAuth, async (req, res) => {
  try {
    const { card_id, title } = req.body;
    if (!card_id) return res.status(400).json({ error: 'card_id required' });
    // Check if reminder already exists
    const existing = await queryOne(
      `SELECT id FROM notifications WHERE user_id = $1 AND reference_type = 'card' AND reference_id = $2 AND type = 'reminder' AND is_bookmarked = TRUE`,
      [req.user.userId, card_id]
    );
    if (existing) {
      // Remove it (toggle off)
      await execute('DELETE FROM notifications WHERE id = $1', [existing.id]);
      return res.json({ ok: true, removed: true });
    }
    // Create bookmarked notification
    const n = await queryOne(
      `INSERT INTO notifications (user_id, type, title, reference_type, reference_id, is_read, is_bookmarked, sender_name)
       VALUES ($1, 'reminder', $2, 'card', $3, TRUE, TRUE, $4) RETURNING *`,
      [req.user.userId, title || 'Напомняне', card_id, req.user.name || '']
    );
    res.status(201).json(n);
  } catch (err) {
    console.error('Reminder create error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/notifications/reminders — check which cards have reminders
router.get('/reminders', requireAuth, async (req, res) => {
  try {
    const items = await query(
      `SELECT reference_id as card_id FROM notifications WHERE user_id = $1 AND type = 'reminder' AND is_bookmarked = TRUE AND reference_type = 'card'`,
      [req.user.userId]
    );
    res.json(items.map(i => i.card_id));
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/notifications/read-all
router.put('/read-all', requireAuth, async (req, res) => {
  try {
    await execute(
      'UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE',
      [req.user.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
