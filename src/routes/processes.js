// Процеси (#/processes) — Венци избра вариант A от /demo/processes.html (04.11.2026, задача „Процеси").
//  • Всеки логнат вижда всичко; редактират само admin и mini_admin.
//  • Процесът е списък от стъпки (един ред + кой я прави + по желание „Повече", чеклист, „Внимание").
//  • Всяко запазване е нова версия в process_versions — може да се върне стара.
//  • Ролите (кой я прави) и отделите — с име, цвят и икона — са в process_config и се пипат от „Настройки".
//  • „Кой за какво отговаря" и чеклистите по роля НЕ се пазят — сглобяват се във фронтенда от стъпките.
//  • Конфликт: PUT носи baseVersion; ако някой е запазил междувременно → 409, нищо не се презаписва.
const express = require('express');
const router = express.Router();
const { query, queryOne, execute } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const seed = require('../services/processes-seed');

let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = execute(`
      CREATE TABLE IF NOT EXISTS processes (
        id          SERIAL PRIMARY KEY,
        dept        TEXT NOT NULL DEFAULT '',
        name        TEXT NOT NULL,
        owner       TEXT NOT NULL DEFAULT '',
        when_text   TEXT NOT NULL DEFAULT '',
        done_text   TEXT NOT NULL DEFAULT '',
        steps       JSONB NOT NULL DEFAULT '[]',
        sort        INTEGER NOT NULL DEFAULT 0,
        version     INTEGER NOT NULL DEFAULT 1,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by  TEXT NOT NULL DEFAULT '',
        deleted_at  TIMESTAMPTZ
      )`)
      .then(() => execute(`
        CREATE TABLE IF NOT EXISTS process_versions (
          id          BIGSERIAL PRIMARY KEY,
          process_id  INTEGER NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
          version     INTEGER NOT NULL,
          data        JSONB NOT NULL,
          note        TEXT NOT NULL DEFAULT '',
          author_id   INTEGER,
          author_name TEXT NOT NULL DEFAULT '',
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`))
      .then(() => execute('CREATE INDEX IF NOT EXISTS idx_process_versions_pid ON process_versions (process_id, version DESC)'))
      .then(() => execute(`
        CREATE TABLE IF NOT EXISTS process_config (
          id          INTEGER PRIMARY KEY,
          roles       JSONB NOT NULL,
          depts       JSONB NOT NULL,
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_by  TEXT NOT NULL DEFAULT ''
        )`))
      .then(seedIfEmpty)
      .catch((err) => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

// Първоначално съдържание — само ако таблиците са празни (нищо не се презаписва).
async function seedIfEmpty() {
  await execute(
    `INSERT INTO process_config (id, roles, depts, updated_by) VALUES (1, $1, $2, 'Claude') ON CONFLICT (id) DO NOTHING`,
    [JSON.stringify(seed.ROLES), JSON.stringify(seed.DEPTS)]
  );
  const has = await queryOne('SELECT 1 AS x FROM processes LIMIT 1');
  if (has) return;
  let sort = 0;
  for (const p of seed.PROCESSES) {
    sort += 10;
    const row = await queryOne(
      `INSERT INTO processes (dept, name, owner, when_text, done_text, steps, sort, version, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 1, 'Claude') RETURNING id`,
      [p.dept, p.name, p.owner, p.when, p.done, JSON.stringify(p.steps), sort]
    );
    if (row) {
      await execute(
        `INSERT INTO process_versions (process_id, version, data, note, author_name) VALUES ($1, 1, $2, $3, 'Claude')`,
        [row.id, JSON.stringify(snapshot({ ...p, when_text: p.when, done_text: p.done })), 'първа версия от Vault процесите']
      );
    }
  }
}

const canEdit = (req) => !!req.user && (req.user.role === 'admin' || req.user.role === 'mini_admin');
function requireEditor(req, res, next) {
  if (!canEdit(req)) return res.status(403).json({ error: 'Само админ и мини админ могат да редактират процесите' });
  next();
}

// ---------- почистване на входа ----------
const str = (v, max) => String(v == null ? '' : v).replace(/\r/g, '').slice(0, max);
const one = (v, max) => str(v, max).replace(/\s*\n\s*/g, ' ').trim();
const keyOk = (k) => /^[a-z0-9_-]{1,24}$/.test(String(k || ''));
const colorOk = (c) => /^#[0-9a-fA-F]{6}$/.test(String(c || ''));

function cleanSteps(steps, roleKeys) {
  if (!Array.isArray(steps)) return [];
  return steps.slice(0, 80).map((s) => ({
    title: one(s && s.title, 200),
    who: roleKeys.has(s && s.who) ? s.who : (roleKeys.has('all') ? 'all' : [...roleKeys][0] || ''),
    more: str(s && s.more, 4000).trim(),
    checks: (Array.isArray(s && s.checks) ? s.checks : []).slice(0, 40).map((t) => one(t, 300)).filter(Boolean),
    warn: one(s && s.warn, 300),
  })).filter((s) => s.title);
}

function snapshot(p) {
  return { dept: p.dept, name: p.name, owner: p.owner, when: p.when_text, done: p.done_text, steps: p.steps };
}

async function getConfig() {
  const c = await queryOne('SELECT roles, depts, updated_at, updated_by FROM process_config WHERE id = 1');
  return c || { roles: seed.ROLES, depts: seed.DEPTS };
}

function toClient(r) {
  return {
    id: r.id, dept: r.dept, name: r.name, owner: r.owner, when: r.when_text, done: r.done_text,
    steps: r.steps || [], sort: r.sort, version: r.version, updated_at: r.updated_at, updated_by: r.updated_by,
  };
}

// GET /api/processes — конфигурация + всички процеси (със стъпките — малко са, рисуват се на клиента)
router.get('/', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const [config, rows] = await Promise.all([
      getConfig(),
      query('SELECT * FROM processes WHERE deleted_at IS NULL ORDER BY sort, id'),
    ]);
    res.json({ config, processes: rows.map(toClient), canEdit: canEdit(req) });
  } catch (err) {
    console.error('[processes] list:', err.message);
    res.status(500).json({ error: 'Процесите не могат да се заредят' });
  }
});

