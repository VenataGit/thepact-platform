// Дълготрайни токени за The Pact Tools разширението.
// Издават се само от логнат (cookie) потребител — разширението ги пази в
// chrome.storage и праща Authorization: Bearer pt_... (виж middleware/auth.js).
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { query, queryOne } = require('../db/pool');
const { requireAuth, clearExtensionTokenCache } = require('../middleware/auth');

// Токен може да мине само през истинска сесия — не през друг extension токен.
function requireCookieSession(req, res, next) {
  if (req.user?.viaExtension) {
    return res.status(403).json({ error: 'Token management requires a browser session' });
  }
  next();
}

// POST /api/extension/token — издава нов токен (показва се само веднъж)
router.post('/token', requireAuth, requireCookieSession, async (req, res, next) => {
  try {
    const token = 'pt_' + crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const label = String(req.body?.label || 'The Pact Tools').slice(0, 100);
    await query(
      'INSERT INTO extension_tokens (user_id, token_hash, label) VALUES ($1, $2, $3)',
      [req.user.userId, hash, label]
    );
    res.json({ token, name: req.user.name });
  } catch (err) { next(err); }
});

// GET /api/extension/tokens — моите токени (без самите стойности)
router.get('/tokens', requireAuth, requireCookieSession, async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT id, label, created_at, last_used_at, revoked_at
         FROM extension_tokens WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.user.userId]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// DELETE /api/extension/tokens/:id — отзоваване на мой токен
router.delete('/tokens/:id', requireAuth, requireCookieSession, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    const row = await queryOne(
      `UPDATE extension_tokens SET revoked_at = NOW()
        WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id`,
      [id, req.user.userId]
    );
    if (!row) return res.status(404).json({ error: 'Token not found' });
    clearExtensionTokenCache();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
