const express = require('express');
const router = express.Router();
const { query, queryOne, execute } = require('../db/pool');
const { requireAuth, requireModerator } = require('../middleware/auth');

// GET /api/messageboard
router.get('/', requireAuth, async (req, res) => {
  try {
    const category = req.query.category;
    let sql = `SELECT mb.*, u.name as user_name, u.avatar_url as user_avatar
               FROM message_board mb LEFT JOIN users u ON mb.user_id = u.id`;
    const params = [];
    if (category) {
      sql += ' WHERE mb.category = $1';
      params.push(category);
    }
    sql += ' ORDER BY mb.pinned DESC, mb.created_at DESC LIMIT 50';
    const messages = await query(sql, params);
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/messageboard
router.post('/', requireAuth, async (req, res) => {
  try {
    const { title, content, category, pinned } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
    const msg = await queryOne(
      `INSERT INTO message_board (user_id, title, content, category, pinned)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.userId, title.trim(), content || null, category || 'general', pinned || false]
    );
    res.status(201).json(msg);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/messageboard/daily-report — auto-generate daily report
router.post('/daily-report', requireAuth, requireModerator, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Get today's activity
    const [movedCards, createdCards, completedCards] = await Promise.all([
      query(
        `SELECT COUNT(*) as count FROM card_events WHERE event_type = 'moved' AND created_at::date = $1`,
        [today]
      ),
      query(
        `SELECT COUNT(*) as count FROM cards WHERE created_at::date = $1 AND archived_at IS NULL`,
        [today]
      ),
      query(
        `SELECT COUNT(*) as count FROM cards WHERE completed_at::date = $1`,
        [today]
      )
    ]);

    const overdueCards = await query(
      `SELECT COUNT(*) as count FROM cards WHERE due_on < $1 AND archived_at IS NULL AND completed_at IS NULL AND is_on_hold = FALSE`,
      [today]
    );

    const content = `📊 Дневен отчет — ${today}\n\n` +
      `✅ Завършени карти: ${completedCards[0]?.count || 0}\n` +
      `📝 Нови карти: ${createdCards[0]?.count || 0}\n` +
      `🔄 Преместени карти: ${movedCards[0]?.count || 0}\n` +
      `⚠️ Просрочени: ${overdueCards[0]?.count || 0}`;

    const msg = await queryOne(
      `INSERT INTO message_board (user_id, title, content, category)
       VALUES ($1, $2, $3, 'daily-report') RETURNING *`,
      [req.user.userId, `Дневен отчет — ${today}`, content]
    );

    res.status(201).json(msg);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
