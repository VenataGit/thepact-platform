const express = require('express');
const router = express.Router();
const { query } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

// GET /api/reports/overdue — cards with due_on < NOW() and not archived
router.get('/overdue', requireAuth, async (req, res) => {
  try {
    const cards = await query(
      `SELECT c.*, b.title as board_title, col.title as column_title,
        COALESCE(
          (SELECT json_agg(json_build_object('id', u.id, 'name', u.name))
           FROM card_assignees ca JOIN users u ON ca.user_id = u.id WHERE ca.card_id = c.id),
          '[]'::json
        ) as assignees
       FROM cards c
       JOIN boards b ON c.board_id = b.id
       JOIN columns col ON c.column_id = col.id
       WHERE c.archived_at IS NULL AND c.completed_at IS NULL
         AND c.due_on IS NOT NULL AND c.due_on < NOW()
       ORDER BY c.due_on ASC`
    );
    res.json(cards);
  } catch (err) {
    console.error('Reports overdue error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/upcoming?days=7 — cards due within N days
router.get('/upcoming', requireAuth, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;

    const cards = await query(
      `SELECT c.*, b.title as board_title, col.title as column_title,
        COALESCE(
          (SELECT json_agg(json_build_object('id', u.id, 'name', u.name))
           FROM card_assignees ca JOIN users u ON ca.user_id = u.id WHERE ca.card_id = c.id),
          '[]'::json
        ) as assignees
       FROM cards c
       JOIN boards b ON c.board_id = b.id
       JOIN columns col ON c.column_id = col.id
       WHERE c.archived_at IS NULL AND c.completed_at IS NULL
         AND c.due_on IS NOT NULL
         AND c.due_on >= NOW()
         AND c.due_on <= NOW() + $1 * interval '1 day'
       ORDER BY c.due_on ASC`,
      [days]
    );
    res.json(cards);
  } catch (err) {
    console.error('Reports upcoming error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/assignments?user_id= — cards grouped by assignee
router.get('/assignments', requireAuth, async (req, res) => {
  try {
    const { user_id } = req.query;

    let sql = `
      SELECT u.id as user_id, u.name as user_name,
        COALESCE(
          (SELECT json_agg(json_build_object(
            'id', c.id, 'title', c.title, 'due_on', c.due_on, 'priority', c.priority,
            'board_title', b.title, 'column_title', col.title
          ) ORDER BY c.due_on NULLS LAST)
          FROM card_assignees ca2
          JOIN cards c ON ca2.card_id = c.id AND c.archived_at IS NULL AND c.completed_at IS NULL
          JOIN boards b ON c.board_id = b.id
          JOIN columns col ON c.column_id = col.id
          WHERE ca2.user_id = u.id),
          '[]'::json
        ) as cards
      FROM users u
      WHERE u.active = TRUE
    `;
    const params = [];

    if (user_id && !isNaN(parseInt(user_id))) {
      sql += ' AND u.id = $1';
      params.push(parseInt(user_id));
    }

    sql += ' ORDER BY u.name';
    const assignments = await query(sql, params);
    res.json(assignments);
  } catch (err) {
    console.error('Reports assignments error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/unassigned — cards with no assignees
router.get('/unassigned', requireAuth, async (req, res) => {
  try {
    const cards = await query(
      `SELECT c.*, b.title as board_title, col.title as column_title
       FROM cards c
       JOIN boards b ON c.board_id = b.id
       JOIN columns col ON c.column_id = col.id
       WHERE c.archived_at IS NULL AND c.completed_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM card_assignees WHERE card_id = c.id)
       ORDER BY c.created_at DESC`
    );
    res.json(cards);
  } catch (err) {
    console.error('Reports unassigned error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/calendar?month=YYYY-MM — all cards with due/publish dates in month
router.get('/calendar', requireAuth, async (req, res) => {
  try {
    const { month } = req.query;
    if (!month) return res.status(400).json({ error: 'month parameter required (YYYY-MM)' });
    const startDate = `${month}-01`;

    const [dueCards, publishCards, stepDues] = await Promise.all([
      query(
        `SELECT c.id, c.title, c.due_on::text as date, 'due' as type,
                c.client_name, b.title as board_title, col.title as column_title,
                COALESCE(
                  (SELECT json_agg(json_build_object('name', u.name))
                   FROM card_assignees ca JOIN users u ON ca.user_id = u.id WHERE ca.card_id = c.id),
                  '[]'::json
                ) as assignees
         FROM cards c
         JOIN boards b ON c.board_id = b.id
         JOIN columns col ON c.column_id = col.id
         WHERE c.archived_at IS NULL AND c.completed_at IS NULL
           AND c.due_on >= $1::date AND c.due_on < $1::date + interval '1 month'
         ORDER BY c.due_on, c.title`,
        [startDate]
      ),
      query(
        `SELECT c.id, c.title, c.publish_date::text as date, 'publish' as type,
                c.client_name, b.title as board_title, col.title as column_title
         FROM cards c
         JOIN boards b ON c.board_id = b.id
         JOIN columns col ON c.column_id = col.id
         WHERE c.archived_at IS NULL
           AND c.publish_date >= $1::date AND c.publish_date < $1::date + interval '1 month'
         ORDER BY c.publish_date, c.title`,
        [startDate]
      ),
      query(
        `SELECT cs.id, cs.title, cs.due_on::text as date, 'step' as type,
                cs.card_id, c.title as card_title, c.client_name
         FROM card_steps cs
         JOIN cards c ON cs.card_id = c.id
         WHERE cs.completed = FALSE AND cs.due_on IS NOT NULL
           AND cs.due_on >= $1::date AND cs.due_on < $1::date + interval '1 month'
           AND c.archived_at IS NULL AND c.completed_at IS NULL
         ORDER BY cs.due_on, cs.title`,
        [startDate]
      )
    ]);

    res.json({ dueCards, publishCards, stepDues });
  } catch (err) {
    console.error('Calendar error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
