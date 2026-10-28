// API за агента, който изпълнява AI заявките с абонамента (ai-agent/worker.js на компютъра).
//
// Auth: header X-Dev-Queue-Key срещу DEV_QUEUE_SECRET — същият ключ като на Dev Queue-то
// и folder агента (същият компютър, същата граница на доверие; без пипане на .env).
const express = require('express');
const router = express.Router();
const config = require('../config');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const aq = require('../services/ai-queue');

// Диагностика за админ (през нормалната сесия).
router.get('/status', requireAuth, requireAdmin, async (req, res) => {
  try { res.json(await aq.status()); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.use((req, res, next) => {
  if (!config.DEV_QUEUE_SECRET) return res.status(503).json({ error: 'ai queue not configured' });
  if (req.get('x-dev-queue-key') !== config.DEV_QUEUE_SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

router.get('/next', async (req, res) => {
  try { res.json({ job: (await aq.claimNext({ peek: !!req.query.peek })) || null }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/done', async (req, res) => {
  try {
    const b = req.body || {};
    const row = await aq.complete(req.params.id, { ok: !!b.ok, text: b.text, usage: b.usage, model: b.model, error: b.error });
    if (!row) return res.status(409).json({ error: 'заявката не е в running' });
    res.json({ ok: true, status: row.status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
