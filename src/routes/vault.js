const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { query, queryOne, execute } = require('../db/pool');
const { requireAuth, requireModerator } = require('../middleware/auth');

const VAULT_DIR = path.join(__dirname, '..', '..', 'uploads', 'vault');

// Ensure vault directory exists
if (!fs.existsSync(VAULT_DIR)) fs.mkdirSync(VAULT_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: VAULT_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB

// GET /api/vault/folders
// ?parent_id=X — browse subfolder
// ?board_id=X — browse docs board root (finds root folder by board_id)
router.get('/folders', requireAuth, async (req, res) => {
  try {
    const parentId = req.query.parent_id || null;
    const boardId = req.query.board_id || null;

    let rootFolderId = parentId;

    // For docs boards: find the root folder by board_id
    if (!parentId && boardId) {
      const root = await queryOne(
        'SELECT id FROM vault_folders WHERE board_id = $1 AND parent_id IS NULL',
        [boardId]
      );
      if (root) rootFolderId = root.id;
      else return res.json({ folders: [], files: [], current_folder: null });
    }

    const folders = await query(
      rootFolderId
        ? 'SELECT * FROM vault_folders WHERE parent_id = $1 ORDER BY name'
        : 'SELECT * FROM vault_folders WHERE parent_id IS NULL AND board_id IS NULL ORDER BY name',
      rootFolderId ? [rootFolderId] : []
    );
    const files = await query(
      rootFolderId
        ? 'SELECT * FROM vault_files WHERE folder_id = $1 ORDER BY created_at DESC'
        : 'SELECT * FROM vault_files WHERE folder_id IS NULL ORDER BY created_at DESC',
      rootFolderId ? [rootFolderId] : []
    );
    let current_folder = null;
    if (rootFolderId) {
      current_folder = await queryOne('SELECT * FROM vault_folders WHERE id = $1', [rootFolderId]);
    }
    res.json({ folders, files, current_folder });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/vault/folders
router.post('/folders', requireAuth, requireModerator, async (req, res) => {
  try {
    const { name, parent_id } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    const folder = await queryOne(
      'INSERT INTO vault_folders (name, parent_id, created_by) VALUES ($1, $2, $3) RETURNING *',
      [name.trim(), parent_id || null, req.user.userId]
    );
    res.status(201).json(folder);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/vault/upload
router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const folderId = req.body.folder_id || null;
    const file = await queryOne(
      `INSERT INTO vault_files (folder_id, filename, original_name, mime_type, size_bytes, storage_path, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [folderId, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size,
       `/uploads/vault/${req.file.filename}`, req.user.userId]
    );
    res.status(201).json(file);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/vault/files/:id/preview - inline preview / download
router.get('/files/:id/preview', requireAuth, async (req, res) => {
  try {
    const file = await queryOne('SELECT * FROM vault_files WHERE id = $1', [req.params.id]);
    if (!file) return res.status(404).json({ error: 'File not found' });

    const mime = (file.mime_type || '').toLowerCase();

    // Images and PDFs: serve inline
    if (mime.startsWith('image/') || mime === 'application/pdf') {
      const fullPath = path.join(__dirname, '..', '..', file.storage_path);
      if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'File missing from disk' });
      res.setHeader('Content-Type', file.mime_type);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.original_name)}"`);
      return fs.createReadStream(fullPath).pipe(res);
    }

    // Everything else: redirect to storage path for download
    res.redirect(file.storage_path);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/vault/files/:id
router.delete('/files/:id', requireAuth, async (req, res) => {
  try {
    const file = await queryOne('DELETE FROM vault_files WHERE id = $1 RETURNING *', [req.params.id]);
    if (!file) return res.status(404).json({ error: 'File not found' });
    // Delete actual file
    const fullPath = path.join(__dirname, '..', '..', file.storage_path);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/vault/folders/:id
router.delete('/folders/:id', requireAuth, requireModerator, async (req, res) => {
  try {
    await execute('DELETE FROM vault_folders WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
