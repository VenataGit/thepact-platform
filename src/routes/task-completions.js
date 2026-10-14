// Бутонът „✓ Готово" в The Pact Tools (Basecamp): изричен сигнал от самия
// човек, че той е свършил конкретна задача — за разлика от bc_stage_events,
// където „кой" е ЗАСЕЧЕН (findEditor, приблизително). Тук няма гадаене: човекът
// е логнат с токена на разширението (requireAuth поддържа Bearer pt_<hash>,
// виж middleware/auth.js), значи user_id идва направо от заявката.
//
// Отдел = позицията на човека в Настройки → Екип и роли (positions, зададена
// върху bc_people — виж /report) — Венци го поиска изрично така (10.09.2026): „и отдел
// (това като знаем кой за кой отдел работи)", а не отдела на картата в
// момента на клика (една карта минава през няколко отдела).
//
// Клик = превключвател (toggle), не натрупващ запис: същият човек на същата
// карта или маркира, или размаркира — пази се по един ред на (user_id, card).
const express = require('express');
const router = express.Router();
const { query, queryOne, execute } = require('../db/pool');
const { requireAuth, requireAdmin } = require('../middleware/auth');

let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = execute(`
      CREATE TABLE IF NOT EXISTS task_completions (
        id            BIGSERIAL PRIMARY KEY,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        bc_project_id BIGINT,
        bc_card_id    BIGINT NOT NULL,
        title         TEXT NOT NULL DEFAULT '',
        url           TEXT NOT NULL DEFAULT '',
        occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, bc_card_id)
      )`)
      .then(() => execute(
        'CREATE INDEX IF NOT EXISTS idx_task_completions_occurred ON task_completions (occurred_at DESC)'
      ))
      .catch((err) => {
        schemaReady = null; // да опита пак при следващото писане
        throw err;
      });
  }
  return schemaReady;
}

function cardIdOf(raw) {
  const id = String(raw || '').replace(/\D/g, '');
  return id || null;
}

// Местене на карта в друг отдел (Pre-Production → Production) я прави НОВ запис
// в Basecamp, с нов bc_card_id — отметката оставаше на стария номер и „се
// губеше" (Венци, 12.10.2026). Затова търсим по номер ИЛИ по заглавие (както
// времето), винаги само за ТОЗИ човек. Заглавието се сравнява без разлика в
// празните места; под 3 знака не се ползва — твърде общо.
function titleKey(raw) {
  // само обикновени интервали/нови редове — точно както в SQL-а долу (Postgres
  // не смята непрекъсваемия интервал за празно място, JS-овото \s го смята)
  const t = String(raw || '').replace(/[ \t\r\n]+/g, ' ').replace(/^ | $/g, '').slice(0, 300);
  return t.length >= 3 ? t : '';
}

async function findMine(userId, cardId, title) {
  return queryOne(
    `SELECT id, bc_card_id, occurred_at FROM task_completions
      WHERE user_id = $1
        AND (bc_card_id = $2
             OR ($3 <> '' AND btrim(regexp_replace(title, E'[ \\t\\r\\n]+', ' ', 'g')) = $3))
      ORDER BY (bc_card_id = $2) DESC, occurred_at DESC
      LIMIT 1`,
    [userId, cardId, titleKey(title)]
  );
}

// Намерено по заглавие на нов номер → пренасочваме реда към новата карта, за да
// е по номер следващия път. Само ако за новия номер още няма ред (UNIQUE).
async function relink(row, cardId, url) {
  if (!row || String(row.bc_card_id) === String(cardId)) return;
  try {
    await query(
      `UPDATE task_completions SET bc_card_id = $2, url = COALESCE(NULLIF($3, ''), url)
        WHERE id = $1
          AND NOT EXISTS (SELECT 1 FROM task_completions t2
                           WHERE t2.user_id = task_completions.user_id AND t2.bc_card_id = $2)`,
      [row.id, cardId, String(url || '').slice(0, 500)]
    );
  } catch (err) {
    console.error('[task-completions relink]', err.message);
  }
}

// GET /api/task-completions/status?bc_card_id=&title=&url= — маркирал ли Е ТОЗИ човек тази карта.
router.get('/status', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const cardId = cardIdOf(req.query.bc_card_id);
    if (!cardId) return res.status(400).json({ error: 'bc_card_id е задължителен' });
    const row = await findMine(req.user.userId, cardId, req.query.title);
    if (row) await relink(row, cardId, req.query.url);
    res.json({ done: !!row, occurredAt: row ? row.occurred_at : null });
  } catch (err) {
    console.error('[task-completions status]', err.message);
    res.status(500).json({ error: 'Вътрешна грешка' });
  }
});

