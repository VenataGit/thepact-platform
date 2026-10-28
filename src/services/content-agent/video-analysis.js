// Content агент — анализ на самите видеа (не само описанието им).
//
// За най-успешните видеа (outlier скор ≥ 2) на клиента и от общата библиотека:
//   1. сваляне с yt-dlp (venv в /opt/ytdlp-venv, с имитация на браузър — без нея TikTok
//      отказва на сървърни IP-та; YouTube блокира сървъра изцяло → там само корицата +
//      заглавието, отбелязано като „частичен анализ"),
//   2. звук → Whisper на VPS-а (127.0.0.1:5001) → транскрипт,
//   3. ffmpeg: кадри в 0 / 0.7 / 1.5 / 2.5 сек + три от тялото, смени на кадъра,
//   4. агент „Анализатор на видео" (Claude вижда кадрите + транскрипта) + проверител.
// Резултатът се пази към видеото (ca_videos.analysis) — анализира се веднъж и се ползва
// от всички клиенти. Файловете се трият веднага. Едно видео наведнъж (VPS-ът е малък).
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFile } = require('child_process');
const { query, queryOne, execute } = require('../../db/pool');
const store = require('./store');
const { callJson, TEAM, block } = require('./agents');

const YTDLP = process.env.YTDLP_BIN || '/opt/ytdlp-venv/bin/yt-dlp';
const WHISPER_HOST = process.env.WHISPER_HOST || '127.0.0.1';
const WHISPER_PORT = parseInt(process.env.WHISPER_PORT || '5001', 10);
const MAX_DURATION = 180;
const RETRY_ERRORS_AFTER_DAYS = 7;

// ---------- помощни ----------

function run(cmd, args, timeout = 120_000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const msg = String(stderr || err.message || '').split('\n').filter((l) => /error/i.test(l)).slice(-1)[0] || err.message;
        return reject(new Error(String(msg).slice(0, 300)));
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

function transcribe(file) {
  return new Promise((resolve, reject) => {
    const buf = fs.readFileSync(file);
    const req = http.request({
      host: WHISPER_HOST, port: WHISPER_PORT, path: '/transcribe', method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': buf.length, 'X-Audio-Ext': 'mp3' },
      timeout: 900_000,
    }, (resp) => {
      let body = '';
      resp.setEncoding('utf8');
      resp.on('data', (c) => { body += c; });
      resp.on('end', () => {
        try {
          const j = JSON.parse(body);
          if (resp.statusCode !== 200) return reject(new Error(j.error || `Whisper ${resp.statusCode}`));
          resolve({ text: String(j.text || ''), language: j.language || '' });
        } catch { reject(new Error(`Whisper: ${body.slice(0, 120)}`)); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Whisper: timeout')));
    req.on('error', reject);
    req.end(buf);
  });
}

async function download(v, dir) {
  await run(YTDLP, [
    '-q', '--no-warnings', '--no-playlist', '--impersonate', 'chrome',
    '-f', 'b[height<=720]/bv*[height<=720]+ba/b', '--max-filesize', '80M',
    '-o', path.join(dir, 'v.%(ext)s'), v.url,
  ], 180_000);
  const f = fs.readdirSync(dir).find((n) => n.startsWith('v.'));
  if (!f) throw new Error('видеото не се свали');
  return path.join(dir, f);
}

async function duration(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], 30_000);
  return Number(stdout.trim()) || 0;
}

async function sceneCuts(file) {
  try {
    const { stderr } = await run('ffmpeg', ['-hide_banner', '-i', file, '-vf', "select='gt(scene,0.3)',showinfo", '-an', '-f', 'null', '-'], 120_000);
    return [...stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1])).filter((t) => Number.isFinite(t));
  } catch { return []; }
}

async function frames(file, dir, dur) {
  const times = [0, 0.7, 1.5, 2.5, dur * 0.35, dur * 0.65, Math.max(dur - 1.5, 0)]
    .map((t) => Math.round(Math.min(t, Math.max(dur - 0.2, 0)) * 10) / 10)
    .filter((t, i, a) => a.indexOf(t) === i);
  const out = [];
  for (const t of times) {
    const f = path.join(dir, `f_${t}.jpg`);
    try {
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '5', '-y', f], 30_000);
      if (fs.existsSync(f)) out.push({ t, data: fs.readFileSync(f).toString('base64') });
    } catch { /* кадърът не излезе — продължаваме */ }
  }
  return out;
}

