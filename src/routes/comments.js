const express = require('express');
const router = express.Router();
const { query, queryOne, execute } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { broadcast } = require('../ws/broadcast');

// GET /api/cards/:cardId/comments
router.get('/:cardId/comments', requireAuth, async (req, res) => {
  try {
    const comments = await query(
      `SELECT c.*, u.name as user_name, u.avatar_url as user_avatar
       FROM card_comments c JOIN users u ON c.user_id = u.id
       WHERE c.card_id = $1 ORDER BY c.created_at ASC`,
      [req.params.cardId]
    );
    res.json(comments);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/cards/:cardId/comments
router.post('/:cardId/comments', requireAuth, async (req, res) => {
  try {
    const { content, mentions } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Content required' });

    const comment = await queryOne(
      `INSERT INTO card_comments (card_id, user_id, content, mentions)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.cardId, req.user.userId, content.trim(), JSON.stringify(mentions || [])]
    );

    // Get user info for broadcast
    const user = await queryOne('SELECT name, avatar_url FROM users WHERE id = $1', [req.user.userId]);
    comment.user_name = user.name;
    comment.user_avatar = user.avatar_url;

    // Create notifications for mentions
    if (mentions?.length > 0) {
      const card = await queryOne('SELECT title FROM cards WHERE id = $1', [req.params.cardId]);
      for (const userId of mentions) {
        if (userId !== req.user.userId) {
          await execute(
            `INSERT INTO notifications (user_id, type, title, body, reference_type, reference_id)
             VALUES ($1, 'mentioned', $2, $3, 'card', $4)`,
            [userId, `${user.name} те спомена в коментар`, card?.title || '', parseInt(req.params.cardId)]
          );
        }
      }
    }

    // Log activity
    const card = await queryOne('SELECT title, board_id FROM cards WHERE id = $1', [req.params.cardId]);
    await execute(
      `INSERT INTO activity_log (user_id, user_name, action, target_type, target_id, target_title)
       VALUES ($1, $2, 'commented', 'card', $3, $4)`,
      [req.user.userId, user.name, parseInt(req.params.cardId), card?.title]
    );

    broadcast({ type: 'comment:created', cardId: parseInt(req.params.cardId), comment }, req.user.userId);
    res.status(201).json(comment);
  } catch (err) {
    console.error('Comment create error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
