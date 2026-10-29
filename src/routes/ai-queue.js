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

// Пулсът на компютъра (всяка минута, дори когато агентът е зает) — services/pc-watch.js.
router.post('/heartbeat', async (req, res) => {
  try {
    await require('../services/pc-watch').recordHeartbeat(req.body || {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Качени файлове за паметта на клиентите (Content агент): компютърът ги дърпа, пази при
// себе си, вади текста (PDF/Word/…/Whisper) и го връща — services/content-agent/imports.js.
const caImports = require('../services/content-agent/imports');

router.get('/imports/next', async (req, res) => {
  try { res.json({ item: (await caImports.claimNext()) || null }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/imports/:id/file', async (req, res) => {
  try {
    const f = await caImports.fileFor(parseInt(req.params.id, 10));
    if (!f) return res.status(404).json({ error: 'няма такъв файл' });
    res.sendFile(f.tmp_path);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/imports/:id/done', express.json({ limit: '20mb' }), async (req, res) => {
  try {
    const r = await caImports.complete(parseInt(req.params.id, 10), req.body || {});
    if (!r) return res.status(409).json({ error: 'файлът не е в обработка' });
    res.json({ ok: true, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
