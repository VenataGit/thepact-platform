// Опашката „създай папките за тази задача".
//
// Платформата е на VPS в Хетцнер и НЯМА достъп до вътрешния сървър (Z: е
// \\192.168.31.147\Production — локална мрежа). Затова тя само записва какво трябва да
// се направи, а истинската работа я върши малък агент на компютъра в офиса, който
// дърпа опашката по HTTP (folder-agent/worker.js). Същият модел като Dev Queue-то.
//
// Пълни се САМО при създаване на нова задача (решение на Венци, 12.08.2026) — нищо не
// се прави със заварените карти.
//
// Таблицата се създава сама при първа нужда: db/migrations/ не се прилага при deploy.
const { query, queryOne, execute } = require('../db/pool');
const fp = require('./folder-paths');

let tableReady = false;

async function ensureTable() {
  if (tableReady) return;
  await execute(`
    CREATE TABLE IF NOT EXISTS folder_jobs (
      id SERIAL PRIMARY KEY,
      bc_card_id TEXT,
      title TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'video',
      files_path TEXT NOT NULL,
      export_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INT NOT NULL DEFAULT 0,
      result TEXT,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await execute('CREATE INDEX IF NOT EXISTS folder_jobs_status_idx ON folder_jobs (status, id)');
  await execute("ALTER TABLE folder_jobs ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'video'");
  tableReady = true;
}

// Заявка за една задача. Незразпознато заглавие → не пишем нищо (както и при блока с
// локациите: по-добре нищо, отколкото папка на грешно място).
// Никога не хвърля — картата в Basecamp вече е създадена и не бива да пада заради нас.
async function enqueue({ cardId, title }) {
  try {
    const paths = fp.pathsForTitle(title);
    if (!paths) return null;

    await ensureTable();

    // Един и същ път не се пуска два пъти (пре-създаване на КП, повторен клик…).
    const dup = await queryOne(
      "SELECT id FROM folder_jobs WHERE files_path = $1 AND status <> 'error' LIMIT 1",
      [paths.files.win]
    );
    if (dup) return null;

    // 'video' → вътре влиза и папка „Assets"; 'block' е самата папка на КП/рекламите.
    const kind = (paths.parsed.videoNumber || paths.parsed.kind === 'free') ? 'video' : 'block';

    const row = await queryOne(
      `INSERT INTO folder_jobs (bc_card_id, title, kind, files_path, export_path)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [cardId ? String(cardId) : null, String(title).slice(0, 300), kind, paths.files.win, paths.exported.win]
    );
    return row ? row.id : null;
  } catch (e) {
    console.error('[folder-queue enqueue]', e.message);
    return null;
  }
}

// Следващата чакаща заявка, заключена за агента.
async function claimNext() {
  await ensureTable();
  return queryOne(`
    UPDATE folder_jobs SET status = 'running', attempts = attempts + 1, updated_at = NOW()
     WHERE id = (SELECT id FROM folder_jobs WHERE status = 'pending' ORDER BY id LIMIT 1)
     RETURNING *`);
}

async function complete(id, { ok, result, error }) {
  await ensureTable();
  return queryOne(
    `UPDATE folder_jobs SET status = $2, result = $3, error = $4, updated_at = NOW()
      WHERE id = $1 AND status = 'running' RETURNING *`,
    [id, ok ? 'done' : 'error', (result || '').slice(0, 2000), (error || '').slice(0, 2000)]
  );
}

// Заседнали заявки (агентът е паднал по средата) се връщат в опашката след 30 мин,
// но не повече от 3 опита — иначе една счупена заявка се върти вечно.
async function requeueStale() {
  await ensureTable();
  const rows = await query(`
    UPDATE folder_jobs SET status = CASE WHEN attempts >= 3 THEN 'error' ELSE 'pending' END,
           error = CASE WHEN attempts >= 3 THEN 'агентът не отговори след 3 опита' ELSE error END,
           updated_at = NOW()
     WHERE status = 'running' AND updated_at < NOW() - INTERVAL '30 minutes'
     RETURNING id`);
  return rows.length;
}

async function recent(limit = 40) {
  await ensureTable();
  return query('SELECT * FROM folder_jobs ORDER BY id DESC LIMIT $1', [Math.min(200, Math.max(1, limit))]);
}

module.exports = { ensureTable, enqueue, claimNext, complete, requeueStale, recent };
