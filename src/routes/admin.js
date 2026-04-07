const express = require('express');
const router = express.Router();
const { query, queryOne, execute } = require('../db/pool');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// Settings keys that may contain secrets — never returned to non-admins.
// Match anything containing one of these substrings (case-insensitive).
const SENSITIVE_KEY_PATTERNS = [
  'secret', 'password', 'pass', 'token', 'api_key', 'apikey',
  'private', 'credential', 'webhook_url', 'smtp', 'jwt',
];

function isSensitiveKey(key) {
  const k = (key || '').toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some(p => k.includes(p));
}

// GET /api/settings — get all settings.
// Non-admins see everything EXCEPT keys matching sensitive patterns
// (secrets, tokens, passwords). Admins see everything.
router.get('/', requireAuth, async (req, res) => {
  try {
    const settings = await query('SELECT key, value, updated_at FROM settings ORDER BY key');
    const isAdmin = req.user?.role === 'admin';

    const filteredRows = isAdmin
      ? settings
      : settings.filter(s => !isSensitiveKey(s.key));

    const obj = {};
    for (const s of filteredRows) obj[s.key] = s.value;
    res.json({ settings: obj, rows: filteredRows });
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

// POST /api/settings/daily-report/trigger — manually trigger daily report (admin)
router.post('/daily-report/trigger', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { generateAndPostDailyReport } = require('../services/daily-report');
    const s = await queryOne("SELECT value FROM settings WHERE key = 'daily_report_room_id'");
    const roomId = parseInt(s?.value) || 1;
    await generateAndPostDailyReport(roomId);
    res.json({ ok: true });
  } catch (err) {
    console.error('Daily report trigger error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings/google-calendar/test — test Google Calendar connection (admin)
router.post('/google-calendar/test', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { google } = require('googleapis');
    const path = require('path');
    const fs = require('fs');
    const { resetCache } = require('../services/google-calendar');

    // Reset cache so it picks up latest settings
    resetCache();

    const credentialsPath = path.join(__dirname, '..', '..', 'google-credentials.json');
    if (!fs.existsSync(credentialsPath)) {
      return res.json({ ok: false, error: 'google-credentials.json файлът не е намерен на сървъра' });
    }

    // Get calendar ID from settings or env
    let calId = process.env.GOOGLE_CALENDAR_ID;
    if (!calId) {
      const setting = await queryOne("SELECT value FROM settings WHERE key = 'google_calendar_id'");
      calId = setting?.value;
    }
    if (!calId) {
      return res.json({ ok: false, error: 'Calendar ID не е конфигуриран' });
    }

    const auth = new google.auth.GoogleAuth({
      keyFile: credentialsPath,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });
    const calendar = google.calendar({ version: 'v3', auth });

    // Try to get calendar info
    const calInfo = await calendar.calendars.get({ calendarId: calId });
    res.json({ ok: true, calendarName: calInfo.data.summary });
  } catch (err) {
    console.error('Google Calendar test error:', err.message);
    res.json({ ok: false, error: err.message });
  }
});

module.exports = router;
