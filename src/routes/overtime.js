// Overtime (извънреден труд) — Венци, 02.11.2026, избра вариант 1 от /demo/overtime.html.
//  • Всеки вижда САМО своите записи; всички хора и историята им вижда само админ (role = admin),
//    и то само в админ изгледа (?scope=all, бутон „🔒 Админ" на страницата) — 02.11.2026 (2).
//  • Бележки на админа (/notes) — само за админ: напр. „дойде 3 ч по-късно след overtime-а".
//  • 09.11.2026: пълният админ (role = admin) може да даде същите права на човек от екипа
//    (Настройки → ⏱ Overtime достъп, таблица overtime_access), „за да може той да следи
//    хората, а не аз". Той вижда всички, пише/трие бележки, трие записи. Достъп дава и
//    отнема САМО пълен админ — даденият не може да го дава нататък.
//  • Без одобрение — записът влиза веднага.
//  • Без редакция: човек може само да изтрие свой запис (ако е объркал) и да го въведе пак.
//  • Пази се и КОГА е добавен записът (created_at) — показва се като дата.
//  • За всеки запис човекът избира как да се компенсира: плащане или почивка.
// Сметката е в public/js/overtime-calc.js — същият файл смята и във формата.
const express = require('express');
const router = express.Router();
const { query, queryOne, execute } = require('../db/pool');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { calc } = require('../../public/js/overtime-calc');

const KINDS = ['Снимки', 'Пътуване', 'Събитие', 'Монтаж', 'Техника / подготовка', 'Друго'];
const COMP = ['pay', 'rest'];

let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = execute(`
      CREATE TABLE IF NOT EXISTS overtime_entries (
        id            BIGSERIAL PRIMARY KEY,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        work_date     DATE NOT NULL,
        time_from     TEXT NOT NULL,
        time_to       TEXT NOT NULL,
        total_minutes INTEGER NOT NULL,
        ot_minutes    INTEGER NOT NULL,
        client        TEXT NOT NULL DEFAULT '',
        kind          TEXT NOT NULL DEFAULT '',
        note          TEXT NOT NULL DEFAULT '',
        comp          TEXT NOT NULL DEFAULT 'pay',
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at    TIMESTAMPTZ
      )`)
      .then(() => execute(
        'CREATE INDEX IF NOT EXISTS idx_overtime_user_date ON overtime_entries (user_id, work_date DESC)'
      ))
      .then(() => execute(`
        CREATE TABLE IF NOT EXISTS overtime_admin_notes (
          id            BIGSERIAL PRIMARY KEY,
          author_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
          about_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          note_date     DATE NOT NULL,
          text          TEXT NOT NULL,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          deleted_at    TIMESTAMPTZ
        )`))
      .then(() => execute(`
        CREATE TABLE IF NOT EXISTS overtime_access (
          user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`))
      .catch((err) => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

const isAdmin = (req) => req.user && req.user.role === 'admin';
// Може ли да следи overtime-а на всички: пълен админ или поименно пуснат (overtime_access).
async function canManage(req) {
  if (!req.user) return false;
  if (isAdmin(req)) return true;
  await ensureSchema();
  return !!(await queryOne('SELECT 1 FROM overtime_access WHERE user_id = $1', [req.user.userId]));
}
async function requireManager(req, res, next) {
  try {
    if (await canManage(req)) return next();
    res.status(403).json({ error: 'Нямаш достъп до админ изгледа на Overtime' });
  } catch (err) {
    console.error('[overtime] access check', err.message);
    res.status(500).json({ error: 'Грешка при проверка на достъпа' });
  }
}
const sofiaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia' }).format(new Date());
const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

// GET /api/overtime?from=YYYY-MM-DD&to=YYYY-MM-DD[&scope=all&user=ID]
// По подразбиране — само своите (и за админ). scope=all → всички или един човек,
// но само за админ или пуснат човек (canManage); на всеки друг scope/user се игнорират.
router.get('/', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const from = validDate(req.query.from) ? req.query.from : '2000-01-01';
    const to = validDate(req.query.to) ? req.query.to : '2100-01-01';
    const admin = await canManage(req);
    const all = admin && req.query.scope === 'all';
    const onlyUser = all ? (parseInt(req.query.user, 10) || null) : req.user.userId;
    const rows = await query(
      `SELECT o.id, o.user_id, u.name, to_char(o.work_date, 'YYYY-MM-DD') AS work_date, o.time_from, o.time_to,
              o.total_minutes, o.ot_minutes, o.client, o.kind, o.note, o.comp, o.created_at
         FROM overtime_entries o
         JOIN users u ON u.id = o.user_id
        WHERE o.deleted_at IS NULL
          AND o.work_date BETWEEN $1::date AND $2::date
          AND ($3::int IS NULL OR o.user_id = $3::int)
        ORDER BY o.work_date DESC, o.time_from DESC, o.id DESC`,
      [from, to, onlyUser]
    );
    // Списъкът с хора за филтъра (само за админ) — всички, които някога са въвели overtime.
    const people = all ? await query(
      `SELECT DISTINCT u.id, u.name FROM overtime_entries o JOIN users u ON u.id = o.user_id
        WHERE o.deleted_at IS NULL ORDER BY u.name`
    ) : [];
    res.json({ admin, scope: all ? 'all' : 'mine', entries: rows, people, kinds: KINDS });
  } catch (err) {
    console.error('[overtime] list', err.message);
    res.status(500).json({ error: 'Грешка при зареждане' });
  }
});

