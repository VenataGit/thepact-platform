const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { query, queryOne, execute } = require('../db/pool');
const { requireAuth, requireModerator } = require('../middleware/auth');
const { broadcast } = require('../ws/broadcast');

// GET /api/boards — all boards with columns (excludes archived unless ?archived=1)
router.get('/', requireAuth, async (req, res) => {
  try {
    const showArchived = req.query.archived === '1';
    const boards = await query(
      showArchived
        ? 'SELECT * FROM boards WHERE archived_at IS NOT NULL ORDER BY archived_at DESC'
        : 'SELECT * FROM boards WHERE archived_at IS NULL ORDER BY position'
    );
    const columns = await query('SELECT * FROM columns ORDER BY board_id, position');

    const result = boards.map(b => ({
      ...b,
      columns: columns.filter(c => c.board_id === b.id)
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/boards/columns/:id — single column info (for column permalink view)
router.get('/columns/:id', requireAuth, async (req, res) => {
  try {
    const col = await queryOne(
      `SELECT c.*, b.title as board_title FROM columns c JOIN boards b ON c.board_id = b.id WHERE c.id = $1`,
      [req.params.id]
    );
    if (!col) return res.status(404).json({ error: 'Column not found' });
    res.json(col);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/boards/reorder — reorder boards globally (mod/admin only).
// Body: { order: [boardId1, boardId2, ...] }
// The new position of each board is its index in the array.
// Broadcasts boards:reordered to all clients via WebSocket.
router.put('/reorder', requireAuth, requireModerator, async (req, res) => {
  try {
    const { order } = req.body || {};
    if (!Array.isArray(order) || order.length === 0) {
      return res.status(400).json({ error: 'Body must include { order: [boardId, ...] }' });
    }

    // Validate all entries are positive integers
    const ids = order.map(x => parseInt(x, 10));
    if (ids.some(id => !Number.isInteger(id) || id <= 0)) {
      return res.status(400).json({ error: 'All board IDs must be positive integers' });
    }

    // Verify every ID exists and is not archived (so reorder can't resurrect archived boards)
    const existing = await query(
      'SELECT id FROM boards WHERE id = ANY($1) AND archived_at IS NULL',
      [ids]
    );
    if (existing.length !== ids.length) {
      return res.status(400).json({ error: 'One or more board IDs are invalid or archived' });
    }

    // Update positions in a single transaction-like batch.
    // Using CASE so we do it in one query (no round-trip per board).
    // Convert array to (id, pos) pairs for the CASE expression.
    const cases = ids.map((id, i) => `WHEN ${id} THEN ${i}`).join(' ');
    await execute(
      `UPDATE boards SET position = CASE id ${cases} END, updated_at = NOW() WHERE id = ANY($1)`,
      [ids]
    );

    // Broadcast to ALL clients (including the sender — no excludeUserId).
    // Frontend re-fetches /api/boards on receipt to pick up the new order.
    broadcast({ type: 'boards:reordered', order: ids });

    res.json({ ok: true, order: ids });
  } catch (err) {
    console.error('[boards] reorder error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/boards/:id — single board with columns
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const board = await queryOne('SELECT * FROM boards WHERE id = $1', [req.params.id]);
    if (!board) return res.status(404).json({ error: 'Board not found' });
    const columns = await query('SELECT * FROM columns WHERE board_id = $1 ORDER BY position', [req.params.id]);
    res.json({ ...board, columns });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/boards — create board (type: 'board' or 'docs')
router.post('/', requireAuth, requireModerator, async (req, res) => {
  try {
    const { title, color, type } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });
    const boardType = (type === 'docs') ? 'docs' : 'board';
    const maxPos = await queryOne('SELECT COALESCE(MAX(position), -1) + 1 as pos FROM boards');
    const board = await queryOne(
      'INSERT INTO boards (title, color, position, type) VALUES ($1, $2, $3, $4) RETURNING *',
      [title, color || null, maxPos.pos, boardType]
    );

    // For docs boards, auto-create a root vault folder
    if (boardType === 'docs') {
      await queryOne(
        'INSERT INTO vault_folders (name, parent_id, board_id, created_by) VALUES ($1, NULL, $2, $3) RETURNING *',
        [title, board.id, req.user.userId]
      );
    }

    // For regular boards, auto-create a Done column
    if (boardType === 'board') {
      await queryOne(
        'INSERT INTO columns (board_id, title, position, is_done_column) VALUES ($1, $2, 0, TRUE) RETURNING *',
        [board.id, 'Done']
      );
    }

    broadcast({ type: 'board:created', board }, req.user.userId);
    res.status(201).json(board);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/boards/:id — update board
router.put('/:id', requireAuth, requireModerator, async (req, res) => {
  try {
    const { title, color, position } = req.body;
    const board = await queryOne(
      'UPDATE boards SET title = COALESCE($1, title), color = COALESCE($2, color), position = COALESCE($3, position), updated_at = NOW() WHERE id = $4 RETURNING *',
      [title, color, position, req.params.id]
    );
    if (!board) return res.status(404).json({ error: 'Board not found' });
    broadcast({ type: 'board:updated', board }, req.user.userId);
    res.json(board);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/boards/:id/archive — archive board
router.put('/:id/archive', requireAuth, requireModerator, async (req, res) => {
  try {
    const board = await queryOne(
      'UPDATE boards SET archived_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    if (!board) return res.status(404).json({ error: 'Board not found' });
    broadcast({ type: 'board:archived', boardId: board.id }, req.user.userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/boards/:id/unarchive — restore archived board
router.put('/:id/unarchive', requireAuth, requireModerator, async (req, res) => {
  try {
    const board = await queryOne(
      'UPDATE boards SET archived_at = NULL, updated_at = NOW() WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    if (!board) return res.status(404).json({ error: 'Board not found' });
    broadcast({ type: 'board:unarchived', boardId: board.id }, req.user.userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/boards/:id — delete board (and all columns/cards cascade)
router.delete('/:id', requireAuth, requireModerator, async (req, res) => {
  try {
    const boardId = parseInt(req.params.id, 10);
    if (!Number.isInteger(boardId) || boardId <= 0) {
      return res.status(400).json({ error: 'Invalid board id' });
    }

    // Look up the board first so we know its type (kanban vs docs)
    const board = await queryOne('SELECT * FROM boards WHERE id = $1', [boardId]);
    if (!board) return res.status(404).json({ error: 'Board not found' });

    // === DOCS BOARDS: clean up vault items BEFORE deleting the board ===
    // vault_folders has ON DELETE CASCADE, but vault_files and vault_documents
    // have ON DELETE SET NULL — without explicit cleanup they become orphaned
    // rows + files on disk that never get reclaimed.
    if (board.type === 'docs') {
      // 1) Collect all folder IDs belonging to this board (root + subfolders)
      const folderRows = await query(
        'SELECT id FROM vault_folders WHERE board_id = $1',
        [boardId]
      );
      const folderIds = folderRows.map(r => r.id);

      if (folderIds.length > 0) {
        // 2) Fetch file paths so we can delete them from disk after the DB cleanup
        const fileRows = await query(
          'SELECT storage_path FROM vault_files WHERE folder_id = ANY($1)',
          [folderIds]
        );

        // 3) Delete DB rows in dependency order
        await execute('DELETE FROM vault_documents WHERE folder_id = ANY($1)', [folderIds]);
        await execute('DELETE FROM vault_files WHERE folder_id = ANY($1)', [folderIds]);
        // vault_folders will cascade-delete on board removal

        // 4) Remove physical files from disk (best-effort, don't fail if missing)
        const uploadsRoot = path.join(__dirname, '..', '..');
        fileRows.forEach(f => {
          if (!f.storage_path) return;
          try {
            // storage_path is stored as "/uploads/vault/XXXX" — strip leading slash
            const filePath = path.join(uploadsRoot, f.storage_path.replace(/^\/+/, ''));
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          } catch (e) {
            console.warn('[boards] failed to delete vault file on disk:', f.storage_path, e.message);
          }
        });
      }
    }

    // Finally delete the board. Columns & vault_folders cascade via FK.
    const deleted = await queryOne('DELETE FROM boards WHERE id = $1 RETURNING *', [boardId]);
    if (!deleted) return res.status(404).json({ error: 'Board not found' });

    broadcast({ type: 'board:deleted', boardId: deleted.id }, req.user.userId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[boards] delete error:', err.message);
    // Foreign key violation on cards (kanban boards with cards can't be deleted)
    if (err.code === '23503') {
      return res.status(409).json({ error: 'Бордът има свързани карти. Първо ги изтрийте или преместете.' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/boards/:id/columns — add column
router.post('/:id/columns', requireAuth, requireModerator, async (req, res) => {
  try {
    const { title, is_done_column } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });
    const maxPos = await queryOne(
      'SELECT COALESCE(MAX(position), -1) + 1 as pos FROM columns WHERE board_id = $1',
      [req.params.id]
    );
    const col = await queryOne(
      'INSERT INTO columns (board_id, title, position, is_done_column) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.params.id, title, maxPos.pos, is_done_column || false]
    );
    broadcast({ type: 'column:created', column: col, boardId: parseInt(req.params.id) }, req.user.userId);
    res.status(201).json(col);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/boards/:boardId/columns/:colId — update column
router.put('/:boardId/columns/:colId', requireAuth, requireModerator, async (req, res) => {
  try {
    const { title, position, is_done_column, wip_limit } = req.body;
    const col = await queryOne(
      `UPDATE columns SET title = COALESCE($1, title), position = COALESCE($2, position),
       is_done_column = COALESCE($3, is_done_column), wip_limit = COALESCE($4, wip_limit), updated_at = NOW()
       WHERE id = $5 AND board_id = $6 RETURNING *`,
      [title, position, is_done_column, wip_limit, req.params.colId, req.params.boardId]
    );
    if (!col) return res.status(404).json({ error: 'Column not found' });
    broadcast({ type: 'column:updated', column: col, boardId: parseInt(req.params.boardId) }, req.user.userId);
    res.json(col);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/boards/:boardId/columns/:colId — delete column
router.delete('/:boardId/columns/:colId', requireAuth, requireModerator, async (req, res) => {
  try {
    const { colId, boardId } = req.params;
    // Delete all cards in this column (cascades to steps, assignees, events, time_entries)
    await execute('DELETE FROM cards WHERE column_id = $1', [colId]);
    // Null out remaining column references in card_events (from other cards' history)
    await execute('UPDATE card_events SET from_column_id = NULL WHERE from_column_id = $1', [colId]);
    await execute('UPDATE card_events SET to_column_id = NULL WHERE to_column_id = $1', [colId]);
    const col = await queryOne(
      'DELETE FROM columns WHERE id = $1 AND board_id = $2 RETURNING *',
      [colId, boardId]
    );
    if (!col) return res.status(404).json({ error: 'Column not found' });
    broadcast({ type: 'column:deleted', columnId: col.id, boardId: parseInt(boardId) }, req.user.userId);
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete column error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
