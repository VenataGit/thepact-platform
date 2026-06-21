// Basecamp-backed board: reads the Video Production card tables and moves cards.
// Acts AS the logged-in user (their own Basecamp token) — not the bot.
//
// Two-stage loading keeps it responsive on a 300+ card board:
//   GET /api/bc-board                  -> structure only (boards + columns + counts), fast
//   GET /api/bc-board/cards?board=<id> -> the cards for ONE board (loaded on demand)
//   POST /api/bc-board/move            -> move a card to another column
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

// The board is shared across team members, so cache both stages briefly.
let structCache = { at: 0, data: null };
const STRUCT_TTL = 60_000;
const cardsCache = new Map(); // cardTableId -> { at, cardTableId, columns }
const CARDS_TTL = 30_000;

async function loadStructure(token, account) {
  if (structCache.data && Date.now() - structCache.at < STRUCT_TTL) return structCache.data;
  const projectId = config.BASECAMP_TEAM_PROJECT_ID;
  const project = await bc.getProject(token, account, projectId);
  const tools = (project.dock || []).filter((t) => t.enabled && /kanban|card/i.test(t.name));
  const boards = await mapLimit(tools, 3, async (t) => {
    const table = (await bc.authedGet(t.url, token)).json;
    return {
      id: table.id,
      title: t.title || table.title,
      projectId,
      columns: (table.lists || []).map((l) => ({ id: l.id, title: l.title, cardsCount: l.cards_count, isDone: /DoneColumn/i.test(l.type || '') })),
    };
  });
  structCache = { at: Date.now(), data: { projectId, boards } };
  return structCache.data;
}

async function loadBoardCards(token, account, cardTableId) {
  const key = String(cardTableId);
  const hit = cardsCache.get(key);
  if (hit && Date.now() - hit.at < CARDS_TTL) return hit;
  const projectId = config.BASECAMP_TEAM_PROJECT_ID;
  const table = await bc.getCardTable(token, account, projectId, cardTableId);
  const lists = table.lists || [];
  const columns = await mapLimit(lists, 5, async (list) => {
    const cards = list.cards_count > 0 ? await bc.getColumnCards(token, account, projectId, list.id) : [];
    return { id: list.id, cards: cards.map(mapCard) };
  });
  const result = { at: Date.now(), cardTableId: table.id, columns };
  cardsCache.set(key, result);
  return result;
}

// GET /api/bc-board — board structure (boards + columns + counts), no cards.
router.get('/', requireAuth, async (req, res) => {
  try {
    const { token, account } = await getUserAuth(req.user.userId);
    res.json(await loadStructure(token, account));
  } catch (err) {
    console.error('[bc-board]', err.message);
    res.status(err.code === 'NO_USER_TOKEN' ? 401 : 502).json({ error: err.message });
  }
});

// GET /api/bc-board/cards?board=<cardTableId> — the cards for one board, on demand.
router.get('/cards', requireAuth, async (req, res) => {
  try {
    const cardTableId = req.query.board;
    if (!cardTableId) return res.status(400).json({ error: 'board required' });
    const { token, account } = await getUserAuth(req.user.userId);
    res.json(await loadBoardCards(token, account, cardTableId));
  } catch (err) {
    console.error('[bc-board cards]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// POST /api/bc-board/move — move a card to another column, recorded AS the logged-in user.
router.post('/move', requireAuth, async (req, res) => {
  try {
    const { cardTableId, cardId, targetColumnId, position } = req.body || {};
    if (!cardTableId || !cardId || !targetColumnId) {
      return res.status(400).json({ error: 'cardTableId, cardId, targetColumnId required' });
    }
    const { token, account } = await getUserAuth(req.user.userId);
    await bc.moveCard(token, account, config.BASECAMP_TEAM_PROJECT_ID, cardTableId, cardId, targetColumnId, position || 0);
    cardsCache.delete(String(cardTableId)); // this board re-fetches on next load
    res.json({ ok: true });
  } catch (err) {
    console.error('[bc-board move]', err.message);
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
