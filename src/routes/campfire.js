const express = require('express');
const router = express.Router();
const { query, queryOne, execute } = require('../db/pool');
const { requireAuth, requireModerator } = require('../middleware/auth');
const { broadcast, sendToUser } = require('../ws/broadcast');

// GET /api/campfire/rooms — list all campfire rooms
router.get('/rooms', requireAuth, async (req, res) => {
  try {
    const rooms = await query(
      `SELECT r.*,
        (SELECT COUNT(*) FROM campfire_members WHERE room_id = r.id) as member_count,
        (SELECT content FROM campfire_messages WHERE room_id = r.id ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT created_at FROM campfire_messages WHERE room_id = r.id ORDER BY created_at DESC LIMIT 1) as last_message_at
       FROM campfire_rooms r
       ORDER BY last_message_at DESC NULLS LAST`
    );
    res.json(rooms);
  } catch (err) {
    console.error('Campfire rooms list error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/campfire/rooms/:id/messages — paginated messages
router.get('/rooms/:id/messages', requireAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const before = req.query.before;

    let sql = `SELECT m.*, u.name as user_name, u.avatar_url as user_avatar
               FROM campfire_messages m
               JOIN users u ON m.user_id = u.id
               WHERE m.room_id = $1`;
    const params = [req.params.id];

    if (before) {
      sql += ` AND m.created_at < $2`;
      params.push(before);
    }

    sql += ` ORDER BY m.created_at DESC LIMIT ${limit}`;
    const messages = await query(sql, params);
    res.json(messages.reverse());
  } catch (err) {
    console.error('Campfire messages error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/campfire/rooms/:id/messages — send message
router.post('/rooms/:id/messages', requireAuth, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Content required' });

    // Verify room exists
    const room = await queryOne('SELECT id FROM campfire_rooms WHERE id = $1', [req.params.id]);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const msg = await queryOne(
      `INSERT INTO campfire_messages (room_id, user_id, content)
       VALUES ($1, $2, $3) RETURNING *`,
      [req.params.id, req.user.userId, content.trim()]
    );

    const user = await queryOne('SELECT name, avatar_url FROM users WHERE id = $1', [req.user.userId]);
    msg.user_name = user.name;
    msg.user_avatar = user.avatar_url;

    broadcast({ type: 'campfire:message', roomId: parseInt(req.params.id), message: msg }, req.user.userId);
    res.status(201).json(msg);
  } catch (err) {
    console.error('Campfire send error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/campfire/rooms — create room (moderator+)
router.post('/rooms', requireAuth, requireModerator, async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });

    const room = await queryOne(
      'INSERT INTO campfire_rooms (name) VALUES ($1) RETURNING *',
      [name.trim()]
    );

    // Add creator as member
    await execute('INSERT INTO campfire_members (room_id, user_id) VALUES ($1, $2)', [room.id, req.user.userId]);

    broadcast({ type: 'campfire:room_created', room }, req.user.userId);
    res.status(201).json(room);
  } catch (err) {
    console.error('Campfire room create error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
