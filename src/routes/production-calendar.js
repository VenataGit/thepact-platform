const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

// GET /api/production-calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/', requireAuth, async (req, res) => {
  try {
    const from = req.query.from || '2020-01-01';
    const to   = req.query.to   || '2030-12-31';
    const entries = await query(`
      SELECT pc.*,
             c.title  AS card_title,
             c.board_id,
             c.brainstorm_date,
             c.filming_date,
             c.editing_date,
             c.upload_date,
             b.title  AS board_title,
             b.color  AS board_color,
             col.title AS column_title
      FROM production_calendar pc
      JOIN cards   c   ON pc.card_id   = c.id
      JOIN columns col ON c.column_id  = col.id
      JOIN boards  b   ON c.board_id   = b.id
      WHERE pc.scheduled_date >= $1
        AND pc.scheduled_date <= $2
      ORDER BY pc.scheduled_date, pc.start_minute
    `, [from, to]);
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/production-calendar
router.post('/', requireAuth, async (req, res) => {
  try {
    const { card_id, scheduled_date, start_minute, duration_minutes } = req.body;
    if (!card_id || !scheduled_date) return res.status(400).json({ error: 'card_id and scheduled_date required' });
    const entry = await queryOne(`
      INSERT INTO production_calendar (card_id, scheduled_date, start_minute, duration_minutes, created_by)
      VALUES ($1, $2, $3, $4, $5) RETURNING *
    `, [card_id, scheduled_date, start_minute ?? 540, duration_minutes ?? 60, req.user.userId]);
    // Enrich with card/board info
    const info = await queryOne(`
      SELECT c.title AS card_title, c.board_id,
             c.brainstorm_date, c.filming_date, c.editing_date, c.upload_date,
             b.title AS board_title, b.color AS board_color, col.title AS column_title
      FROM cards c
      JOIN columns col ON c.column_id = col.id
      JOIN boards  b   ON c.board_id  = b.id
      WHERE c.id = $1
    `, [card_id]);
    res.status(201).json({ ...entry, ...info });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/production-calendar/:id
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { scheduled_date, start_minute, duration_minutes } = req.body;
    const entry = await queryOne(`
      UPDATE production_calendar
         SET scheduled_date   = COALESCE($1, scheduled_date),
             start_minute     = COALESCE($2, start_minute),
             duration_minutes = COALESCE($3, duration_minutes),
             updated_at       = NOW()
       WHERE id = $4
       RETURNING *
    `, [scheduled_date, start_minute, duration_minutes, req.params.id]);
    if (!entry) return res.status(404).json({ error: 'Not found' });
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/production-calendar/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const entry = await queryOne('DELETE FROM production_calendar WHERE id = $1 RETURNING id', [req.params.id]);
    if (!entry) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
