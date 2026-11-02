// Overtime (извънреден труд) — Венци, 02.11.2026, избра вариант 1 от /demo/overtime.html.
//  • Всеки вижда САМО своите записи; всички хора и историята им вижда само админ (role = admin).
//  • Без одобрение — записът влиза веднага.
//  • Без редакция: човек може само да изтрие свой запис (ако е объркал) и да го въведе пак.
//  • Пази се и КОГА е добавен записът (created_at) — показва се като дата.
//  • За всеки запис човекът избира как да се компенсира: плащане или почивка.
// Сметката е в public/js/overtime-calc.js — същият файл смята и във формата.
const express = require('express');
const router = express.Router();
const { query, queryOne, execute } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
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
      .catch((err) => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

const isAdmin = (req) => req.user && req.user.role === 'admin';
const sofiaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia' }).format(new Date());
const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

// GET /api/overtime?from=YYYY-MM-DD&to=YYYY-MM-DD[&user=ID]
// Не-админ: винаги само своите (user се игнорира). Админ: всички или един човек.
router.get('/', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const from = validDate(req.query.from) ? req.query.from : '2000-01-01';
    const to = validDate(req.query.to) ? req.query.to : '2100-01-01';
    const admin = isAdmin(req);
    const onlyUser = admin ? (parseInt(req.query.user, 10) || null) : req.user.userId;
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
    const people = admin ? await query(
      `SELECT DISTINCT u.id, u.name FROM overtime_entries o JOIN users u ON u.id = o.user_id
        WHERE o.deleted_at IS NULL ORDER BY u.name`
    ) : [];
    res.json({ admin, entries: rows, people, kinds: KINDS });
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

// DELETE /api/overtime/:id — само собственикът (или админ). Меко триене: редът остава
// в базата с deleted_at, но никъде не се показва и не се брои.
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Невалиден запис' });
    const row = await queryOne('SELECT user_id FROM overtime_entries WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!row) return res.status(404).json({ error: 'Записът не е намерен' });
    if (row.user_id !== req.user.userId && !isAdmin(req)) return res.status(403).json({ error: 'Можеш да триеш само свои записи' });
    await execute('UPDATE overtime_entries SET deleted_at = NOW() WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[overtime] delete', err.message);
    res.status(500).json({ error: 'Грешка при триене' });
  }
});

module.exports = router;
