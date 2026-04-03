const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { query, queryOne, execute } = require('../db/pool');

// GET /api/timers/columns — return all column timer states
router.get('/columns', requireAuth, async (req, res) => {
  try {
    const rows = await query('SELECT column_id, started_at, is_paused FROM column_overdue_timers');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/timers/columns/sync — update timers based on current overdue state
// Body: [{column_id, has_overdue}]
router.post('/columns/sync', requireAuth, async (req, res) => {
  try {
    const cols = req.body;
    if (!Array.isArray(cols) || cols.length === 0) return res.json([]);

    for (const { column_id, has_overdue } of cols) {
      if (!column_id) continue;
      const existing = await queryOne(
        'SELECT is_paused FROM column_overdue_timers WHERE column_id = $1',
        [column_id]
      );
      if (!existing) {
        // First time we see this column — create record
        await execute(
          'INSERT INTO column_overdue_timers (column_id, started_at, is_paused) VALUES ($1, NOW(), $2)',
          [column_id, has_overdue ? true : false]
        );
      } else if (has_overdue && !existing.is_paused) {
        // Column went overdue — pause the timer
        await execute(
          'UPDATE column_overdue_timers SET is_paused = true WHERE column_id = $1',
          [column_id]
        );
      } else if (!has_overdue && existing.is_paused) {
        // Column became clean — reset timer to now
        await execute(
          'UPDATE column_overdue_timers SET is_paused = false, started_at = NOW() WHERE column_id = $1',
          [column_id]
        );
      }
    }

    const rows = await query('SELECT column_id, started_at, is_paused FROM column_overdue_timers');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
