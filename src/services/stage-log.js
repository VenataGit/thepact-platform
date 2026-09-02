// Дневник на преходите между производствени етапи — кога стъпка (заснемане/монтаж/
// качване) е чекната и кога карта минава от една дъска (отдел) в друга.
//
// Basecamp не пази история на завършването на стъпки, нито на местенето между
// дъски — само сегашното състояние. Затова се засича на всеки снапшот
// (pm-agent/snapshot.js, на 15 мин) чрез сравнение със записаното в bc_cards_snap
// и се пази тук — единственият източник за месечните отчети по клиент
// (Венци, 02.09.2026: „за да е завършен етап трябва и стъпката да е чекната,
// и картата преместена към следващия отдел" — двата вида събития по-долу).
//
// Времето на реда е моментът на ЗАСИЧАНЕ (следващия sync след реалната промяна),
// не точният момент на действието в Basecamp — грешка до ~15 минути, приета като
// достатъчна за месечен отчет.
//
// Пази се дори и картата по-късно да бъде архивирана/отказана — историята на кой
// отдел през нея е минал не изчезва заедно с картата.
const { execute } = require('../db/pool');
const steps = require('./steps');

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
      .then(() => Promise.all([
        execute('CREATE INDEX IF NOT EXISTS idx_bc_stage_events_occurred ON bc_stage_events (occurred_at DESC)'),
        execute('CREATE INDEX IF NOT EXISTS idx_bc_stage_events_card ON bc_stage_events (card_id, occurred_at DESC)'),
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

/**
 * Сравнява предишния снапшот на картата с прясната и записва:
 *  - смяна на дъската (отдела), под която стои картата — „преместена към
 *    следващия отдел";
 *  - всяка производствена стъпка, минала от невзета към взета.
 *
 * @param card  картата (списъчен или пълен payload — носи title, steps)
 * @param prev  редът от bc_cards_snap отпреди upsert-а ({ board_title, steps }) или null
 * @param meta  { projectId, boardTitle }
 * @returns брой записани реда
 */
async function logStageTransitions(card, prev, meta) {
  if (!prev) return 0; // нова карта — няма предишно състояние за сравнение
  const changes = [];

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
      changes.push({ event_type: 'step_completed', step_key: key, step_title: title });
    });
  }

  if (!changes.length) return 0;
  await ensureSchema();
  const title = String(card.title || '').trim();
  const appUrl = card.app_url || '';
  for (const ch of changes) {
    await execute(
      `INSERT INTO bc_stage_events
         (card_id, project_id, card_title, app_url, event_type, step_key, step_title, from_board, to_board)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [card.id, (meta && meta.projectId) || null, title, appUrl, ch.event_type,
       ch.step_key || '', ch.step_title || '', ch.from_board || '', ch.to_board || '']
    );
  }
  return changes.length;
}

module.exports = { logStageTransitions, ensureSchema };
