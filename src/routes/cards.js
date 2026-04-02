const express = require('express');
const router = express.Router();
const { query, queryOne, execute } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { broadcast } = require('../ws/broadcast');

// GET /api/cards — all active cards grouped by board/column
router.get('/', requireAuth, async (req, res) => {
  try {
    const { board_id, column_id, assignee_id, client } = req.query;

    let sql = `
      SELECT c.*, b.title as board_title, col.title as column_title,
        COALESCE(
          (SELECT json_agg(json_build_object('id', u.id, 'name', u.name))
           FROM card_assignees ca JOIN users u ON ca.user_id = u.id WHERE ca.card_id = c.id),
          '[]'::json
        ) as assignees
      FROM cards c
      JOIN boards b ON c.board_id = b.id
      JOIN columns col ON c.column_id = col.id
      WHERE c.archived_at IS NULL
    `;
    const params = [];
    let i = 1;

    if (board_id) { sql += ` AND c.board_id = $${i++}`; params.push(board_id); }
    if (column_id) { sql += ` AND c.column_id = $${i++}`; params.push(column_id); }
    if (client) { sql += ` AND c.client_name ILIKE $${i++}`; params.push(`%${client}%`); }
    if (assignee_id) {
      sql += ` AND c.id IN (SELECT card_id FROM card_assignees WHERE user_id = $${i++})`;
      params.push(assignee_id);
    }

    sql += ' ORDER BY b.position, col.position, c.position, c.created_at';
    const cards = await query(sql, params);
    res.json(cards);
  } catch (err) {
    console.error('Cards list error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/cards/:id — single card with steps, assignees, notes
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const card = await queryOne(`
      SELECT c.*, b.title as board_title, col.title as column_title
      FROM cards c JOIN boards b ON c.board_id = b.id JOIN columns col ON c.column_id = col.id
      WHERE c.id = $1
    `, [req.params.id]);
    if (!card) return res.status(404).json({ error: 'Card not found' });

    const [steps, assignees, notes] = await Promise.all([
      query('SELECT * FROM card_steps WHERE card_id = $1 ORDER BY position', [card.id]),
      query('SELECT u.id, u.name, u.avatar_url FROM card_assignees ca JOIN users u ON ca.user_id = u.id WHERE ca.card_id = $1', [card.id]),
      query('SELECT cn.*, u.name as author_name FROM card_notes cn LEFT JOIN users u ON cn.user_id = u.id WHERE cn.card_id = $1 ORDER BY cn.created_at DESC', [card.id])
    ]);

    res.json({ ...card, steps, assignees, notes });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/cards — create card
router.post('/', requireAuth, async (req, res) => {
  try {
    const { board_id, column_id, title, content, due_on, publish_date, priority, assignee_ids, client_name, kp_number, video_number, video_title, parent_id } = req.body;
    if (!board_id || !column_id || !title) return res.status(400).json({ error: 'board_id, column_id and title required' });

    const maxPos = await queryOne('SELECT COALESCE(MAX(position), -1) + 1 as pos FROM cards WHERE column_id = $1', [column_id]);

    const card = await queryOne(`
      INSERT INTO cards (board_id, column_id, title, content, due_on, publish_date, priority, creator_id, parent_id, client_name, kp_number, video_number, video_title, position)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `, [board_id, column_id, title, content || null, due_on || null, publish_date || null, priority || 'normal',
        req.user.userId, parent_id || null, client_name || null, kp_number || null, video_number || null, video_title || null, maxPos.pos]);

    // Assign users
    if (assignee_ids?.length > 0) {
      for (const uid of assignee_ids) {
        await execute('INSERT INTO card_assignees (card_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [card.id, uid]);
      }
    }

    // Log event
    await execute(
      'INSERT INTO card_events (card_id, event_type, to_board_id, to_column_id, user_id) VALUES ($1, $2, $3, $4, $5)',
      [card.id, 'created', board_id, column_id, req.user.userId]
    );

    // Activity log
    await execute(
      `INSERT INTO activity_log (user_id, user_name, action, target_type, target_id, target_title)
       VALUES ($1, $2, 'created', 'card', $3, $4)`,
      [req.user.userId, req.user.name, card.id, card.title]
    );

    // Notify assignees
    if (assignee_ids?.length > 0) {
      for (const uid of assignee_ids) {
        if (uid !== req.user.userId) {
          await execute(
            `INSERT INTO notifications (user_id, type, title, body, reference_type, reference_id)
             VALUES ($1, 'assigned', $2, $3, 'card', $4)`,
            [uid, `${req.user.name} те назначи на задача`, card.title, card.id]
          );
        }
      }
    }

    broadcast({ type: 'card:created', card }, req.user.userId);
    res.status(201).json(card);
  } catch (err) {
    console.error('Card create error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/cards/:id — update card fields
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { title, content, due_on, publish_date, priority, is_on_hold, assignee_ids, client_name, kp_number, video_number, video_title } = req.body;

    const card = await queryOne(`
      UPDATE cards SET
        title = COALESCE($1, title), content = COALESCE($2, content),
        due_on = COALESCE($3, due_on), publish_date = COALESCE($4, publish_date),
        priority = COALESCE($5, priority), is_on_hold = COALESCE($6, is_on_hold),
        client_name = COALESCE($7, client_name), kp_number = COALESCE($8, kp_number),
        video_number = COALESCE($9, video_number), video_title = COALESCE($10, video_title),
        updated_at = NOW()
      WHERE id = $11 AND archived_at IS NULL RETURNING *
    `, [title, content, due_on, publish_date, priority, is_on_hold, client_name, kp_number, video_number, video_title, req.params.id]);

    if (!card) return res.status(404).json({ error: 'Card not found' });

    // Update assignees if provided
    if (assignee_ids !== undefined) {
      await execute('DELETE FROM card_assignees WHERE card_id = $1', [card.id]);
      for (const uid of (assignee_ids || [])) {
        await execute('INSERT INTO card_assignees (card_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [card.id, uid]);
      }
    }

    broadcast({ type: 'card:updated', cardId: card.id, changes: req.body }, req.user.userId);
    res.json(card);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/cards/:id/move — move card between columns/boards
router.post('/:id/move', requireAuth, async (req, res) => {
  try {
    const { column_id, board_id, position } = req.body;
    if (!column_id) return res.status(400).json({ error: 'column_id required' });

    const card = await queryOne('SELECT * FROM cards WHERE id = $1 AND archived_at IS NULL', [req.params.id]);
    if (!card) return res.status(404).json({ error: 'Card not found' });

    // Verify target column exists and get board_id
    const targetCol = await queryOne('SELECT * FROM columns WHERE id = $1', [column_id]);
    if (!targetCol) return res.status(400).json({ error: 'Target column not found' });

    const targetBoardId = board_id || targetCol.board_id;
    const targetPosition = position ?? 0;

    // Check if moving to Done column
    const isCompleted = targetCol.is_done_column;

    const updated = await queryOne(`
      UPDATE cards SET board_id = $1, column_id = $2, position = $3,
        completed_at = $4, updated_at = NOW()
      WHERE id = $5 RETURNING *
    `, [targetBoardId, column_id, targetPosition, isCompleted ? new Date() : null, card.id]);

    // Log event
    await execute(
      'INSERT INTO card_events (card_id, event_type, from_board_id, from_column_id, to_board_id, to_column_id, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [card.id, 'moved', card.board_id, card.column_id, targetBoardId, column_id, req.user.userId]
    );

    broadcast({
      type: 'card:moved',
      cardId: card.id,
      fromBoardId: card.board_id,
      fromColumnId: card.column_id,
      toBoardId: targetBoardId,
      toColumnId: column_id,
      position: targetPosition,
      userId: req.user.userId,
      userName: req.user.name
    }, req.user.userId);

    res.json(updated);
  } catch (err) {
    console.error('Card move error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/cards/:id — archive card
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const card = await queryOne(
      'UPDATE cards SET archived_at = NOW() WHERE id = $1 AND archived_at IS NULL RETURNING *',
      [req.params.id]
    );
    if (!card) return res.status(404).json({ error: 'Card not found' });

    await execute(
      'INSERT INTO card_events (card_id, event_type, user_id) VALUES ($1, $2, $3)',
      [card.id, 'archived', req.user.userId]
    );

    broadcast({ type: 'card:deleted', cardId: card.id }, req.user.userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// === STEPS ===

// POST /api/cards/:id/steps
router.post('/:id/steps', requireAuth, async (req, res) => {
  try {
    const { title, due_on, assignee_id } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });
    const maxPos = await queryOne('SELECT COALESCE(MAX(position), -1) + 1 as pos FROM card_steps WHERE card_id = $1', [req.params.id]);
    const step = await queryOne(
      'INSERT INTO card_steps (card_id, title, due_on, assignee_id, position) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [req.params.id, title, due_on || null, assignee_id || null, maxPos.pos]
    );
    broadcast({ type: 'step:created', cardId: parseInt(req.params.id), step }, req.user.userId);
    res.status(201).json(step);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/cards/:cardId/steps/:stepId
router.put('/:cardId/steps/:stepId', requireAuth, async (req, res) => {
  try {
    const { completed, title, due_on, assignee_id, position } = req.body;
    const step = await queryOne(`
      UPDATE card_steps SET
        completed = COALESCE($1, completed),
        completed_at = CASE WHEN $1 = TRUE THEN NOW() ELSE NULL END,
        title = COALESCE($2, title),
        due_on = COALESCE($3, due_on),
        assignee_id = COALESCE($4, assignee_id),
        position = COALESCE($5, position)
      WHERE id = $6 AND card_id = $7 RETURNING *
    `, [completed, title, due_on, assignee_id, position, req.params.stepId, req.params.cardId]);
    if (!step) return res.status(404).json({ error: 'Step not found' });

    broadcast({ type: 'step:updated', cardId: parseInt(req.params.cardId), step }, req.user.userId);
    res.json(step);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/cards/:cardId/steps/:stepId
router.delete('/:cardId/steps/:stepId', requireAuth, async (req, res) => {
  try {
    await execute('DELETE FROM card_steps WHERE id = $1 AND card_id = $2', [req.params.stepId, req.params.cardId]);
    broadcast({ type: 'step:deleted', cardId: parseInt(req.params.cardId), stepId: parseInt(req.params.stepId) }, req.user.userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// === NOTES ===

// POST /api/cards/:id/notes
router.post('/:id/notes', requireAuth, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Content required' });
    const note = await queryOne(
      'INSERT INTO card_notes (card_id, user_id, content) VALUES ($1, $2, $3) RETURNING *',
      [req.params.id, req.user.userId, content.trim()]
    );
    res.status(201).json(note);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
