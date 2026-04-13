const express = require('express');
const router = express.Router();
const { query, queryOne, execute } = require('../db/pool');
const { requireAuth, requireModerator } = require('../middleware/auth');
const { broadcast } = require('../ws/broadcast');

// GET /api/messageboard — global messages (legacy) or scoped to board
router.get('/', requireAuth, async (req, res) => {
  try {
    const boardId = req.query.board_id ? parseInt(req.query.board_id) : null;
    const category = req.query.category;
    let sql = `SELECT mb.*, u.name as user_name, u.avatar_url as user_avatar,
               (SELECT COUNT(*) FROM message_comments mc WHERE mc.message_id = mb.id) as comment_count
               FROM message_board mb LEFT JOIN users u ON mb.user_id = u.id`;
    const params = [];
    const conditions = [];
    if (boardId) {
      params.push(boardId);
      conditions.push('mb.board_id = $' + params.length);
    }
    if (category) {
      params.push(category);
      conditions.push('mb.category = $' + params.length);
    }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY mb.pinned DESC, mb.created_at DESC LIMIT 100';
    const messages = await query(sql, params);
    res.json(messages);
  } catch (err) {
    console.error('[messageboard] GET error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/messageboard/:id — single message with comments
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const msg = await queryOne(
      `SELECT mb.*, u.name as user_name, u.avatar_url as user_avatar
       FROM message_board mb LEFT JOIN users u ON mb.user_id = u.id
       WHERE mb.id = $1`, [req.params.id]
    );
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    const comments = await query(
      `SELECT mc.*, u.name as user_name, u.avatar_url as user_avatar
       FROM message_comments mc LEFT JOIN users u ON mc.user_id = u.id
       WHERE mc.message_id = $1 ORDER BY mc.created_at ASC`, [req.params.id]
    );
    msg.comments = comments;
    res.json(msg);
  } catch (err) {
    console.error('[messageboard] GET/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/messageboard — create message
router.post('/', requireAuth, async (req, res) => {
  try {
    const { title, content, category, pinned, board_id } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
    const msg = await queryOne(
      `INSERT INTO message_board (user_id, title, content, category, pinned, board_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.userId, title.trim(), content || null, category || 'general', pinned || false, board_id || null]
    );
    // Attach user name for broadcast
    msg.user_name = req.user.name || 'Unknown';
    broadcast({ type: 'message:created', message: msg }, req.user.userId);
    res.status(201).json(msg);
  } catch (err) {
    console.error('[messageboard] POST error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/messageboard/:id — update message
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const msg = await queryOne('SELECT * FROM message_board WHERE id = $1', [req.params.id]);
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    // Only author or moderator can edit
    if (msg.user_id !== req.user.userId && req.user.role !== 'admin' && req.user.role !== 'moderator') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { title, content, category, pinned } = req.body;
    const updated = await queryOne(
      `UPDATE message_board SET title = COALESCE($1, title), content = COALESCE($2, content),
       category = COALESCE($3, category), pinned = COALESCE($4, pinned), updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [title, content, category, pinned, req.params.id]
    );
    broadcast({ type: 'message:updated', message: updated }, req.user.userId);
    res.json(updated);
  } catch (err) {
    console.error('[messageboard] PUT error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/messageboard/:id — delete message
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const msg = await queryOne('SELECT * FROM message_board WHERE id = $1', [req.params.id]);
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (msg.user_id !== req.user.userId && req.user.role !== 'admin' && req.user.role !== 'moderator') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await execute('DELETE FROM message_board WHERE id = $1', [req.params.id]);
    broadcast({ type: 'message:deleted', messageId: parseInt(req.params.id), boardId: msg.board_id }, req.user.userId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[messageboard] DELETE error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/messageboard/:id/comments — add comment to message
router.post('/:id/comments', requireAuth, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Content required' });
    const msg = await queryOne('SELECT id, board_id FROM message_board WHERE id = $1', [req.params.id]);
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    const comment = await queryOne(
      `INSERT INTO message_comments (message_id, user_id, content) VALUES ($1, $2, $3) RETURNING *`,
      [req.params.id, req.user.userId, content.trim()]
    );
    comment.user_name = req.user.name || 'Unknown';
    broadcast({ type: 'message:comment:created', comment, messageId: parseInt(req.params.id) }, req.user.userId);
    res.status(201).json(comment);
  } catch (err) {
    console.error('[messageboard] POST comment error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/messageboard/:id/comments/:commentId — delete comment
router.delete('/:id/comments/:commentId', requireAuth, async (req, res) => {
  try {
    const comment = await queryOne('SELECT * FROM message_comments WHERE id = $1 AND message_id = $2', [req.params.commentId, req.params.id]);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    if (comment.user_id !== req.user.userId && req.user.role !== 'admin' && req.user.role !== 'moderator') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await execute('DELETE FROM message_comments WHERE id = $1', [req.params.commentId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[messageboard] DELETE comment error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/messageboard/daily-report — auto-generate daily report
router.post('/daily-report', requireAuth, requireModerator, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const [movedCards, createdCards, completedCards] = await Promise.all([
      query(`SELECT COUNT(*) as count FROM card_events WHERE event_type = 'moved' AND created_at::date = $1`, [today]),
      query(`SELECT COUNT(*) as count FROM cards WHERE created_at::date = $1 AND archived_at IS NULL`, [today]),
      query(`SELECT COUNT(*) as count FROM cards WHERE completed_at::date = $1`, [today])
    ]);
    const overdueCards = await query(
      `SELECT COUNT(*) as count FROM cards WHERE due_on < $1 AND archived_at IS NULL AND completed_at IS NULL AND is_on_hold = FALSE`, [today]
    );
    const content = `📊 Дневен отчет — ${today}\n\n` +
      `✅ Завършени карти: ${completedCards[0]?.count || 0}\n` +
      `📝 Нови карти: ${createdCards[0]?.count || 0}\n` +
      `🔄 Преместени карти: ${movedCards[0]?.count || 0}\n` +
      `⚠️ Просрочени: ${overdueCards[0]?.count || 0}`;
    const msg = await queryOne(
      `INSERT INTO message_board (user_id, title, content, category) VALUES ($1, $2, $3, 'daily-report') RETURNING *`,
      [req.user.userId, `Дневен отчет — ${today}`, content]
    );
    res.status(201).json(msg);
  } catch (err) {
    console.error('[messageboard] daily-report error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
