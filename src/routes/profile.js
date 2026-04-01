const express = require('express');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const router = express.Router();
const { queryOne, execute } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const config = require('../config');

// Avatar upload config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', '..', 'uploads', 'avatars');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `user-${req.user.userId}-${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'));
  }
});

// GET /api/profile — current user profile
router.get('/', requireAuth, async (req, res) => {
  const user = await queryOne(
    'SELECT id, email, name, avatar_url, role, created_at, last_login_at FROM users WHERE id = $1',
    [req.user.userId]
  );
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// PUT /api/profile — update name
router.put('/', requireAuth, async (req, res) => {
  const { name } = req.body;
  if (!name || name.trim().length < 2) return res.status(400).json({ error: 'Name must be at least 2 characters' });
  const user = await queryOne(
    'UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING id, name, email, avatar_url, role',
    [name.trim(), req.user.userId]
  );
  res.json(user);
});

// POST /api/profile/avatar — upload avatar
router.post('/avatar', requireAuth, upload.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const avatarUrl = `/uploads/avatars/${req.file.filename}`;

  // Delete old avatar file if exists
  const old = await queryOne('SELECT avatar_url FROM users WHERE id = $1', [req.user.userId]);
  if (old?.avatar_url?.startsWith('/uploads/')) {
    const oldPath = path.join(__dirname, '..', '..', old.avatar_url);
    try { fs.unlinkSync(oldPath); } catch {}
  }

  const user = await queryOne(
    'UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2 RETURNING id, name, email, avatar_url, role',
    [avatarUrl, req.user.userId]
  );
  res.json(user);
});

// POST /api/profile/password — change password
router.post('/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const user = await queryOne('SELECT password_hash FROM users WHERE id = $1', [req.user.userId]);
  const match = await bcrypt.compare(currentPassword, user.password_hash);
  if (!match) return res.status(401).json({ error: 'Current password is incorrect' });

  const hash = await bcrypt.hash(newPassword, config.BCRYPT_ROUNDS);
  await execute('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, req.user.userId]);
  res.json({ ok: true });
});

module.exports = router;
