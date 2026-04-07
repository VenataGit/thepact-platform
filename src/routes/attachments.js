const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { query, queryOne, execute } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { broadcast } = require('../ws/broadcast');
const {
  attachmentFilter,
  safeStorageFilename,
  MAX_ATTACHMENT_SIZE,
} = require('../utils/upload-validator');

const ATTACHMENTS_DIR = path.join(__dirname, '..', '..', 'uploads', 'attachments');

// Ensure attachments directory exists
if (!fs.existsSync(ATTACHMENTS_DIR)) fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: ATTACHMENTS_DIR,
  filename: (req, file, cb) => cb(null, safeStorageFilename(file.originalname)),
});

const upload = multer({
  storage,
  fileFilter: attachmentFilter,
  limits: { fileSize: MAX_ATTACHMENT_SIZE },
});

// GET /api/cards/:cardId/attachments — list attachments for a card
router.get('/:cardId/attachments', requireAuth, async (req, res) => {
  try {
    const attachments = await query(
      `SELECT a.*, u.name as uploaded_by_name
       FROM attachments a
       LEFT JOIN users u ON a.uploaded_by = u.id
       WHERE a.card_id = $1
       ORDER BY a.created_at DESC`,
      [req.params.cardId]
    );
    res.json(attachments);
  } catch (err) {
    console.error('Attachments list error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/cards/:cardId/attachments — upload attachment
router.post('/:cardId/attachments', requireAuth, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      // Multer file-too-large error or fileFilter rejection
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Файлът е твърде голям (макс. 50MB)' });
      }
      return res.status(400).json({ error: err.message || 'Невалиден файл' });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });

    // Verify card exists
    const card = await queryOne('SELECT id, title FROM cards WHERE id = $1', [req.params.cardId]);
    if (!card) {
      // Cleanup orphan upload
      try { fs.unlinkSync(req.file.path); } catch (e) { console.warn('Orphan attachment cleanup failed:', e.message); }
      return res.status(404).json({ error: 'Card not found' });
    }

    const attachment = await queryOne(
      `INSERT INTO attachments (card_id, filename, mime_type, size_bytes, storage_path, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.params.cardId, req.file.originalname, req.file.mimetype,
       req.file.size, `/uploads/attachments/${req.file.filename}`, req.user.userId]
    );

    broadcast({ type: 'attachment:created', cardId: parseInt(req.params.cardId), attachment }, req.user.userId);
    res.status(201).json(attachment);
  } catch (err) {
    console.error('Attachment upload error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/cards/:cardId/attachments/:id — delete attachment
router.delete('/:cardId/attachments/:id', requireAuth, async (req, res) => {
  try {
    const attachment = await queryOne(
      'DELETE FROM attachments WHERE id = $1 AND card_id = $2 RETURNING *',
      [req.params.id, req.params.cardId]
    );
    if (!attachment) return res.status(404).json({ error: 'Attachment not found' });

    // Delete actual file
    const fullPath = path.join(__dirname, '..', '..', attachment.storage_path);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);

    broadcast({ type: 'attachment:deleted', cardId: parseInt(req.params.cardId), attachmentId: parseInt(req.params.id) }, req.user.userId);
    res.json({ ok: true });
  } catch (err) {
    console.error('Attachment delete error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
