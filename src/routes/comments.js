const express = require('express');
const router = express.Router();
const { query, queryOne, execute } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { broadcast } = require('../ws/broadcast');
const { sendPushToUser } = require('../services/push');

// GET /api/cards/:cardId/comments
router.get('/:cardId/comments', requireAuth, async (req, res) => {
  try {
    const comments = await query(
      `SELECT c.*, u.name as user_name, u.avatar_url as user_avatar,
              p.content as parent_content, pu.name as parent_user_name
       FROM card_comments c
       JOIN users u ON c.user_id = u.id
       LEFT JOIN card_comments p ON c.reply_to_id = p.id
       LEFT JOIN users pu ON p.user_id = pu.id
       WHERE c.card_id = $1 ORDER BY c.created_at DESC`,
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
    const { content, mentions, reply_to_id } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Content required' });

    const comment = await queryOne(
      `INSERT INTO card_comments (card_id, user_id, content, mentions, reply_to_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.cardId, req.user.userId, content.trim(), JSON.stringify(mentions || []), reply_to_id || null]
    );

    // Get user info for broadcast
    const user = await queryOne('SELECT name, avatar_url FROM users WHERE id = $1', [req.user.userId]);
    comment.user_name = user.name;
    comment.user_avatar = user.avatar_url;

    const card = await queryOne('SELECT title FROM cards WHERE id = $1', [req.params.cardId]);

    // Notify the author of the parent comment (reply notification)
    if (reply_to_id) {
      const parentComment = await queryOne('SELECT user_id FROM card_comments WHERE id = $1', [reply_to_id]);
      if (parentComment && parentComment.user_id !== req.user.userId) {
        await execute(
          `INSERT INTO notifications (user_id, type, title, body, reference_type, reference_id, sender_name, comment_id)
           VALUES ($1, 'reply', $2, $3, 'card', $4, $5, $6)`,
          [parentComment.user_id, `${user.name} отговори на твой коментар`, card?.title || '', parseInt(req.params.cardId), user.name, comment.id]
        );
        sendPushToUser(parentComment.user_id, {
          title: 'Отговор на коментар',
          body: `${user.name} отговори на твой коментар в: ${card?.title || 'карта'}`,
          tag: `reply-${comment.id}`,
          url: `/#/card/${req.params.cardId}`,
        });
      }
    }

    // Notify mentioned users
    if (mentions?.length > 0) {
      for (const userId of mentions) {
        if (userId !== req.user.userId) {
          await execute(
            `INSERT INTO notifications (user_id, type, title, body, reference_type, reference_id, sender_name, comment_id)
             VALUES ($1, 'mentioned', $2, $3, 'card', $4, $5, $6)`,
            [userId, `${user.name} те спомена в коментар`, card?.title || '', parseInt(req.params.cardId), user.name, comment.id]
          );
          sendPushToUser(userId, {
            title: 'Споменат/а си',
            body: `${user.name} те спомена в: ${card?.title || 'карта'}`,
            tag: `mention-${comment.id}`,
            url: `/#/card/${req.params.cardId}`,
          });
        }
      }
    }

    // Log activity
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

// PUT /api/cards/:cardId/comments/:commentId — edit comment
router.put('/:cardId/comments/:commentId', requireAuth, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Content required' });

    const comment = await queryOne(
      'SELECT * FROM card_comments WHERE id = $1 AND card_id = $2',
      [req.params.commentId, req.params.cardId]
    );
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    const isAuthor = comment.user_id === req.user.userId;
    const isModerator = req.user.role === 'admin' || req.user.role === 'moderator';
    if (!isAuthor && !isModerator) {
      return res.status(403).json({ error: 'Not allowed to edit this comment' });
    }

    if (isAuthor && !isModerator) {
      const setting = await queryOne("SELECT value FROM settings WHERE key = 'comment_edit_window_minutes'");
      const windowMinutes = setting ? parseInt(setting.value, 10) : 10;
      const elapsed = (Date.now() - new Date(comment.created_at).getTime()) / 60000;
      if (elapsed > windowMinutes) {
        return res.status(403).json({ error: `Edit window expired (${windowMinutes} minutes)` });
      }
    }

    const updated = await queryOne(
      `UPDATE card_comments SET content = $1, updated_at = NOW()
       WHERE id = $2 AND card_id = $3 RETURNING *`,
      [content.trim(), req.params.commentId, req.params.cardId]
    );

    const user = await queryOne('SELECT name, avatar_url FROM users WHERE id = $1', [updated.user_id]);
    updated.user_name = user.name;
    updated.user_avatar = user.avatar_url;

    broadcast({ type: 'comment:updated', cardId: parseInt(req.params.cardId), comment: updated });
    res.json(updated);
  } catch (err) {
    console.error('Comment edit error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/cards/:cardId/comments/:commentId
router.delete('/:cardId/comments/:commentId', requireAuth, async (req, res) => {
  try {
    const comment = await queryOne(
      'SELECT * FROM card_comments WHERE id = $1 AND card_id = $2',
      [req.params.commentId, req.params.cardId]
    );
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    const isAuthor = comment.user_id === req.user.userId;
    const isModerator = req.user.role === 'admin' || req.user.role === 'moderator';
    if (!isAuthor && !isModerator) {
      return res.status(403).json({ error: 'Not allowed to delete this comment' });
    }

    if (isAuthor && !isModerator) {
      const setting = await queryOne("SELECT value FROM settings WHERE key = 'comment_edit_window_minutes'");
      const windowMinutes = setting ? parseInt(setting.value, 10) : 10;
      const elapsed = (Date.now() - new Date(comment.created_at).getTime()) / 60000;
      if (elapsed > windowMinutes) {
        return res.status(403).json({ error: `Delete window expired (${windowMinutes} minutes)` });
      }
    }

    await execute(
      'UPDATE cards SET pinned_comment_id = NULL WHERE id = $1 AND pinned_comment_id = $2',
      [req.params.cardId, req.params.commentId]
    );

    await execute(
      'DELETE FROM card_comments WHERE id = $1 AND card_id = $2',
      [req.params.commentId, req.params.cardId]
    );

    broadcast({ type: 'comment:deleted', cardId: parseInt(req.params.cardId), commentId: parseInt(req.params.commentId) });
    res.json({ ok: true });
  } catch (err) {
    console.error('Comment delete error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
