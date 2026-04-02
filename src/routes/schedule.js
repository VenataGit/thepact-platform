const express = require('express');
const router = express.Router();
const { query, queryOne, execute } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { broadcast } = require('../ws/broadcast');

// GET /api/schedule?month=YYYY-MM&user_id= — events for a month with attendees
router.get('/', requireAuth, async (req, res) => {
  try {
    const { month, user_id } = req.query;
    if (!month) return res.status(400).json({ error: 'month parameter required (YYYY-MM)' });

    const startDate = `${month}-01`;
    const endDate = `${month}-01::date + interval '1 month'`;

    let sql = `
      SELECT e.*,
        u.name as creator_name,
        COALESCE(
          (SELECT json_agg(json_build_object('id', au.id, 'name', au.name, 'avatar_url', au.avatar_url))
           FROM schedule_event_attendees sa JOIN users au ON sa.user_id = au.id WHERE sa.event_id = e.id),
          '[]'::json
        ) as attendees
      FROM schedule_events e
      LEFT JOIN users u ON e.creator_id = u.id
      WHERE e.starts_at >= $1::date AND e.starts_at < $1::date + interval '1 month'
    `;
    const params = [startDate];
    let i = 2;

    if (user_id && !isNaN(parseInt(user_id))) {
      sql += ` AND (e.creator_id = $${i} OR e.id IN (SELECT event_id FROM schedule_event_attendees WHERE user_id = $${i}))`;
      params.push(parseInt(user_id));
      i++;
    }

    sql += ' ORDER BY e.starts_at';
    const events = await query(sql, params);
    res.json(events);
  } catch (err) {
    console.error('Schedule list error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/schedule/my?month=YYYY-MM — personal schedule (events + card due dates + step due dates)
router.get('/my', requireAuth, async (req, res) => {
  try {
    const { month } = req.query;
    if (!month) return res.status(400).json({ error: 'month parameter required (YYYY-MM)' });

    const startDate = `${month}-01`;

    const [events, cardDueDates, stepDueDates] = await Promise.all([
      query(
        `SELECT e.*, 'event' as item_type
         FROM schedule_events e
         WHERE (e.creator_id = $1 OR e.id IN (SELECT event_id FROM schedule_event_attendees WHERE user_id = $1))
           AND e.starts_at >= $2::date AND e.starts_at < $2::date + interval '1 month'
         ORDER BY e.starts_at`,
        [req.user.userId, startDate]
      ),
      query(
        `SELECT c.id, c.title, c.due_on, c.priority, 'card_due' as item_type
         FROM cards c
         JOIN card_assignees ca ON ca.card_id = c.id AND ca.user_id = $1
         WHERE c.archived_at IS NULL AND c.due_on IS NOT NULL
           AND c.due_on >= $2::date AND c.due_on < $2::date + interval '1 month'
         ORDER BY c.due_on`,
        [req.user.userId, startDate]
      ),
      query(
        `SELECT cs.id, cs.title, cs.due_on, cs.card_id, 'step_due' as item_type
         FROM card_steps cs
         WHERE cs.assignee_id = $1 AND cs.completed = FALSE AND cs.due_on IS NOT NULL
           AND cs.due_on >= $2::date AND cs.due_on < $2::date + interval '1 month'
         ORDER BY cs.due_on`,
        [req.user.userId, startDate]
      )
    ]);

    res.json({ events, cardDueDates, stepDueDates });
  } catch (err) {
    console.error('My schedule error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/schedule/:id — single event
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const event = await queryOne(
      `SELECT e.*, u.name as creator_name,
        COALESCE(
          (SELECT json_agg(json_build_object('id', au.id, 'name', au.name, 'avatar_url', au.avatar_url))
           FROM schedule_event_attendees sa JOIN users au ON sa.user_id = au.id WHERE sa.event_id = e.id),
          '[]'::json
        ) as attendees
       FROM schedule_events e
       LEFT JOIN users u ON e.creator_id = u.id
       WHERE e.id = $1`,
      [req.params.id]
    );
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/schedule — create event with attendee_ids
router.post('/', requireAuth, async (req, res) => {
  try {
    const { title, description, starts_at, ends_at, all_day, attendee_ids } = req.body;
    if (!title || !starts_at) return res.status(400).json({ error: 'title and starts_at required' });

    const event = await queryOne(
      `INSERT INTO schedule_events (title, description, starts_at, ends_at, all_day, creator_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [title, description || null, starts_at, ends_at || null, all_day || false, req.user.userId]
    );

    // Add attendees
    if (attendee_ids?.length > 0) {
      for (const uid of attendee_ids) {
        await execute('INSERT INTO schedule_event_attendees (event_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [event.id, uid]);
      }
    }

    broadcast({ type: 'schedule:created', event }, req.user.userId);
    res.status(201).json(event);
  } catch (err) {
    console.error('Schedule create error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/schedule/:id — update event
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { title, description, starts_at, ends_at, all_day, attendee_ids } = req.body;

    const event = await queryOne(
      `UPDATE schedule_events SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        starts_at = COALESCE($3, starts_at),
        ends_at = COALESCE($4, ends_at),
        all_day = COALESCE($5, all_day),
        updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [title, description, starts_at, ends_at, all_day, req.params.id]
    );
    if (!event) return res.status(404).json({ error: 'Event not found' });

    // Update attendees if provided
    if (attendee_ids !== undefined) {
      await execute('DELETE FROM schedule_event_attendees WHERE event_id = $1', [event.id]);
      for (const uid of (attendee_ids || [])) {
        await execute('INSERT INTO schedule_event_attendees (event_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [event.id, uid]);
      }
    }

    broadcast({ type: 'schedule:updated', event }, req.user.userId);
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/schedule/:id — delete event
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const event = await queryOne('DELETE FROM schedule_events WHERE id = $1 RETURNING *', [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    await execute('DELETE FROM schedule_event_attendees WHERE event_id = $1', [req.params.id]);

    broadcast({ type: 'schedule:deleted', eventId: parseInt(req.params.id) }, req.user.userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
