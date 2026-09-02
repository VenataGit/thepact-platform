// Дневник на цялостния живот на производствените карти — създаване, кой отдел я
// поема, кои стъпки (заснемане/монтаж/качване) са чекнати, и отпадане от активните
// дъски. Единственият източник за месечните отчети по клиент.
//
// Basecamp не пази история на нищо от това — само сегашното състояние. Затова се
// засича на всеки снапшот (pm-agent/snapshot.js, на 15 мин) чрез сравнение със
// записаното в bc_cards_snap и се пази тук.
//
// Венци (02.09.2026): за да е завършен етап трябва И стъпката на конкретния отдел
// да е чекната, И картата да е преместена към следващия отдел — затова двата вида
// събития (step_completed / board_moved) се пазят поотделно, не слети в едно.
// Освен това: „понякога проект се отказва, но е минал през някой екип" — затова
// card_archived пази последната позната дъска/колона, а всеки ред пази историята
// дори картата по-късно да изчезне от активните.
//
// Засега само СЪБИРАМЕ — как точно ще изглежда отчетът/кое ще е полезно се решава
// по-късно, след като се събере достатъчно данни (Венци, 02.09.2026).
//
// Времето на реда (occurred_at) е моментът на ЗАСИЧАНЕ (следващия sync след
// реалната промяна), освен при card_created — там Basecamp си дава истинското
// created_at. Грешка до ~15 минути за другите видове, приета като достатъчна.
const { execute } = require('../db/pool');
const steps = require('./steps');
const { findEditor } = require('./card-text-log');

let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = execute(`
      CREATE TABLE IF NOT EXISTS bc_stage_events (
        id          BIGSERIAL PRIMARY KEY,
        card_id     BIGINT NOT NULL,
        project_id  BIGINT,
        card_title  TEXT NOT NULL DEFAULT '',
        app_url     TEXT NOT NULL DEFAULT '',
        event_type  TEXT NOT NULL,
        step_key    TEXT NOT NULL DEFAULT '',
        step_title  TEXT NOT NULL DEFAULT '',
        from_board  TEXT NOT NULL DEFAULT '',
        to_board    TEXT NOT NULL DEFAULT '',
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`)
      // Дойдоха по-късно (пълен контекст на момента) — CREATE TABLE IF NOT EXISTS
      // не добавя колони към вече съществуваща таблица (същият подход като
      // card-text-log.js#ensureSchema).
      .then(() => execute(`ALTER TABLE bc_stage_events
        ADD COLUMN IF NOT EXISTS board_title  TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS column_title TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS on_hold      BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS who_id       BIGINT,
        ADD COLUMN IF NOT EXISTS who_name     TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS assignees    JSONB NOT NULL DEFAULT '[]',
        ADD COLUMN IF NOT EXISTS card_due_on  DATE,
        ADD COLUMN IF NOT EXISTS step_due_on  DATE`))
      .then(() => Promise.all([
        execute('CREATE INDEX IF NOT EXISTS idx_bc_stage_events_occurred ON bc_stage_events (occurred_at DESC)'),
        execute('CREATE INDEX IF NOT EXISTS idx_bc_stage_events_card ON bc_stage_events (card_id, occurred_at DESC)'),
        execute('CREATE INDEX IF NOT EXISTS idx_bc_stage_events_type ON bc_stage_events (event_type, occurred_at DESC)'),
      ]))
      .catch((err) => {
        schemaReady = null; // да опита пак при следващото писане
        throw err;
      });
  }
  return schemaReady;
}

// Стъпките нямат стабилен идентификатор в снапшота — сравняват се по заглавие.
// Повтарящо се заглавие се изхвърля изцяло: не се знае коя с коя се съпоставя,
// а грешно съпоставена двойка би родила измислен преход. (Същият подход като
// card-text-log.js#stepDues.)
function stepMap(list) {
  const map = new Map();
  const dupes = new Set();
  for (const s of Array.isArray(list) ? list : []) {
    const title = String((s && s.title) || '').trim();
    if (!title) continue;
    if (map.has(title)) { dupes.add(title); continue; }
    map.set(title, Boolean(s && s.completed));
  }
  dupes.forEach((t) => map.delete(t));
  return map;
}

function assigneesJson(list) {
  return JSON.stringify((Array.isArray(list) ? list : []).map((a) => ({ id: a.id, name: a.name || '' })));
}

