// Per-client overview, sourced live from the Video Production Basecamp boards.
// Re-slices the SAME cached board data the dashboard uses (services/bc-aggregate.js),
// grouping cards by client + КП parsed from the card title. Read-only.
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getUserAuth } = require('../services/basecamp-token');
const agg = require('../services/bc-aggregate');

// Trim the heavy per-video detail off the list response — the grid only needs signals.
function toSummary(c) {
  return {
    name: c.name, key: c.key, initials: c.initials,
    signal: c.signal, currentKp: c.currentKp, kpNumbers: c.kpNumbers,
    activeVideos: c.activeVideos, overdueVideos: c.overdueVideos, soonVideos: c.soonVideos,
    planAlert: c.planAlert, meta: c.meta,
  };
}

// GET /api/clients — one summary per client (grid view).
router.get('/', requireAuth, async (req, res) => {
  try {
    const { token, account } = await getUserAuth(req.user.userId);
    const { generatedAt, clients } = await agg.aggregateAll(token, account);
    res.json({ generatedAt, clients: clients.map(toSummary) });
  } catch (err) {
    console.error('[clients]', err.message);
    res.status(err.code === 'NO_USER_TOKEN' ? 401 : 502).json({ error: err.message });
  }
});

// GET /api/clients/:name — full detail for one client (plans -> videos by stage).
router.get('/:name', requireAuth, async (req, res) => {
  try {
    const key = String(req.params.name || '').trim().toLowerCase();
    const { token, account } = await getUserAuth(req.user.userId);
    const { generatedAt, clients } = await agg.aggregateAll(token, account);
    const client = clients.find((c) => c.key === key);
    if (!client) return res.status(404).json({ error: 'Клиентът не е намерен.' });
    res.json({ generatedAt, ...client });
  } catch (err) {
    console.error('[clients detail]', err.message);
    res.status(err.code === 'NO_USER_TOKEN' ? 401 : 502).json({ error: err.message });
  }
});

module.exports = router;
