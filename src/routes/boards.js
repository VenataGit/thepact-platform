const express = require('express');
const router = express.Router();
const { query, queryOne, execute } = require('../db/pool');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// GET /api/boards — all boards with columns
router.get('/', requireAuth, async (req, res) => {
  try {
    const boards = await query('SELECT * FROM boards ORDER BY position');
    const columns = await query('SELECT * FROM columns ORDER BY board_id, position');

    const result = boards.map(b => ({
      ...b,
      columns: columns.filter(c => c.board_id === b.id)
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/boards — create board (admin)
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { title, color } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });
    const maxPos = await queryOne('SELECT COALESCE(MAX(position), -1) + 1 as pos FROM boards');
    const board = await queryOne(
      'INSERT INTO boards (title, color, position) VALUES ($1, $2, $3) RETURNING *',
      [title, color || null, maxPos.pos]
    );
    res.status(201).json(board);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/boards/:id — update board
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { title, color, position } = req.body;
    const board = await queryOne(
      'UPDATE boards SET title = COALESCE($1, title), color = COALESCE($2, color), position = COALESCE($3, position), updated_at = NOW() WHERE id = $4 RETURNING *',
      [title, color, position, req.params.id]
    );
    if (!board) return res.status(404).json({ error: 'Board not found' });
    res.json(board);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/boards/:id/columns — add column
router.post('/:id/columns', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { title, is_done_column } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });
    const maxPos = await queryOne(
      'SELECT COALESCE(MAX(position), -1) + 1 as pos FROM columns WHERE board_id = $1',
      [req.params.id]
    );
    const col = await queryOne(
      'INSERT INTO columns (board_id, title, position, is_done_column) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.params.id, title, maxPos.pos, is_done_column || false]
    );
    res.status(201).json(col);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/boards/:boardId/columns/:colId — update column
router.put('/:boardId/columns/:colId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { title, position, is_done_column, wip_limit } = req.body;
    const col = await queryOne(
      `UPDATE columns SET title = COALESCE($1, title), position = COALESCE($2, position),
       is_done_column = COALESCE($3, is_done_column), wip_limit = COALESCE($4, wip_limit), updated_at = NOW()
       WHERE id = $5 AND board_id = $6 RETURNING *`,
      [title, position, is_done_column, wip_limit, req.params.colId, req.params.boardId]
    );
    if (!col) return res.status(404).json({ error: 'Column not found' });
    res.json(col);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
