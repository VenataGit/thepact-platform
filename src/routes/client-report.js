// Месечен отчет по клиенти: нови задачи, заснето, монтирано, качено — плюс
// преместванията между отделите (идея → заснемане → монтаж → PM/качване).
//
// Клиентът и видеото се четат от заглавието на картата (parseClientKp /
// videoNumberOf от bc-aggregate — единственият източник на тази конвенция).
// „Заснето/монтирано/качено" идват от bc_stage_events (services/stage-log.js):
// стъпка, чекната за конкретния отдел. „Преместено към следващия отдел" идва
// от същата таблица (event_type = 'board_moved') — двата сигнала, поискани от
// Венци (02.09.2026), за да не се брои готов етап само по чекбокса, ако картата
// така и не е тръгнала към следващия отдел.
//
// Данните тръгват от 02.09.2026 нататък (датата на пускане) — Basecamp не пази
// история на завършването на стъпки, затова минали месеци не могат да се
// възстановят.
const express = require('express');
const router = express.Router();
const { query } = require('../db/pool');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { parseClientKp, videoNumberOf } = require('../services/bc-aggregate');

const NO_CLIENT = '(без клиент)';

// Кратки имена за отчета — steps.js държи "Дата за X" (срокове), тук трябва
// самото действие, което е станало.
const STEP_LABELS = { idea: 'Сценарий', shoot: 'Заснемане', edit: 'Монтаж', upload: 'Качване' };

function clientOf(title) {
  const parsed = parseClientKp(title);
  return parsed ? parsed.client : NO_CLIENT;
}

function rangeParams(req) {
  const from = String(req.query.from || '').slice(0, 10);
  const to = String(req.query.to || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  return [from, to];
}

// GET /api/client-report?from=YYYY-MM-DD&to=YYYY-MM-DD — суровите редове + обобщение по клиент.
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const params = rangeParams(req);
    if (!params) return res.status(400).json({ error: 'from/to параметри са задължителни (YYYY-MM-DD)' });
    const [from, to] = params;

    const [newTasksRows, stepRows, moveRows] = await Promise.all([
      query(
        `SELECT card_id, title, app_url, bc_created_at
           FROM bc_cards_snap
          WHERE bc_created_at >= $1::date AND bc_created_at < $2::date + interval '1 day'
          ORDER BY bc_created_at ASC`,
        [from, to]
      ),
      query(
        `SELECT card_id, card_title, app_url, step_key, step_title, occurred_at
           FROM bc_stage_events
          WHERE event_type = 'step_completed'
            AND occurred_at >= $1::date AND occurred_at < $2::date + interval '1 day'
          ORDER BY occurred_at ASC`,
        [from, to]
      ),
      query(
        `SELECT card_id, card_title, app_url, from_board, to_board, occurred_at
           FROM bc_stage_events
          WHERE event_type = 'board_moved'
            AND occurred_at >= $1::date AND occurred_at < $2::date + interval '1 day'
          ORDER BY occurred_at ASC`,
        [from, to]
      ),
    ]);

    const newTasks = newTasksRows.map((r) => ({
      cardId: r.card_id, title: r.title, url: r.app_url,
      client: clientOf(r.title), video: videoNumberOf(r.title),
      createdAt: r.bc_created_at,
    }));
    const stepEvents = stepRows.map((r) => ({
      cardId: r.card_id, title: r.card_title, url: r.app_url,
      client: clientOf(r.card_title), video: videoNumberOf(r.card_title),
      stepKey: r.step_key, stepLabel: STEP_LABELS[r.step_key] || r.step_title,
      occurredAt: r.occurred_at,
    }));
    const moveEvents = moveRows.map((r) => ({
      cardId: r.card_id, title: r.card_title, url: r.app_url,
      client: clientOf(r.card_title), video: videoNumberOf(r.card_title),
      fromBoard: r.from_board, toBoard: r.to_board,
      occurredAt: r.occurred_at,
    }));

    const byClient = new Map();
    const bucket = (name) => {
      if (!byClient.has(name)) {
        byClient.set(name, { client: name, newTasks: 0, idea: 0, shoot: 0, edit: 0, upload: 0, moves: 0 });
      }
      return byClient.get(name);
    };
    newTasks.forEach((t) => { bucket(t.client).newTasks += 1; });
    stepEvents.forEach((e) => { const b = bucket(e.client); if (e.stepKey in b) b[e.stepKey] += 1; });
    moveEvents.forEach((e) => { bucket(e.client).moves += 1; });

    res.json({
      from, to,
      byClient: [...byClient.values()].sort((a, b) => a.client.localeCompare(b.client, 'bg')),
      newTasks, stepEvents, moveEvents,
    });
  } catch (err) {
    console.error('[client-report]', err.message);
    res.status(500).json({ error: 'Вътрешна грешка' });
  }
});

module.exports = router;
