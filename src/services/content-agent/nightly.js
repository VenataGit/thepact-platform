// Content агент — нощното YouTube търсене (Венци, 29.10.2026).
//
// Всяка нощ в 01:00 (Europe/Sofia), докато никой не работи, за всеки активен клиент:
//   1. обновява YouTube каналите в библиотеката за неговата ниша (нови качвания),
//   2. търси в YouTube Shorts по думите му (български + английски + думите на нишата),
//      като всяка нощ продължава от мястото, където е спряло (pageToken) и сменя
//      подредбата — така намира НОВИ неща, а не едни и същи,
//   3. Пазачът на нишата пресява новите канали, свалят се видеата им (outlier скор),
//   4. спира, когато намери ≥ 10 нови успешни видеа (скор ≥ 2) или изхарчи дела си от
//      дневната квота на YouTube.
// Само YouTube — безплатно (квота 10 000 единици/ден; нощта ползва до NIGHT_UNITS,
// останалото е за деня). Всичко влиза в общата библиотека (client_id = 0), която ползват
// всички клиенти, и на ~30 мин — в базата на компютъра в офиса.
const cron = require('node-cron');
const { query, queryOne, execute } = require('../../db/pool');
const store = require('./store');
const scout = require('./scout');
const discover = require('./discover');

const NIGHT_UNITS = 8000;         // от 10 000 дневни единици
const MIN_CLIENT_UNITS = 300;     // поне 3 търсения на клиент
const TARGET_NEW = 10;            // цел: нови успешни видеа на клиент
const SEARCH_UNITS = 100;         // search.list
const CHANNEL_UNITS = 3;          // channels + playlistItems + videos
const ORDERS = ['viewCount', 'relevance', 'date'];
const MIN_MEMORY = 3;             // без поне толкова знания за клиента не знаем какво да търсим

let task = null;
let running = false;

function initNightly() {
  try {
    task = cron.schedule('0 1 * * *', () => {
      runNight().catch((e) => console.error('[content-agent nightly]', e.message));
    }, { timezone: 'Europe/Sofia' });
    console.log('  Content Agent nightly: 01:00 (YouTube)');
  } catch (e) {
    console.log('  Content Agent nightly: skipped —', e.message);
  }
}

const isCyrillic = (s) => /[а-яё]/i.test(String(s));

