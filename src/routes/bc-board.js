// Basecamp-backed board: reads the Video Production card tables and moves cards.
// Acts AS the logged-in user (their own Basecamp token) — not the bot.
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const config = require('../config');
const bc = require('../services/basecamp');
const { getUserAuth } = require('../services/basecamp-token');

// Run async fn over items with limited concurrency (gentle on Basecamp rate limits).
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return out;
}

// The Video Production board is identical for all team members, so a short shared cache
// avoids re-hitting Basecamp on every load. Invalidated immediately after a move.
let cache = { at: 0, data: null };
const CACHE_MS = 30_000;

function mapCard(c) {
  return {
    id: c.id,
    title: c.title,
    dueOn: c.due_on,
    completed: c.completed,
    assignees: (c.assignees || []).map((a) => ({ id: a.id, name: a.name })),
    stepsCount: (c.steps || []).length,
    url: c.app_url,
    position: c.position,
  };
}

async function loadBoard(token, account) {
  if (cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;
  const projectId = config.BASECAMP_TEAM_PROJECT_ID;
  const project = await bc.getProject(token, account, projectId);
  const tools = (project.dock || []).filter((t) => t.enabled && /kanban|card/i.test(t.name));
  // 1. Card tables (light — one call each).
  const tables = await mapLimit(tools, 3, async (t) => {
    const table = (await bc.authedGet(t.url, token)).json;
    return { id: table.id, title: t.title || table.title, lists: table.lists || [] };
  });
  // 2. Cards per column with a GLOBAL concurrency cap (heavy — gentle on Basecamp rate limits).
  const jobs = [];
  tables.forEach((tb) => tb.lists.forEach((list) => jobs.push({ tb, list, cards: [] })));
  await mapLimit(jobs, 5, async (job) => {
    job.cards = job.list.cards_count > 0 ? await bc.getColumnCards(token, account, projectId, job.list.id) : [];
  });
  const boards = tables.map((tb) => ({
    id: tb.id,
    title: tb.title,
    projectId,
    columns: tb.lists.map((list) => {
      const job = jobs.find((j) => j.tb === tb && j.list === list);
      return { id: list.id, title: list.title, cardsCount: list.cards_count, cards: (job.cards || []).map(mapCard) };
    }),
  }));
  cache = { at: Date.now(), data: { projectId, boards } };
  return cache.data;
}

// GET /api/bc-board — Video Production card tables with columns + cards (as the user)
router.get('/', requireAuth, async (req, res) => {
  try {
    const { token, account } = await getUserAuth(req.user.userId);
    res.json(await loadBoard(token, account));
  } catch (err) {
    console.error('[bc-board]', err.message);
    res.status(err.code === 'NO_USER_TOKEN' ? 401 : 502).json({ error: err.message });
  }
});

// POST /api/bc-board/move — move a card to another column (recorded AS the logged-in user)
router.post('/move', requireAuth, async (req, res) => {
  try {
    const { cardTableId, cardId, targetColumnId, position } = req.body || {};
    if (!cardTableId || !cardId || !targetColumnId) {
      return res.status(400).json({ error: 'cardTableId, cardId, targetColumnId required' });
    }
    const { token, account } = await getUserAuth(req.user.userId);
    await bc.moveCard(token, account, config.BASECAMP_TEAM_PROJECT_ID, cardTableId, cardId, targetColumnId, position || 0);
    cache = { at: 0, data: null }; // invalidate so the next load reflects the move
    res.json({ ok: true });
  } catch (err) {
    console.error('[bc-board move]', err.message);
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