// GET /api/processes/recent — последните промени (за началната страница)
router.get('/recent', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const rows = await query(
      `SELECT v.process_id, v.version, v.note, v.author_name, v.created_at, p.name
         FROM process_versions v JOIN processes p ON p.id = v.process_id
        WHERE p.deleted_at IS NULL
        ORDER BY v.created_at DESC, v.id DESC LIMIT 12`
    );
    res.json({ items: rows });
  } catch (err) {
    console.error('[processes] recent:', err.message);
    res.status(500).json({ error: 'Грешка' });
  }
});

// GET /api/processes/:id/versions — историята на един процес
router.get('/:id/versions', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Невалиден процес' });
  try {
    await ensureSchema();
    const rows = await query(
      'SELECT version, note, author_name, created_at, data FROM process_versions WHERE process_id = $1 ORDER BY version DESC LIMIT 100',
      [id]
    );
    res.json({ versions: rows });
  } catch (err) {
    console.error('[processes] versions:', err.message);
    res.status(500).json({ error: 'Грешка' });
  }
});

async function validated(body, config) {
  const roleKeys = new Set((config.roles || []).map((r) => r.key));
  const deptKeys = new Set((config.depts || []).map((d) => d.key));
  const name = one(body.name, 160);
  if (!name) return { error: 'Процесът трябва да има име' };
  return {
    data: {
      name,
      dept: deptKeys.has(body.dept) ? body.dept : ((config.depts || [])[0] || {}).key || '',
      owner: roleKeys.has(body.owner) ? body.owner : '',
      when_text: one(body.when, 300),
      done_text: one(body.done, 300),
      steps: cleanSteps(body.steps, roleKeys),
    },
  };
}

