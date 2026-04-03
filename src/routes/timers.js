const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { query, queryOne, execute } = require('../db/pool');

// GET /api/timers/boards
router.get('/boards', requireAuth, async (req, res) => {
  try {
    const rows = await query('SELECT board_id, started_at, is_paused FROM board_overdue_timers');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/timers/boards/sync
// Body: [{board_id, has_overdue}]
router.post('/boards/sync', requireAuth, async (req, res) => {
  try {
    const boards = req.body;
    if (!Array.isArray(boards) || boards.length === 0) return res.json([]);

    for (const { board_id, has_overdue } of boards) {
      if (!board_id) continue;
      const existing = await queryOne(
        'SELECT is_paused FROM board_overdue_timers WHERE board_id = $1',
        [board_id]
      );
      if (!existing) {
        await execute(
          'INSERT INTO board_overdue_timers (board_id, started_at, is_paused) VALUES ($1, NOW(), $2)',
          [board_id, has_overdue ? true : false]
        );
      } else if (has_overdue && !existing.is_paused) {
        await execute(
          'UPDATE board_overdue_timers SET is_paused = true WHERE board_id = $1',
          [board_id]
        );
      } else if (!has_overdue && existing.is_paused) {
        await execute(
          'UPDATE board_overdue_timers SET is_paused = false, started_at = NOW() WHERE board_id = $1',
          [board_id]
        );
      }
    }

    const rows = await query('SELECT board_id, started_at, is_paused FROM board_overdue_timers');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
