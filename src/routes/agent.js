// PM Agent API — само за админ (Венци). Фаза 0/1: sync + одит + журнал.
const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { query, queryOne } = require('../db/pool');
const { runSync, snapshotCounts } = require('../services/pm-agent/snapshot');
const { runAudit } = require('../services/pm-agent/audit');

router.use(requireAuth, requireAdmin);

// Състояние: снапшот бройки + последните изпълнения.
router.get('/status', async (req, res) => {
  try {
    const counts = await snapshotCounts();
    const runs = await query(
      `SELECT id, kind, status, stats, error, bc_message_url, started_at, finished_at
       FROM agent_runs ORDER BY id DESC LIMIT 10`);
    res.json({ counts, runs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ръчен sync (async — връща веднага; статусът се следи от /status).
router.post('/sync', express.json(), (req, res) => {
  const full = Boolean(req.body && req.body.full);
  runSync({ trigger: 'manual', full }).catch((err) => console.error('[pm-agent] manual sync error:', err.message));
  res.json({ started: true, full });
});

// Пуска одита (async). Ако снапшотът е празен, одитът сам прави пълен sync.
router.post('/audit', (req, res) => {
  runAudit({ trigger: 'manual' }).catch((err) => console.error('[pm-agent] audit error:', err.message));
  res.json({ started: true });
});

// Журнал (без докладите — те са големи).
router.get('/runs', async (req, res) => {
  try {
    const runs = await query(
      `SELECT id, kind, status, stats, error, bc_message_url, started_at, finished_at
       FROM agent_runs ORDER BY id DESC LIMIT 50`);
    res.json({ runs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Едно изпълнение — с пълния доклад.
router.get('/runs/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Невалидно id.' });
    const run = await queryOne('SELECT * FROM agent_runs WHERE id = $1', [id]);
    if (!run) return res.status(404).json({ error: 'Няма такова изпълнение.' });
    res.json({ run });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