// POST /api/processes — нов процес
router.post('/', requireAuth, requireEditor, async (req, res) => {
  try {
    await ensureSchema();
    const v = await validated(req.body || {}, await getConfig());
    if (v.error) return res.status(400).json({ error: v.error });
    const d = v.data;
    const max = await queryOne('SELECT COALESCE(MAX(sort), 0) AS m FROM processes');
    const row = await queryOne(
      `INSERT INTO processes (dept, name, owner, when_text, done_text, steps, sort, version, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8) RETURNING *`,
      [d.dept, d.name, d.owner, d.when_text, d.done_text, JSON.stringify(d.steps), (max ? Number(max.m) : 0) + 10, req.user.name || '']
    );
    await execute(
      'INSERT INTO process_versions (process_id, version, data, note, author_id, author_name) VALUES ($1, 1, $2, $3, $4, $5)',
      [row.id, JSON.stringify(snapshot(row)), one(req.body.note, 300) || 'нов процес', req.user.id, req.user.name || '']
    );
    res.json({ process: toClient(row) });
  } catch (err) {
    console.error('[processes] create:', err.message);
    res.status(500).json({ error: 'Процесът не беше създаден' });
  }
});

// PUT /api/processes/:id — запазване = нова версия. baseVersion пази от презаписване на чужда промяна.
router.put('/:id', requireAuth, requireEditor, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Невалиден процес' });
  try {
    await ensureSchema();
    const v = await validated(req.body || {}, await getConfig());
    if (v.error) return res.status(400).json({ error: v.error });
    const d = v.data;
    const base = parseInt(req.body.baseVersion, 10);
    const row = await queryOne(
      `UPDATE processes SET dept = $1, name = $2, owner = $3, when_text = $4, done_text = $5, steps = $6,
              version = version + 1, updated_at = NOW(), updated_by = $7
        WHERE id = $8 AND deleted_at IS NULL AND version = $9
        RETURNING *`,
      [d.dept, d.name, d.owner, d.when_text, d.done_text, JSON.stringify(d.steps), req.user.name || '', id, base]
    );
    if (!row) {
      const cur = await queryOne('SELECT version, updated_by FROM processes WHERE id = $1 AND deleted_at IS NULL', [id]);
      if (!cur) return res.status(404).json({ error: 'Процесът го няма' });
      return res.status(409).json({ error: `Междувременно ${cur.updated_by || 'някой'} е запазил v${cur.version}. Отвори процеса наново и нанеси промяната пак.` });
    }
    await execute(
      'INSERT INTO process_versions (process_id, version, data, note, author_id, author_name) VALUES ($1, $2, $3, $4, $5, $6)',
      [row.id, row.version, JSON.stringify(snapshot(row)), one(req.body.note, 300), req.user.id, req.user.name || '']
    );
    res.json({ process: toClient(row) });
  } catch (err) {
    console.error('[processes] update:', err.message);
    res.status(500).json({ error: 'Промяната не беше запазена' });
  }
});

// POST /api/processes/:id/restore — връща стара версия КАТО НОВА версия (историята не се губи)
router.post('/:id/restore', requireAuth, requireEditor, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const ver = parseInt((req.body || {}).version, 10);
  if (!id || !ver) return res.status(400).json({ error: 'Невалидна заявка' });
  try {
    await ensureSchema();
    const old = await queryOne('SELECT data FROM process_versions WHERE process_id = $1 AND version = $2', [id, ver]);
    if (!old) return res.status(404).json({ error: 'Няма такава версия' });
    const o = old.data || {};
    const config = await getConfig();
    const v = await validated({ ...o, when: o.when, done: o.done }, config);
    if (v.error) return res.status(400).json({ error: v.error });
    const d = v.data;
    const row = await queryOne(
      `UPDATE processes SET dept = $1, name = $2, owner = $3, when_text = $4, done_text = $5, steps = $6,
              version = version + 1, updated_at = NOW(), updated_by = $7
        WHERE id = $8 AND deleted_at IS NULL RETURNING *`,
      [d.dept, d.name, d.owner, d.when_text, d.done_text, JSON.stringify(d.steps), req.user.name || '', id]
    );
    if (!row) return res.status(404).json({ error: 'Процесът го няма' });
    await execute(
      'INSERT INTO process_versions (process_id, version, data, note, author_id, author_name) VALUES ($1, $2, $3, $4, $5, $6)',
      [row.id, row.version, JSON.stringify(snapshot(row)), `върната v${ver}`, req.user.id, req.user.name || '']
    );
    res.json({ process: toClient(row) });
  } catch (err) {
    console.error('[processes] restore:', err.message);
    res.status(500).json({ error: 'Версията не беше върната' });
  }
});

