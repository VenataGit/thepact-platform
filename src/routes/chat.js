const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { query, queryOne, execute } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { broadcast, sendToUser } = require('../ws/broadcast');
const { sendPushToUser } = require('../services/push');

// File uploads for chat
const CHAT_UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads', 'chat');
if (!fs.existsSync(CHAT_UPLOADS_DIR)) fs.mkdirSync(CHAT_UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: CHAT_UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } }); // 25MB

// GET /api/chat/channels — list user's channels with unread counts
router.get('/channels', requireAuth, async (req, res) => {
  try {
    const channels = await query(
      `SELECT ch.*,
        (SELECT json_agg(json_build_object('id', u.id, 'name', u.name, 'avatar_url', u.avatar_url))
         FROM chat_members cm2 JOIN users u ON cm2.user_id = u.id WHERE cm2.channel_id = ch.id) as members,
        (SELECT content FROM chat_messages WHERE channel_id = ch.id ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT user_id FROM chat_messages WHERE channel_id = ch.id ORDER BY created_at DESC LIMIT 1) as last_message_user_id,
        (SELECT u.name FROM chat_messages cm3 JOIN users u ON cm3.user_id = u.id WHERE cm3.channel_id = ch.id ORDER BY cm3.created_at DESC LIMIT 1) as last_message_user_name,
        (SELECT created_at FROM chat_messages WHERE channel_id = ch.id ORDER BY created_at DESC LIMIT 1) as last_message_at,
        (SELECT message_type FROM chat_messages WHERE channel_id = ch.id ORDER BY created_at DESC LIMIT 1) as last_message_type,
        (SELECT COUNT(*) FROM chat_messages
         WHERE channel_id = ch.id
         AND created_at > COALESCE(
           (SELECT last_read_at FROM chat_members WHERE channel_id = ch.id AND user_id = $1),
           '1970-01-01'
         )) as unread_count
       FROM chat_channels ch
       JOIN chat_members cm ON cm.channel_id = ch.id AND cm.user_id = $1
       ORDER BY COALESCE(ch.updated_at, ch.created_at) DESC NULLS LAST`,
      [req.user.userId]
    );
    res.json(channels);
  } catch (err) {
    console.error('Chat channels error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/chat/recent — channels for the Pings dropdown (Basecamp-style grid, up to 10 tiles = 5 cols × 2 rows).
// Returns the 10 most recently active channels the user is a member of.
// The full list lives on the /chat page (/api/chat/channels).
router.get('/recent', requireAuth, async (req, res) => {
  try {
    const channels = await query(
      `SELECT ch.*,
        (SELECT json_agg(json_build_object('id', u.id, 'name', u.name, 'avatar_url', u.avatar_url))
         FROM chat_members cm2 JOIN users u ON cm2.user_id = u.id WHERE cm2.channel_id = ch.id) as members,
        (SELECT COUNT(*) FROM chat_members WHERE channel_id = ch.id) as member_count,
        (SELECT content FROM chat_messages WHERE channel_id = ch.id ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT u.name FROM chat_messages cm3 JOIN users u ON cm3.user_id = u.id WHERE cm3.channel_id = ch.id ORDER BY cm3.created_at DESC LIMIT 1) as last_message_user_name,
        (SELECT created_at FROM chat_messages WHERE channel_id = ch.id ORDER BY created_at DESC LIMIT 1) as last_message_at,
        (SELECT COUNT(*) FROM chat_messages
         WHERE channel_id = ch.id
         AND created_at > COALESCE(
           (SELECT last_read_at FROM chat_members WHERE channel_id = ch.id AND user_id = $1),
           '1970-01-01'
         )) as unread_count
       FROM chat_channels ch
       JOIN chat_members cm ON cm.channel_id = ch.id AND cm.user_id = $1
       ORDER BY (SELECT MAX(created_at) FROM chat_messages WHERE channel_id = ch.id) DESC NULLS LAST,
                ch.created_at DESC
       LIMIT 10`,
      [req.user.userId]
    );
    res.json(channels);
  } catch (err) {
    console.error('Chat recent error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/chat/unread-count — total unread across all channels
router.get('/unread-count', requireAuth, async (req, res) => {
  try {
    const result = await queryOne(
      `SELECT COALESCE(SUM(cnt), 0)::int as count FROM (
        SELECT (SELECT COUNT(*) FROM chat_messages
                WHERE channel_id = ch.id
                AND created_at > COALESCE(cm.last_read_at, '1970-01-01')) as cnt
        FROM chat_channels ch
        JOIN chat_members cm ON cm.channel_id = ch.id AND cm.user_id = $1
      ) sub`,
      [req.user.userId]
    );
    res.json({ count: result.count });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/chat/channels — create channel (group or DM)
router.post('/channels', requireAuth, async (req, res) => {
  try {
    const { name, type, member_ids } = req.body;
    const channelType = type === 'dm' ? 'dm' : 'group';

    // For DMs, check if one already exists between these two users
    if (channelType === 'dm' && member_ids?.length === 1) {
      const existing = await queryOne(
        `SELECT ch.* FROM chat_channels ch
         WHERE ch.type = 'dm'
         AND EXISTS (SELECT 1 FROM chat_members WHERE channel_id = ch.id AND user_id = $1)
         AND EXISTS (SELECT 1 FROM chat_members WHERE channel_id = ch.id AND user_id = $2)`,
        [req.user.userId, member_ids[0]]
      );
      if (existing) {
        // Return full channel with members
        const members = await query(
          `SELECT u.id, u.name, u.avatar_url FROM chat_members cm JOIN users u ON cm.user_id = u.id WHERE cm.channel_id = $1`,
          [existing.id]
        );
        existing.members = members;
        return res.json(existing);
      }
    }

    const channel = await queryOne(
      'INSERT INTO chat_channels (name, type, created_by) VALUES ($1, $2, $3) RETURNING *',
      [name || null, channelType, req.user.userId]
    );

    // Add creator as admin
    await execute('INSERT INTO chat_members (channel_id, user_id, role, last_read_at) VALUES ($1, $2, $3, NOW())',
      [channel.id, req.user.userId, 'admin']);

    // Add other members
    if (member_ids?.length > 0) {
      for (const uid of member_ids) {
        await execute('INSERT INTO chat_members (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [channel.id, uid]);
      }
    }

    // Return with members
    const members = await query(
      `SELECT u.id, u.name, u.avatar_url FROM chat_members cm JOIN users u ON cm.user_id = u.id WHERE cm.channel_id = $1`,
      [channel.id]
    );
    channel.members = members;

    // Send system message for group creation
    if (channelType === 'group') {
      const creator = await queryOne('SELECT name FROM users WHERE id = $1', [req.user.userId]);
      const memberNames = members.filter(m => m.id !== req.user.userId).map(m => m.name).join(', ');
      await execute(
        `INSERT INTO chat_messages (channel_id, user_id, content, message_type) VALUES ($1, $2, $3, 'system')`,
        [channel.id, req.user.userId, `${creator.name} създаде група с ${memberNames}`]
      );
    }

    res.status(201).json(channel);
  } catch (err) {
    console.error('Chat create channel error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/chat/channels/:id — update channel (name, avatar)
router.put('/channels/:id', requireAuth, async (req, res) => {
  try {
    const { name } = req.body;
    const channel = await queryOne(
      'UPDATE chat_channels SET name = COALESCE($1, name), updated_at = NOW() WHERE id = $2 RETURNING *',
      [name, req.params.id]
    );
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    // Notify members
    const members = await query('SELECT user_id FROM chat_members WHERE channel_id = $1', [req.params.id]);
    for (const m of members) {
      sendToUser(m.user_id, { type: 'chat:channel:updated', channelId: parseInt(req.params.id), name: channel.name, avatar_url: channel.avatar_url });
    }

    // System message
    const user = await queryOne('SELECT name FROM users WHERE id = $1', [req.user.userId]);
    await execute(
      `INSERT INTO chat_messages (channel_id, user_id, content, message_type) VALUES ($1, $2, $3, 'system')`,
      [req.params.id, req.user.userId, `${user.name} преименува групата на "${name}"`]
    );
    await execute('UPDATE chat_channels SET updated_at = NOW() WHERE id = $1', [req.params.id]);

    res.json(channel);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/chat/channels/:id/avatar — upload group avatar
router.post('/channels/:id/avatar', requireAuth, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const avatarUrl = `/uploads/chat/${req.file.filename}`;
    const channel = await queryOne(
      'UPDATE chat_channels SET avatar_url = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [avatarUrl, req.params.id]
    );
    // Notify members
    const members = await query('SELECT user_id FROM chat_members WHERE channel_id = $1', [req.params.id]);
    for (const m of members) {
      sendToUser(m.user_id, { type: 'chat:channel:updated', channelId: parseInt(req.params.id), avatar_url: avatarUrl });
    }
    res.json(channel);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/chat/channels/:id/messages
router.get('/channels/:id/messages', requireAuth, async (req, res) => {
  try {
    const member = await queryOne(
      'SELECT 1 FROM chat_members WHERE channel_id = $1 AND user_id = $2',
      [req.params.id, req.user.userId]
    );
    if (!member) return res.status(403).json({ error: 'Not a member' });

    // Cap user-supplied limit to prevent DoS via huge result sets
    const rawLimit = parseInt(req.query.limit, 10);
    const limit = Math.min(Math.max(rawLimit > 0 ? rawLimit : 50, 1), 200);
    const before = req.query.before;

    let sql = `SELECT m.*, u.name as user_name, u.avatar_url as user_avatar
               FROM chat_messages m JOIN users u ON m.user_id = u.id
               WHERE m.channel_id = $1`;
    const params = [req.params.id];

    if (before) {
      sql += ` AND m.created_at < $2`;
      params.push(before);
    }

    sql += ` ORDER BY m.created_at DESC LIMIT ${limit}`;
    const messages = await query(sql, params);
    res.json(messages.reverse());
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/chat/channels/:id/messages — send message
router.post('/channels/:id/messages', requireAuth, async (req, res) => {
  try {
    const { content, mentions, message_type, attachment_url, attachment_name, attachment_mime, attachment_size } = req.body;
    const msgType = message_type || 'text';

    if (msgType === 'text' && !content?.trim()) return res.status(400).json({ error: 'Content required' });

    // Verify membership
    const member = await queryOne(
      'SELECT 1 FROM chat_members WHERE channel_id = $1 AND user_id = $2',
      [req.params.id, req.user.userId]
    );
    if (!member) return res.status(403).json({ error: 'Not a member' });

    const msg = await queryOne(
      `INSERT INTO chat_messages (channel_id, user_id, content, mentions, message_type, attachment_url, attachment_name, attachment_mime, attachment_size)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [req.params.id, req.user.userId, (content || '').trim(), JSON.stringify(mentions || []),
       msgType, attachment_url || null, attachment_name || null, attachment_mime || null, attachment_size || null]
    );

    // Update channel updated_at
    await execute('UPDATE chat_channels SET updated_at = NOW() WHERE id = $1', [req.params.id]);

    // Mark as read for sender
    await execute('UPDATE chat_members SET last_read_at = NOW() WHERE channel_id = $1 AND user_id = $2',
      [req.params.id, req.user.userId]);

    const user = await queryOne('SELECT name, avatar_url FROM users WHERE id = $1', [req.user.userId]);
    msg.user_name = user.name;
    msg.user_avatar = user.avatar_url;

    // Notify all channel members
    const members = await query('SELECT user_id FROM chat_members WHERE channel_id = $1', [req.params.id]);
    for (const m of members) {
      if (m.user_id !== req.user.userId) {
        sendToUser(m.user_id, { type: 'chat:message', channelId: parseInt(req.params.id), message: msg });
        sendPushToUser(m.user_id, {
          title: `${user.name}`,
          body: msg.body?.replace(/<[^>]*>/g, '').substring(0, 120) || 'Ново съобщение',
          tag: `chat-${req.params.id}`,
          url: `/#/chat/${req.params.id}`,
        });
      }
    }

    res.status(201).json(msg);
  } catch (err) {
    console.error('Chat send error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/chat/channels/:id/messages/:msgId — edit message
router.put('/channels/:id/messages/:msgId', requireAuth, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Content required' });

    // Verify ownership
    const msg = await queryOne('SELECT * FROM chat_messages WHERE id = $1 AND channel_id = $2', [req.params.msgId, req.params.id]);
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (msg.user_id !== req.user.userId) return res.status(403).json({ error: 'Not your message' });

    const updated = await queryOne(
      `UPDATE chat_messages SET content = $1, is_edited = true, edited_at = NOW() WHERE id = $2 RETURNING *`,
      [content.trim(), req.params.msgId]
    );

    const user = await queryOne('SELECT name, avatar_url FROM users WHERE id = $1', [req.user.userId]);
    updated.user_name = user.name;
    updated.user_avatar = user.avatar_url;

    // Notify all channel members
    const members = await query('SELECT user_id FROM chat_members WHERE channel_id = $1', [req.params.id]);
    for (const m of members) {
      sendToUser(m.user_id, { type: 'chat:message:edited', channelId: parseInt(req.params.id), message: updated });
    }

    res.json(updated);
  } catch (err) {
    console.error('Chat edit error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/chat/channels/:id/messages/:msgId — delete message
router.delete('/channels/:id/messages/:msgId', requireAuth, async (req, res) => {
  try {
    // Verify ownership
    const msg = await queryOne('SELECT * FROM chat_messages WHERE id = $1 AND channel_id = $2', [req.params.msgId, req.params.id]);
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (msg.user_id !== req.user.userId) return res.status(403).json({ error: 'Not your message' });

    await execute('DELETE FROM chat_messages WHERE id = $1', [req.params.msgId]);

    // Notify all channel members
    const members = await query('SELECT user_id FROM chat_members WHERE channel_id = $1', [req.params.id]);
    for (const m of members) {
      sendToUser(m.user_id, { type: 'chat:message:deleted', channelId: parseInt(req.params.id), messageId: parseInt(req.params.msgId) });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Chat delete error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/chat/channels/:id/upload — upload file to chat
router.post('/channels/:id/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const fileUrl = `/uploads/chat/${req.file.filename}`;
    res.json({
      url: fileUrl,
      name: req.file.originalname,
      mime: req.file.mimetype,
      size: req.file.size
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/chat/channels/:id/read — mark channel as read
router.put('/channels/:id/read', requireAuth, async (req, res) => {
  try {
    await execute('UPDATE chat_members SET last_read_at = NOW() WHERE channel_id = $1 AND user_id = $2',
      [req.params.id, req.user.userId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/chat/channels/:id/members — add member
router.post('/channels/:id/members', requireAuth, async (req, res) => {
  try {
    const { user_id } = req.body;
    await execute('INSERT INTO chat_members (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.params.id, user_id]);

    const user = await queryOne('SELECT id, name, avatar_url FROM users WHERE id = $1', [user_id]);
    const adder = await queryOne('SELECT name FROM users WHERE id = $1', [req.user.userId]);

    // System message
    await queryOne(
      `INSERT INTO chat_messages (channel_id, user_id, content, message_type) VALUES ($1, $2, $3, 'system') RETURNING *`,
      [req.params.id, req.user.userId, `${adder.name} добави ${user.name} в групата`]
    );
    await execute('UPDATE chat_channels SET updated_at = NOW() WHERE id = $1', [req.params.id]);

    // Notify members
    const members = await query('SELECT user_id FROM chat_members WHERE channel_id = $1', [req.params.id]);
    for (const m of members) {
      sendToUser(m.user_id, { type: 'chat:member:added', channelId: parseInt(req.params.id), user });
    }

    res.json({ ok: true, user });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/chat/channels/:id/members/:userId — remove member
router.delete('/channels/:id/members/:userId', requireAuth, async (req, res) => {
  try {
    const removed = await queryOne('SELECT name FROM users WHERE id = $1', [req.params.userId]);
    const remover = await queryOne('SELECT name FROM users WHERE id = $1', [req.user.userId]);

    await execute('DELETE FROM chat_members WHERE channel_id = $1 AND user_id = $2',
      [req.params.id, req.params.userId]);

    // System message
    const msg = req.user.userId === parseInt(req.params.userId)
      ? `${removed.name} напусна групата`
      : `${remover.name} премахна ${removed.name} от групата`;
    await queryOne(
      `INSERT INTO chat_messages (channel_id, user_id, content, message_type) VALUES ($1, $2, $3, 'system') RETURNING *`,
      [req.params.id, req.user.userId, msg]
    );
    await execute('UPDATE chat_channels SET updated_at = NOW() WHERE id = $1', [req.params.id]);

    // Notify
    const members = await query('SELECT user_id FROM chat_members WHERE channel_id = $1', [req.params.id]);
    for (const m of members) {
      sendToUser(m.user_id, { type: 'chat:member:removed', channelId: parseInt(req.params.id), userId: parseInt(req.params.userId) });
    }
    sendToUser(parseInt(req.params.userId), { type: 'chat:member:removed', channelId: parseInt(req.params.id), userId: parseInt(req.params.userId) });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/chat/gif-search — proxy GIF search (Giphy API)
router.get('/gif-search', requireAuth, async (req, res) => {
  try {
    const q = req.query.q || '';
    const apiKey = process.env.GIPHY_API_KEY || 'GlVGYHkr3WSBnllca54iNt0yFbjz7L65';
    const endpoint = q
      ? `https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=${encodeURIComponent(q)}&limit=20&rating=g&lang=bg`
      : `https://api.giphy.com/v1/gifs/trending?api_key=${apiKey}&limit=20&rating=g`;

    const response = await fetch(endpoint);
    const data = await response.json();

    const results = (data.data || []).map(g => ({
      id: g.id,
      title: g.title || '',
      url: g.images?.original?.url || g.images?.downsized?.url || '',
      preview: g.images?.fixed_width_small?.url || g.images?.fixed_width?.url || g.images?.preview_gif?.url || '',
      width: parseInt(g.images?.original?.width) || 0,
      height: parseInt(g.images?.original?.height) || 0
    }));

    res.json({ results });
  } catch (err) {
    console.error('[gif-search]', err.message);
    res.status(500).json({ error: 'GIF search failed', results: [] });
  }
});

module.exports = router;
