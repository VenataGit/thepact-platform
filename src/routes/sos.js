const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { query, queryOne, execute } = require('../db/pool');
const { broadcast } = require('../ws/broadcast');
const { sendPushToAllExcept } = require('../services/push');

// POST /api/sos — fire SOS alert
router.post('/', requireAuth, async (req, res) => {
  try {
    const { message, card_id, target_all, target_user_ids } = req.body;

    const alert = await queryOne(
      `INSERT INTO sos_alerts (sender_id, message, card_id, target_all, target_user_ids)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.userId, message || null, card_id || null,
       target_all !== false, target_user_ids || []]
    );

    // Get sender info
    const sender = await queryOne('SELECT name FROM users WHERE id = $1', [req.user.userId]);

    // Get card title if provided
    let cardTitle = null;
    if (card_id) {
      const card = await queryOne('SELECT title FROM cards WHERE id = $1', [card_id]);
      cardTitle = card?.title || null;
    }

    broadcast({
      type: 'sos:alert',
      alertId: alert.id,
      senderId: req.user.userId,
      senderName: sender?.name || 'Unknown',
      message: message || null,
      cardId: card_id || null,
      cardTitle,
      targetAll: alert.target_all,
      targetUserIds: alert.target_user_ids,
      createdAt: alert.created_at
    });

    // Push SOS to everyone (critical)
    sendPushToAllExcept(req.user.userId, {
      title: '🚨 SOS!',
      body: `${sender?.name || 'Някой'}: ${message || 'Спешен сигнал!'}`,
      tag: `sos-${alert.id}`,
      url: '/#/home',
    });

    res.status(201).json({ ok: true, alertId: alert.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sos — recent alerts
router.get('/', requireAuth, async (req, res) => {
  try {
    const rows = await query(`
      SELECT s.*, u.name as sender_name, c.title as card_title
      FROM sos_alerts s
      LEFT JOIN users u ON s.sender_id = u.id
      LEFT JOIN cards c ON s.card_id = c.id
      ORDER BY s.created_at DESC LIMIT 50
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sos/active — unresolved alerts targeting the current user, last 24h.
// Used on app init so users who entered AFTER the broadcast still see the alert.
router.get('/active', requireAuth, async (req, res) => {
  try {
    const rows = await query(`
      SELECT s.*, u.name as sender_name, c.title as card_title
      FROM sos_alerts s
      LEFT JOIN users u ON s.sender_id = u.id
      LEFT JOIN cards c ON s.card_id = c.id
      WHERE s.resolved_at IS NULL
        AND s.created_at > NOW() - INTERVAL '24 hours'
        AND s.sender_id != $1
        AND (s.target_all = TRUE OR $1 = ANY(s.target_user_ids))
      ORDER BY s.created_at DESC
    `, [req.user.userId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/sos/:id/resolve
router.put('/:id/resolve', requireAuth, async (req, res) => {
  try {
    await execute('UPDATE sos_alerts SET resolved_at = NOW() WHERE id = $1', [req.params.id]);
    broadcast({ type: 'sos:resolved', alertId: parseInt(req.params.id) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