async function insertEvent(fields) {
  await ensureSchema();
  await execute(
    `INSERT INTO bc_stage_events
       (card_id, project_id, card_title, app_url, event_type, step_key, step_title,
        from_board, to_board, board_title, column_title, on_hold,
        who_id, who_name, assignees, card_due_on, step_due_on, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [fields.cardId, fields.projectId || null, fields.cardTitle || '', fields.appUrl || '',
     fields.eventType, fields.stepKey || '', fields.stepTitle || '', fields.fromBoard || '',
     fields.toBoard || '', fields.boardTitle || '', fields.columnTitle || '', Boolean(fields.onHold),
     fields.whoId || null, fields.whoName || '', fields.assignees || '[]', fields.cardDueOn || null,
     fields.stepDueOn || null, fields.occurredAt || new Date()]
  );
}

/**
 * Сравнява предишния снапшот на картата с прясната и записва:
 *  - нова карта (никога незасичана преди) — event_type 'card_created';
 *  - смяна на дъската (отдела), под която стои картата — 'board_moved';
 *  - производствена стъпка, минала от невзета към взета — 'step_completed'.
 *
 * @param auth  Basecamp токен (за да се разпознае кой е автора на промяната)
 * @param card  картата (списъчен или пълен payload — носи title, steps, assignees)
 * @param prev  редът от bc_cards_snap отпреди upsert-а ({ board_title, steps }) или null
 * @param meta  { projectId, boardTitle, columnTitle, onHold }
 * @returns брой записани реда
 */
async function logStageTransitions(auth, card, prev, meta) {
  const changes = [];

  if (!prev) {
    changes.push({ event_type: 'card_created', occurred_at: card.created_at ? new Date(card.created_at) : new Date() });
  } else {
    const oldBoard = String(prev.board_title || '').trim();
    const newBoard = String((meta && meta.boardTitle) || '').trim();
    if (oldBoard && newBoard && oldBoard !== newBoard) {
      changes.push({ event_type: 'board_moved', from_board: oldBoard, to_board: newBoard });
    }

    if (Array.isArray(card.steps) && Array.isArray(prev.steps)) {
      const before = stepMap(prev.steps);
      const now = stepMap(card.steps);
      now.forEach((isDone, title) => {
        if (!isDone) return;
        if (!before.has(title)) return; // нова стъпка, не преход
        if (before.get(title) === true) return; // вече е било чекнато
        const key = steps.keyOfTitle(title);
        if (!key) return; // не е производствена стъпка (напр. „Приоритет")
        const stepRow = card.steps.find((s) => String((s && s.title) || '').trim() === title);
        changes.push({
          event_type: 'step_completed', step_key: key, step_title: title,
          step_due_on: (stepRow && stepRow.due_on) || null,
        });
      });
    }
  }

  if (!changes.length) return 0;

  // Едно питане за автора, дори когато няколко неща са се променили наведнъж.
  let who = null;
  if (auth) {
    try {
      who = await findEditor(auth, (meta && meta.projectId) || null, card.id, card.updated_at);
    } catch (err) {
      console.warn('[stage-log] findEditor failed:', card.id, err.message);
    }
  }

  const base = {
    cardId: card.id, projectId: meta && meta.projectId,
    cardTitle: String(card.title || '').trim(), appUrl: card.app_url || '',
    boardTitle: (meta && meta.boardTitle) || '', columnTitle: (meta && meta.columnTitle) || '',
    onHold: meta && meta.onHold, whoId: who ? who.id : null, whoName: who ? who.name : '',
    assignees: assigneesJson(card.assignees), cardDueOn: card.due_on || null,
  };

  for (const ch of changes) {
    await insertEvent({
      ...base, eventType: ch.event_type, stepKey: ch.step_key, stepTitle: ch.step_title,
      fromBoard: ch.from_board, toBoard: ch.to_board, stepDueOn: ch.step_due_on,
      occurredAt: ch.occurred_at,
    });
  }
  return changes.length;
}

/**
 * Карта, изчезнала от активните дъски (архивирана/преместена в Trash/отказана).
 * Пази последното познато състояние — коя дъска/колона я е държала, кой е бил
 * назначен — за да остане следата дори проектът да е бил отказан.
 *
 * @param row  редът от bc_cards_snap ПРЕДИ да се маркира active = FALSE
 *             ({ card_id, project_id, title, app_url, board_title, column_title, due_on, assignees, on_hold })
 */
async function logCardArchived(row) {
  await insertEvent({
    cardId: row.card_id, projectId: row.project_id, cardTitle: row.title || '', appUrl: row.app_url || '',
    eventType: 'card_archived', boardTitle: row.board_title || '', columnTitle: row.column_title || '',
    onHold: row.on_hold, assignees: JSON.stringify(row.assignees || []), cardDueOn: row.due_on || null,
  });
}

module.exports = { logStageTransitions, logCardArchived, ensureSchema };