// POST /api/task-completions/toggle { bc_project_id, bc_card_id, title, url }
router.post('/toggle', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const cardId = cardIdOf(req.body && req.body.bc_card_id);
    if (!cardId) return res.status(400).json({ error: 'bc_card_id е задължителен' });

    const existing = await findMine(req.user.userId, cardId, req.body && req.body.title);
    if (existing) {
      await query('DELETE FROM task_completions WHERE id = $1', [existing.id]);
      return res.json({ done: false });
    }

    const projectId = cardIdOf(req.body && req.body.bc_project_id);
    const row = await queryOne(
      `INSERT INTO task_completions (user_id, bc_project_id, bc_card_id, title, url)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, bc_card_id) DO NOTHING
       RETURNING occurred_at`,
      [req.user.userId, projectId, cardId,
       String((req.body && req.body.title) || '').slice(0, 300),
       String((req.body && req.body.url) || '').slice(0, 500)]
    );
    // ON CONFLICT DO NOTHING връща null само при надпревара между два бързи клика —
    // и в двата случая крайният резултат Е "маркирано", затова връщаме done: true.
    res.json({ done: true, occurredAt: row ? row.occurred_at : new Date() });
  } catch (err) {
    console.error('[task-completions toggle]', err.message);
    res.status(500).json({ error: 'Вътрешна грешка' });
  }
});

// ---------- позиция → отдел + скрити хора (⚙ Настройки на „Готови задачи") ----------
//
// Позициите в Екип и роли са длъжности (Видеограф, Монтажист…), а Венци филтрира
// по отдели (Pre-Production / Production / Post-Production / Project Management) —
// затова всяка позиция се закача към отдел. Пази се в `settings` (един JSON ред),
// без нова таблица. Ключът е id на позицията (преименуване не я откача).
const DEPARTMENTS = ['Pre-Production', 'Production', 'Post-Production', 'Project Management'];
const NO_DEPT = '(без отдел)';
// Предложението от демото (13.10.2026) — важи, докато админът не избере друго.
const DEFAULT_DEPT_BY_NAME = {
  'контент криейтър': 'Pre-Production',
  'видеограф': 'Production',
  'монтажист': 'Post-Production',
  'мениджър': 'Project Management',
  'акаунт мениджър': 'Project Management',
};
const CONFIG_KEY = 'done_report_config';

async function loadConfig() {
  const row = await queryOne('SELECT value FROM settings WHERE key = $1', [CONFIG_KEY]);
  let cfg = {};
  try { cfg = row && row.value ? JSON.parse(row.value) : {}; } catch (e) { cfg = {}; }
  return {
    deptMap: cfg.deptMap && typeof cfg.deptMap === 'object' ? cfg.deptMap : {},
    hidden: Array.isArray(cfg.hidden) ? cfg.hidden.map(Number).filter(Boolean) : [],
  };
}

async function saveConfig(cfg) {
  await execute(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [CONFIG_KEY, JSON.stringify({ deptMap: cfg.deptMap, hidden: cfg.hidden })]
  );
}

function deptOfPosition(cfg, positionId, positionName) {
  if (positionId && Object.prototype.hasOwnProperty.call(cfg.deptMap, String(positionId))) {
    return cfg.deptMap[String(positionId)] || NO_DEPT;
  }
  return DEFAULT_DEPT_BY_NAME[String(positionName || '').trim().toLowerCase()] || NO_DEPT;
}

// Позицията и човекът от Basecamp за всеки профил. Позицията се задава в Екип и
// роли ВЪРХУ човека от Basecamp (bc_people.position_id), не върху профила —
// users.position_id е старото поле и остава само като резерва. Връзката профил ↔
// bc_people НЕ е тривиална (проверено на живо, 13.10.2026): users.basecamp_user_id
// е Launchpad id-то от OAuth входа, а bc_people.person_id е id-то в акаунта — две
// различни числа за един човек; а имейлите в bc_people Basecamp ги връща маскирани
// („k••••@…"). Затова: id → имейл → точно име.
const MATCH_BP = `(bp.person_id = u.basecamp_user_id
                   OR (bp.email <> '' AND bp.email = LOWER(u.email))
                   OR LOWER(TRIM(bp.name)) = LOWER(TRIM(u.name)))`;
const MATCH_ORDER = `(bp.person_id = u.basecamp_user_id) DESC NULLS LAST,
                     (bp.email = LOWER(u.email)) DESC, bp.active DESC`;

