// Статистика: нови задачи, заснето, монтирано, качено — плюс преместванията
// между отделите (идея → заснемане → монтаж → PM/качване), нарязани по клиент,
// по отдел (екип) и по конкретен човек.
//
// Клиентът и видеото се четат от заглавието на картата (parseClientKp /
// videoNumberOf от bc-aggregate — единственият източник на тази конвенция).
// „Заснето/монтирано/качено" идват от bc_stage_events (services/stage-log.js):
// стъпка, чекната за конкретния отдел. „Преместено към следващия отдел" идва
// от същата таблица (event_type = 'board_moved') — двата сигнала, поискани от
// Венци (02.09.2026), за да не се брои готов етап само по чекбокса, ако картата
// така и не е тръгнала към следващия отдел.
//
// Отдел = board_title в bc_stage_events: дъската, на която е стояла картата в
// момента на събитието (за преместване — вече новата, целевата дъска). Човек =
// who_name — засича се веднъж на промяна (findEditor в stage-log.js), не винаги
// успява да разпознае автора, затова има кофа "(неизвестно)".
//
// Данните тръгват от 02.09.2026 нататък (датата на пускане) — Basecamp не пази
// история на завършването на стъпки, затова минали месеци не могат да се
// възстановят. „Нови задачи" преди идваха от bc_cards_snap — вече идват от
// bc_stage_events (card_created), за да носят и отдел, и човек като всичко
// останало, от един и същ източник.
const express = require('express');
const router = express.Router();
const { query } = require('../db/pool');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { parseClientKp, videoNumberOf } = require('../services/bc-aggregate');

const NO_CLIENT = '(без клиент)';
const NO_DEPARTMENT = '(без отдел)';
const NO_PERSON = '(неизвестно)';

// Кратки имена за отчета — steps.js държи "Дата за X" (срокове), тук трябва
// самото действие, което е станало.
const STEP_LABELS = { idea: 'Сценарий', shoot: 'Заснемане', edit: 'Монтаж', upload: 'Качване' };

function clientOf(title) {
  const parsed = parseClientKp(title);
  return parsed ? parsed.client : NO_CLIENT;
}

// Три разреза (клиент/отдел/човек) над едни и същи редове — обща форма на
// кофите, за да не се дублира логиката трижди.
function newBucket(name) {
  return { name, newTasks: 0, idea: 0, shoot: 0, edit: 0, upload: 0, moves: 0 };
}
function bucketer() {
  const map = new Map();
  return { map, get(name) { if (!map.has(name)) map.set(name, newBucket(name)); return map.get(name); } };
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
        `SELECT card_id, card_title, app_url, board_title, who_name, occurred_at
           FROM bc_stage_events
          WHERE event_type = 'card_created'
            AND occurred_at >= $1::date AND occurred_at < $2::date + interval '1 day'
          ORDER BY occurred_at ASC`,
        [from, to]
      ),
      query(
        `SELECT card_id, card_title, app_url, board_title, who_name, step_key, step_title, occurred_at
           FROM bc_stage_events
          WHERE event_type = 'step_completed'
            AND occurred_at >= $1::date AND occurred_at < $2::date + interval '1 day'
          ORDER BY occurred_at ASC`,
        [from, to]
      ),
      query(
        `SELECT card_id, card_title, app_url, board_title, who_name, from_board, to_board, occurred_at
           FROM bc_stage_events
          WHERE event_type = 'board_moved'
            AND occurred_at >= $1::date AND occurred_at < $2::date + interval '1 day'
          ORDER BY occurred_at ASC`,
        [from, to]
      ),
    ]);

    const newTasks = newTasksRows.map((r) => ({
      cardId: r.card_id, title: r.card_title, url: r.app_url,
      client: clientOf(r.card_title), video: videoNumberOf(r.card_title),
      department: r.board_title || NO_DEPARTMENT, person: r.who_name || NO_PERSON,
      createdAt: r.occurred_at,
    }));
    const stepEvents = stepRows.map((r) => ({
      cardId: r.card_id, title: r.card_title, url: r.app_url,
      client: clientOf(r.card_title), video: videoNumberOf(r.card_title),
      department: r.board_title || NO_DEPARTMENT, person: r.who_name || NO_PERSON,
      stepKey: r.step_key, stepLabel: STEP_LABELS[r.step_key] || r.step_title,
      occurredAt: r.occurred_at,
    }));
    const moveEvents = moveRows.map((r) => ({
      cardId: r.card_id, title: r.card_title, url: r.app_url,
      client: clientOf(r.card_title), video: videoNumberOf(r.card_title),
      department: r.board_title || NO_DEPARTMENT, person: r.who_name || NO_PERSON,
      fromBoard: r.from_board, toBoard: r.to_board,
      occurredAt: r.occurred_at,
    }));

    const byClient = bucketer();
    const byDepartment = bucketer();
    const byPerson = bucketer();
    newTasks.forEach((t) => {
      byClient.get(t.client).newTasks += 1;
      byDepartment.get(t.department).newTasks += 1;
      byPerson.get(t.person).newTasks += 1;
    });
    stepEvents.forEach((e) => {
      [byClient.get(e.client), byDepartment.get(e.department), byPerson.get(e.person)]
        .forEach((b) => { if (e.stepKey in b) b[e.stepKey] += 1; });
    });
    moveEvents.forEach((e) => {
      byClient.get(e.client).moves += 1;
      byDepartment.get(e.department).moves += 1;
      byPerson.get(e.person).moves += 1;
    });

    const byName = (a, b) => a.name.localeCompare(b.name, 'bg');
    res.json({
      from, to,
      byClient: [...byClient.map.values()].sort(byName),
      byDepartment: [...byDepartment.map.values()].sort(byName),
      byPerson: [...byPerson.map.values()].sort(byName),
      newTasks, stepEvents, moveEvents,
    });
  } catch (err) {
    console.error('[client-report]', err.message);
    res.status(500).json({ error: 'Вътрешна грешка' });
  }
});

module.exports = router;
