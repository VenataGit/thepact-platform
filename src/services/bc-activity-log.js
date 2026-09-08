// Дневник на всичко останало в Basecamp освен картите — документи, файлове,
// съобщения от message board, задачи (todos): създаване, редакция, изтриване.
//
// bc_card_text_log/bc_stage_events следят само Kanban::Card. Този дневник е
// същата идея (сравнение на прясното с предишния снапшот, при разлика — ред тук),
// но общ за всеки друг тип запис — виж pm-agent/snapshot.js.
const { execute } = require('../db/pool');
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

module.exports = { ensureSchema, logDiff, logEvent, MAX_TEXT };
