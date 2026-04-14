const express = require('express');
const router = express.Router();
const { query, queryOne, execute } = require('../db/pool');
const { requireAuth, requireMiniAdmin } = require('../middleware/auth');

// GET /api/positions — list all positions (any authenticated user)
router.get('/', requireAuth, async (req, res) => {
  try {
    const positions = await query(
      `SELECT p.id, p.name, p.description, p.created_at,
              COUNT(u.id)::int AS user_count
       FROM positions p
       LEFT JOIN users u ON u.position_id = p.id AND u.is_active = TRUE
       GROUP BY p.id
       ORDER BY p.name`
    );
    res.json(positions);
  } catch (err) {
    console.error('Positions list error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/positions/:id — get position with permissions
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const position = await queryOne('SELECT id, name, description, created_at FROM positions WHERE id = $1', [req.params.id]);
    if (!position) return res.status(404).json({ error: 'Position not found' });

    const permissions = await query(
      'SELECT id, permission_key FROM position_permissions WHERE position_id = $1 ORDER BY permission_key',
      [req.params.id]
    );
    position.permissions = permissions.map(p => p.permission_key);
    res.json(position);
  } catch (err) {
    console.error('Position detail error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/positions — create position (mini_admin+)
router.post('/', requireAuth, requireMiniAdmin, async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });

    const existing = await queryOne('SELECT id FROM positions WHERE name = $1', [name.trim()]);
    if (existing) return res.status(409).json({ error: 'Position already exists' });

    const position = await queryOne(
      'INSERT INTO positions (name, description) VALUES ($1, $2) RETURNING id, name, description, created_at',
      [name.trim(), description || '']
    );
    res.status(201).json(position);
  } catch (err) {
    console.error('Position create error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/positions/:id — update position (mini_admin+)
router.put('/:id', requireAuth, requireMiniAdmin, async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });

    const position = await queryOne(
      'UPDATE positions SET name = $1, description = $2 WHERE id = $3 RETURNING id, name, description, created_at',
      [name.trim(), description || '', req.params.id]
    );
    if (!position) return res.status(404).json({ error: 'Position not found' });
    res.json(position);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Position name already exists' });
    console.error('Position update error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/positions/:id — delete position (mini_admin+)
router.delete('/:id', requireAuth, requireMiniAdmin, async (req, res) => {
  try {
    const result = await queryOne('DELETE FROM positions WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result) return res.status(404).json({ error: 'Position not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Position delete error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/positions/:id/permissions — set permissions for position (mini_admin+)
router.put('/:id/permissions', requireAuth, requireMiniAdmin, async (req, res) => {
  try {
    const { permissions } = req.body;
    if (!Array.isArray(permissions)) return res.status(400).json({ error: 'permissions array required' });

    const position = await queryOne('SELECT id FROM positions WHERE id = $1', [req.params.id]);
    if (!position) return res.status(404).json({ error: 'Position not found' });

    // Delete existing and insert new
    await execute('DELETE FROM position_permissions WHERE position_id = $1', [req.params.id]);

    for (const key of permissions) {
      if (key && key.trim()) {
        await execute(
          'INSERT INTO position_permissions (position_id, permission_key) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [req.params.id, key.trim()]
        );
      }
    }

    const updated = await query(
      'SELECT permission_key FROM position_permissions WHERE position_id = $1 ORDER BY permission_key',
      [req.params.id]
    );
    res.json({ permissions: updated.map(p => p.permission_key) });
  } catch (err) {
    console.error('Position permissions error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
