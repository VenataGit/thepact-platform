// Тракване на време (The Pact Tools таймерът в Basecamp + ръчни корекции).
// Модел: един запис = непрекъснат сегмент; работещ таймер = ended_at IS NULL
// (уникален per user). "Пауза" = затворен сегмент; продължаване = нов запис.
// Разширението праща heartbeat; sweeper-ът (services/time-sweeper.js) затваря
// записи без пулс, така че затворен таб никога не оставя вечно въртящ таймер.
const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../db/pool');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { broadcast } = require('../ws/broadcast');

const TZ = 'Europe/Sofia';
const STOP_REASONS = new Set(['user', 'pause', 'unload']);

function entryPublic(e) {
  return {
    id: e.id,
    userId: e.user_id,
    userName: e.user_name || undefined,
    bcProjectId: e.bc_project_id ? String(e.bc_project_id) : null,
    bcRecordingId: e.bc_recording_id ? String(e.bc_recording_id) : null,
    recordingType: e.recording_type,
    title: e.title,
    url: e.url,
    startedAt: e.started_at,
    endedAt: e.ended_at,
    durationSeconds: e.duration_seconds,
    isManual: e.is_manual,
    stoppedBy: e.stopped_by,
    note: e.note
  };
}

// Общо изработено днес (по българско време) в секунди, вкл. вървящия таймер.
async function todaySeconds(userId) {
  const row = await queryOne(
    `SELECT COALESCE(SUM(
       CASE WHEN ended_at IS NULL
            THEN GREATEST(0, EXTRACT(EPOCH FROM (NOW() - started_at)))
            ELSE duration_seconds END
     ), 0)::int AS secs
     FROM time_entries
     WHERE user_id = $1
       AND (started_at AT TIME ZONE '${TZ}')::date = (NOW() AT TIME ZONE '${TZ}')::date`,
    [userId]
  );
  return row ? row.secs : 0;
}

// Затваря вървящия таймер на потребителя (ако има). Връща затворения запис.
async function closeRunning(userId, reason, atLastBeat) {
  const endExpr = atLastBeat ? 'GREATEST(last_beat, started_at)' : 'NOW()';
  return queryOne(
    `UPDATE time_entries
        SET ended_at = ${endExpr},
            duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (${endExpr} - started_at)))::int,
            stopped_by = $2
      WHERE user_id = $1 AND ended_at IS NULL
      RETURNING *`,
    [userId, reason]
  );
}

function broadcastStop(entry) {
  if (!entry) return;
  broadcast({
    type: 'time:working:stop',
    entryId: entry.id,
    userId: entry.user_id,
    bcRecordingId: entry.bc_recording_id ? String(entry.bc_recording_id) : null
  });
}

