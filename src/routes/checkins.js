const express = require('express');
const router = express.Router();
const { query, queryOne, execute } = require('../db/pool');
const { requireAuth, requireModerator } = require('../middleware/auth');
const { broadcast, sendToUser } = require('../ws/broadcast');

// GET /api/checkins/questions — list active questions
router.get('/questions', requireAuth, async (req, res) => {
  try {
    const questions = await query(
      `SELECT q.*, u.name as creator_name,
        (SELECT COUNT(*) FROM checkin_responses WHERE question_id = q.id) as response_count
       FROM checkin_questions q
       LEFT JOIN users u ON q.created_by = u.id
       WHERE q.is_active = TRUE
       ORDER BY q.created_at DESC`
    );
    res.json(questions);
  } catch (err) {
    console.error('Checkins questions error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/checkins/questions/:id/responses — responses for a question
router.get('/questions/:id/responses', requireAuth, async (req, res) => {
  try {
    const responses = await query(
      `SELECT r.*, u.name as user_name, u.avatar_url as user_avatar
       FROM checkin_responses r
       JOIN users u ON r.user_id = u.id
       WHERE r.question_id = $1
       ORDER BY r.created_at DESC`,
      [req.params.id]
    );
    res.json(responses);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/checkins/my-pending — questions user hasn't answered today
router.get('/my-pending', requireAuth, async (req, res) => {
  try {
    const pending = await query(
      `SELECT q.*
       FROM checkin_questions q
       WHERE q.is_active = TRUE
         AND q.id NOT IN (
           SELECT question_id FROM checkin_responses
           WHERE user_id = $1 AND created_at::date = CURRENT_DATE
         )
       ORDER BY q.created_at`,
      [req.user.userId]
    );
    res.json(pending);
  } catch (err) {
    console.error('My pending checkins error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/checkins/questions — create question (moderator+)
router.post('/questions', requireAuth, requireModerator, async (req, res) => {
  try {
    const { question: questionText, schedule_cron } = req.body;
    if (!questionText?.trim()) return res.status(400).json({ error: 'Question required' });

    const question = await queryOne(
      `INSERT INTO checkin_questions (question, schedule_cron, created_by)
       VALUES ($1, $2, $3) RETURNING *`,
      [questionText.trim(), schedule_cron || '0 9 * * 1-5', req.user.userId]
    );

    broadcast({ type: 'checkin:question_created', question }, req.user.userId);
    res.status(201).json(question);
  } catch (err) {
    console.error('Checkin question create error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/checkins/questions/:id — update question
router.put('/questions/:id', requireAuth, requireModerator, async (req, res) => {
  try {
    const { question: questionText, schedule_cron, is_active } = req.body;

    const question = await queryOne(
      `UPDATE checkin_questions SET
        question = COALESCE($1, question),
        schedule_cron = COALESCE($2, schedule_cron),
        is_active = COALESCE($3, is_active)
       WHERE id = $4 RETURNING *`,
      [questionText, schedule_cron, is_active, req.params.id]
    );
    if (!question) return res.status(404).json({ error: 'Question not found' });

    res.json(question);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/checkins/questions/:id — deactivate question
router.delete('/questions/:id', requireAuth, requireModerator, async (req, res) => {
  try {
    const question = await queryOne(
      'UPDATE checkin_questions SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    if (!question) return res.status(404).json({ error: 'Question not found' });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/checkins/questions/:id/responses — submit response
router.post('/questions/:id/responses', requireAuth, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Content required' });

    // Verify question exists and is active
    const question = await queryOne('SELECT id, question FROM checkin_questions WHERE id = $1 AND is_active = TRUE', [req.params.id]);
    if (!question) return res.status(404).json({ error: 'Question not found or inactive' });

    // Check if already answered today
    const existing = await queryOne(
      `SELECT id FROM checkin_responses WHERE question_id = $1 AND user_id = $2 AND created_at::date = CURRENT_DATE`,
      [req.params.id, req.user.userId]
    );
    if (existing) return res.status(409).json({ error: 'Already answered today' });

    const response = await queryOne(
      `INSERT INTO checkin_responses (question_id, user_id, content)
       VALUES ($1, $2, $3) RETURNING *`,
      [req.params.id, req.user.userId, content.trim()]
    );

    broadcast({ type: 'checkin:response', questionId: parseInt(req.params.id), response: { ...response, user_name: req.user.name } }, req.user.userId);
    res.status(201).json(response);
  } catch (err) {
    console.error('Checkin response error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
