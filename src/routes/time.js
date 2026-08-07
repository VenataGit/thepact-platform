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

// Една и съща задача може да смени и двете си опорни точки, но НИКОГА едновременно:
//   • местене между дъски → НОВО id, СЪЩОТО заглавие  → свързва ги заглавието
//   • преименуване        → СЪЩОТО id, НОВО заглавие  → свързва ги id-то
// Затова двата признака се обединяват транзитивно: всеки ред (заглавие, карта) е
// ребро в граф, а една задача = една свързана компонента. Така „преместена, после
// преименувана, после пак преместена" пак излиза като една задача с едно общо време.
//
// Показваното заглавие е НАЙ-СКОРОШНОТО в периода — човек търси задачата по това,
// както се казва сега, а не по това, както се е казвала преди три преименувания.
function mergeTasks(rows) {
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root);
    let cur = x; // скъсяване на пътя
    while (parent.get(cur) !== root) { const next = parent.get(cur); parent.set(cur, root); cur = next; }
    return root;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  // NULL карта не свързва нищо — иначе всички записи без id биха станали една задача.
  for (const r of rows) {
    const titleNode = 't:' + r.title_key;
    find(titleNode);
    if (r.bc_recording_id !== null && r.bc_recording_id !== undefined) {
      union(titleNode, 'c:' + r.bc_recording_id);
    }
  }

  const groups = new Map();
  for (const r of rows) {
    const root = find('t:' + r.title_key);
    if (!groups.has(root)) {
      groups.set(root, {
        title: '', title_key: r.title_key, titleKeys: [], cardIds: [],
        bc_recording_id: null, project_name: '',
        seconds: 0, entries: 0, users: 0, cards: 0, titles: 0,
        _users: new Set(), _last: null
      });
    }
    const g = groups.get(root);
    g.seconds += Number(r.seconds) || 0;
    g.entries += Number(r.entries) || 0;
    if (!g.titleKeys.includes(r.title_key)) g.titleKeys.push(r.title_key);
    if (r.bc_recording_id !== null && r.bc_recording_id !== undefined) {
      const cid = String(r.bc_recording_id);
      if (!g.cardIds.includes(cid)) g.cardIds.push(cid);
    }
    for (const u of (r.user_ids || [])) g._users.add(u);
    if (!g.project_name && r.project_name) g.project_name = r.project_name;
    if (!g._last || new Date(r.last_started) > new Date(g._last)) {
      g._last = r.last_started;
      g.title = r.title;
      g.title_key = r.title_key;
      g.bc_recording_id = r.bc_recording_id !== null && r.bc_recording_id !== undefined
        ? String(r.bc_recording_id) : null;
    }
  }

  return [...groups.values()].map((g) => {
    g.users = g._users.size;
    g.cards = g.cardIds.length;
    g.titles = g.titleKeys.length;
    delete g._users;
    delete g._last;
    return g;
  }).sort((a, b) => b.seconds - a.seconds);
}

// Суровите двойки (заглавие, карта) за периода — храната на mergeTasks.
const TASK_PAIRS_SQL = `
  SELECT ${TITLE_KEY} AS title_key,
         e.bc_recording_id,
         (ARRAY_AGG(e.title ORDER BY e.started_at DESC))[1] AS title,
         MAX(e.started_at) AS last_started,
         COALESCE(SUM(${DUR}),0)::int AS seconds,
         COUNT(*)::int AS entries,
         ARRAY_AGG(DISTINCT e.user_id) AS user_ids,
         MAX(COALESCE(p.name, '')) AS project_name
    FROM time_entries e LEFT JOIN bc_projects p ON p.project_id = e.bc_project_id
   ${RANGE}
   GROUP BY ${TITLE_KEY}, e.bc_recording_id`;

async function taskGroups(from, to) {
  return mergeTasks(await query(TASK_PAIRS_SQL, [from, to]));
}

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
    const [totals, byUser, byProject, tasks, byDay] = await Promise.all([
      queryOne(
        `SELECT COALESCE(SUM(${DUR}),0)::int AS seconds, COUNT(*)::int AS entries,
                COUNT(DISTINCT e.user_id)::int AS users,
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
      // Задачите се сглобяват от двойките (заглавие, карта) — виж mergeTasks:
      // местенето сменя id-то, преименуването сменя заглавието, а двете заедно
      // пак дават една задача.
      taskGroups(params[0], params[1]),
      query(
        `SELECT ((e.started_at AT TIME ZONE '${TZ}')::date)::text AS day, COALESCE(SUM(${DUR}),0)::int AS seconds
           FROM time_entries e ${RANGE} GROUP BY day ORDER BY day`, params)
    ]);
    const { byClient, byKp } = rollUp(tasks);
    // „Задачи" в плочките = броят сглобени задачи, а не броят различни заглавия.
    res.json({
      totals: Object.assign({}, totals, { tasks: tasks.length }),
      byUser, byClient, byKp, byProject, byDay,
      byTask: tasks.slice(0, 200),
      tasksTotal: tasks.length
    });
  } catch (err) { next(err); }
});

// Кои заглавия в периода принадлежат на даден клиент / КП. Работи върху вече
// сглобените задачи и разчита НАЙ-СКОРОШНОТО заглавие със същия parseClientKp
// като отчета — иначе филтърът и сумите биха се разминали. Връща всички заглавия
// на задачата, за да влязат и записите отпреди преименуването.
async function titleKeysFor(from, to, client, kp) {
  const keys = [];
  for (const g of await taskGroups(from, to)) {
    const parsed = parseClientKp(g.title);
    if (client === NO_CLIENT) {
      if (!parsed) keys.push(...g.titleKeys);
      continue;
    }
    if (!parsed) continue;
    if (client && parsed.client.toLowerCase() !== client.toLowerCase()) continue;
    if (kp !== null && parsed.kp !== kp) continue;
    keys.push(...g.titleKeys);
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

    // Задачата се филтрира по заглавията си, не по карта — виж TITLE_KEY/mergeTasks.
    // Преименувана задача има няколко заглавия, затова title_key идва като списък
    // (?title_key=a&title_key=b) — иначе записите отпреди преименуването биха паднали.
    // Ключовете идват от самия SQL (от /report), затова двете страни винаги съвпадат.
    let titleKeys = null;
    const rawKeys = req.query.title_key;
    const keyList = (Array.isArray(rawKeys) ? rawKeys : [rawKeys])
      .map((k) => String(k === undefined || k === null ? '' : k).trim())
      .filter(Boolean);
    const client = String(req.query.client || '').trim();
    const kpRaw = String(req.query.kp || '').trim();
    if (keyList.length) {
      titleKeys = keyList;
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
