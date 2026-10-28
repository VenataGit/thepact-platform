// AI опашката: Claude през АБОНАМЕНТА на компютъра в офиса, не през платеното API.
//
// Решение на Венци (28.10.2026, задача „Кредиси"): никакви API токени — всичко да
// върви като Dev Queue-то. Платформата само записва заявката (system + messages) в
// ai_jobs и чака; агентът на компютъра (D:\Claude ThePact\ai-agent\worker.js) я
// дърпа по HTTP, пуска Claude Code (`claude -p`, без инструменти) с абонамента и
// връща текста. За викащия код (callClaude) това изглежда като обикновен отговор.
//
// Ограничение: tool use (чатът на PM агента) не минава оттук — Claude Code не може
// да вика инструментите на платформата.
//
// Таблицата се създава сама при първа нужда: db/migrations/ не се прилага при deploy.
const { queryOne, execute } = require('../db/pool');

const POLL_MS = 2000;
const CLAIM_TIMEOUT_MS = 10 * 60_000;  // компютърът не е взел заявката → грешка
const RUN_TIMEOUT_MS = 30 * 60_000;    // взета, но няма отговор → грешка

let tableReady = false;

async function ensureTable() {
  if (tableReady) return;
  await execute(`
    CREATE TABLE IF NOT EXISTS ai_jobs (
      id SERIAL PRIMARY KEY,
      kind TEXT,
      model TEXT,
      effort TEXT,
      request JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      result_text TEXT,
      usage JSONB,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      claimed_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ
    )`);
  await execute('CREATE INDEX IF NOT EXISTS ai_jobs_status_idx ON ai_jobs (status, id)');
  tableReady = true;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Записва заявката и чака компютъра. Връща същата форма като API-то:
// { text, content, usage, model, stopReason }.
async function run({ system, messages, effort, model, kind }) {
  await ensureTable();
  const job = await queryOne(
    'INSERT INTO ai_jobs (kind, model, effort, request) VALUES ($1,$2,$3,$4) RETURNING id',
    [kind || null, model || null, effort || null, JSON.stringify({ system: system || '', messages })]
  );
  const started = Date.now();
  let claimedAt = null;
  for (;;) {
    await sleep(POLL_MS);
    const row = await queryOne('SELECT status, result_text, usage, model, error, claimed_at FROM ai_jobs WHERE id = $1', [job.id]);
    if (!row) throw new Error('AI заявката изчезна от опашката.');
    if (row.status === 'done') {
      const text = row.result_text || '';
      return {
        text,
        content: [{ type: 'text', text }],
        usage: row.usage || {},
        model: row.model || model,
        stopReason: 'end_turn',
      };
    }
    if (row.status === 'error') throw new Error(`Claude (абонамент): ${row.error || 'неизвестна грешка'}`);
    if (row.claimed_at && !claimedAt) claimedAt = Date.now();
    const late = claimedAt
      ? Date.now() - claimedAt > RUN_TIMEOUT_MS
      : Date.now() - started > CLAIM_TIMEOUT_MS;
    if (late) {
      const msg = claimedAt
        ? 'компютърът взе заявката, но не върна отговор навреме'
        : 'компютърът в офиса не взе заявката (изключен ли е?)';
      await execute("UPDATE ai_jobs SET status = 'error', error = $2, finished_at = NOW() WHERE id = $1 AND status IN ('pending','running')",
        [job.id, msg]).catch(() => {});
      throw new Error(`Claude (абонамент): ${msg}.`);
    }
  }
}

// Следващата чакаща заявка, заключена за агента. ?peek → само поглед.
async function claimNext({ peek = false } = {}) {
  await ensureTable();
  if (peek) return queryOne("SELECT id, kind, model, created_at FROM ai_jobs WHERE status = 'pending' ORDER BY id LIMIT 1");
  return queryOne(`
    UPDATE ai_jobs SET status = 'running', claimed_at = NOW()
     WHERE id = (SELECT id FROM ai_jobs WHERE status = 'pending' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
     RETURNING id, kind, model, effort, request`);
}

async function complete(id, { ok, text, usage, model, error }) {
  await ensureTable();
  return queryOne(
    `UPDATE ai_jobs SET status = $2, result_text = $3, usage = $4, model = COALESCE($5, model),
            error = $6, finished_at = NOW()
      WHERE id = $1 AND status = 'running' RETURNING id, status`,
    [id, ok ? 'done' : 'error', ok ? String(text || '') : null, usage ? JSON.stringify(usage) : null,
      model || null, ok ? null : String(error || 'грешка').slice(0, 2000)]
  );
}

async function status() {
  await ensureTable();
  return queryOne(`
    SELECT COUNT(*) FILTER (WHERE status = 'pending') AS pending,
           COUNT(*) FILTER (WHERE status = 'running') AS running,
           COUNT(*) FILTER (WHERE status = 'done' AND finished_at > NOW() - INTERVAL '24 hours') AS done_24h,
           COUNT(*) FILTER (WHERE status = 'error' AND finished_at > NOW() - INTERVAL '24 hours') AS error_24h,
           MAX(claimed_at) AS last_claimed
      FROM ai_jobs`);
}

module.exports = { run, claimNext, complete, status };