async function userPositions() {
  const rows = await query(
    `SELECT u.id AS user_id, u.name, u.is_active,
            anyp.person_id AS bc_person_id,
            COALESCE(withp.position_id, u.position_id) AS position_id,
            pos.name AS position_name
       FROM users u
       LEFT JOIN LATERAL (
         SELECT bp.person_id FROM bc_people bp WHERE ${MATCH_BP}
          ORDER BY ${MATCH_ORDER} LIMIT 1
       ) anyp ON TRUE
       LEFT JOIN LATERAL (
         SELECT bp.position_id FROM bc_people bp
          WHERE bp.position_id IS NOT NULL AND ${MATCH_BP}
          ORDER BY ${MATCH_ORDER} LIMIT 1
       ) withp ON TRUE
       LEFT JOIN positions pos ON pos.id = COALESCE(withp.position_id, u.position_id)`
  );
  const map = new Map();
  rows.forEach((r) => map.set(r.user_id, r));
  return map;
}

// същото нормализиране на заглавието като findMine()
const TITLE_SQL = `btrim(regexp_replace(t.title, E'[ \\t\\r\\n]+', ' ', 'g'))`;

// GET /api/task-completions/report?from=YYYY-MM-DD&to=YYYY-MM-DD — класация по
// човек (+ позиция и отдел) за периода и списъкът с отметките.
// Админ и мини админ виждат всички; всеки друг — САМО своите (Венци, 13.10.2026:
// „всеки да може да си следи колко видеа е направил... да вижда само неговите").
//
// „Кой още от отдела е работил" (вариант 2 от демото, избран от Венци): към всяка
// отметка се връщат ДРУГИТЕ хора от СЪЩИЯ отдел, цъкнали „✓ Готово" по същата
// задача — по номер на картата или по заглавие (както findMine), БЕЗ ограничение по
// период: двама монтажисти може да са цъкнали в различни седмици по едно видео.
router.get('/report', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const from = String(req.query.from || '').slice(0, 10);
    const to = String(req.query.to || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ error: 'from/to параметри са задължителни (YYYY-MM-DD)' });
    }
    const seeAll = req.user.role === 'admin' || req.user.role === 'mini_admin';
    // $3 = NULL → всички; иначе само редовете на логнатия човек.
    const onlyUser = seeAll ? null : req.user.userId;

    const [cfg, positions, rows] = await Promise.all([
      loadConfig(),
      userPositions(),
      query(
        `SELECT t.user_id, u.name, t.bc_card_id, t.title, t.url, t.occurred_at, ${TITLE_SQL} AS tkey
           FROM task_completions t
           JOIN users u ON u.id = t.user_id
          WHERE t.occurred_at >= $1::date AND t.occurred_at < $2::date + interval '1 day'
            AND ($3::int IS NULL OR t.user_id = $3::int)
          ORDER BY t.occurred_at DESC`,
        [from, to, onlyUser]
      ),
    ]);
    const hidden = new Set(cfg.hidden);
    const items = rows.filter((r) => !hidden.has(r.user_id));

    const person = (userId, fallbackName) => {
      const p = positions.get(userId) || {};
      return {
        name: p.name || fallbackName || '',
        position: p.position_name || '(без позиция)',
        department: deptOfPosition(cfg, p.position_id, p.position_name),
      };
    };

    // Всички отметки (от всякакъв период) по същите задачи — за „кой още".
    const cardIds = [...new Set(items.map((r) => String(r.bc_card_id)))];
    const keys = [...new Set(items.map((r) => r.tkey).filter((k) => k && k.length >= 3))];
    const related = items.length ? await query(
      `SELECT t.user_id, u.name, t.bc_card_id, t.occurred_at, ${TITLE_SQL} AS tkey
         FROM task_completions t
         JOIN users u ON u.id = t.user_id
        WHERE t.bc_card_id = ANY($1::bigint[]) OR ${TITLE_SQL} = ANY($2::text[])`,
      [cardIds, keys]
    ) : [];

    const byUser = new Map();
    const outItems = items.map((r) => {
      const seen = new Set([r.user_id]);
      const me = person(r.user_id, r.name);
      // САМО колеги от СЪЩИЯ отдел (Венци, 14.10.2026): „нормално е някой да е заснел
      // видеото преди то да стигне до монтаж" — разни отдели по едно видео не са
      // застъпване; интересно е, когато двама монтажисти / двама видеографи / двама
      // контент криейтъри / двама акаунти са цъкнали по една задача. Хора без отдел
      // не се броят за „един отдел" помежду си.
      const others = me.department === NO_DEPT ? [] : related
        .filter((o) => !hidden.has(o.user_id)
          && (String(o.bc_card_id) === String(r.bc_card_id) || (r.tkey && r.tkey.length >= 3 && o.tkey === r.tkey)))
        .sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at))
        .filter((o) => (seen.has(o.user_id) ? false : seen.add(o.user_id)))
        .map((o) => Object.assign({ user_id: o.user_id, occurred_at: o.occurred_at }, person(o.user_id, o.name)))
        .filter((o) => o.department === me.department);

      const b = byUser.get(r.user_id) || Object.assign({ user_id: r.user_id, count: 0, team_count: 0 }, me);
      b.count += 1;
      if (others.length) b.team_count += 1;
      byUser.set(r.user_id, b);

      return Object.assign({ user_id: r.user_id, title: r.title, url: r.url, occurred_at: r.occurred_at, others }, me);
    });

    res.json({
      from, to, mine: !seeAll,
      departments: DEPARTMENTS,
      byUser: [...byUser.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'bg')),
      items: outItems,
    });
  } catch (err) {
    console.error('[task-completions report]', err.message);
    res.status(500).json({ error: 'Вътрешна грешка' });
  }
});

