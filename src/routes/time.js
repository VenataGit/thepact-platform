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
const { parseClientKp } = require('../services/bc-aggregate');

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

const NO_CLIENT = 'Без клиент';

// Времето се групира по ЗАГЛАВИЕ на задачата, а не по bc_recording_id.
// Защо: картите се местят между дъски през „портал" на Basecamp и излизат от
// другата страна с НОВО id — всичко, закачено за старото id, се разцепва на две.
// Заглавието остава същото, затова ключът идва от него: малки букви, събрани
// интервали, без крайни празни знаци.
//
// Ключът се смята в SQL, а не се пази в колона — така не може да се разсинхронизира
// със заглавието (например при ръчна корекция през PATCH /api/time/entries/:id) и
// цялата стара история се пресмята наново със задна дата, без миграция на данни.
// Ако таблицата някога стане голяма, това се вдига в STORED колона с индекс.
// bc_recording_id СЕ ПАЗИ като второстепенен признак (линк към Basecamp, филтър
// по конкретна карта) — сменя се кой е водещият ключ, id-то не се маха.
const TITLE_KEY = "lower(btrim(regexp_replace(e.title, '\\s+', ' ', 'g')))";

// Клиент и КП идват от самото заглавие (конвенция „Cineland КП-18 - Видео 3 - …"),
// защото всички карти на екипа живеят в един Basecamp проект и bc_project_id НЕ
// различава клиентите. Затова се групира тук, върху вече сумираните по заглавие
// редове — едно разчитане на заглавието дава и трите нива (клиент / КП / задача).
function rollUp(byTitle) {
  const clients = new Map();
  const plans = new Map();
  for (const t of byTitle) {
    const secs = Number(t.seconds) || 0;
    const parsed = parseClientKp(t.title);
    const client = parsed ? parsed.client : NO_CLIENT;

    if (!clients.has(client)) clients.set(client, { client, seconds: 0, tasks: 0, entries: 0 });
    const c = clients.get(client);
    c.seconds += secs;
    c.tasks += 1;
    c.entries += Number(t.entries) || 0;

    if (parsed) {
      const key = parsed.client + ' КП-' + parsed.kp;
      if (!plans.has(key)) plans.set(key, { label: key, client: parsed.client, kp: parsed.kp, seconds: 0, tasks: 0 });
      const p = plans.get(key);
      p.seconds += secs;
      p.tasks += 1;
    }
  }
  const bySecs = (a, b) => b.seconds - a.seconds;
  return {
    byClient: [...clients.values()].sort(bySecs),
    byKp: [...plans.values()].sort(bySecs)
  };
}

// GET /api/time/report?from&to — агрегати за периода
// (общо / хора / клиенти / КП / задачи по заглавие / Basecamp проекти / дни)
router.get('/report', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const params = [dateParam(req.query.from), dateParam(req.query.to)];
    const [totals, byUser, byProject, byTitle, byDay] = await Promise.all([
      queryOne(
        `SELECT COALESCE(SUM(${DUR}),0)::int AS seconds, COUNT(*)::int AS entries,
                COUNT(DISTINCT e.user_id)::int AS users,
                COUNT(DISTINCT ${TITLE_KEY})::int AS tasks,
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
      // Задачите се групират по нормализирано заглавие, не по карта — така времето
      // по една и съща задача остава събрано, дори картата да е минала през портал
      // и да е излязла с ново id. cards показва през колко различни карти е минала
      // задачата, bc_recording_id е само за линка/филтъра.
      query(
        `SELECT ${TITLE_KEY} AS title_key, MAX(e.title) AS title,
                COALESCE(SUM(${DUR}),0)::int AS seconds,
                COUNT(DISTINCT e.user_id)::int AS users, COUNT(*)::int AS entries,
                COUNT(DISTINCT e.bc_recording_id)::int AS cards,
                MAX(e.bc_recording_id) AS bc_recording_id,
                MAX(COALESCE(p.name, '')) AS project_name
           FROM time_entries e LEFT JOIN bc_projects p ON p.project_id = e.bc_project_id ${RANGE}
          GROUP BY ${TITLE_KEY} ORDER BY seconds DESC`, params),
      query(
        `SELECT ((e.started_at AT TIME ZONE '${TZ}')::date)::text AS day, COALESCE(SUM(${DUR}),0)::int AS seconds
           FROM time_entries e ${RANGE} GROUP BY day ORDER BY day`, params)
    ]);
    const { byClient, byKp } = rollUp(byTitle);
    res.json({
      totals, byUser, byClient, byKp, byProject, byDay,
      byTask: byTitle.slice(0, 200),
      tasksTotal: byTitle.length
    });
  } catch (err) { next(err); }
});

// Кои title_key-ове в периода принадлежат на даден клиент / КП. Ползва същия
// parseClientKp като отчета, за да няма два различни начина за разчитане на
// заглавието (иначе филтърът и сумите биха се разминали).
async function titleKeysFor(from, to, client, kp) {
  const rows = await query(
    `SELECT ${TITLE_KEY} AS title_key, MAX(e.title) AS title
       FROM time_entries e ${RANGE} GROUP BY ${TITLE_KEY}`,
    [from, to]
  );
  const keys = [];
  for (const r of rows) {
    const parsed = parseClientKp(r.title);
    if (client === NO_CLIENT) {
      if (!parsed) keys.push(r.title_key);
      continue;
    }
    if (!parsed) continue;
    if (client && parsed.client.toLowerCase() !== client.toLowerCase()) continue;
    if (kp !== null && parsed.kp !== kp) continue;
    keys.push(r.title_key);
  }
  return keys;
}

// GET /api/time/report/entries?from&to&user_id&project_id&recording_id&title_key&client&kp
router.get('/report/entries', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const from = dateParam(req.query.from);
    const to = dateParam(req.query.to);
    const userId = parseInt(req.query.user_id) || null;
    const projectId = String(req.query.project_id || '').replace(/\D/g, '') || null;
    const recordingId = String(req.query.recording_id || '').replace(/\D/g, '') || null;

    // Задачата се филтрира по нормализирано заглавие, не по карта — виж TITLE_KEY.
    // Ключовете идват от самия SQL (от /report), затова двете страни винаги съвпадат.
    let titleKeys = null;
    const oneKey = String(req.query.title_key || '').trim();
    const client = String(req.query.client || '').trim();
    const kpRaw = String(req.query.kp || '').trim();
    if (oneKey) {
      titleKeys = [oneKey];
    } else if (client) {
      titleKeys = await titleKeysFor(from, to, client, kpRaw ? parseInt(kpRaw, 10) : null);
      if (!titleKeys.length) return res.json([]);
    }

    const rows = await query(
      `SELECT e.*, u.name AS user_name, COALESCE(p.name, '') AS project_name
         FROM time_entries e
         JOIN users u ON u.id = e.user_id
         LEFT JOIN bc_projects p ON p.project_id = e.bc_project_id
        ${RANGE}
          AND ($3::int IS NULL OR e.user_id = $3::int)
          AND ($4::bigint IS NULL OR e.bc_project_id = $4::bigint)
          AND ($5::bigint IS NULL OR e.bc_recording_id = $5::bigint)
          AND ($6::text[] IS NULL OR ${TITLE_KEY} = ANY($6::text[]))
        ORDER BY e.started_at DESC LIMIT 1000`,
      [from, to, userId, projectId, recordingId, titleKeys]
    );
    res.json(rows.map((r) => Object.assign(entryPublic(r), { projectName: r.project_name })));
  } catch (err) { next(err); }
});

module.exports = router;