// POST /api/overtime — нов запис за логнатия човек.
router.post('/', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const b = req.body || {};
    const date = String(b.date || '').slice(0, 10);
    const from = String(b.from || '').slice(0, 5);
    const to = String(b.to || '').slice(0, 5);
    const client = String(b.client || '').trim().slice(0, 200);
    const kind = KINDS.includes(b.kind) ? b.kind : 'Друго';
    const note = String(b.note || '').trim().slice(0, 4000);
    const comp = COMP.includes(b.comp) ? b.comp : null;

    const r = calc(date, from, to);
    if (r.error) return res.status(400).json({ error: r.error });
    if (date > sofiaToday()) return res.status(400).json({ error: 'Датата е в бъдещето — overtime се въвежда след като е изработен.' });
    if (!r.ot) return res.status(400).json({ error: 'Целият интервал е в работно време (10:00–19:00) — няма overtime.' });
    if (!client) return res.status(400).json({ error: 'Напиши за кого е бил overtime-ът.' });
    if (!note) return res.status(400).json({ error: 'Напиши накратко какво си правил.' });
    if (!comp) return res.status(400).json({ error: 'Избери: плащане или почивка.' });

    const row = await queryOne(
      `INSERT INTO overtime_entries (user_id, work_date, time_from, time_to, total_minutes, ot_minutes, client, kind, note, comp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [req.user.userId, date, from, to, r.total, r.ot, client, kind, note, comp]
    );
    res.json({ ok: true, id: row.id, ot_minutes: r.ot });
  } catch (err) {
    console.error('[overtime] create', err.message);
    res.status(500).json({ error: 'Грешка при запис' });
  }
});

// ---------- Кой има достъп до админ изгледа (управлява го САМО пълен админ) ----------
// GET /api/overtime/me — за страницата: да покаже ли бутона „🔒 Админ".
router.get('/me', requireAuth, async (req, res) => {
  try {
    res.json({ manager: await canManage(req), fullAdmin: isAdmin(req) });
  } catch (err) {
    console.error('[overtime] me', err.message);
    res.status(500).json({ error: 'Грешка' });
  }
});

// GET /api/overtime/access — активните хора + кой е пуснат.
router.get('/access', requireAuth, requireAdmin, async (req, res) => {
  try {
    await ensureSchema();
    const people = await query(
      `SELECT u.id, u.name, u.role, p.name AS position_name,
              a.user_id IS NOT NULL AS granted, a.granted_at, g.name AS granted_by_name
         FROM users u
         LEFT JOIN positions p ON p.id = u.position_id
         LEFT JOIN overtime_access a ON a.user_id = u.id
         LEFT JOIN users g ON g.id = a.granted_by
        WHERE u.is_active = TRUE
        ORDER BY u.name`
    );
    res.json({ people });
  } catch (err) {
    console.error('[overtime] access list', err.message);
    res.status(500).json({ error: 'Грешка при зареждане' });
  }
});

// PUT /api/overtime/access/:userId { granted: true|false }
router.put('/access/:userId', requireAuth, requireAdmin, async (req, res) => {
  try {
    await ensureSchema();
    const userId = parseInt(req.params.userId, 10);
    if (!userId) return res.status(400).json({ error: 'Невалиден човек' });
    if (req.body && req.body.granted) {
      const u = await queryOne('SELECT id FROM users WHERE id = $1 AND is_active = TRUE', [userId]);
      if (!u) return res.status(404).json({ error: 'Няма такъв активен човек' });
      await execute(
        `INSERT INTO overtime_access (user_id, granted_by) VALUES ($1, $2)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId, req.user.userId]
      );
    } else {
      await execute('DELETE FROM overtime_access WHERE user_id = $1', [userId]);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[overtime] access set', err.message);
    res.status(500).json({ error: 'Грешка при запис' });
  }
});

