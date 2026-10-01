// Дневник на всичко останало в Basecamp освен картите — документи, файлове,
// съобщения от message board, задачи (todos): създаване, редакция, изтриване.
//
// bc_card_text_log/bc_stage_events следят само Kanban::Card. Този дневник е
// същата идея (сравнение на прясното с предишния снапшот, при разлика — ред тук),
// но общ за всеки друг тип запис — виж pm-agent/snapshot.js.
const { query, execute } = require('../db/pool');
const bc = require('./basecamp');
const { plainText } = require('./card-text-log');

const MAX_TEXT = 20000;

let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = execute(`
      CREATE TABLE IF NOT EXISTS bc_activity_log (
        id             BIGSERIAL PRIMARY KEY,
        project_id     BIGINT NOT NULL,
        recording_type TEXT NOT NULL,
        recording_id   BIGINT NOT NULL,
        event          TEXT NOT NULL,
        field          TEXT NOT NULL DEFAULT '',
        title          TEXT NOT NULL DEFAULT '',
        parent_title   TEXT NOT NULL DEFAULT '',
        old_text       TEXT NOT NULL DEFAULT '',
        new_text       TEXT NOT NULL DEFAULT '',
        who_id         BIGINT,
        who_name       TEXT NOT NULL DEFAULT '',
        app_url        TEXT NOT NULL DEFAULT '',
        bc_updated_at  TIMESTAMPTZ,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`)
      .then(() => Promise.all([
        execute('CREATE INDEX IF NOT EXISTS idx_bc_activity_log_created ON bc_activity_log (created_at DESC)'),
        execute('CREATE INDEX IF NOT EXISTS idx_bc_activity_log_project ON bc_activity_log (project_id, created_at DESC)'),
        execute('CREATE INDEX IF NOT EXISTS idx_bc_activity_log_rec ON bc_activity_log (recording_type, recording_id, created_at DESC)'),
        // who_tried: доизвличането на автора (backfillWho) е опитано веднъж — да не
        // се върти безкрай по записи, за които Basecamp не връща събития.
        execute('ALTER TABLE bc_activity_log ADD COLUMN IF NOT EXISTS who_tried BOOLEAN NOT NULL DEFAULT FALSE'),
      ]))
      .catch((err) => {
        schemaReady = null;
        throw err;
      });
  }
  return schemaReady;
}

