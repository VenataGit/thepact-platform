// Content агент — каталог с формати.
//
// Анализаторът на видео вече казва за всяко успешно видео какво се прави в него
// (формат, кукичка, структура). Тук агентът „Каталогизатор на формати" (+ проверител)
// ги подрежда в общ каталог: всяко видео отива в съществуващ формат или (ако наистина е
// друго) в нов — с име от няколко думи, кратко описание и как да се ползва за клиент.
// Видеата стават примерите към формата. Пуска се фоново след анализа на видеата и след
// нощното търсене, и ръчно от раздел „Формати".
const { query, queryOne, execute } = require('../../db/pool');
const store = require('./store');
const { runStep } = require('./agents');

const BATCH = 25;
const CATEGORIES = ['Хумор и скеч', 'Съвет и обучение', 'Продукт и демо', 'Преди и след', 'Процес и изработка',
  'POV и разпознаване', 'Тест и предизвикателство', 'Отговор и реакция', 'Естетика и атмосфера', 'Разказ и мистерия'];
const MAX_BATCHES = 8;      // на едно пускане — до 200 видеа
let running = false;

/** Колко анализирани успешни видеа още не са минали през каталога. */
async function pendingCount() {
  await store.ensureSchema();
  const r = await queryOne(
    `SELECT COUNT(*)::int AS n FROM ca_videos v
      WHERE v.analysis IS NOT NULL AND v.outlier_score >= 2
        AND NOT EXISTS (SELECT 1 FROM ca_format_videos f WHERE f.video_id = v.id)`
  );
  return r.n;
}

async function catalogBatch(usage) {
  const videos = await query(
    `SELECT v.id, v.platform, v.caption, v.outlier_score, v.analysis
       FROM ca_videos v
      WHERE v.analysis IS NOT NULL AND v.outlier_score >= 2
        AND NOT EXISTS (SELECT 1 FROM ca_format_videos f WHERE f.video_id = v.id)
      ORDER BY v.outlier_score DESC LIMIT $1`,
    [BATCH]
  );
  if (!videos.length) return { done: true, assigned: 0, created: 0 };
  const formats = await query(
    `SELECT f.id, f.name, f.description, COUNT(fv.video_id)::int AS examples
       FROM ca_formats f LEFT JOIN ca_format_videos fv ON fv.format_id = f.id
      GROUP BY f.id ORDER BY examples DESC, f.id`
  );
  const ctx = {
    formats: formats.map((f) => ({ id: f.id, name: f.name, description: f.description, examples: f.examples })),
    videos: videos.map((v) => {
      const a = v.analysis || {};
      const h = a.hook || {};
      return {
        video_id: v.id, platform: v.platform,
        format: a.format, hook_archetype: h.archetype, hook_spoken: h.spoken, hook_visual: h.visual,
        structure: Array.isArray(a.structure) ? a.structure.slice(0, 5) : a.structure,
        why_it_works: a.why_it_works, partial: !!(a.meta && a.meta.partial),
        caption: String(v.caption || '').slice(0, 200),
      };
    }),
  };
  const { output } = await runStep('formats', ctx, null, usage);

  // Новите формати първо — после разпределението.
  const keyToId = {};
  let created = 0;
  for (const nf of (output.new_formats || [])) {
    const name = String(nf.name || '').trim().slice(0, 80);
    if (!name || !nf.key) continue;
    const same = formats.find((f) => f.name.toLowerCase() === name.toLowerCase());
    if (same) { keyToId[nf.key] = same.id; continue; }
    const row = await queryOne(
      'INSERT INTO ca_formats (name, description, how_to, pitch, category) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [name, String(nf.description || '').slice(0, 400), String(nf.how_to || '').slice(0, 600),
       String(nf.pitch || '').slice(0, 300), CATEGORIES.includes(nf.category) ? nf.category : '']
    );
    keyToId[nf.key] = row.id;
    created += 1;
  }
  const validIds = new Set([...formats.map((f) => f.id), ...Object.values(keyToId)]);
  const ids = new Set(videos.map((v) => v.id));
  let assigned = 0;
  for (const a of (output.assign || [])) {
    const vid = Number(a.video_id);
    if (!ids.has(vid)) continue;
    let fid = a.format_id != null ? Number(a.format_id) : (a.new_format_key ? keyToId[a.new_format_key] : null);
    if (fid != null && !validIds.has(fid)) fid = null;
    await execute(
      `INSERT INTO ca_format_videos (video_id, format_id, note) VALUES ($1,$2,$3)
       ON CONFLICT (video_id) DO UPDATE SET format_id = EXCLUDED.format_id, note = EXCLUDED.note`,
      [vid, fid, String(a.note || '').slice(0, 300)]
    );
    ids.delete(vid);
    if (fid != null) assigned += 1;
  }
  // Пропуснатите от агента — маркирани като прегледани без формат, за да не зациклим.
  for (const vid of ids) {
    await execute('INSERT INTO ca_format_videos (video_id, format_id) VALUES ($1, NULL) ON CONFLICT DO NOTHING', [vid]);
  }
  if (created) await execute('UPDATE ca_formats SET updated_at = NOW() WHERE id = ANY($1::int[])', [Object.values(keyToId)]);
  return { done: false, assigned, created };
}