// Списъкът търсения на клиента: YouTube търсенията + думите на нишата (без хаштагите).
function queriesOf(terms) {
  const out = [];
  for (const q of terms.youtube_queries_bg || []) out.push({ q, lang: 'bg' });
  for (const q of terms.youtube_queries_en || []) out.push({ q, lang: 'en' });
  for (const t of terms.topics || []) {
    if (/\s/.test(t)) out.push({ q: t, lang: isCyrillic(t) ? 'bg' : 'en' });
  }
  const seen = new Set();
  return out.filter((x) => { const k = x.q.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

async function eligibleClients() {
  const cfg = await store.loadSettings();
  const hidden = new Set(cfg.hiddenClients);
  const groups = await store.clientGroups();
  const rows = await query(
    `SELECT c.id, c.name,
            (SELECT COUNT(*) FROM ca_memory m WHERE m.client_id = c.id AND m.status = 'approved')::int AS memory,
            (SELECT COUNT(*) FROM ca_profiles p WHERE p.client_id = c.id AND p.active)::int AS profiles
       FROM kp_clients c WHERE c.is_active IS NOT FALSE ORDER BY c.id`
  );
  return rows.filter((c) => !hidden.has(c.id) && (groups.canonicalOf[c.id] || c.id) === c.id
    && (c.memory >= MIN_MEMORY || c.profiles > 0));
}

/** Нощното търсене за един клиент. Връща резултата (пази се и в ca_search.nightly). */
async function nightForClient(clientId, unitsBudget, { usage } = {}) {
  const cfg = await store.loadSettings();
  if (!cfg.youtubeKey) return { skipped: 'няма YouTube ключ' };
  const client = await store.getClient(clientId);
  const { terms } = await discover.ensureTerms(client, { usage });
  const topics = discover.allTopics(terms);
  const row = await discover.getSearch(clientId);
  const state = (row && row.nightly) || {};
  const cursors = state.cursors || {};
  const maxBefore = (await queryOne('SELECT COALESCE(MAX(id), 0) AS m FROM ca_videos')).m;
  let units = 0;
  const res = { at: new Date().toISOString(), searches: 0, new_channels: 0, refreshed: 0, new_videos: 0, new_outliers: 0, units: 0, errors: [] };

  const countNew = async () => {
    const r = await queryOne(
      `SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE v.outlier_score >= 2)::int AS good
         FROM ca_videos v JOIN ca_profiles p ON p.id = v.profile_id
        WHERE v.id > $1 AND p.active AND (v.client_id = $2 OR (v.client_id = 0 AND p.topics && $3::text[]))`,
      [maxBefore, clientId, topics]
    );
    res.new_videos = r.n; res.new_outliers = r.good;
  };

  // 1) YouTube каналите в нишата (на клиента и в библиотеката), обновявани преди > 3 дни.
  const stale = await query(
    `SELECT * FROM ca_profiles WHERE platform = 'youtube' AND active
        AND (client_id = $1 OR (client_id = 0 AND topics && $2::text[]))
        AND (last_scraped_at IS NULL OR last_scraped_at < NOW() - interval '3 days')
      ORDER BY last_scraped_at NULLS FIRST LIMIT 40`,
    [clientId, topics]
  );
  for (const p of stale) {
    if (units + CHANNEL_UNITS > unitsBudget / 2) break; // половината остава за новото търсене
    const r = await scout.refreshProfile(p, cfg);
    units += CHANNEL_UNITS;
    if (r.ok) res.refreshed += 1; else res.errors.push(`${p.handle}: ${r.error}`);
  }
  await countNew();

  // 2) Нови канали — търсенията продължават откъдето са спрели предишната нощ.
  const queries = queriesOf(terms);
  const base = 'https://www.googleapis.com/youtube/v3';
  const after = new Date(Date.now() - 365 * 86400_000).toISOString();
  let qi = Number(state.next_query) || 0;
  let tries = 0;
  while (res.new_outliers < TARGET_NEW && units + SEARCH_UNITS + 20 * CHANNEL_UNITS <= unitsBudget && queries.length && tries < queries.length * 2) {
    const { q, lang } = queries[qi % queries.length];
    qi += 1; tries += 1;
    const cur = cursors[q] || { order: 0, page: '' };
    const order = ORDERS[cur.order % ORDERS.length];
    let s;
    try {
      s = await scout.fetchJson(`${base}/search?part=snippet&type=video&videoDuration=short&maxResults=50&order=${order}` +
        `&publishedAfter=${encodeURIComponent(after)}&relevanceLanguage=${lang}` + (lang === 'bg' ? '&regionCode=BG' : '') +
        (cur.page ? `&pageToken=${encodeURIComponent(cur.page)}` : '') + `&q=${encodeURIComponent(q)}&key=${cfg.youtubeKey}`);
    } catch (e) {
      res.errors.push(`търсене „${q}": ${e.message}`);
      if (/quota/i.test(e.message)) break;
      continue;
    }
    units += SEARCH_UNITS; res.searches += 1;
    // Следващата нощ — следващата страница; свършат ли страниците — друга подредба отначало.
    cursors[q] = s.nextPageToken ? { order: cur.order, page: s.nextPageToken } : { order: cur.order + 1, page: '' };

    const ids = (s.items || []).map((i) => i.id && i.id.videoId).filter(Boolean);
    if (!ids.length) continue;
    const vs = await scout.fetchJson(`${base}/videos?part=statistics,snippet&id=${ids.join(',')}&key=${cfg.youtubeKey}`).catch(() => ({ items: [] }));
    units += 1;
    const known = new Set((await query("SELECT lower(handle) AS h FROM ca_profiles WHERE platform = 'youtube'")).map((r) => r.h));
    const channels = {};
    for (const v of (vs.items || [])) {
      const id = v.snippet.channelId;
      if (!id || known.has(id.toLowerCase())) continue;
      const c = channels[id] = channels[id] || { platform: 'youtube', handle: id, url: `https://www.youtube.com/channel/${id}`, label: v.snippet.channelTitle, lang, best: 0, fans: 0, samples: [] };
      c.best = Math.max(c.best, Number(v.statistics.viewCount) || 0);
      if (c.samples.length < 2) c.samples.push(String(v.snippet.title || '').slice(0, 160));
    }
    const cands = Object.values(channels).filter((c) => c.best >= 3000).sort((a, b) => b.best - a.best).slice(0, 30);
    if (!cands.length) continue;
    const kept = (await discover.filterRelevant(client, terms, cands, usage)).slice(0, 20);
    for (const c of kept) {
      if (units + CHANNEL_UNITS > unitsBudget) break;
      const { row: p, isNew } = await discover.upsertLibraryProfile({ ...c, topics });
      if (isNew) res.new_channels += 1;
      const r = await scout.refreshProfile(p, cfg);
      units += CHANNEL_UNITS;
      if (!r.ok) res.errors.push(`${c.label}: ${r.error}`);
    }
    await countNew();
  }

  res.units = units;
  res.errors = res.errors.slice(0, 8);
  await execute(
    `INSERT INTO ca_search (client_id, nightly) VALUES ($1, $2)
     ON CONFLICT (client_id) DO UPDATE SET nightly = $2`,
    [clientId, JSON.stringify({ ...res, cursors, next_query: qi })]
  );
  return res;
}

/** Цялата нощ — клиент по клиент, с дял от квотата. */
async function runNight({ only } = {}) {
  if (running) return { skipped: 'running' };
  running = true;
  const started = Date.now();
  try {
    await store.ensureSchema();
    const cfg = await store.loadSettings();
    if (!cfg.nightlyEnabled && !only) return { skipped: 'изключено' };
    const clients = only ? (await eligibleClients()).filter((c) => only.includes(c.id)) : await eligibleClients();
    if (!clients.length) return { skipped: 'няма клиенти' };
    const share = Math.max(MIN_CLIENT_UNITS, Math.floor(NIGHT_UNITS / clients.length));
    let used = 0;
    const summary = [];
    for (const c of clients) {
      const budget = Math.min(share, NIGHT_UNITS - used);
      if (budget < MIN_CLIENT_UNITS) break;
      try {
        const r = await nightForClient(c.id, budget);
        used += r.units || 0;
        summary.push(`${c.name}: +${r.new_outliers || 0} успешни / +${r.new_videos || 0} видеа, ${r.units || 0} ед.`);
      } catch (e) {
        summary.push(`${c.name}: грешка ${e.message}`);
      }
    }
    console.log(`[content-agent nightly] ${Math.round((Date.now() - started) / 60000)} мин, ${used} ед. · ${summary.join(' · ')}`);
    return { clients: clients.length, units: used, summary };
  } finally {
    running = false;
  }
}

module.exports = { initNightly, runNight, nightForClient, queriesOf, isRunning: () => running };
