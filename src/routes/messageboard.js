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

// PUT /api/messageboard/:id/comments/:commentId — edit comment
router.put('/:id/comments/:commentId', requireAuth, async (req, res) => {
  try {
    const comment = await queryOne('SELECT * FROM message_comments WHERE id = $1 AND message_id = $2', [req.params.commentId, req.params.id]);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    if (comment.user_id !== req.user.userId && req.user.role !== 'admin' && req.user.role !== 'moderator') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Content required' });
    const updated = await queryOne(
      'UPDATE message_comments SET content = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [content.trim(), req.params.commentId]
    );
    res.json(updated);
  } catch (err) {
    console.error('[messageboard] PUT comment error:', err);
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

// POST /api/messageboard/daily-report — generate structured daily report
// Query: ?board_id=23 — post into specific message board
router.post('/daily-report', requireAuth, requireModerator, async (req, res) => {
  try {
    const boardId = req.query.board_id ? parseInt(req.query.board_id) : (req.body.board_id || null);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    const day3 = new Date(today);
    day3.setDate(day3.getDate() + 3);
    const day3Str = day3.toISOString().split('T')[0];

    // Fetch all active cards with deadlines, board, column, assignees
    const cards = await query(`
      SELECT c.id, c.title, c.board_id, c.column_id, c.priority,
        c.due_on, c.publish_date, c.brainstorm_date, c.filming_date, c.editing_date, c.upload_date,
        c.completed_at, c.is_on_hold,
        b.title as board_title, col.title as column_title,
        COALESCE(
          (SELECT string_agg(u.name, ', ')
           FROM card_assignees ca JOIN users u ON ca.user_id = u.id WHERE ca.card_id = c.id),
          ''
        ) as assignee_names
      FROM cards c
      JOIN boards b ON c.board_id = b.id
      JOIN columns col ON c.column_id = col.id
      WHERE c.archived_at IS NULL AND c.trashed_at IS NULL AND c.completed_at IS NULL
      ORDER BY c.due_on ASC NULLS LAST, c.title
    `);

    // Helper: get earliest relevant deadline for a card
    function getEarliest(c) {
      const dates = [c.brainstorm_date, c.filming_date, c.editing_date, c.upload_date, c.publish_date, c.due_on]
        .filter(Boolean)
        .map(d => new Date(d));
      if (dates.length === 0) return null;
      dates.sort((a, b) => a - b);
      // Return first non-passed date, or the latest passed one
      const future = dates.find(d => d >= today);
      return future || dates[dates.length - 1];
    }

    // Categorize cards
    const overdue = [];
    const dueToday = [];
    const dueTomorrow = [];
    const due2to3 = [];

    for (const c of cards) {
      if (c.is_on_hold) continue;
      const deadline = getEarliest(c);
      if (!deadline) continue;

      const deadlineStr = deadline.toISOString().split('T')[0];

      if (deadline < today) {
        const diffDays = Math.floor((today - deadline) / (1000 * 60 * 60 * 24));
        overdue.push({ ...c, deadline, diffDays });
      } else if (deadlineStr === todayStr) {
        dueToday.push({ ...c, deadline });
      } else if (deadlineStr === tomorrowStr) {
        dueTomorrow.push({ ...c, deadline });
      } else if (deadline <= day3) {
        due2to3.push({ ...c, deadline });
      }
    }

    // Sort overdue by most days first
    overdue.sort((a, b) => b.diffDays - a.diffDays);

    // Build HTML content with clickable links
    function cardLine(c, showDays) {
      const link = `<a href="#/card/${c.id}" style="color:#6fb3e0;text-decoration:none;font-weight:600">${escHtml(c.title)}</a>`;
      const days = showDays ? ` <em style="color:#e07070">(${c.diffDays} дни закъснение)</em>` : '';
      const location = ` · ${escHtml(c.board_title)} → ${escHtml(c.column_title)}`;
      const assignees = c.assignee_names ? ` · <span style="color:#a0c4e0">${escHtml(c.assignee_names)}</span>` : '';
      return `<div style="padding:4px 0">${link}${days}${location}${assignees}</div>`;
    }

    function escHtml(s) {
      return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    let html = '';

    if (overdue.length > 0) {
      html += `<h3 style="color:#e07070">⛔ Просрочени карти (${overdue.length})</h3>`;
      html += overdue.map(c => cardLine(c, true)).join('');
      html += '<br>';
    }

    if (dueToday.length > 0) {
      html += `<h3 style="color:#e0c040">🔴 Краен срок днес (${dueToday.length})</h3>`;
      html += dueToday.map(c => cardLine(c, false)).join('');
      html += '<br>';
    }

    if (dueTomorrow.length > 0) {
      html += `<h3 style="color:#e0c040">🟡 Краен срок утре (${dueTomorrow.length})</h3>`;
      html += dueTomorrow.map(c => cardLine(c, false)).join('');
      html += '<br>';
    }

    if (due2to3.length > 0) {
      html += `<h3 style="color:#e0a040">🟠 Краен срок след 2-3 дни (${due2to3.length})</h3>`;
      html += due2to3.map(c => cardLine(c, false)).join('');
    }

    if (!html) {
      html = '<div style="padding:20px;text-align:center;color:#888">Няма задачи с наближаващи крайни срокове.</div>';
    }

    // Format date in Bulgarian
    const dateOpts = { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' };
    const dateBg = today.toLocaleDateString('bg-BG', dateOpts);
    const title = `📊 Дневен отчет — ${dateBg}`;

    const msg = await queryOne(
      `INSERT INTO message_board (user_id, title, content, category, board_id)
       VALUES ($1, $2, $3, 'daily-report', $4) RETURNING *`,
      [req.user.userId, title, html, boardId]
    );

    res.status(201).json(msg);
  } catch (err) {
    console.error('[messageboard] daily-report error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