// ---------- ⚙ Настройки (само админ — Венци: „достъп само админите") ----------

// GET /api/task-completions/settings — позиции с отдела им + хората.
router.get('/settings', requireAuth, requireAdmin, async (req, res) => {
  try {
    await ensureSchema();
    const [cfg, positions, posList, counts] = await Promise.all([
      loadConfig(),
      userPositions(),
      query('SELECT id, name FROM positions ORDER BY name'),
      query('SELECT user_id, COUNT(*)::int AS n FROM task_completions GROUP BY user_id'),
    ]);
    const countOf = new Map(counts.map((c) => [c.user_id, c.n]));
    const people = [...positions.values()]
      // активните + всеки с отметки (дори да е деактивиран, за да може да се скрие)
      .filter((p) => p.is_active !== false || countOf.has(p.user_id))
      .map((p) => ({
        user_id: p.user_id, name: p.name, active: p.is_active !== false,
        position_id: p.position_id || null, position_name: p.position_name || '',
        department: deptOfPosition(cfg, p.position_id, p.position_name),
        has_bc_person: !!p.bc_person_id,
        hidden: cfg.hidden.includes(p.user_id),
        total: countOf.get(p.user_id) || 0,
      }))
      .sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name, 'bg'));
    res.json({
      departments: DEPARTMENTS,
      positions: posList.map((p) => ({ id: p.id, name: p.name, department: deptOfPosition(cfg, p.id, p.name) })),
      people,
    });
  } catch (err) {
    console.error('[task-completions settings]', err.message);
    res.status(500).json({ error: 'Вътрешна грешка' });
  }
});

// PUT /api/task-completions/settings/positions/:id { department } — към кой отдел е позицията.
router.put('/settings/positions/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const dept = String((req.body && req.body.department) || '');
    if (!id) return res.status(400).json({ error: 'Невалидна позиция.' });
    if (dept && !DEPARTMENTS.includes(dept)) return res.status(400).json({ error: 'Невалиден отдел.' });
    if (!await queryOne('SELECT id FROM positions WHERE id = $1', [id])) {
      return res.status(404).json({ error: 'Позицията не съществува.' });
    }
    const cfg = await loadConfig();
    cfg.deptMap[String(id)] = dept; // '' = изрично „без отдел"
    await saveConfig(cfg);
    res.json({ ok: true });
  } catch (err) {
    console.error('[task-completions settings/positions]', err.message);
    res.status(500).json({ error: 'Вътрешна грешка' });
  }
});

// PUT /api/task-completions/settings/people/:userId { position_id?, hidden? }
// Позицията се пише на СЪЩОТО място като Настройки → Екип и роли (bc_people) —
// един източник, за да не се разминават двете места. Ако човекът няма запис в
// екипа от Basecamp, се пише в профила (users.position_id).
router.put('/settings/people/:userId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    if (!userId) return res.status(400).json({ error: 'Невалиден човек.' });
    const body = req.body || {};

    if (Object.prototype.hasOwnProperty.call(body, 'position_id')) {
      const posId = body.position_id ? parseInt(body.position_id, 10) : null;
      if (posId && !await queryOne('SELECT id FROM positions WHERE id = $1', [posId])) {
        return res.status(404).json({ error: 'Позицията не съществува.' });
      }
      const p = (await userPositions()).get(userId);
      if (!p) return res.status(404).json({ error: 'Няма такъв човек.' });
      if (p.bc_person_id) {
        await execute('UPDATE bc_people SET position_id = $1 WHERE person_id = $2', [posId, p.bc_person_id]);
      } else {
        await execute('UPDATE users SET position_id = $1, updated_at = NOW() WHERE id = $2', [posId, userId]);
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'hidden')) {
      const cfg = await loadConfig();
      const set = new Set(cfg.hidden);
      if (body.hidden) set.add(userId); else set.delete(userId);
      cfg.hidden = [...set];
      await saveConfig(cfg);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[task-completions settings/people]', err.message);
    res.status(500).json({ error: 'Вътрешна грешка' });
  }
});

module.exports = router;
