// Content агент (#/content) — паметта на клиента, профилите му, успешните видеа и
// пусканията на агентите. Вижда се от целия екип (content creator-ите работят тук);
// настройките с ключовете — само админ.
const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { query, queryOne, execute } = require('../db/pool');
const store = require('../services/content-agent/store');
const scout = require('../services/content-agent/scout');
const pipeline = require('../services/content-agent/pipeline');
const caHistory = require('../services/content-agent/history');
const discover = require('../services/content-agent/discover');
const imports = require('../services/content-agent/imports');
const multer = require('multer');
const fs = require('fs');
const videoAnalysis = require('../services/content-agent/video-analysis');
const by = caHistory.userOf;

const PLATFORMS = ['youtube', 'tiktok', 'instagram', 'facebook', 'other'];
const ROLES = ['own', 'competitor', 'inspiration'];
const STATUSES = ['approved', 'pending', 'rejected'];

router.use(requireAuth, (req, res, next) => {
  store.ensureSchema().then(() => next()).catch((e) => res.status(500).json({ error: `Базата не е готова: ${e.message}` }));
});

const fail = (res, e, code = 500) => { console.error('[content-agent api]', e.message); res.status(code).json({ error: e.message }); };
const who = (req) => (req.user && req.user.name) || '';
const clientId = (req) => parseInt(req.params.id, 10);

// ---------- клиенти ----------

router.get('/clients', async (req, res) => {
  try {
    const groups = await store.mergeDuplicates();
    const rows = await query(
      `SELECT c.id, c.name, c.is_active, c.current_kp_number, c.next_kp_date, (c.bc_project_id IS NOT NULL) AS linked,
              (SELECT COUNT(*) FROM ca_memory m WHERE m.client_id = c.id AND m.status = 'approved')::int AS memory,
              (SELECT COUNT(*) FROM ca_memory m WHERE m.client_id = c.id AND m.status = 'pending')::int AS pending,
              (SELECT COUNT(*) FROM ca_profiles p WHERE p.client_id = c.id AND p.active)::int AS profiles,
              (SELECT MAX(created_at) FROM ca_runs r WHERE r.client_id = c.id) AS last_run
         FROM kp_clients c ORDER BY c.is_active DESC NULLS LAST, c.name`
    );
    const hidden = new Set((await store.loadSettings()).hiddenClients);
    res.json({
      // Дубликатите (еднакво име) не се показват — само настоящият клиент.
      clients: rows.filter((c) => groups.canonicalOf[c.id] === undefined || groups.canonicalOf[c.id] === c.id)
        .map((c) => ({ ...c, hidden: hidden.has(c.id) })),
      duplicates: groups.duplicates,
    });
  } catch (e) { fail(res, e); }
});

// Скриване на клиент от списъка (неактивни, дубликати) — само админ. Не пипа
// КП-Автоматизация: клиентът остава там какъвто е, само тук не се показва.
router.post('/clients/:id/hide', requireAdmin, express.json(), async (req, res) => {
  try {
    const id = clientId(req);
    const set = new Set((await store.loadSettings()).hiddenClients);
    if (req.body && req.body.hidden === false) set.delete(id); else set.add(id);
    await store.saveSetting('ca_hidden_clients', JSON.stringify([...set]));
    res.json({ hidden: set.has(id) });
  } catch (e) { fail(res, e); }
});

const scouting = new Set(); // клиенти, чиито профили се обновяват в момента