/**
 * Слива почти еднаквите формати (агент „Редактор на каталога" + проверител): видеата на
 * слетите отиват при оставащия, а празните формати се махат. До 3 минавания.
 */
async function consolidate(usage) {
  let merged = 0;
  for (let pass = 0; pass < 3; pass++) {
    const formats = await query(
      `SELECT f.id, f.name, f.description, COUNT(fv.video_id)::int AS videos
         FROM ca_formats f LEFT JOIN ca_format_videos fv ON fv.format_id = f.id
        GROUP BY f.id ORDER BY videos DESC, f.id`
    );
    if (formats.length <= 30) break;
    const { output } = await runStep('format_merge', { formats }, null, usage);
    const exists = new Set(formats.map((f) => f.id));
    const used = new Set();
    let passMerged = 0;
    for (const m of (output.merges || [])) {
      const keep = Number(m.keep_id);
      const ids = (m.merge_ids || []).map(Number).filter((id) => exists.has(id) && id !== keep && !used.has(id));
      if (!exists.has(keep) || used.has(keep) || !ids.length) continue;
      used.add(keep); ids.forEach((id) => used.add(id));
      await execute('UPDATE ca_format_videos SET format_id = $1 WHERE format_id = ANY($2::int[])', [keep, ids]);
      await execute(
        `UPDATE ca_formats SET name = COALESCE(NULLIF($2, ''), name), description = COALESCE(NULLIF($3, ''), description),
                how_to = COALESCE(NULLIF($4, ''), how_to), pitch = '', updated_at = NOW() WHERE id = $1`,
        [keep, String(m.name || '').slice(0, 80), String(m.description || '').slice(0, 400), String(m.how_to || '').slice(0, 600)]
      );
      // Само форматите, останали без видеа след сливането (създадени от агента).
      await execute(
        'DELETE FROM ca_formats f WHERE f.id = ANY($1::int[]) AND NOT EXISTS (SELECT 1 FROM ca_format_videos v WHERE v.format_id = f.id)',
        [ids]
      );
      passMerged += ids.length;
    }
    merged += passMerged;
    if (!passMerged) break;
  }
  if (merged) console.log(`[content-agent formats] слети ${merged} формата`);
  return merged;
}

/**
 * Кратко, конкретно описание („pitch") + категория за форматите без тях (и за слетите —
 * сливането чисти pitch-а, за да се опише наново цялата група). По 15 наведнъж.
 */
async function describe(usage) {
  let done = 0;
  for (let pass = 0; pass < 6; pass++) {
    const fs = await query("SELECT id, name, description FROM ca_formats WHERE pitch = '' ORDER BY id LIMIT 15");
    if (!fs.length) break;
    const ex = await query(
      `SELECT * FROM (SELECT fv.format_id, v.analysis->'hook'->>'visual' AS visual, v.analysis->'hook'->>'spoken' AS spoken,
              v.analysis->'hook'->>'on_screen' AS on_screen, v.analysis->>'format' AS format,
              ROW_NUMBER() OVER (PARTITION BY fv.format_id ORDER BY v.outlier_score DESC) AS rn
         FROM ca_format_videos fv JOIN ca_videos v ON v.id = fv.video_id WHERE fv.format_id = ANY($1::int[])) x WHERE rn <= 3`,
      [fs.map((f) => f.id)]
    );
    const formats = fs.map((f) => ({ ...f, examples: ex.filter((e) => e.format_id === f.id).map(({ format_id, rn, ...r }) => r) }));
    const { output } = await runStep('format_describe', { formats }, null, usage);
    const ids = new Set(fs.map((f) => f.id));
    let n = 0;
    for (const o of (output.formats || [])) {
      const id = Number(o.id);
      if (!ids.has(id) || !String(o.pitch || '').trim()) continue;
      await execute('UPDATE ca_formats SET pitch = $2, category = $3, updated_at = NOW() WHERE id = $1',
        [id, String(o.pitch).slice(0, 300), CATEGORIES.includes(o.category) ? o.category : 'Друго']);
      n += 1;
    }
    done += n;
    if (!n) break;
  }
  return done;
}

