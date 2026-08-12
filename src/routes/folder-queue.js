// API за агента, който създава папките на вътрешния сървър (folder-agent/worker.js).
//
// Auth: header X-Dev-Queue-Key срещу DEV_QUEUE_SECRET — нарочно СЪЩИЯТ ключ като на
// Dev Queue-то. Агентът върви на същия компютър, зад същата граница на доверие, а нов
// ключ би значел пипане на .env на VPS-а. Без настроен ключ целият router е изключен.
const express = require('express');
const router = express.Router();
const config = require('../config');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const fq = require('../services/folder-queue');

// Диагностика за админ (през нормалната сесия, не през ключа на агента).
router.get('/recent', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json({ items: await fq.recent(parseInt(req.query.limit, 10) || 40) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.use((req, res, next) => {
  if (!config.DEV_QUEUE_SECRET) return res.status(503).json({ error: 'folder queue not configured' });
  if (req.get('x-dev-queue-key') !== config.DEV_QUEUE_SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

// Следващата заявка. ?peek=1 само поглежда, без да заключва.
router.get('/next', async (req, res) => {
  try {
    await fq.requeueStale();
    if (req.query.peek) return res.json({ job: (await fq.peekNext()) || null, peek: true });
    res.json({ job: (await fq.claimNext()) || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Отчет от агента: какво стана с папките.
router.post('/:id/done', express.json(), async (req, res) => {
  try {
    const row = await fq.complete(req.params.id, {
      ok: Boolean(req.body && req.body.ok),
      result: req.body && req.body.result,
      error: req.body && req.body.error,
    });
    if (!row) return res.status(409).json({ error: 'заявката не е в running' });
    res.json({ ok: true, status: row.status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
