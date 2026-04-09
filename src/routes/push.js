const express = require('express');
const router = express.Router();
const { queryOne, execute } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const config = require('../config');

// GET /api/push/vapid-key — public key for client-side subscription
router.get('/vapid-key', requireAuth, (req, res) => {
  if (!config.VAPID_PUBLIC_KEY) {
    return res.status(503).json({ error: 'Push notifications not configured' });
  }
  res.json({ publicKey: config.VAPID_PUBLIC_KEY });
});

// POST /api/push/subscribe — save push subscription
router.post('/subscribe', requireAuth, async (req, res) => {
  try {
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: 'Invalid subscription data' });
    }

    // Upsert: if endpoint exists, update keys (they can rotate)
    await execute(
      `INSERT INTO push_subscriptions (user_id, endpoint, keys_p256dh, keys_auth, user_agent)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint) DO UPDATE SET
         user_id = $1, keys_p256dh = $3, keys_auth = $4, user_agent = $5, created_at = NOW()`,
      [req.user.userId, endpoint, keys.p256dh, keys.auth, req.headers['user-agent'] || null]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('[push] subscribe error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/push/unsubscribe — remove push subscription
router.delete('/unsubscribe', requireAuth, async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ error: 'endpoint required' });

    await execute(
      'DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2',
      [endpoint, req.user.userId]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('[push] unsubscribe error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/push/status — check if current user has active subscriptions
router.get('/status', requireAuth, async (req, res) => {
  try {
    const sub = await queryOne(
      'SELECT COUNT(*) as count FROM push_subscriptions WHERE user_id = $1',
      [req.user.userId]
    );
    res.json({ subscribed: parseInt(sub.count) > 0 });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
