// Content агент — импорт в паметта на клиента.
//
// Два пътя, една логика (importText):
//   1. Поставен текст / малък текстов файл → направо importText.
//   2. Качен файл (PDF, Word, Excel, PowerPoint, видео, аудио, снимка…) → пази се временно
//      в UPLOAD_DIR → компютърът в офиса (ai-agent/worker.js през /api/ai-queue/imports/*)
//      го сваля, ПАЗИ го при себе си, вади текста (pdftotext / Python / Whisper) и го връща
//      → importText → временният файл се трие. Снимките се описват от Claude (през AI
//      опашката, пак на компютъра).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { query, queryOne, execute } = require('../../db/pool');
const store = require('./store');
const caHistory = require('./history');
const { callJson, TEAM, block } = require('./agents');

const UPLOAD_DIR = path.join(os.tmpdir(), 'ca-imports');
const KEEP_DAYS = 7;          // невзет/забравен временен файл се трие след толкова
const STUCK_HOURS = 3;        // „processing" без отговор → пак в опашката

const IMPORT_SYSTEM = `${TEAM}

Ти си ПАЗИТЕЛЯТ НА ПАМЕТТА. Получаваш документ за клиент (карта, проучване, стари скриптове, бележки от среща, коментари, транскрипт на видео или аудио, описание на снимка). Разбий го на отделни кратки записи за паметта на клиента.
Видове: profile (факт за бизнеса, продукти, аудитория, цели), like (харесва), dislike (не харесва), rule (правило/забрана), voice (как говори — цитат или описание на гласа), past_video (видео, което сме правили — заглавие, идея, как се е представило), note (друго полезно).
Всеки запис е самостоятелен и разбираем без документа. Не измисляй нищо. Пропусни организационни неща (фактури, логистика, срещи), освен ако не казват нещо за съдържанието. Минали скриптове: по един past_video запис на видео (заглавие + идея в 1-2 изречения), а характерни реплики → voice. Транскрипт на видео/аудио с клиента: как говори → voice, какво казва за бизнеса → profile/like/dislike/rule.
Отговори с JSON: {"items": [{"kind": "...", "text": "..."}]}`;

/** Текст → записи в паметта (чакат одобрение). Връща броя добавени. */
async function importText({ clientId, text, filename, by }) {
  const client = await store.getClient(clientId);
  if (!client) throw new Error('Клиентът не е намерен.');
  const existing = await store.memoryText(clientId);
  const out = await callJson({
    system: IMPORT_SYSTEM,
    user: [block('клиент', client.name), block('вече_в_паметта', existing), block('документ', String(text).slice(0, 200000))].join('\n\n'),
    effort: 'low', maxTokens: 20000,
  });
  let added = 0;
  for (const it of (out.items || []).slice(0, 300)) {
    if (!it || !store.KINDS.includes(it.kind) || !String(it.text || '').trim()) continue;
    const r = await queryOne(
      `INSERT INTO ca_memory (client_id, kind, text, source, status, created_by)
       SELECT $1,$2,$3,$4,'pending',$5
        WHERE NOT EXISTS (SELECT 1 FROM ca_memory WHERE client_id = $1 AND lower(text) = lower($3))
       RETURNING *`,
      [clientId, it.kind, String(it.text).trim().slice(0, 5000), `Импорт: ${filename}`, (by && by.name) || '']
    );
    if (r) { added++; await caHistory.log('memory', 'create', null, r, by); }
  }
  return added;
}

// ---------- качени файлове ----------

function ensureDir() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  return UPLOAD_DIR;
}

// Стари временни файлове (компютърът не ги е взел / вече са обработени).
async function cleanup() {
  try {
    const rows = await query(
      `SELECT id, tmp_path FROM ca_imports WHERE tmp_path <> '' AND created_at < NOW() - ($1 || ' days')::interval`,
      [String(KEEP_DAYS)]
    );
    for (const r of rows) {
      try { fs.rmSync(r.tmp_path, { force: true }); } catch { /* */ }
      await execute(
        `UPDATE ca_imports SET tmp_path = '',
                status = CASE WHEN status IN ('uploaded','processing') THEN 'error' ELSE status END,
                error = CASE WHEN status IN ('uploaded','processing') THEN 'компютърът не го обработи 7 дни' ELSE error END
          WHERE id = $1`, [r.id]);
    }
  } catch (e) { console.warn('[content-agent imports] cleanup:', e.message); }
}

