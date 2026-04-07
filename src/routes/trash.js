const express = require('express');
const router = express.Router();
const { query, queryOne, execute } = require('../db/pool');
const { requireAuth, requireModerator } = require('../middleware/auth');
const { broadcast } = require('../ws/broadcast');

// Helper: can user act on this trashed card?
// Allowed: card creator, current assignee, moderator/admin.
async function canActOnTrashedCard(cardId, user) {
  if (user.role === 'admin' || user.role === 'moderator') return true;
  const row = await queryOne(
    `SELECT c.creator_id,
            EXISTS(SELECT 1 FROM card_assignees WHERE card_id = c.id AND user_id = $2) AS is_assignee
     FROM cards c WHERE c.id = $1 AND c.trashed_at IS NOT NULL`,
    [cardId, user.userId]
  );
  if (!row) return null; // not found / not in trash
  return row.creator_id === user.userId || row.is_assignee === true;
}

// GET /api/trash — all cards in trash (last 30 days)
router.get('/', requireAuth, async (req, res) => {
  try {
    const cards = await query(`
      SELECT c.id, c.title, c.board_id, c.trashed_at, c.client_name,
             b.title as board_title, col.title as column_title,
             COALESCE(
               (SELECT json_agg(json_build_object('id', u.id, 'name', u.name))
                FROM card_assignees ca JOIN users u ON ca.user_id = u.id WHERE ca.card_id = c.id),
               '[]'::json
             ) as assignees
      FROM cards c
      JOIN boards b ON c.board_id = b.id
      JOIN columns col ON c.column_id = col.id
      WHERE c.trashed_at IS NOT NULL
        AND c.trashed_at > NOW() - INTERVAL '30 days'
      ORDER BY c.trashed_at DESC
    `);
    res.json(cards);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/trash/:id/restore — restore card from trash.
// Allowed: creator, current assignee, or moderator/admin.
router.post('/:id/restore', requireAuth, async (req, res) => {
  try {
    const allowed = await canActOnTrashedCard(req.params.id, req.user);
    if (allowed === null) return res.status(404).json({ error: 'Card not found in trash' });
    if (!allowed) return res.status(403).json({ error: 'Нямате права да възстановите тази карта' });

    const card = await queryOne(
      'UPDATE cards SET trashed_at = NULL WHERE id = $1 AND trashed_at IS NOT NULL RETURNING id, title, board_id',
      [req.params.id]
    );
    if (!card) return res.status(404).json({ error: 'Card not found in trash' });
    broadcast({ type: 'card:restored', cardId: card.id, boardId: card.board_id });
    res.json({ ok: true, card });
  } catch (err) {
    console.error('[trash] restore error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/trash/:id — permanently delete one card.
// Restricted to moderator/admin (irreversible operation).
router.delete('/:id', requireAuth, requireModerator, async (req, res) => {
  try {
    const card = await queryOne(
      'DELETE FROM cards WHERE id = $1 AND trashed_at IS NOT NULL RETURNING id',
      [req.params.id]
    );
    if (!card) return res.status(404).json({ error: 'Card not found in trash' });
    broadcast({ type: 'card:deleted', cardId: parseInt(req.params.id) });
    res.json({ ok: true });
  } catch (err) {
    console.error('[trash] permanent delete error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