/** Каталогизира до MAX_BATCHES партиди. Едно пускане наведнъж. Никога не хвърля. */
async function runCatalog({ maxBatches = MAX_BATCHES } = {}) {
  if (running) return { skipped: 'running' };
  running = true;
  const total = { assigned: 0, created: 0, batches: 0 };
  try {
    await store.ensureSchema();
    for (let i = 0; i < maxBatches; i++) {
      const r = await catalogBatch({});
      if (r.done) break;
      total.assigned += r.assigned; total.created += r.created; total.batches += 1;
    }
    if (total.batches) console.log(`[content-agent formats] ${total.assigned} видеа в каталога, ${total.created} нови формата`);
    total.merged = await consolidate({});
    total.described = await describe({});
    return total;
  } catch (e) {
    console.error('[content-agent formats]', e.message);
    return { ...total, error: e.message };
  } finally {
    running = false;
  }
}

// ---------- Ловец на формати ----------
// Бутон „Намери нови формати": анализира още от успешните видеа, които вече имаме, но не са
// гледани (TikTok/Instagram — пълен анализ с кадри и звук; най-свежите и най-успешните,
// по едно на профил за разнообразие), после ги подрежда в каталога. Без нов Apify разход.
let hunting = false;
let lastHunt = null;

async function hunt({ limit = 20, budgetMs = 40 * 60_000 } = {}) {
  if (hunting) return { skipped: 'running' };
  hunting = true;
  const started = Date.now();
  const res = { at: new Date().toISOString(), analyzed: 0, failed: 0 };
  try {
    await store.ensureSchema();
    const va = require('./video-analysis');
    const list = await query(
      `SELECT * FROM (
         SELECT DISTINCT ON (v.profile_id) v.*
           FROM ca_videos v JOIN ca_profiles p ON p.id = v.profile_id
          WHERE p.active AND v.platform IN ('tiktok','instagram') AND v.outlier_score >= 3
            AND v.analysis IS NULL AND v.analyzed_at IS NULL
            AND (v.duration_sec IS NULL OR v.duration_sec <= 180)
          ORDER BY v.profile_id, v.outlier_score DESC) x
        ORDER BY (x.published_at > NOW() - interval '60 days') DESC NULLS LAST, x.outlier_score DESC
        LIMIT $1`,
      [limit]
    );
    for (const v of list) {
      if (Date.now() - started > budgetMs) break;
      const r = await va.analyzeOne(v, {});
      if (r.ok) res.analyzed += 1; else res.failed += 1;
    }
    const before = (await queryOne('SELECT COUNT(*)::int AS n FROM ca_formats')).n;
    const cat = await runCatalog();
    res.formats_before = before;
    res.formats_after = (await queryOne('SELECT COUNT(*)::int AS n FROM ca_formats')).n;
    res.new_formats = cat.created || 0;
    res.minutes = Math.round((Date.now() - started) / 60000);
    console.log(`[content-agent formats] Ловец: анализирани ${res.analyzed}, нови формати ${res.new_formats}, каталог ${res.formats_after}`);
    return res;
  } catch (e) {
    res.error = e.message;
    return res;
  } finally {
    lastHunt = res;
    hunting = false;
  }
}

function runInBackground() {
  setImmediate(() => runCatalog().catch(() => {}));
}

/** Каталогът за екрана: форматите с брой, среден скор, платформи и най-добрите примери. */
async function list({ examples = 6 } = {}) {
  await store.ensureSchema();
  const formats = await query(
    `SELECT f.id, f.name, f.description, f.how_to, f.pitch, f.category, f.created_at, f.updated_at,
            COUNT(fv.video_id)::int AS count, ROUND(AVG(v.outlier_score)::numeric, 1) AS avg_score,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT v.platform), NULL) AS platforms
       FROM ca_formats f
       JOIN ca_format_videos fv ON fv.format_id = f.id
       JOIN ca_videos v ON v.id = fv.video_id
      GROUP BY f.id
      ORDER BY count DESC, avg_score DESC NULLS LAST`
  );
  const ex = await query(
    `SELECT * FROM (
       SELECT fv.format_id, fv.note, v.id, v.platform, v.url, v.views, v.outlier_score, v.caption,
              v.analysis->'hook'->>'spoken' AS hook_spoken, p.label, p.handle,
              ROW_NUMBER() OVER (PARTITION BY fv.format_id ORDER BY v.outlier_score DESC) AS rn
         FROM ca_format_videos fv JOIN ca_videos v ON v.id = fv.video_id
         LEFT JOIN ca_profiles p ON p.id = v.profile_id
        WHERE fv.format_id IS NOT NULL) x
      WHERE rn <= $1`,
    [examples]
  );
  const by = {};
  for (const e of ex) (by[e.format_id] = by[e.format_id] || []).push(e);
  return { formats: formats.map((f) => ({ ...f, examples: by[f.id] || [] })), pending: await pendingCount(), running, hunting, last_hunt: lastHunt, categories: CATEGORIES };
}

module.exports = { runCatalog, runInBackground, list, pendingCount, consolidate, describe, hunt, isRunning: () => running, isHunting: () => hunting };