router.get('/clients/:id', async (req, res) => {
  try {
    const groups = await store.mergeDuplicates();
    // Стар линк към дубликат → към настоящия клиент със същото име.
    const canon = groups.canonicalOf[clientId(req)];
    if (canon && canon !== clientId(req)) return res.json({ redirect: canon });
    const id = clientId(req);
    const client = await store.getClient(id);
    if (!client) return res.status(404).json({ error: 'Клиентът не е намерен.' });
    const [profiles, memory, runs, outliers, library, search, importsList] = await Promise.all([
      query('SELECT * FROM ca_profiles WHERE client_id = $1 ORDER BY platform, role, label, id', [id]),
      query("SELECT * FROM ca_memory WHERE client_id = $1 ORDER BY (status = 'pending') DESC, kind, created_at DESC", [id]),
      query(`SELECT id, trigger, request, requested_by, status, error, bc_project_id, bc_parent_id, created_at, finished_at,
                    jsonb_array_length(steps) AS step_count, (result->'scripts') IS NOT NULL AS has_result
               FROM ca_runs WHERE client_id = $1 ORDER BY id DESC LIMIT 30`, [id]),
      scout.topOutliers(id, { limit: 40, minScore: 1.5 }),
      discover.libraryOutliers(id, { limit: 40, minScore: 1.5 }),
      discover.getSearch(id),
      imports.listForClient(id),
    ]);
    const libProfiles = search ? await query(
      'SELECT COUNT(*)::int AS n FROM ca_profiles WHERE client_id = 0 AND active = TRUE AND topics && $1::text[]',
      [discover.allTopics(search.terms)]) : [{ n: 0 }];
    res.json({
      client, profiles, memory, runs, outliers, library, imports: importsList, scouting: scouting.has(id), kinds: store.KIND_LABELS,
      search: search ? { terms: search.terms, terms_updated_at: search.terms_updated_at, last_discovery_at: search.last_discovery_at, last_result: search.last_result } : null,
      library_profiles: libProfiles[0].n, discovering: discover.isRunning(id), analyzing: videoAnalysis.isBusy(id),
      library_videos: search ? (await query(
        `SELECT COUNT(*)::int AS n, COUNT(v.analysis)::int AS analyzed FROM ca_videos v JOIN ca_profiles p ON p.id = v.profile_id
          WHERE p.client_id = 0 AND p.active = TRUE AND p.topics && $1::text[]`, [discover.allTopics(search.terms)]))[0] : { n: 0, analyzed: 0 },
      apify: { ...(await store.apifySpent(id)), budget: (await store.loadSettings()).apifyBudget },
    });
  } catch (e) { fail(res, e); }
});

// ---------- профили ----------

function profileFields(b) {
  const platform = PLATFORMS.includes(b.platform) ? b.platform : null;
  if (!platform) throw Object.assign(new Error('Избери платформа.'), { status: 400 });
  const url = String(b.url || '').trim().slice(0, 500);
  const handle = String(b.handle || '').trim().replace(/^@/, '').slice(0, 200);
  if (!url && !handle) throw Object.assign(new Error('Въведи линк или @профил.'), { status: 400 });
  return {
    platform, url, handle,
    label: String(b.label || '').trim().slice(0, 200),
    role: ROLES.includes(b.role) ? b.role : 'own',
  };
}

