const express = require('express');
const router = express.Router();
const { query, queryOne, execute } = require('../db/pool');
const { requireAuth, requireModerator } = require('../middleware/auth');
const { broadcast, sendToUser } = require('../ws/broadcast');

// GET /api/chat/channels — list user's channels
router.get('/channels', requireAuth, async (req, res) => {
  try {
    const channels = await query(
      `SELECT ch.*,
        (SELECT json_agg(json_build_object('id', u.id, 'name', u.name, 'avatar_url', u.avatar_url))
         FROM chat_members cm JOIN users u ON cm.user_id = u.id WHERE cm.channel_id = ch.id) as members,
        (SELECT content FROM chat_messages WHERE channel_id = ch.id ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT created_at FROM chat_messages WHERE channel_id = ch.id ORDER BY created_at DESC LIMIT 1) as last_message_at
       FROM chat_channels ch
       JOIN chat_members cm ON cm.channel_id = ch.id AND cm.user_id = $1
       ORDER BY last_message_at DESC NULLS LAST`,
      [req.user.userId]
    );
    res.json(channels);
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
        `SELECT ch.id FROM chat_channels ch
         WHERE ch.type = 'dm'
         AND EXISTS (SELECT 1 FROM chat_members WHERE channel_id = ch.id AND user_id = $1)
         AND EXISTS (SELECT 1 FROM chat_members WHERE channel_id = ch.id AND user_id = $2)`,
        [req.user.userId, member_ids[0]]
      );
      if (existing) return res.json(existing);
    }

    const channel = await queryOne(
      'INSERT INTO chat_channels (name, type, created_by) VALUES ($1, $2, $3) RETURNING *',
      [name || null, channelType, req.user.userId]
    );

    // Add creator
    await execute('INSERT INTO chat_members (channel_id, user_id) VALUES ($1, $2)', [channel.id, req.user.userId]);

    // Add other members
    if (member_ids?.length > 0) {
      for (const uid of member_ids) {
        await execute('INSERT INTO chat_members (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [channel.id, uid]);
      }
    }

    res.status(201).json(channel);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/chat/channels/:id/messages
router.get('/channels/:id/messages', requireAuth, async (req, res) => {
  try {
    // Verify user is member
    const member = await queryOne(
      'SELECT 1 FROM chat_members WHERE channel_id = $1 AND user_id = $2',
      [req.params.id, req.user.userId]
    );
    if (!member) return res.status(403).json({ error: 'Not a member' });

    const limit = parseInt(req.query.limit) || 50;
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

// POST /api/chat/channels/:id/messages
router.post('/channels/:id/messages', requireAuth, async (req, res) => {
  try {
    const { content, mentions } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Content required' });

    // Verify membership
    const member = await queryOne(
      'SELECT 1 FROM chat_members WHERE channel_id = $1 AND user_id = $2',
      [req.params.id, req.user.userId]
    );
    if (!member) return res.status(403).json({ error: 'Not a member' });

    const msg = await queryOne(
      `INSERT INTO chat_messages (channel_id, user_id, content, mentions)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.id, req.user.userId, content.trim(), JSON.stringify(mentions || [])]
    );

    const user = await queryOne('SELECT name, avatar_url FROM users WHERE id = $1', [req.user.userId]);
    msg.user_name = user.name;
    msg.user_avatar = user.avatar_url;

    // Notify all channel members
    const members = await query('SELECT user_id FROM chat_members WHERE channel_id = $1', [req.params.id]);
    for (const m of members) {
      if (m.user_id !== req.user.userId) {
        sendToUser(m.user_id, { type: 'chat:message', channelId: parseInt(req.params.id), message: msg });
      }
    }

    res.status(201).json(msg);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/chat/channels/:id/members — add member
router.post('/channels/:id/members', requireAuth, async (req, res) => {
  try {
    const { user_id } = req.body;
    await execute('INSERT INTO chat_members (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.params.id, user_id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/chat/channels/:id/members/:userId — remove member
router.delete('/channels/:id/members/:userId', requireAuth, async (req, res) => {
  try {
    await execute('DELETE FROM chat_members WHERE channel_id = $1 AND user_id = $2', [req.params.id, req.params.userId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
