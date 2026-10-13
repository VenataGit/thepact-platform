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

// GET /api/task-completions/report?from=YYYY-MM-DD&to=YYYY-MM-DD — класация по
// човек (+ отдел от позицията му) за периода, плюс суровия списък за детайли.
router.get('/report', requireAuth, requireAdmin, async (req, res) => {
  try {
    await ensureSchema();
    const from = String(req.query.from || '').slice(0, 10);
    const to = String(req.query.to || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ error: 'from/to параметри са задължителни (YYYY-MM-DD)' });
    }

    const [byUser, items] = await Promise.all([
      query(
        // Позицията се задава в Настройки → Екип и роли ВЪРХУ човека от Basecamp
        // (bc_people.position_id), не върху профила в платформата — затова се
        // взима оттам; users.position_id е старото поле и остава само като резерва.
        // Връзката профил ↔ bc_people НЕ е тривиална (проверено на живо, 13.10.2026):
        // users.basecamp_user_id е Launchpad id-то от OAuth входа, а bc_people.person_id
        // е id-то в акаунта — две различни числа за един човек; а имейлите в bc_people
        // Basecamp ги връща маскирани („k••••@…"). Затова: id → имейл → точно име.
        `SELECT u.id AS user_id, u.name,
                COALESCE(NULLIF(p.name, ''), '(без позиция)') AS department,
                COUNT(*)::int AS count
           FROM task_completions t
           JOIN users u ON u.id = t.user_id
           LEFT JOIN LATERAL (
             SELECT bp.position_id FROM bc_people bp
              WHERE bp.position_id IS NOT NULL
                AND (bp.person_id = u.basecamp_user_id
                     OR (bp.email <> '' AND bp.email = LOWER(u.email))
                     OR LOWER(TRIM(bp.name)) = LOWER(TRIM(u.name)))
              ORDER BY (bp.person_id = u.basecamp_user_id) DESC NULLS LAST,
                       (bp.email = LOWER(u.email)) DESC,
                       bp.active DESC
              LIMIT 1
           ) bp ON TRUE
           LEFT JOIN positions p ON p.id = COALESCE(bp.position_id, u.position_id)
          WHERE t.occurred_at >= $1::date AND t.occurred_at < $2::date + interval '1 day'
          GROUP BY u.id, u.name, p.name
          ORDER BY count DESC, u.name ASC`,
        [from, to]
      ),
      query(
        `SELECT t.user_id, u.name, t.title, t.url, t.occurred_at
           FROM task_completions t
           JOIN users u ON u.id = t.user_id
          WHERE t.occurred_at >= $1::date AND t.occurred_at < $2::date + interval '1 day'
          ORDER BY t.occurred_at DESC`,
        [from, to]
      ),
    ]);

    res.json({ from, to, byUser, items });
  } catch (err) {
    console.error('[task-completions report]', err.message);
    res.status(500).json({ error: 'Вътрешна грешка' });
  }
});

module.exports = router;