router.post('/clients/:id/profiles', express.json(), async (req, res) => {
  try {
    const f = profileFields(req.body || {});
    const row = await queryOne(
      `INSERT INTO ca_profiles (client_id, platform, url, handle, label, role, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [clientId(req), f.platform, f.url, f.handle, f.label, f.role, who(req)]
    );
    await caHistory.log('profile', 'create', null, row, by(req));
    res.json(row);
  } catch (e) { fail(res, e, e.status || 500); }
});

router.put('/profiles/:pid', express.json(), async (req, res) => {
  try {
    const f = profileFields(req.body || {});
    const before = await queryOne('SELECT * FROM ca_profiles WHERE id = $1', [parseInt(req.params.pid, 10)]);
    const row = await queryOne(
      `UPDATE ca_profiles SET platform = $2, url = $3, handle = $4, label = $5, role = $6, active = $7
        WHERE id = $1 RETURNING *`,
      [parseInt(req.params.pid, 10), f.platform, f.url, f.handle, f.label, f.role, req.body.active !== false]
    );
    if (!row) return res.status(404).json({ error: 'Профилът не е намерен.' });
    await caHistory.log('profile', 'update', before, row, by(req));
    res.json(row);
  } catch (e) { fail(res, e, e.status || 500); }
});

router.delete('/profiles/:pid', async (req, res) => {
  try {
    const pid = parseInt(req.params.pid, 10);
    const before = await queryOne('SELECT * FROM ca_profiles WHERE id = $1', [pid]);
    await execute('DELETE FROM ca_videos WHERE profile_id = $1', [pid]);
    await execute('DELETE FROM ca_profiles WHERE id = $1', [pid]);
    if (before) await caHistory.log('profile', 'delete', before, null, by(req));
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

// Обновяване на профилите (Скаутът). Може да отнеме минути → тръгва фоново.
router.post('/clients/:id/scout', express.json(), async (req, res) => {
  const id = clientId(req);
  if (scouting.has(id)) return res.json({ started: false, running: true });
  scouting.add(id);
  res.json({ started: true });
  scout.refreshClient(id, { force: !!(req.body && req.body.force) })
    .catch((e) => console.error('[content-agent scout]', e.message))
    .finally(() => { scouting.delete(id); videoAnalysis.analyzeInBackground(id); });
});

// Анализ на самите видеа (сваляне, транскрипт, кадри) — фоново, едно по едно.
router.post('/clients/:id/analyze', async (req, res) => {
  const id = clientId(req);
  if (videoAnalysis.isBusy(id)) return res.json({ started: false, running: true });
  videoAnalysis.analyzeInBackground(id);
  res.json({ started: true });
});

// Откривател: търси нови профили в нишата (BG + EN) → обща библиотека. Фоново.
router.post('/clients/:id/discover', express.json(), async (req, res) => {
  try {
    const cfg = await store.loadSettings();
    if (!cfg.apifyToken && !cfg.youtubeKey) return res.status(400).json({ error: 'Няма Apify токен и YouTube ключ (Настройки на Content агента).' });
    const client = await store.getClient(clientId(req));
    if (!client) return res.status(404).json({ error: 'Клиентът не е намерен.' });
    // Нови думи за търсене при изрична молба — иначе се ползват запазените (до 30 дни).
    if (req.body && req.body.new_terms) await discover.ensureTerms(client, { force: true });
    res.json(await discover.discoverInBackground(client.id, { force: true }));
  } catch (e) { fail(res, e); }
});

// ---------- памет ----------

router.post('/clients/:id/memory', express.json(), async (req, res) => {
  try {
    const kind = store.KINDS.includes(req.body.kind) ? req.body.kind : null;
    const text = String(req.body.text || '').trim();
    if (!kind || !text) return res.status(400).json({ error: 'Избери вид и напиши текста.' });
    const row = await queryOne(
      `INSERT INTO ca_memory (client_id, kind, text, source, status, created_by, reviewed_by)
       VALUES ($1,$2,$3,$4,'approved',$5,$5) RETURNING *`,
      [clientId(req), kind, text.slice(0, 20000), String(req.body.source || 'Ръчно').slice(0, 300), who(req)]
    );
    await caHistory.log('memory', 'create', null, row, by(req));
    res.json(row);
  } catch (e) { fail(res, e); }
});

router.put('/memory/:mid', express.json(), async (req, res) => {
  try {
    const cur = await queryOne('SELECT * FROM ca_memory WHERE id = $1', [parseInt(req.params.mid, 10)]);
    if (!cur) return res.status(404).json({ error: 'Записът не е намерен.' });
    const kind = store.KINDS.includes(req.body.kind) ? req.body.kind : cur.kind;
    const text = req.body.text != null ? String(req.body.text).trim().slice(0, 20000) : cur.text;
    const status = STATUSES.includes(req.body.status) ? req.body.status : cur.status;
    if (!text) return res.status(400).json({ error: 'Текстът е празен.' });
    const row = await queryOne(
      `UPDATE ca_memory SET kind = $2, text = $3, status = $4,
              reviewed_by = CASE WHEN $4 <> $5 THEN $6 ELSE reviewed_by END, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [cur.id, kind, text, status, cur.status, who(req)]
    );
    const onlyStatus = status !== cur.status && text === cur.text && kind === cur.kind;
    await caHistory.log('memory', onlyStatus ? 'status' : 'update', cur, row, by(req));
    res.json(row);
  } catch (e) { fail(res, e); }
});

router.delete('/memory/:mid', async (req, res) => {
  try {
    const before = await queryOne('SELECT * FROM ca_memory WHERE id = $1', [parseInt(req.params.mid, 10)]);
    await execute('DELETE FROM ca_memory WHERE id = $1', [parseInt(req.params.mid, 10)]);
    if (before) await caHistory.log('memory', 'delete', before, null, by(req));
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

// Импорт на поставен текст / малък текстов файл → записи в паметта (чакат одобрение).
// Логиката е обща с качените файлове: services/content-agent/imports.js#importText.
router.post('/clients/:id/import', express.json({ limit: '3mb' }), async (req, res) => {
  try {
    const id = clientId(req);
    const text = String(req.body.text || '').trim();
    const filename = String(req.body.filename || 'поставен текст').slice(0, 200);
    if (text.length < 20) return res.status(400).json({ error: 'Текстът е твърде кратък.' });
    res.json({ added: await imports.importText({ clientId: id, text, filename, by: by(req) }) });
  } catch (e) { fail(res, e); }
});

// Качване на файл (PDF, Word, Excel, PowerPoint, видео, аудио, снимка…). Обработва го
// компютърът в офиса — пази го при себе си, вади текста/транскрипта и го връща.
const uploadFile = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, imports.ensureDir()),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
  }),
  limits: { fileSize: 4 * 1024 * 1024 * 1024, files: 1 },
});
router.post('/clients/:id/upload', uploadFile.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Няма файл.' });
    // multer чете името като latin1 — връщаме кирилицата.
    req.file.originalname = Buffer.from(req.file.originalname || '', 'latin1').toString('utf8');
    const client = await store.getClient(clientId(req));
    if (!client) { fs.rmSync(req.file.path, { force: true }); return res.status(404).json({ error: 'Клиентът не е намерен.' }); }
    const row = await imports.createImport({ clientId: client.id, file: req.file, by: by(req) });
    res.json({ id: row.id });
  } catch (e) { fail(res, e); }
});

