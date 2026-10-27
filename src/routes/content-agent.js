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
const { callJson, TEAM, block } = require('../services/content-agent/agents');

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
    const rows = await query(
      `SELECT c.id, c.name, c.is_active, c.current_kp_number, c.next_kp_date, (c.bc_project_id IS NOT NULL) AS linked,
              (SELECT COUNT(*) FROM ca_memory m WHERE m.client_id = c.id AND m.status = 'approved')::int AS memory,
              (SELECT COUNT(*) FROM ca_memory m WHERE m.client_id = c.id AND m.status = 'pending')::int AS pending,
              (SELECT COUNT(*) FROM ca_profiles p WHERE p.client_id = c.id AND p.active)::int AS profiles,
              (SELECT MAX(created_at) FROM ca_runs r WHERE r.client_id = c.id) AS last_run
         FROM kp_clients c ORDER BY c.is_active DESC NULLS LAST, c.name`
    );
    res.json({ clients: rows });
  } catch (e) { fail(res, e); }
});

const scouting = new Set(); // клиенти, чиито профили се обновяват в момента

router.get('/clients/:id', async (req, res) => {
  try {
    const id = clientId(req);
    const client = await store.getClient(id);
    if (!client) return res.status(404).json({ error: 'Клиентът не е намерен.' });
    const [profiles, memory, runs, outliers] = await Promise.all([
      query('SELECT * FROM ca_profiles WHERE client_id = $1 ORDER BY platform, role, label, id', [id]),
      query("SELECT * FROM ca_memory WHERE client_id = $1 ORDER BY (status = 'pending') DESC, kind, created_at DESC", [id]),
      query(`SELECT id, trigger, request, requested_by, status, error, bc_project_id, bc_parent_id, created_at, finished_at,
                    jsonb_array_length(steps) AS step_count, (result->'scripts') IS NOT NULL AS has_result
               FROM ca_runs WHERE client_id = $1 ORDER BY id DESC LIMIT 30`, [id]),
      scout.topOutliers(id, { limit: 40, minScore: 1.5 }),
    ]);
    res.json({ client, profiles, memory, runs, outliers, scouting: scouting.has(id), kinds: store.KIND_LABELS });
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
    res.json(row);
  } catch (e) { fail(res, e, e.status || 500); }
});

router.put('/profiles/:pid', express.json(), async (req, res) => {
  try {
    const f = profileFields(req.body || {});
    const row = await queryOne(
      `UPDATE ca_profiles SET platform = $2, url = $3, handle = $4, label = $5, role = $6, active = $7
        WHERE id = $1 RETURNING *`,
      [parseInt(req.params.pid, 10), f.platform, f.url, f.handle, f.label, f.role, req.body.active !== false]
    );
    if (!row) return res.status(404).json({ error: 'Профилът не е намерен.' });
    res.json(row);
  } catch (e) { fail(res, e, e.status || 500); }
});

router.delete('/profiles/:pid', async (req, res) => {
  try {
    const pid = parseInt(req.params.pid, 10);
    await execute('DELETE FROM ca_videos WHERE profile_id = $1', [pid]);
    await execute('DELETE FROM ca_profiles WHERE id = $1', [pid]);
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
    .finally(() => scouting.delete(id));
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
    res.json(row);
  } catch (e) { fail(res, e); }
});

router.delete('/memory/:mid', async (req, res) => {
  try {
    await execute('DELETE FROM ca_memory WHERE id = $1', [parseInt(req.params.mid, 10)]);
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

// Импорт: поставен текст / файл (карта на клиента, research, стари скриптове,
// бележки от среща) → AI го разбива на отделни записи → чакат одобрение.
const IMPORT_SYSTEM = `${TEAM}

Ти си ПАЗИТЕЛЯТ НА ПАМЕТТА. Получаваш документ за клиент (карта, проучване, стари скриптове, бележки от среща, коментари). Разбий го на отделни кратки записи за паметта на клиента.
Видове: profile (факт за бизнеса, продукти, аудитория, цели), like (харесва), dislike (не харесва), rule (правило/забрана), voice (как говори — цитат или описание на гласа), past_video (видео, което сме правили — заглавие, идея, как се е представило), note (друго полезно).
Всеки запис е самостоятелен и разбираем без документа. Не измисляй нищо. Пропусни организационни неща (фактури, логистика, срещи), освен ако не казват нещо за съдържанието. Минали скриптове: по един past_video запис на видео (заглавие + идея в 1-2 изречения), а характерни реплики → voice.
Отговори с JSON: {"items": [{"kind": "...", "text": "..."}]}`;

router.post('/clients/:id/import', express.json({ limit: '3mb' }), async (req, res) => {
  try {
    const id = clientId(req);
    const client = await store.getClient(id);
    if (!client) return res.status(404).json({ error: 'Клиентът не е намерен.' });
    const text = String(req.body.text || '').trim();
    const filename = String(req.body.filename || 'поставен текст').slice(0, 200);
    if (text.length < 20) return res.status(400).json({ error: 'Текстът е твърде кратък.' });
    const existing = await store.memoryText(id);
    const out = await callJson({
      system: IMPORT_SYSTEM,
      user: [block('клиент', client.name), block('вече_в_паметта', existing), block('документ', text.slice(0, 200000))].join('\n\n'),
      effort: 'low', maxTokens: 20000,
    });
    let added = 0;
    for (const it of (out.items || []).slice(0, 300)) {
      if (!it || !store.KINDS.includes(it.kind) || !String(it.text || '').trim()) continue;
      const r = await queryOne(
        `INSERT INTO ca_memory (client_id, kind, text, source, status, created_by)
         SELECT $1,$2,$3,$4,'pending',$5
          WHERE NOT EXISTS (SELECT 1 FROM ca_memory WHERE client_id = $1 AND lower(text) = lower($3))
         RETURNING id`,
        [id, it.kind, String(it.text).trim().slice(0, 5000), `Импорт: ${filename}`, who(req)]
      );
      if (r) added++;
    }
    res.json({ added });
  } catch (e) { fail(res, e); }
});

// Одобри / откажи всички чакащи наведнъж.
router.post('/clients/:id/memory/bulk', express.json(), async (req, res) => {
  try {
    const status = req.body.status === 'rejected' ? 'rejected' : 'approved';
    const r = await query(
      `UPDATE ca_memory SET status = $2, reviewed_by = $3, updated_at = NOW()
        WHERE client_id = $1 AND status = 'pending' RETURNING id`,
      [clientId(req), status, who(req)]
    );
    res.json({ updated: r.length });
  } catch (e) { fail(res, e); }
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

const EDITABLE = ['ca_enabled', 'ca_auto_on_kp', 'ca_apify_token', 'ca_youtube_api_key', 'ca_actor_tiktok', 'ca_actor_instagram', 'ca_actor_facebook'];
const SECRET = ['ca_apify_token', 'ca_youtube_api_key'];

router.get('/settings', requireAdmin, async (req, res) => {
  try {
    const s = await store.loadSettings();
    const mask = (v) => (v ? `••••${String(v).slice(-4)}` : '');
    res.json({
      ca_enabled: s.enabled, ca_auto_on_kp: s.autoOnKp,
      ca_apify_token: mask(s.apifyToken), ca_youtube_api_key: mask(s.youtubeKey),
      ca_actor_tiktok: s.actors.tiktok, ca_actor_instagram: s.actors.instagram, ca_actor_facebook: s.actors.facebook,
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
