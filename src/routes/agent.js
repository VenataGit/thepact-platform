// PM Agent API — само за админ (Венци). Фаза 0/1: sync + одит + журнал.
const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { query, queryOne } = require('../db/pool');
const { runSync, snapshotCounts } = require('../services/pm-agent/snapshot');
const { runAudit } = require('../services/pm-agent/audit');
const { handleChatMessage, chatHistoryForUi, resetChat, isChatBusy } = require('../services/pm-agent/chat');
const { approveProposal, rejectProposal } = require('../services/pm-agent/actions');
const { runDigest, runWatchdog } = require('../services/pm-agent/digest');

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

// ---------- Чат (Фаза 2) ----------

// Съобщение до агента (async — отговорът идва по WebSocket).
router.post('/chat', express.json({ limit: '256kb' }), (req, res) => {
  const text = String((req.body && req.body.text) || '').trim();
  if (!text) return res.status(400).json({ error: 'Празно съобщение.' });
  if (text.length > 20000) return res.status(400).json({ error: 'Твърде дълго съобщение.' });
  if (isChatBusy()) return res.status(409).json({ error: 'Агентът още обработва предишното съобщение.' });
  handleChatMessage(req.user.userId, text).catch((err) => console.error('[pm-agent] chat error:', err.message));
  res.json({ started: true });
});

router.get('/chat/history', async (req, res) => {
  try {
    const messages = await chatHistoryForUi();
    const proposals = await query(
      "SELECT * FROM agent_proposals ORDER BY id DESC LIMIT 30");
    res.json({ messages, proposals, busy: isChatBusy() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/chat/reset', async (req, res) => {
  try { await resetChat(); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------- Предложения (Фаза 3) ----------

router.get('/proposals', async (req, res) => {
  try {
    const status = String(req.query.status || '');
    const rows = status
      ? await query('SELECT * FROM agent_proposals WHERE status = $1 ORDER BY id DESC LIMIT 50', [status])
      : await query('SELECT * FROM agent_proposals ORDER BY id DESC LIMIT 50');
    res.json({ proposals: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/proposals/:id/approve', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Невалидно id.' });
  try {
    const p = await approveProposal(id);
    res.json({ proposal: p });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/proposals/:id/reject', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Невалидно id.' });
  try {
    const p = await rejectProposal(id);
    res.json({ proposal: p });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------- Дайджест / watchdog (Фаза 4) ----------

router.post('/digest', (req, res) => {
  runDigest({ trigger: 'manual' }).catch((err) => console.error('[pm-agent] digest error:', err.message));
  res.json({ started: true });
});

router.post('/watchdog', async (req, res) => {
  try {
    const result = await runWatchdog();
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
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