// ---------- Бележки на админа (админ + пуснатите в overtime_access) ----------
// GET /api/overtime/notes[?user=ID] — всички бележки или само за един човек.
router.get('/notes', requireAuth, requireManager, async (req, res) => {
  try {
    await ensureSchema();
    const user = parseInt(req.query.user, 10) || null;
    const rows = await query(
      `SELECT n.id, n.about_user_id, a.name AS about_name, n.author_id, w.name AS author_name,
              to_char(n.note_date, 'YYYY-MM-DD') AS note_date, n.text, n.created_at
         FROM overtime_admin_notes n
         LEFT JOIN users a ON a.id = n.about_user_id
         LEFT JOIN users w ON w.id = n.author_id
        WHERE n.deleted_at IS NULL AND ($1::int IS NULL OR n.about_user_id = $1::int)
        ORDER BY n.note_date DESC, n.id DESC
        LIMIT 500`,
      [user]
    );
    res.json({ notes: rows });
  } catch (err) {
    console.error('[overtime] notes list', err.message);
    res.status(500).json({ error: 'Грешка при зареждане' });
  }
});

// POST /api/overtime/notes { about_user_id?, date, text }
router.post('/notes', requireAuth, requireManager, async (req, res) => {
  try {
    await ensureSchema();
    const b = req.body || {};
    const date = validDate(b.date) ? b.date : sofiaToday();
    const text = String(b.text || '').trim().slice(0, 4000);
    const about = parseInt(b.about_user_id, 10) || null;
    if (!text) return res.status(400).json({ error: 'Напиши бележката.' });
    const row = await queryOne(
      `INSERT INTO overtime_admin_notes (author_id, about_user_id, note_date, text)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [req.user.userId, about, date, text]
    );
    res.json({ ok: true, id: row.id });
  } catch (err) {
    console.error('[overtime] notes create', err.message);
    res.status(500).json({ error: 'Грешка при запис' });
  }
});

// DELETE /api/overtime/notes/:id — меко триене.
router.delete('/notes/:id', requireAuth, requireManager, async (req, res) => {
  try {
    await ensureSchema();
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Невалидна бележка' });
    await execute('UPDATE overtime_admin_notes SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[overtime] notes delete', err.message);
    res.status(500).json({ error: 'Грешка при триене' });
  }
});

// DELETE /api/overtime/:id — само собственикът (или админ). Меко триене: редът остава
// в базата с deleted_at, но никъде не се показва и не се брои.
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Невалиден запис' });
    const row = await queryOne('SELECT user_id FROM overtime_entries WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!row) return res.status(404).json({ error: 'Записът не е намерен' });
    if (row.user_id !== req.user.userId && !(await canManage(req))) return res.status(403).json({ error: 'Можеш да триеш само свои записи' });
    await execute('UPDATE overtime_entries SET deleted_at = NOW() WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[overtime] delete', err.message);
    res.status(500).json({ error: 'Грешка при триене' });
  }
});

// дневното обобщение (services/overtime-digest.js) ползва същата схема
router.ensureSchema = ensureSchema;
module.exports = router;
