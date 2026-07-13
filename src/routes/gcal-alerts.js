// Админ API за „Календар известия" (Google Calendar → Basecamp Message Board).
// Всичко тук е admin-only — конфигурира се от новия панел Настройки.
const express = require('express');
const router = express.Router();
const { query, queryOne, execute } = require('../db/pool');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getServiceAccountEmail } = require('../services/google-calendar');
const { checkCalendarAccess, postTestMessage, syncAllFeeds, refreshBcPeople } = require('../services/gcal-alerts');
const { normalizeAppUrl } = require('../services/basecamp');

// Приема суров Calendar ID ("xxx@group.calendar.google.com") или embed/share линк с ?src=.
function parseCalendarInput(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) {
    try {
      const src = new URL(s).searchParams.get('src');
      return src || null;
    } catch { return null; }
  }
  return s.includes('@') ? s : null;
}

// "https://3.basecamp.com/{acc}/buckets/{project}/message_boards/{board}" → ids.
function parseBoardUrl(url) {
  const m = String(url || '').match(/buckets\/(\d+)\/message_boards\/(\d+)/);
  return m ? { project: m[1], board: m[2] } : null;
}

async function loadFeeds() {
  const feeds = await query('SELECT * FROM gcal_feeds ORDER BY id');
  const resp = await query('SELECT feed_id, bc_person_id FROM gcal_feed_responsibles');
  for (const f of feeds) {
    f.responsibles = resp.filter((r) => r.feed_id === f.id).map((r) => String(r.bc_person_id));
    delete f.sync_token;
  }
  return feeds;
}

