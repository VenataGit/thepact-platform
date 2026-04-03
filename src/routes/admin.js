const express = require('express');
const router = express.Router();
const { query, queryOne, execute } = require('../db/pool');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// GET /api/settings — get all settings
router.get('/', requireAuth, async (req, res) => {
  try {
    const settings = await query('SELECT key, value, updated_at FROM settings ORDER BY key');
    // Return as key-value object for convenience
    const obj = {};
    for (const s of settings) obj[s.key] = s.value;
    res.json({ settings: obj, rows: settings });
  } catch (err) {
    console.error('Settings list error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/settings/:key — update a setting (admin only)
router.put('/:key', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { value } = req.body;
    if (value === undefined || value === null) return res.status(400).json({ error: 'Value required' });

    const setting = await queryOne(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
       RETURNING *`,
      [req.params.key, String(value)]
    );

    res.json(setting);
  } catch (err) {
    console.error('Settings update error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