// POST /api/time/start — стартира таймер по Basecamp задача.
// Ако вече върви друг — спира го (един активен таймер на човек).
router.post('/start', requireAuth, async (req, res, next) => {
  try {
    const b = req.body || {};
    const recordingId = String(b.bc_recording_id || '').replace(/\D/g, '');
    const projectId = String(b.bc_project_id || '').replace(/\D/g, '');
    if (!recordingId) return res.status(400).json({ error: 'bc_recording_id required' });
    const recordingType = String(b.recording_type || '').slice(0, 40);
    const title = String(b.title || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    const url = String(b.url || '').slice(0, 500);

    let entry = null;
    // Retry при съвсем едновременни start-ове (уникалният индекс пази инварианта).
    for (let attempt = 0; attempt < 2 && !entry; attempt++) {
      const closed = await closeRunning(req.user.userId, 'switch', false);
      broadcastStop(closed);
      try {
        entry = await queryOne(
          `INSERT INTO time_entries (user_id, bc_project_id, bc_recording_id, recording_type, title, url)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [req.user.userId, projectId || null, recordingId, recordingType, title, url]
        );
      } catch (err) {
        if (err.code !== '23505' || attempt === 1) throw err;
      }
    }

    broadcast({
      type: 'time:working:start',
      entryId: entry.id,
      userId: req.user.userId,
      userName: req.user.name,
      bcRecordingId: recordingId,
      bcProjectId: projectId || null,
      title,
      startedAt: entry.started_at
    });
    res.json({ entry: entryPublic(entry), todaySeconds: await todaySeconds(req.user.userId) });
  } catch (err) { next(err); }
});

// POST /api/time/beat — пулс от разширението (държи таймера жив)
router.post('/beat', requireAuth, async (req, res, next) => {
  try {
    const entry = await queryOne(
      `UPDATE time_entries SET last_beat = NOW()
        WHERE user_id = $1 AND ended_at IS NULL RETURNING *`,
      [req.user.userId]
    );
    if (!entry) return res.status(404).json({ error: 'No running timer' });
    res.json({ entry: entryPublic(entry), todaySeconds: await todaySeconds(req.user.userId) });
  } catch (err) { next(err); }
});

// POST /api/time/stop — спира таймера. body.reason: user (стоп) | pause | unload
router.post('/stop', requireAuth, async (req, res, next) => {
  try {
    const reason = STOP_REASONS.has(req.body?.reason) ? req.body.reason : 'user';
    // При unload (затворен таб) времето е до последния пулс, не до "сега".
    const entry = await closeRunning(req.user.userId, reason, reason === 'unload');
    broadcastStop(entry);
    res.json({
      entry: entry ? entryPublic(entry) : null,
      todaySeconds: await todaySeconds(req.user.userId)
    });
  } catch (err) { next(err); }
});

// GET /api/time/running — моят вървящ таймер (за възстановяване на widget-а)
router.get('/running', requireAuth, async (req, res, next) => {
  try {
    const entry = await queryOne(
      'SELECT * FROM time_entries WHERE user_id = $1 AND ended_at IS NULL',
      [req.user.userId]
    );
    res.json({
      entry: entry ? entryPublic(entry) : null,
      todaySeconds: await todaySeconds(req.user.userId)
    });
  } catch (err) { next(err); }
});

// GET /api/time/active — всички вървящи таймери (индикаторът в платформата)
router.get('/active', requireAuth, async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT e.*, u.name AS user_name
         FROM time_entries e JOIN users u ON u.id = e.user_id
        WHERE e.ended_at IS NULL ORDER BY e.started_at`
    );
    res.json(rows.map(entryPublic));
  } catch (err) { next(err); }
});

// GET /api/time/me/today — сумата за днес (widget-ът показва "днес: Xч Yм")
router.get('/me/today', requireAuth, async (req, res, next) => {
  try {
    res.json({ todaySeconds: await todaySeconds(req.user.userId) });
  } catch (err) { next(err); }
});

// GET /api/time/me/top-boards — по кои дъски съм работил най-много (30 дни).
// Дашбордът ползва това, за да реши коя дъска да остане разгъната на тесен екран.
router.get('/me/top-boards', requireAuth, async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT c.board_id::text AS board_id,
              SUM(COALESCE(e.duration_seconds, GREATEST(0, EXTRACT(EPOCH FROM (NOW() - e.started_at)))))::int AS seconds
         FROM time_entries e
         JOIN bc_cards_snap c ON c.card_id = e.bc_recording_id
        WHERE e.user_id = $1
          AND e.started_at > NOW() - INTERVAL '30 days'
          AND c.board_id IS NOT NULL
        GROUP BY c.board_id
        ORDER BY seconds DESC
        LIMIT 10`,
      [req.user.userId]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/time/me/entries?from=YYYY-MM-DD&to=YYYY-MM-DD — моите записи
router.get('/me/entries', requireAuth, async (req, res, next) => {
  try {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : null;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : null;
    const rows = await query(
      `SELECT * FROM time_entries
        WHERE user_id = $1
          AND ($2::date IS NULL OR (started_at AT TIME ZONE '${TZ}')::date >= $2::date)
          AND ($3::date IS NULL OR (started_at AT TIME ZONE '${TZ}')::date <= $3::date)
        ORDER BY started_at DESC LIMIT 500`,
      [req.user.userId, from, to]
    );
    res.json(rows.map(entryPublic));
  } catch (err) { next(err); }
});

// POST /api/time/manual — ръчен запис (забравен таймер и т.н.)
router.post('/manual', requireAuth, async (req, res, next) => {
  try {
    const b = req.body || {};
    const started = new Date(b.started_at);
    const ended = new Date(b.ended_at);
    if (isNaN(started) || isNaN(ended)) return res.status(400).json({ error: 'Invalid dates' });
    if (ended <= started) return res.status(400).json({ error: 'ended_at must be after started_at' });
    const seconds = Math.round((ended - started) / 1000);
    if (seconds > 24 * 3600) return res.status(400).json({ error: 'Entry longer than 24h' });
    const entry = await queryOne(
      `INSERT INTO time_entries
         (user_id, bc_project_id, bc_recording_id, recording_type, title, url,
          started_at, ended_at, last_beat, duration_seconds, is_manual, stopped_by, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, TRUE, 'user', $10)
       RETURNING *`,
      [
        req.user.userId,
        String(b.bc_project_id || '').replace(/\D/g, '') || null,
        String(b.bc_recording_id || '').replace(/\D/g, '') || null,
        String(b.recording_type || '').slice(0, 40),
        String(b.title || '').replace(/\s+/g, ' ').trim().slice(0, 300),
        String(b.url || '').slice(0, 500),
        started.toISOString(),
        ended.toISOString(),
        seconds,
        String(b.note || '').slice(0, 500)
      ]
    );
    res.json(entryPublic(entry));
  } catch (err) { next(err); }
});

// PATCH /api/time/entries/:id — корекция на приключен запис (мой; админ — всеки).
// Коригираният запис се маркира is_manual, за да личи в отчета.
router.patch('/entries/:id', requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    const existing = await queryOne('SELECT * FROM time_entries WHERE id = $1', [id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (existing.user_id !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not yours' });
    }
    if (!existing.ended_at) return res.status(400).json({ error: 'Stop the timer first' });

    const b = req.body || {};
    const started = b.started_at ? new Date(b.started_at) : new Date(existing.started_at);
    const ended = b.ended_at ? new Date(b.ended_at) : new Date(existing.ended_at);
    if (isNaN(started) || isNaN(ended) || ended <= started) {
      return res.status(400).json({ error: 'Invalid time range' });
    }
    const seconds = Math.round((ended - started) / 1000);
    if (seconds > 24 * 3600) return res.status(400).json({ error: 'Entry longer than 24h' });
    const title = b.title !== undefined
      ? String(b.title).replace(/\s+/g, ' ').trim().slice(0, 300)
      : existing.title;
    const note = b.note !== undefined ? String(b.note).slice(0, 500) : existing.note;

    const entry = await queryOne(
      `UPDATE time_entries
          SET started_at = $2, ended_at = $3, duration_seconds = $4,
              title = $5, note = $6, is_manual = TRUE
        WHERE id = $1 RETURNING *`,
      [id, started.toISOString(), ended.toISOString(), seconds, title, note]
    );
    res.json(entryPublic(entry));
  } catch (err) { next(err); }
});

// DELETE /api/time/entries/:id — изтриване (мой запис; админ — всеки).
// Вървящ таймер: изтриването е "откажи без да логваш".
router.delete('/entries/:id', requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    const existing = await queryOne('SELECT * FROM time_entries WHERE id = $1', [id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (existing.user_id !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not yours' });
    }
    await query('DELETE FROM time_entries WHERE id = $1', [id]);
    if (!existing.ended_at) broadcastStop(existing);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ---------------- админ отчет ---------------- */

// Вървящите таймери влизат в сумите с изтеклото до момента време.
const DUR = "COALESCE(duration_seconds, GREATEST(0, EXTRACT(EPOCH FROM (NOW() - e.started_at)))::int)";
const RANGE = `WHERE ($1::date IS NULL OR (e.started_at AT TIME ZONE '${TZ}')::date >= $1::date)
                 AND ($2::date IS NULL OR (e.started_at AT TIME ZONE '${TZ}')::date <= $2::date)`;

function dateParam(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null;
}

// GET /api/time/report?from&to — агрегати за периода (общо/хора/проекти/задачи/дни)
router.get('/report', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const params = [dateParam(req.query.from), dateParam(req.query.to)];
    const [totals, byUser, byProject, byTask, byDay] = await Promise.all([
      queryOne(
        `SELECT COALESCE(SUM(${DUR}),0)::int AS seconds, COUNT(*)::int AS entries,
                COUNT(DISTINCT e.user_id)::int AS users,
                COUNT(DISTINCT e.bc_recording_id)::int AS tasks,
                COALESCE(SUM(CASE WHEN e.is_manual THEN ${DUR} ELSE 0 END),0)::int AS manual_seconds
           FROM time_entries e ${RANGE}`, params),
      query(
        `SELECT e.user_id, u.name, COALESCE(SUM(${DUR}),0)::int AS seconds, COUNT(*)::int AS entries,
                COALESCE(SUM(CASE WHEN e.is_manual THEN ${DUR} ELSE 0 END),0)::int AS manual_seconds
           FROM time_entries e JOIN users u ON u.id = e.user_id ${RANGE}
          GROUP BY e.user_id, u.name ORDER BY seconds DESC`, params),
      query(
        `SELECT e.bc_project_id, COALESCE(p.name, '(без проект)') AS project_name,
                COALESCE(SUM(${DUR}),0)::int AS seconds,
                COUNT(DISTINCT e.user_id)::int AS users, COUNT(*)::int AS entries
           FROM time_entries e LEFT JOIN bc_projects p ON p.project_id = e.bc_project_id ${RANGE}
          GROUP BY e.bc_project_id, p.name ORDER BY seconds DESC`, params),
      query(
        `SELECT e.bc_recording_id, MAX(e.title) AS title, e.bc_project_id,
                COALESCE(p.name, '') AS project_name,
                COALESCE(SUM(${DUR}),0)::int AS seconds, COUNT(DISTINCT e.user_id)::int AS users
           FROM time_entries e LEFT JOIN bc_projects p ON p.project_id = e.bc_project_id ${RANGE}
          GROUP BY e.bc_recording_id, e.bc_project_id, p.name ORDER BY seconds DESC LIMIT 200`, params),
      query(
        `SELECT ((e.started_at AT TIME ZONE '${TZ}')::date)::text AS day, COALESCE(SUM(${DUR}),0)::int AS seconds
           FROM time_entries e ${RANGE} GROUP BY day ORDER BY day`, params)
    ]);
    res.json({ totals, byUser, byProject, byTask, byDay });
  } catch (err) { next(err); }
});

// GET /api/time/report/entries?from&to&user_id&project_id&recording_id — записите поединично
router.get('/report/entries', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const userId = parseInt(req.query.user_id) || null;
    const projectId = String(req.query.project_id || '').replace(/\D/g, '') || null;
    const recordingId = String(req.query.recording_id || '').replace(/\D/g, '') || null;
    const rows = await query(
      `SELECT e.*, u.name AS user_name, COALESCE(p.name, '') AS project_name
         FROM time_entries e
         JOIN users u ON u.id = e.user_id
         LEFT JOIN bc_projects p ON p.project_id = e.bc_project_id
        ${RANGE}
          AND ($3::int IS NULL OR e.user_id = $3::int)
          AND ($4::bigint IS NULL OR e.bc_project_id = $4::bigint)
          AND ($5::bigint IS NULL OR e.bc_recording_id = $5::bigint)
        ORDER BY e.started_at DESC LIMIT 1000`,
      [dateParam(req.query.from), dateParam(req.query.to), userId, projectId, recordingId]
    );
    res.json(rows.map((r) => Object.assign(entryPublic(r), { projectName: r.project_name })));
  } catch (err) { next(err); }
});

module.exports = router;