// GET /api/gcal-alerts/overview — всичко за админ секцията с една заявка.
// Екипът идва от bc_people (кеш на хората от Video Production в Basecamp);
// при празен кеш се тегли на момента, за да не чака никой да се логва.
router.get('/overview', requireAuth, requireAdmin, async (req, res) => {
  try {
    const rows = await query("SELECT key, value FROM settings WHERE key LIKE 'gcal_alerts_%'");
    const s = {};
    for (const r of rows) s[r.key] = r.value;

    let team = await query('SELECT * FROM bc_people WHERE active = TRUE ORDER BY name');
    if (!team.length) {
      try {
        await refreshBcPeople();
        team = await query('SELECT * FROM bc_people WHERE active = TRUE ORDER BY name');
      } catch (err) {
        console.warn('[gcal-alerts] first people load failed:', err.message);
      }
    }
    const syncedRow = await queryOne('SELECT MAX(synced_at) AS at FROM bc_people');
    const personMap = await query(
      `SELECT m.google_email, m.bc_person_id, p.name AS person_name
       FROM gcal_person_map m LEFT JOIN bc_people p ON p.person_id = m.bc_person_id
       ORDER BY m.google_email`
    );
    res.json({
      saEmail: getServiceAccountEmail(),
      enabled: s.gcal_alerts_enabled === 'true',
      pingCampfire: s.gcal_alerts_ping_campfire !== 'false',
      boardUrl: s.gcal_alerts_bc_board_url || '',
      project: s.gcal_alerts_bc_project || '',
      board: s.gcal_alerts_bc_board || '',
      feeds: await loadFeeds(),
      team,
      peopleSyncedAt: syncedRow ? syncedRow.at : null,
      personMap,
    });
  } catch (err) {
    console.error('[gcal-alerts] overview error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/gcal-alerts/refresh-people — ръчно обновяване на екипа от Basecamp.
router.post('/refresh-people', requireAuth, requireAdmin, async (req, res) => {
  try {
    const count = await refreshBcPeople();
    res.json({ ok: true, count });
  } catch (err) {
    console.error('[gcal-alerts] refresh people error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/gcal-alerts/config — глобален toggle + Message Board линк.
router.put('/config', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { enabled, boardUrl, pingCampfire } = req.body || {};
    const save = (key, value) => execute(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [key, String(value)]
    );
    if (enabled !== undefined) await save('gcal_alerts_enabled', enabled ? 'true' : 'false');
    if (pingCampfire !== undefined) await save('gcal_alerts_ping_campfire', pingCampfire ? 'true' : 'false');
    if (boardUrl !== undefined) {
      const ids = parseBoardUrl(boardUrl);
      if (!ids) return res.status(400).json({ error: 'Невалиден линк — очаквам …/buckets/…/message_boards/… от Basecamp.' });
      await save('gcal_alerts_bc_board_url', String(boardUrl).trim());
      await save('gcal_alerts_bc_project', ids.project);
      await save('gcal_alerts_bc_board', ids.board);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[gcal-alerts] config error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/gcal-alerts/feeds — добавя календар (ID или embed линк) + жива проверка на достъпа.
router.post('/feeds', requireAuth, requireAdmin, async (req, res) => {
  try {
    const calendarId = parseCalendarInput(req.body && req.body.calendar);
    if (!calendarId) {
      return res.status(400).json({ error: 'Невалиден календар — подай Calendar ID (…@group.calendar.google.com) или embed линк със src=.' });
    }
    const access = await checkCalendarAccess(calendarId);
    const feed = await queryOne(
      `INSERT INTO gcal_feeds (google_calendar_id, name, last_error)
       VALUES ($1, $2, $3)
       ON CONFLICT (google_calendar_id) DO UPDATE SET last_error = $3
       RETURNING *`,
      [calendarId, access.name || '', access.ok ? null : access.error]
    );
    res.json({ feed, access });
  } catch (err) {
    console.error('[gcal-alerts] add feed error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/gcal-alerts/feeds/:id/check — повторна проверка на достъпа.
router.post('/feeds/:id/check', requireAuth, requireAdmin, async (req, res) => {
  try {
    const feed = await queryOne('SELECT * FROM gcal_feeds WHERE id = $1', [req.params.id]);
    if (!feed) return res.status(404).json({ error: 'Няма такъв календар.' });
    const access = await checkCalendarAccess(feed.google_calendar_id);
    await execute(
      'UPDATE gcal_feeds SET name = COALESCE(NULLIF($2, \'\'), name), last_error = $3 WHERE id = $1',
      [feed.id, (!feed.name && access.name) ? access.name : feed.name, access.ok ? null : access.error]
    );
    res.json({ access });
  } catch (err) {
    console.error('[gcal-alerts] check feed error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/gcal-alerts/feeds/:id — име / on-off / отговорници.
router.put('/feeds/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const feed = await queryOne('SELECT * FROM gcal_feeds WHERE id = $1', [req.params.id]);
    if (!feed) return res.status(404).json({ error: 'Няма такъв календар.' });
    const { name, enabled, responsibles } = req.body || {};
    if (name !== undefined) await execute('UPDATE gcal_feeds SET name = $2 WHERE id = $1', [feed.id, String(name).trim()]);
    if (enabled !== undefined) await execute('UPDATE gcal_feeds SET enabled = $2 WHERE id = $1', [feed.id, !!enabled]);
    if (Array.isArray(responsibles)) {
      await execute('DELETE FROM gcal_feed_responsibles WHERE feed_id = $1', [feed.id]);
      const ids = [...new Set(responsibles.map(String).filter((v) => /^\d+$/.test(v)))];
      for (const pid of ids) {
        await execute(
          'INSERT INTO gcal_feed_responsibles (feed_id, bc_person_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [feed.id, pid]
        );
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[gcal-alerts] update feed error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/gcal-alerts/feeds/:id
router.delete('/feeds/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await execute('DELETE FROM gcal_feeds WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[gcal-alerts] delete feed error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/gcal-alerts/person-map — { google_email, bc_person_id } (null → трие реда).
router.put('/person-map', requireAuth, requireAdmin, async (req, res) => {
  try {
    const email = String(req.body && req.body.google_email || '').trim().toLowerCase();
    const personId = req.body && req.body.bc_person_id;
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Невалиден имейл.' });
    if (!personId) {
      await execute('DELETE FROM gcal_person_map WHERE google_email = $1', [email]);
    } else {
      if (!/^\d+$/.test(String(personId))) return res.status(400).json({ error: 'Невалиден човек.' });
      await execute(
        `INSERT INTO gcal_person_map (google_email, bc_person_id) VALUES ($1, $2)
         ON CONFLICT (google_email) DO UPDATE SET bc_person_id = $2`,
        [email, String(personId)]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[gcal-alerts] person map error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/gcal-alerts/test — тестово съобщение в борда.
router.post('/test', requireAuth, requireAdmin, async (req, res) => {
  try {
    const message = await postTestMessage();
    res.json({ ok: true, url: normalizeAppUrl(message.app_url) || null });
  } catch (err) {
    console.error('[gcal-alerts] test error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/gcal-alerts/sync — ръчно пускане на sync цикъла (иначе върви всяка минута).
router.post('/sync', requireAuth, requireAdmin, async (req, res) => {
  try {
    await syncAllFeeds();
    res.json({ ok: true });
  } catch (err) {
    console.error('[gcal-alerts] manual sync error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
