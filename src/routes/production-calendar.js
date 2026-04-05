const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { createGCalEvent, updateGCalEvent, deleteGCalEvent } = require('../services/google-calendar');

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

    // Sync to Google Calendar (async, non-blocking)
    syncProdToGCal('create', { ...entry, ...info }).catch(err =>
      console.error('[GCal] Background sync error:', err.message)
    );

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

    // Get card title for GCal
    const info = await queryOne(`
      SELECT c.title AS card_title, b.title AS board_title
      FROM cards c
      JOIN boards b ON c.board_id = b.id
      WHERE c.id = $1
    `, [entry.card_id]);

    // Sync to Google Calendar (async, non-blocking)
    syncProdToGCal('update', { ...entry, ...info }).catch(err =>
      console.error('[GCal] Background sync error:', err.message)
    );

    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/production-calendar/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const entry = await queryOne('DELETE FROM production_calendar WHERE id = $1 RETURNING *', [req.params.id]);
    if (!entry) return res.status(404).json({ error: 'Not found' });

    // Delete from Google Calendar
    if (entry.google_calendar_event_id) {
      deleteGCalEvent(entry.google_calendar_event_id).catch(err =>
        console.error('[GCal] Background delete error:', err.message)
      );
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Sync production calendar entry to Google Calendar
 * Converts start_minute + duration_minutes to proper datetime
 */
async function syncProdToGCal(action, entry) {
  try {
    const title = entry.card_title || `Card #${entry.card_id}`;
    const date = entry.scheduled_date;
    // Convert to YYYY-MM-DD string if it's a Date object
    const dateStr = typeof date === 'string' ? date.split('T')[0] : new Date(date).toISOString().split('T')[0];

    const startH = Math.floor(entry.start_minute / 60);
    const startM = entry.start_minute % 60;
    const endMinute = entry.start_minute + (entry.duration_minutes || 60);
    const endH = Math.floor(endMinute / 60);
    const endM = endMinute % 60;

    // Build event object compatible with google-calendar service
    const event = {
      title: `🎬 ${title}`,
      description: entry.board_title ? `Board: ${entry.board_title}` : '',
      starts_at: `${dateStr}T${String(startH).padStart(2,'0')}:${String(startM).padStart(2,'0')}:00`,
      ends_at: `${dateStr}T${String(endH).padStart(2,'0')}:${String(endM).padStart(2,'0')}:00`,
      all_day: false,
    };

    if (action === 'create') {
      const gcalEventId = await createGCalEvent(event);
      if (gcalEventId) {
        await queryOne(
          'UPDATE production_calendar SET google_calendar_event_id = $1 WHERE id = $2 RETURNING id',
          [gcalEventId, entry.id]
        );
        console.log(`[GCal] Prod entry ${entry.id} → GCal ${gcalEventId}`);
      }
    } else if (action === 'update') {
      if (entry.google_calendar_event_id) {
        await updateGCalEvent(entry.google_calendar_event_id, event);
      } else {
        // Entry created before GCal was enabled — create now
        const gcalEventId = await createGCalEvent(event);
        if (gcalEventId) {
          await queryOne(
            'UPDATE production_calendar SET google_calendar_event_id = $1 WHERE id = $2 RETURNING id',
            [gcalEventId, entry.id]
          );
          console.log(`[GCal] Prod entry ${entry.id} → GCal ${gcalEventId} (first sync)`);
        }
      }
    }
  } catch (err) {
    console.error('[GCal] Prod sync error:', err.message);
  }
}

module.exports = router;
