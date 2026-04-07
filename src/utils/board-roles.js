// Resolve "well-known" boards by either:
//   1. Settings key (preferred — survives renames)
//   2. Title match fallback (legacy — works on fresh installs that haven't set the flag yet)
//
// Cache results for 60 seconds to avoid querying settings on every card move.

const { query, queryOne } = require('../db/pool');

const CACHE_TTL_MS = 60 * 1000;
let _postProdCache = { value: null, fetchedAt: 0 };

/**
 * Returns the board ID that represents "Post-Production" (where cards land
 * when ready for editing, and which triggers Google Calendar sync).
 *
 * Resolution order:
 *   1. settings.post_production_board_id  (admin-configurable)
 *   2. boards.title ILIKE 'post-production'  (fallback for fresh installs)
 *
 * Returns null if neither is found.
 */
async function getPostProductionBoardId() {
  const now = Date.now();
  if (_postProdCache.value !== null && now - _postProdCache.fetchedAt < CACHE_TTL_MS) {
    return _postProdCache.value;
  }

  // 1. Settings override
  try {
    const setting = await queryOne(
      "SELECT value FROM settings WHERE key = 'post_production_board_id'"
    );
    if (setting?.value) {
      const id = parseInt(setting.value, 10);
      if (id > 0) {
        _postProdCache = { value: id, fetchedAt: now };
        return id;
      }
    }
  } catch (e) {
    console.warn('[board-roles] settings lookup failed:', e.message);
  }

  // 2. Title fallback
  try {
    const board = await queryOne(
      "SELECT id FROM boards WHERE LOWER(title) = 'post-production' LIMIT 1"
    );
    if (board) {
      _postProdCache = { value: board.id, fetchedAt: now };
      return board.id;
    }
  } catch (e) {
    console.warn('[board-roles] title fallback failed:', e.message);
  }

  _postProdCache = { value: null, fetchedAt: now };
  return null;
}

/** Invalidate the cache (call after admin updates the setting) */
function clearBoardRoleCache() {
  _postProdCache = { value: null, fetchedAt: 0 };
}

module.exports = { getPostProductionBoardId, clearBoardRoleCache };