async function youtubeThumb(v) {
  const id = (String(v.url).match(/(?:shorts\/|v=|youtu\.be\/)([\w-]{6,})/) || [])[1] || v.video_id;
  for (const q of ['maxresdefault', 'hqdefault']) {
    try {
      const r = await fetch(`https://i.ytimg.com/vi/${id}/${q}.jpg`);
      if (r.ok) return Buffer.from(await r.arrayBuffer()).toString('base64');
    } catch { /* следващото */ }
  }
  return null;
}

// ---------- агентите ----------

const ANALYST_SYSTEM = `${TEAM}

Ти си АНАЛИЗАТОРЪТ НА ВИДЕО. Гледаш кадри от едно успешно кратко видео (outlier — минало много над нормата на профила си) и четеш какво се казва в него. Задачата ти е да разбереш ТОЧНО защо е проработило, за да може екипът да пренесе структурата (не съдържанието) към свои клиенти.
Обърни специално внимание на първите 3 секунди: кадрите в 0 / 0.7 / 1.5 / 2.5 сек. Описвай само това, което реално се вижда и чува — нищо измислено. Ако анализът е частичен (само корица и заглавие), кажи го в limits.
Отговори с JSON:
{"hook": {"spoken": "какво се казва в първите секунди (цитат)", "visual": "какво се вижда в първия кадър", "on_screen": "текст на екрана в началото или празно", "archetype": "архетип на кукичката", "why": "защо спира скрола"},
 "format": "тип видео (говореща глава, скеч, POV, тест, улична анкета…)",
 "structure": [{"t": "0-3 сек", "what": "какво става"}],
 "pacing": "темпо: смени на кадъра, текст, звук",
 "emotion": "каква емоция носи",
 "why_it_works": "2-3 изречения — истинската причина за успеха",
 "transferable": ["какво може да се пренесе към друг бранд — структура, механика"],
 "not_transferable": "какво зависи от самия автор/късмет и не се пренася",
 "limits": "какво не можа да се види/чуе или празно"}`;

const CHECKER_SYSTEM = `${TEAM}

Ти проверяваш АНАЛИЗА НА ВИДЕО спрямо кадрите и транскрипта. Провери: цитатът на кукичката съвпада ли с транскрипта; описаното в кадрите наистина ли се вижда; „защо работи" конкретно ли е (не „добро съдържание"); пренесимото наистина ли е структура/механика, а не копиране; няма ли измислени неща.
Отговори с JSON: {"ok": true|false, "score": 1-10, "issues": [{"problem": "...", "fix": "..."}]}`;

function contentBlocks(v, frameList, meta) {
  const blocks = [];
  for (const f of frameList) {
    blocks.push({ type: 'text', text: f.t === 'cover' ? 'Корица на видеото:' : `Кадър в ${f.t} сек:` });
    blocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: f.data } });
  }
  blocks.push({ type: 'text', text: [
    block('видео', {
      platform: v.platform, url: v.url, views: v.views == null ? null : Number(v.views),
      outlier_score: v.outlier_score == null ? null : Number(v.outlier_score),
      duration_sec: meta.duration, scene_cuts: meta.cuts.length,
      cuts_first_3s: meta.cuts.filter((t) => t <= 3).length, partial: meta.partial,
    }),
    block('описание', String(v.caption || '').slice(0, 1500) || '(няма)'),
    block('транскрипт', meta.transcript || '(няма — частичен анализ)'),
  ].join('\n\n') });
  return blocks;
}

async function analyzeWithAgents(v, frameList, meta, usage) {
  const content = contentBlocks(v, frameList, meta);
  let analysis = await callJson({ system: ANALYST_SYSTEM, user: content, effort: 'medium', maxTokens: 8000, usage });
  let review = null;
  for (let round = 0; round < 2; round++) {
    review = await callJson({
      system: CHECKER_SYSTEM,
      user: [...content, { type: 'text', text: block('анализ_за_проверка', analysis) }],
      effort: 'low', maxTokens: 4000, usage,
    });
    if (review.ok || !Array.isArray(review.issues) || !review.issues.length || round === 1) break;
    analysis = await callJson({
      system: ANALYST_SYSTEM,
      user: [...content, { type: 'text', text: `${block('твоят_предишен_анализ', analysis)}\n\n${block('забележки_от_проверителя', review.issues)}\n\nПоправи анализа. Върни целия JSON.` }],
      effort: 'medium', maxTokens: 8000, usage,
    });
  }
  return { ...analysis, review: review ? { ok: !!review.ok, score: review.score || null } : null };
}

// ---------- едно видео ----------