// Одобри / откажи всички чакащи наведнъж.
router.post('/clients/:id/memory/bulk', express.json(), async (req, res) => {
  try {
    const status = req.body.status === 'rejected' ? 'rejected' : 'approved';
    const before = await query("SELECT * FROM ca_memory WHERE client_id = $1 AND status = 'pending'", [clientId(req)]);
    const r = await query(
      `UPDATE ca_memory SET status = $2, reviewed_by = $3, updated_at = NOW()
        WHERE client_id = $1 AND status = 'pending' RETURNING *`,
      [clientId(req), status, who(req)]
    );
    const prev = {};
    for (const b of before) prev[b.id] = b;
    for (const row of r) await caHistory.log('memory', 'status', prev[row.id] || null, row, by(req));
    res.json({ updated: r.length });
  } catch (e) { fail(res, e); }
});

// ---------- история на промените (само админ) ----------

router.get('/clients/:id/history', requireAdmin, async (req, res) => {
  try {
    res.json({ history: await caHistory.list(clientId(req)) });
  } catch (e) { fail(res, e); }
});

router.post('/history/:hid/restore', requireAdmin, async (req, res) => {
  try {
    res.json(await caHistory.restore(parseInt(req.params.hid, 10), by(req)));
  } catch (e) { fail(res, e, e.status || 500); }
});

// ---------- пускания ----------

// По желание линк към задача в Basecamp — тогава резултатът отива и като коментар там.
function parseBasecampLink(url) {
  const m = String(url || '').match(/buckets\/(\d+)\/(card_tables\/cards|todos|messages)\/(\d+)/);
  if (!m) return null;
  const type = m[2] === 'todos' ? 'Todo' : m[2] === 'messages' ? 'Message' : 'Kanban::Card';
  return { projectId: Number(m[1]), parentId: Number(m[3]), type };
}

router.post('/clients/:id/run', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const id = clientId(req);
    const client = await store.getClient(id);
    if (!client) return res.status(404).json({ error: 'Клиентът не е намерен.' });
    const link = req.body.basecamp_url ? parseBasecampLink(req.body.basecamp_url) : null;
    if (req.body.basecamp_url && !link) return res.status(400).json({ error: 'Не разпознавам линка към задачата в Basecamp.' });
    const runId = await pipeline.createRun({
      clientId: id, trigger: 'manual', request: String(req.body.request || ''), requestedBy: who(req),
      bcProjectId: link && link.projectId, bcParentId: link && link.parentId, parentType: link ? link.type : '',
    });
    res.json({ id: runId });
  } catch (e) { fail(res, e); }
});

router.get('/runs/:rid', async (req, res) => {
  try {
    const run = await queryOne('SELECT * FROM ca_runs WHERE id = $1', [parseInt(req.params.rid, 10)]);
    if (!run) return res.status(404).json({ error: 'Пускането не е намерено.' });
    res.json(run);
  } catch (e) { fail(res, e); }
});

// ---------- настройки (админ) ----------

const EDITABLE = ['ca_enabled', 'ca_auto_on_kp', 'ca_apify_token', 'ca_youtube_api_key', 'ca_actor_tiktok', 'ca_actor_instagram', 'ca_actor_facebook', 'ca_actor_instagram_hashtag', 'ca_apify_budget_usd'];
const SECRET = ['ca_apify_token', 'ca_youtube_api_key'];

router.get('/settings', requireAdmin, async (req, res) => {
  try {
    const s = await store.loadSettings();
    const mask = (v) => (v ? `••••${String(v).slice(-4)}` : '');
    res.json({
      ca_enabled: s.enabled, ca_auto_on_kp: s.autoOnKp,
      ca_apify_token: mask(s.apifyToken), ca_youtube_api_key: mask(s.youtubeKey),
      ca_actor_tiktok: s.actors.tiktok, ca_actor_instagram: s.actors.instagram, ca_actor_facebook: s.actors.facebook,
      ca_actor_instagram_hashtag: s.actors.instagram_hashtag,
      ca_apify_budget_usd: s.apifyBudget,
      defaults: store.DEFAULT_ACTORS,
    });
  } catch (e) { fail(res, e); }
});

router.put('/settings', requireAdmin, express.json(), async (req, res) => {
  try {
    for (const [k, v] of Object.entries(req.body || {})) {
      if (!EDITABLE.includes(k)) continue;
      if (SECRET.includes(k) && /^••••/.test(String(v))) continue; // маската не се записва обратно
      await store.saveSetting(k, typeof v === 'boolean' ? String(v) : String(v || '').trim());
    }
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

module.exports = router;
