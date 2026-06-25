// Basecamp-backed board: reads the Video Production card tables and moves cards.
// Acts AS the logged-in user (their own Basecamp token) — not the bot.
//
// Two-stage loading keeps it responsive on a 300+ card board:
//   GET /api/bc-board                  -> structure only (boards + columns + counts), fast
//   GET /api/bc-board/cards?board=<id> -> the cards for ONE board (loaded on demand)
//   POST /api/bc-board/move            -> move a card to another column
const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const config = require('../config');
const { queryOne, execute } = require('../db/pool');
const bc = require('../services/basecamp');
const { getUserAuth } = require('../services/basecamp-token');
// Board fetching + caching lives in the shared aggregate service so the Clients
// overview reuses the same warm caches (see services/bc-aggregate.js).
const agg = require('../services/bc-aggregate');
const { loadStructure, loadBoardCards, invalidateBoard } = agg;

// Global dashboard layout (board + column ordering), set by an admin, applied for everyone.
const LAYOUT_KEY = 'bc_dashboard_layout';
async function getLayout() {
  try {
    const row = await queryOne('SELECT value FROM app_settings WHERE key = $1', [LAYOUT_KEY]);
    return row && row.value ? JSON.parse(row.value) : {};
  } catch { return {}; }
}

// GET /api/bc-board — board structure (boards + columns + counts), no cards.
router.get('/', requireAuth, async (req, res) => {
  try {
    const { token, account } = await getUserAuth(req.user.userId);
    const data = await loadStructure(token, account);
    const layout = await getLayout();
    res.json({ ...data, layout });
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

// GET /api/bc-board/inspect?board=<cardTableId> — admin diagnostic. Basecamp does NOT
// document how an "on hold" card is represented in JSON, so dump the raw status/parent
// fields per card to discover the indicator (put a card on hold, then compare).
router.get('/inspect', requireAuth, requireAdmin, async (req, res) => {
  try {
    const cardTableId = req.query.board;
    const wantCard = req.query.card ? String(req.query.card) : null;
    if (!cardTableId) return res.status(400).json({ error: 'board required' });
    const { token, account } = await getUserAuth(req.user.userId);
    const projectId = config.BASECAMP_TEAM_PROJECT_ID;
    const table = await bc.getCardTable(token, account, projectId, cardTableId);

    // ?structure=1[&column=<id>]: dump the raw card-table lists + a column's detail, so we
    // can see how the on-hold section is represented and how to fetch its cards.
    if (req.query.structure) {
      let columnDetail = null, onHoldCards = null;
      const colId = req.query.column;
      if (colId) {
        try { columnDetail = (await bc.authedGet(`${bc.API_BASE}/${account}/buckets/${projectId}/card_tables/columns/${colId}.json`, token)).json; }
        catch (e) { columnDetail = { error: e.message }; }
        // Guess: on-hold cards may be fetchable from the column's own cards endpoint variant.
        try { onHoldCards = (await bc.authedGet(`${bc.API_BASE}/${account}/buckets/${projectId}/card_tables/lists/${colId}/cards.json`, token)).json; }
        catch (e) { onHoldCards = { error: e.message }; }
      }
      return res.json({
        board: table.title,
        lists: (table.lists || []).map((l) => ({ id: l.id, title: l.title, type: l.type, cards_count: l.cards_count, cards_url: l.cards_url, keys: Object.keys(l) })),
        columnDetail,
        cardsViaColumnEndpoint: Array.isArray(onHoldCards) ? onHoldCards.map((c) => ({ id: c.id, title: c.title, parent_type: c.parent && c.parent.type })) : onHoldCards,
      });
    }

    // ?card=<id>: return the FULL raw card object (from the column list) so we can see
    // every field — incl. whatever indicates "on hold". Also try the standalone GET.
    if (wantCard) {
      let inList = null, foundColumn = null;
      for (const list of (table.lists || [])) {
        if (!list.cards_count) continue;
        const cards = await bc.getColumnCards(token, account, projectId, list.id);
        const hit = cards.find((c) => String(c.id) === wantCard);
        if (hit) { inList = hit; foundColumn = list.title; break; }
      }
      let standalone = null;
      try {
        standalone = (await bc.authedGet(`${bc.API_BASE}/${account}/buckets/${projectId}/card_tables/cards/${wantCard}.json`, token)).json;
      } catch (e) { standalone = { error: e.message }; }
      return res.json({
        board: table.title,
        foundInColumnList: foundColumn || '(NOT in any normal column list — likely a separate on-hold section)',
        rawCardFromColumnList: inList,
        rawCardStandalone: standalone,
      });
    }

    const out = [];
    for (const list of (table.lists || [])) {
      if (!list.cards_count) continue;
      const cards = await bc.getColumnCards(token, account, projectId, list.id);
      out.push({
        column: list.title,
        list_type: list.type,
        cards: cards.map((c) => ({
          id: c.id, title: c.title, status: c.status, inherits_status: c.inherits_status,
          completed: c.completed, type: c.type, parent_type: c.parent && c.parent.type,
        })),
      });
    }
    res.json({ board: table.title, columns: out });
  } catch (err) {
    console.error('[bc-board inspect]', err.message);
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
    invalidateBoard(cardTableId); // this board re-fetches on next load
    res.json({ ok: true });
  } catch (err) {
    console.error('[bc-board move]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// POST /api/bc-board/layout — save the global board/column ordering (admin only).
router.post('/layout', requireAuth, requireAdmin, async (req, res) => {
  try {
    const layout = req.body && req.body.layout ? req.body.layout : (req.body || {});
    await execute(
      'INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()',
      [LAYOUT_KEY, JSON.stringify(layout || {})]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[bc-board layout]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