// DELETE /api/processes/:id — меко изтриване (редът и историята остават в базата)
router.delete('/:id', requireAuth, requireEditor, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Невалиден процес' });
  try {
    await ensureSchema();
    await execute('UPDATE processes SET deleted_at = NOW(), updated_by = $2 WHERE id = $1 AND deleted_at IS NULL', [id, req.user.name || '']);
    res.json({ ok: true });
  } catch (err) {
    console.error('[processes] delete:', err.message);
    res.status(500).json({ error: 'Грешка при изтриване' });
  }
});

// PUT /api/processes/config/all — роли и отдели (име, цвят, икона, ред)
router.put('/config/all', requireAuth, requireEditor, async (req, res) => {
  try {
    await ensureSchema();
    const body = req.body || {};
    const seen = new Set();
    const roles = (Array.isArray(body.roles) ? body.roles : []).slice(0, 40).map((r) => ({
      key: keyOk(r && r.key) ? r.key : '',
      name: one(r && r.name, 60),
      color: colorOk(r && r.color) ? r.color : '#9aa7ad',
    })).filter((r) => r.key && r.name && !seen.has('r:' + r.key) && seen.add('r:' + r.key));
    const depts = (Array.isArray(body.depts) ? body.depts : []).slice(0, 40).map((d) => ({
      key: keyOk(d && d.key) ? d.key : '',
      name: one(d && d.name, 60),
      icon: one(d && d.icon, 8),
      color: colorOk(d && d.color) ? d.color : '#9aa7ad',
    })).filter((d) => d.key && d.name && !seen.has('d:' + d.key) && seen.add('d:' + d.key));
    if (!roles.length || !depts.length) return res.status(400).json({ error: 'Трябва поне една роля и един отдел' });

    // Не се маха роля/отдел, който още се ползва — иначе стъпките остават „без никого".
    const rows = await query('SELECT name, dept, owner, steps FROM processes WHERE deleted_at IS NULL');
    const rk = new Set(roles.map((r) => r.key));
    const dk = new Set(depts.map((d) => d.key));
    for (const p of rows) {
      if (!dk.has(p.dept)) return res.status(400).json({ error: `Отделът на „${p.name}" още се ползва — премести процеса, преди да махнеш отдела.` });
      const used = [p.owner, ...(p.steps || []).map((s) => s.who)].filter(Boolean);
      const miss = used.find((k) => !rk.has(k));
      if (miss) return res.status(400).json({ error: `Роля „${miss}" още се ползва в „${p.name}" — смени я там, преди да я махнеш.` });
    }
    await execute(
      'UPDATE process_config SET roles = $1, depts = $2, updated_at = NOW(), updated_by = $3 WHERE id = 1',
      [JSON.stringify(roles), JSON.stringify(depts), req.user.name || '']
    );
    res.json({ config: { roles, depts } });
  } catch (err) {
    console.error('[processes] config:', err.message);
    res.status(500).json({ error: 'Настройките не бяха запазени' });
  }
});

// PUT /api/processes/order/all — ред на процесите (стрелките в Настройки)
router.put('/order/all', requireAuth, requireEditor, async (req, res) => {
  const ids = (Array.isArray((req.body || {}).ids) ? req.body.ids : []).map((x) => parseInt(x, 10)).filter(Boolean).slice(0, 500);
  try {
    await ensureSchema();
    let sort = 0;
    for (const id of ids) { sort += 10; await execute('UPDATE processes SET sort = $1 WHERE id = $2', [sort, id]); }
    res.json({ ok: true });
  } catch (err) {
    console.error('[processes] order:', err.message);
    res.status(500).json({ error: 'Грешка' });
  }
});

module.exports = router;
module.exports._test = { cleanSteps, ensureSchemaReset: () => { schemaReady = null; } };