async function insert(row) {
  await ensureSchema();
  await execute(
    `INSERT INTO bc_activity_log
       (project_id, recording_type, recording_id, event, field, title, parent_title,
        old_text, new_text, who_id, who_name, app_url, bc_updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      row.projectId, row.recordingType, row.recordingId, row.event, row.field || '',
      String(row.title || '').slice(0, 500), String(row.parentTitle || '').slice(0, 300),
      String(row.oldText || '').slice(0, MAX_TEXT), String(row.newText || '').slice(0, MAX_TEXT),
      row.whoId || null, row.whoName || '', row.appUrl || '', row.bcUpdatedAt || null,
    ]
  );
}

/**
 * Сравнява title/content (или само title, ако hasContent=false — файлове нямат
 * четимо съдържание) между предишния снапшот и прясно изтегления запис.
 * Пише по един ред за всяко реално различие ('updated').
 *
 * @returns брой записани реда
 */
async function logDiff({ projectId, recordingType, recordingId, prevRow, currRow, who,
  appUrl, parentTitle, bcUpdatedAt, hasContent = true }) {
  if (!prevRow) return 0;
  const changes = [];

  const oldTitle = String(prevRow.title || '').trim();
  const newTitle = String(currRow.title || '').trim();
  if (oldTitle !== newTitle) changes.push({ field: 'title', old: oldTitle, new: newTitle });

  if (hasContent) {
    const oldBody = plainText(prevRow.content);
    const newBody = plainText(currRow.content);
    if (oldBody !== newBody) changes.push({ field: 'content', old: oldBody, new: newBody });
  }

  if (!changes.length) return 0;

  for (const ch of changes) {
    await insert({
      projectId, recordingType, recordingId, event: 'updated', field: ch.field,
      title: newTitle || oldTitle, parentTitle, oldText: ch.old, newText: ch.new,
      whoId: who ? who.id : null, whoName: who ? who.name : '', appUrl, bcUpdatedAt,
    });
  }
  return changes.length;
}

// Псевдо-събитие без стар/нов текст: 'created' | 'deleted' | 'completed'.
async function logEvent({ projectId, recordingType, recordingId, event, title, parentTitle,
  whoId, whoName, appUrl, bcUpdatedAt }) {
  await insert({ projectId, recordingType, recordingId, event, title, parentTitle, whoId, whoName, appUrl, bcUpdatedAt });
  return 1;
}

// ------------------------------------------------------------------- авторът
//
// Самият запис (документ, файл, съобщение, задача) носи само `creator` — кой го
// е СЪЗДАЛ. Кой го е редактирал, завършил или изтрил се вижда само в събитията
// му (recordings/{id}/events.json). Затова:
//   * created            → creator от payload-а (без допълнителна заявка);
//   * всичко останало    → събитието с подходящо действие, най-близко по време.

function creatorOf(rec) {
  const c = rec && rec.creator;
  return c && c.name ? { id: c.id || null, name: c.name } : null;
}

// Кое действие в събитията отговаря на нашия ред.
const EVENT_ACTION = {
  created: /creat/i,
  completed: /complet/i,
  deleted: /trash|delet|destroy|archiv/i,
};

async function findActor(auth, projectId, recordingId, event, at) {
  try {
    const events = await bc.getRecordingEvents(auth.token, auth.account, projectId, recordingId);
    const withCreator = events.filter((e) => e && e.creator && e.creator.name && e.created_at);
    if (!withCreator.length) return null;
    const re = EVENT_ACTION[event];
    const matching = re ? withCreator.filter((e) => re.test(String(e.action || e.kind || ''))) : [];
    const pool = matching.length ? matching : withCreator;
    const target = at ? new Date(at).getTime() : NaN;
    const best = pool.slice().sort((a, b) => {
      if (Number.isNaN(target)) return new Date(b.created_at) - new Date(a.created_at); // най-новото
      return Math.abs(new Date(a.created_at) - target) - Math.abs(new Date(b.created_at) - target);
    })[0];
    return { id: best.creator.id || null, name: best.creator.name };
  } catch (err) {
    console.warn('[bc-activity-log] events failed for', recordingId, '—', err.message);
    return null;
  }
}

// Доизвлича автора на вече записани редове без име („не се знае") — включително
// тези отпреди тази поправка. Таван на цикъл, защото всеки ред е една заявка.
async function backfillWho(auth, limit = 60) {
  await ensureSchema();
  const rows = await query(
    `SELECT id, project_id, recording_id, event, COALESCE(bc_updated_at, created_at) AS at
       FROM bc_activity_log
      WHERE who_name = '' AND who_tried = FALSE
      ORDER BY id DESC LIMIT $1`,
    [limit]
  );
  // Едно питане на запис, дори да има няколко реда за него.
  const cache = new Map();
  let fixed = 0;
  for (const r of rows) {
    const key = `${r.project_id}:${r.recording_id}:${r.event}`;
    if (!cache.has(key)) {
      // При изтриване/завършване търсим НАЙ-НОВОТО подходящо събитие — засичаме ги
      // до час по-късно, затова времето на реда не е точно.
      const at = r.event === 'deleted' || r.event === 'completed' ? null : r.at;
      cache.set(key, await findActor(auth, r.project_id, r.recording_id, r.event, at));
    }
    const who = cache.get(key);
    await execute(
      `UPDATE bc_activity_log SET who_id = COALESCE($2, who_id), who_name = COALESCE($3, who_name), who_tried = TRUE
        WHERE id = $1`,
      [r.id, who ? who.id : null, who ? who.name : null]
    );
    if (who) fixed += 1;
  }
  return fixed;
}

// Старите редове „създаде" без автор се допълват направо от `creator` на записа,
// докато снапшотът така или иначе минава през него — без нито една заявка.
async function fillCreator(recordingType, recordingId, who) {
  if (!who) return;
  await ensureSchema();
  await execute(
    `UPDATE bc_activity_log SET who_id = $3, who_name = $4
      WHERE recording_type = $1 AND recording_id = $2 AND event = 'created' AND who_name = ''`,
    [recordingType, recordingId, who.id || null, who.name]
  );
}

module.exports = { ensureSchema, logDiff, logEvent, creatorOf, findActor, backfillWho, fillCreator, MAX_TEXT };