async function createImport({ clientId, file, by }) {
  await store.ensureSchema();
  const row = await queryOne(
    `INSERT INTO ca_imports (client_id, filename, mime, size, tmp_path, created_by, created_by_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [clientId, String(file.originalname || 'файл').slice(0, 250), file.mimetype || '', file.size || 0, file.path,
     (by && by.name) || '', (by && by.id) || null]
  );
  cleanup();
  return row;
}

async function listForClient(clientId, limit = 20) {
  await store.ensureSchema();
  return query(
    `SELECT id, filename, mime, size, status, kind, pc_path, text_len, added, note, error, created_by, created_at, finished_at
       FROM ca_imports WHERE client_id = $1 ORDER BY id DESC LIMIT $2`,
    [clientId, limit]
  );
}

/** За компютъра: следващият файл за обработка (или зациклил от преди STUCK_HOURS). */
async function claimNext() {
  await store.ensureSchema();
  return queryOne(
    `UPDATE ca_imports i SET status = 'processing', claimed_at = NOW()
      WHERE i.id = (SELECT id FROM ca_imports
                     WHERE tmp_path <> '' AND (status = 'uploaded'
                        OR (status = 'processing' AND claimed_at < NOW() - ($1 || ' hours')::interval))
                     ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING i.id, i.client_id, i.filename, i.mime, i.size,
                (SELECT name FROM kp_clients c WHERE c.id = i.client_id) AS client_name`,
    [String(STUCK_HOURS)]
  );
}

async function fileFor(id) {
  const r = await queryOne("SELECT tmp_path, filename FROM ca_imports WHERE id = $1 AND status = 'processing'", [id]);
  return r && r.tmp_path && fs.existsSync(r.tmp_path) ? r : null;
}

const IMAGE_SYSTEM = `${TEAM}

Опиши подробно какво има на снимката, полезно за екипа, който прави видеа за клиента: продукти, марки, текстове (препиши ги точно), хора, място, стил, цветове, настроение. Ако е екранна снимка на съобщение/коментар/статистика — препиши съдържанието дословно.
Отговори с JSON: {"text": "описанието"}`;

async function describeImage(file, mime) {
  const st = fs.statSync(file);
  if (st.size > 5 * 1024 * 1024) throw new Error('снимката е над 5 MB');
  const type = /png/i.test(mime) ? 'image/png' : /webp/i.test(mime) ? 'image/webp' : /gif/i.test(mime) ? 'image/gif' : 'image/jpeg';
  const out = await callJson({
    system: IMAGE_SYSTEM, effort: 'low', maxTokens: 4000,
    user: [{ type: 'image', source: { type: 'base64', media_type: type, data: fs.readFileSync(file).toString('base64') } },
      { type: 'text', text: 'Опиши снимката.' }],
  });
  return String(out.text || '');
}

/**
 * Компютърът връща резултата. Отговаряме веднага; AI частта (записите в паметта)
 * върви фоново — тя също минава през опашката на същия компютър.
 */
async function complete(id, b) {
  const row = await queryOne("SELECT * FROM ca_imports WHERE id = $1 AND status = 'processing'", [id]);
  if (!row) return null;
  if (!b.ok) {
    await execute(
      "UPDATE ca_imports SET status = 'error', error = $2, pc_path = $3, finished_at = NOW() WHERE id = $1",
      [id, String(b.error || 'неуспешно').slice(0, 500), String(b.pc_path || '').slice(0, 500)]
    );
    return { status: 'error' };
  }
  await execute(
    `UPDATE ca_imports SET status = 'importing', kind = $2, pc_path = $3, note = $4, text_len = $5 WHERE id = $1`,
    [id, String(b.kind || ''), String(b.pc_path || '').slice(0, 500), String(b.note || '').slice(0, 500), String(b.text || '').length]
  );
  setImmediate(async () => {
    try {
      let text = String(b.text || '');
      if (b.kind === 'image') text = await describeImage(row.tmp_path, row.mime);
      if (text.trim().length < 20) throw new Error(b.note || 'във файла няма текст за импорт');
      const by = { name: row.created_by, id: row.created_by_id };
      const added = await importText({ clientId: row.client_id, text, filename: row.filename, by });
      await execute("UPDATE ca_imports SET status = 'done', added = $2, finished_at = NOW() WHERE id = $1", [id, added]);
    } catch (e) {
      await execute("UPDATE ca_imports SET status = 'error', error = $2, finished_at = NOW() WHERE id = $1",
        [id, String(e.message || e).slice(0, 500)]).catch(() => {});
    } finally {
      try { fs.rmSync(row.tmp_path, { force: true }); } catch { /* */ }
      await execute("UPDATE ca_imports SET tmp_path = '' WHERE id = $1", [id]).catch(() => {});
    }
  });
  return { status: 'importing' };
}

module.exports = { importText, createImport, listForClient, claimNext, fileFor, complete, ensureDir, UPLOAD_DIR };