async function analyzeOne(v, usage = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-va-'));
  try {
    let frameList = [];
    const meta = { duration: v.duration_sec || null, cuts: [], transcript: '', partial: false };
    if (v.platform === 'youtube') {
      // YouTube блокира сваляне от сървъра → корица + заглавие/описание.
      const thumb = await youtubeThumb(v);
      if (thumb) frameList = [{ t: 'cover', data: thumb }];
      meta.partial = true;
    } else {
      const file = await download(v, dir);
      meta.duration = Math.round(await duration(file)) || meta.duration;
      if (meta.duration && meta.duration > MAX_DURATION + 30) throw new Error(`видеото е ${meta.duration} сек — не е кратко`);
      meta.cuts = await sceneCuts(file);
      frameList = await frames(file, dir, meta.duration || 30);
      const mp3 = path.join(dir, 'a.mp3');
      try {
        await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', '-y', mp3], 60_000);
        const tr = await transcribe(mp3);
        meta.transcript = tr.text;
      } catch (e) {
        meta.transcript = '';
        console.warn('[content-agent video] транскрипт:', e.message);
      }
    }
    if (!frameList.length && !meta.transcript) throw new Error('няма нито кадри, нито звук за анализ');
    const analysis = await analyzeWithAgents(v, frameList, meta, usage);
    analysis.meta = { duration: meta.duration, scene_cuts: meta.cuts.length, cuts_first_3s: meta.cuts.filter((t) => t <= 3).length, partial: meta.partial };
    await execute(
      'UPDATE ca_videos SET analysis = $2, transcript = $3, analyzed_at = NOW(), analysis_error = NULL WHERE id = $1',
      [v.id, JSON.stringify(analysis), meta.transcript ? meta.transcript.slice(0, 20000) : null]
    );
    return { ok: true, id: v.id };
  } catch (e) {
    const msg = String(e.message || e).slice(0, 300);
    await execute('UPDATE ca_videos SET analysis_error = $2, analyzed_at = NOW() WHERE id = $1', [v.id, msg]).catch(() => {});
    return { ok: false, id: v.id, error: msg };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------- кои видеа ----------

/** Най-успешните неанализирани видеа на клиента + от библиотеката за неговата ниша. */
async function candidates(clientId, limit) {
  await store.ensureSchema();
  const s = await queryOne('SELECT terms FROM ca_search WHERE client_id = $1', [clientId]);
  const t = (s && s.terms) || {};
  const topics = [...new Set([...(t.topics || []), ...(t.tiktok_hashtags || []), ...(t.instagram_hashtags || [])]
    .map((x) => String(x).toLowerCase().replace(/^#/, '').trim()).filter(Boolean))];
  return query(
    `SELECT v.* FROM ca_videos v JOIN ca_profiles p ON p.id = v.profile_id
      WHERE p.active = TRUE AND v.outlier_score >= 2
        AND (v.client_id = $1 OR (v.client_id = 0 AND p.topics && $2::text[]))
        AND (v.duration_sec IS NULL OR v.duration_sec <= $3)
        AND (v.analyzed_at IS NULL OR (v.analysis IS NULL AND v.analyzed_at < NOW() - ($4 || ' days')::interval))
      ORDER BY (v.platform = 'youtube') ASC, v.outlier_score DESC
      LIMIT $5`,
    [clientId, topics, MAX_DURATION, String(RETRY_ERRORS_AFTER_DAYS), limit]
  );
}

// Една опашка за целия сървър — едно видео наведнъж.
let chain = Promise.resolve();
const busyClients = new Set();

/**
 * Анализира до `limit` видеа за клиента, но спира, когато изтече `budgetMs`
 * (останалите остават за следващия път / фоновия анализ).
 */
function analyzeTop(clientId, { limit = 6, budgetMs = 6 * 60_000, usage } = {}) {
  const job = chain.then(async () => {
    busyClients.add(clientId);
    const started = Date.now();
    const res = { analyzed: 0, failed: 0, errors: [] };
    try {
      const list = await candidates(clientId, limit);
      for (const v of list) {
        if (Date.now() - started > budgetMs) break;
        const r = await analyzeOne(v, usage || {});
        if (r.ok) res.analyzed += 1; else { res.failed += 1; res.errors.push(r.error); }
      }
    } finally {
      busyClients.delete(clientId);
    }
    if (res.analyzed || res.failed) console.log(`[content-agent video] клиент ${clientId}: анализирани ${res.analyzed}, неуспешни ${res.failed}`);
    return res;
  });
  chain = job.catch(() => {});
  return job;
}

/** Фоново — не чака. Никога не хвърля. */
function analyzeInBackground(clientId, opts = {}) {
  analyzeTop(clientId, { limit: 12, budgetMs: 40 * 60_000, ...opts })
    .catch((e) => console.error('[content-agent video]', e.message));
}

const isBusy = (clientId) => busyClients.has(clientId);

module.exports = { analyzeOne, analyzeTop, analyzeInBackground, candidates, isBusy };
