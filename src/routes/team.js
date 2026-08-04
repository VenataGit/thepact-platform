// Админ API за „Екип и роли" (Настройки → Екип и роли).
//
// Само за пълен админ (requireAdmin) — тук се решава кой каква позиция има и кой
// се тагва по контент плановете. Работи с ХОРАТА ОТ BASECAMP (bc_people), защото
// част от екипа никога не се е логвала в платформата; отделно показва и профилите
// в платформата (users), за да може да се чистят тестови акаунти.
const express = require('express');
const router = express.Router();
const { query, queryOne, execute } = require('../db/pool');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const team = require('../services/bc-team');

// Хората от Basecamp + позицията им + дали имат профил в платформата.
function loadPeople() {
  return query(
    `SELECT p.person_id, p.name, p.email, p.title, p.avatar_url, p.active, p.synced_at,
            p.position_id, pos.name AS position_name, pos.kp_responsible,
            u.id AS platform_user_id, u.role AS platform_role, u.is_active AS platform_active
       FROM bc_people p
       LEFT JOIN positions pos ON pos.id = p.position_id
       LEFT JOIN users u ON LOWER(u.email) = p.email AND p.email <> ''
      ORDER BY p.active DESC, p.name`
  );
}

// GET /api/team/overview — всичко за секцията с една заявка.
router.get('/overview', requireAuth, requireAdmin, async (req, res) => {
  try {
    let people = await loadPeople();
    // Първо отваряне на панела при празен кеш → дърпаме екипа веднага.
    if (!people.length) {
      try {
        await team.refreshTeam();
        people = await loadPeople();
      } catch (err) {
        console.warn('[team] първо зареждане на екипа се провали:', err.message);
      }
    }

    const positions = await query(
      `SELECT pos.id, pos.name, pos.description, pos.kp_responsible,
              COUNT(p.person_id)::int AS people_count
         FROM positions pos
         LEFT JOIN bc_people p ON p.position_id = pos.id AND p.active = TRUE
        GROUP BY pos.id ORDER BY pos.name`
    );

    const users = await query(
      `SELECT u.id, u.email, u.name, u.role, u.is_active, u.last_login_at, u.created_at,
              (u.basecamp_user_id IS NOT NULL) AS has_basecamp
         FROM users u ORDER BY u.is_active DESC, u.name`
    );

    // Одобрените имейли + дали човекът вече си е направил профил с влизане.
    const approved = await query(
      `SELECT a.id, a.email, a.note, a.created_at, a.last_login_at,
              adder.name AS added_by_name,
              u.id AS platform_user_id, u.name AS platform_name, u.is_active AS platform_active
         FROM approved_emails a
         LEFT JOIN users adder ON adder.id = a.added_by
         LEFT JOIN users u ON LOWER(u.email) = a.email
        ORDER BY a.created_at DESC`
    );

    const syncedRow = await queryOne('SELECT MAX(synced_at) AS at FROM bc_people');
    res.json({
      people, positions, users, approved,
      syncedAt: syncedRow ? syncedRow.at : null,
      syncTime: await team.syncTime(),
      myUserId: req.user.userId,
    });
  } catch (err) {
    console.error('[team] overview error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/team/refresh — дърпа екипа от Basecamp сега.
router.post('/refresh', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json({ ok: true, ...(await team.refreshTeam()) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// PUT /api/team/people/:personId { position_id } — позиция на човек от Basecamp.
router.put('/people/:personId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const personId = parseInt(req.params.personId, 10);
    if (!personId) return res.status(400).json({ error: 'Невалиден човек.' });
    const raw = req.body ? req.body.position_id : null;
    const posId = raw ? parseInt(raw, 10) : null;
    if (posId) {
      const pos = await queryOne('SELECT id FROM positions WHERE id = $1', [posId]);
      if (!pos) return res.status(404).json({ error: 'Позицията не съществува.' });
    }
    const updated = await queryOne(
      'UPDATE bc_people SET position_id = $1 WHERE person_id = $2 RETURNING person_id, name, position_id',
      [posId, personId]
    );
    if (!updated) return res.status(404).json({ error: 'Човекът не е в кеша на екипа — обнови екипа.' });
    res.json({ ok: true, person: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/team/approved { email, note } — одобрява имейл за вход в платформата.
// Само пълен админ. Имейлът е този, с който човекът е регистриран в Basecamp.
router.post('/approved', requireAuth, requireAdmin, async (req, res) => {
  try {
    const email = String((req.body && req.body.email) || '').toLowerCase().trim();
    const note = String((req.body && req.body.note) || '').trim().slice(0, 200);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Въведи валиден имейл.' });
    }
    const row = await queryOne(
      `INSERT INTO approved_emails (email, note, added_by) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET note = EXCLUDED.note
       RETURNING id, email`,
      [email, note, req.user.userId]
    );
    res.json({ ok: true, approved: row });
  } catch (err) {
    console.error('[team] approve email error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/team/approved/:id — маха имейл от одобрените.
// Само отнема правото за НАСЛЕДВАЩИ влизания — вече създаденият профил остава
// (той се деактивира или трие от „Профили в платформата").
router.delete('/approved/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Невалиден запис.' });
    const gone = await queryOne('DELETE FROM approved_emails WHERE id = $1 RETURNING email', [id]);
    if (!gone) return res.status(404).json({ error: 'Записът вече не съществува.' });
    res.json({ ok: true, email: gone.email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/team/config { syncTime } — час на дневния sync.
router.put('/config', requireAuth, requireAdmin, async (req, res) => {
  try {
    const t = req.body && req.body.syncTime;
    if (!/^\d{1,2}:\d{2}$/.test(String(t || ''))) {
      return res.status(400).json({ error: 'Часът трябва да е във формат ЧЧ:ММ.' });
    }
    await execute(
      `INSERT INTO settings (key, value, updated_at) VALUES ('bc_team_sync_time', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [String(t)]
    );
    await team.restartBcTeamSync();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
