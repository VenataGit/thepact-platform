// Контент стратегия агент (#/strategy) — клиентските проекти от Basecamp, кой чака
// стратегия, пусканията на агента. Вижда се и се пуска от целия екип; скриване на
// проект (вътрешен/ненужен) — само админ.
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { query, queryOne, execute } = require('../db/pool');
const store = require('../services/strategy-agent/store');
const pipeline = require('../services/strategy-agent/pipeline');

router.use(requireAuth, (req, res, next) => {
  store.ensureSchema().then(() => next()).catch((e) => res.status(500).json({ error: `Базата не е готова: ${e.message}` }));
});

const fail = (res, e, code = 500) => { console.error('[strategy-agent api]', e.message); res.status(code).json({ error: e.message }); };
const pid = (req) => String(req.params.pid || '').replace(/\D/g, '');

router.get('/projects', async (req, res) => {
  try {
    const rows = await query(
      `SELECT p.*, (SELECT row_to_json(x) FROM (SELECT r.id, r.status, r.created_at, r.finished_at, r.requested_by
                                                  FROM cs_runs r WHERE r.project_id = p.project_id ORDER BY r.id DESC LIMIT 1) x) AS last_run
         FROM cs_projects p JOIN bc_projects b ON b.project_id = p.project_id AND b.active = TRUE
        ORDER BY p.is_new DESC, p.detected_at DESC, p.name`
    );
    res.json({ projects: rows.map((p) => ({ ...p, client: p.client_name || store.clientNameFromProject(p.name), plan: store.planFromProject(p.name) })) });
  } catch (e) { fail(res, e); }
});

// Засичане веднага (без да се чакат 15-те минути).
router.post('/detect', async (req, res) => {
  try { res.json(await store.detectProjects()); } catch (e) { fail(res, e); }
});

router.get('/projects/:pid', async (req, res) => {
  try {
    const p = await store.getProject(pid(req));
    if (!p) return res.status(404).json({ error: 'Проектът не е намерен.' });
    const runs = await query(
      `SELECT id, status, requested_by, notes, error, created_at, finished_at, (result IS NOT NULL) AS has_result
         FROM cs_runs WHERE project_id = $1 ORDER BY id DESC LIMIT 30`, [p.project_id]);
    res.json({ ...p, plan: store.planFromProject(p.name), runs });
  } catch (e) { fail(res, e); }
});

// Името на клиента (за папката в „Клиентски карти") и скриването.
router.patch('/projects/:pid', express.json(), async (req, res) => {
  try {
    const id = pid(req);
    if (req.body.client_name !== undefined) {
      await execute('UPDATE cs_projects SET client_name = $2, updated_at = NOW() WHERE project_id = $1',
        [id, String(req.body.client_name || '').trim().slice(0, 200)]);
    }
    if (req.body.hidden !== undefined) {
      if (req.user.role !== 'admin') return res.status(403).json({ error: 'Само админ може да скрива проекти.' });
      await execute('UPDATE cs_projects SET hidden = $2, updated_at = NOW() WHERE project_id = $1', [id, !!req.body.hidden]);
    }
    res.json(await store.getProject(id));
  } catch (e) { fail(res, e); }
});

router.post('/projects/:pid/run', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const p = await store.getProject(pid(req));
    if (!p) return res.status(404).json({ error: 'Проектът не е намерен.' });
    const id = await pipeline.createRun({ projectId: p.project_id, notes: String(req.body.notes || ''), requestedBy: (req.user && req.user.name) || '' });
    res.json({ id });
  } catch (e) { fail(res, e); }
});

router.get('/runs/:rid', async (req, res) => {
  try {
    const run = await queryOne(
      'SELECT r.*, p.name AS project_name, p.client_name FROM cs_runs r LEFT JOIN cs_projects p ON p.project_id = r.project_id WHERE r.id = $1',
      [parseInt(req.params.rid, 10)]
    );
    if (!run) return res.status(404).json({ error: 'Пускането не е намерено.' });
    res.json({ ...run, client: run.client_name || store.clientNameFromProject(run.project_name) });
  } catch (e) { fail(res, e); }
});

module.exports = router;
