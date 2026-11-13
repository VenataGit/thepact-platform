// Content агент — Ловецът на трендове (Венци, 13.11.2026).
//
// С бутон „Търси трендове сега" (раздел „🔥 Трендове") събира безплатни сигнали какво
// е вайръл в момента:
//   1. Google Trends — какво търсят хората днес в България и в САЩ (+ новините зад темата),
//   2. YouTube „най-популярни" за България и САЩ (1 единица квота на заявка),
//   3. нашата библиотека — видеа от последните 14 дни, избухнали много над нормата си,
//      с формата им от каталога,
// и агент „Ловец на трендове" (+ проверител) ги превръща в трендове: какво е, защо сега,
// колко ще трае, за кои наши клиенти пасва и с каква идея. Всяко търсене се пази.
const { query, queryOne, execute } = require('../../db/pool');
const store = require('./store');
const scout = require('./scout');
const { runStep } = require('./agents');

let running = false;

const decode = (s) => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)); return m ? decode(m[1]) : ''; };

async function googleTrends(geo) {
  const r = await fetch(`https://trends.google.com/trending/rss?geo=${geo}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`Google Trends ${geo}: ${r.status}`);
  const xml = await r.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const it = m[1];
    const news = [...it.matchAll(/<ht:news_item>([\s\S]*?)<\/ht:news_item>/g)].slice(0, 2).map((n) => ({
      title: tag(n[1], 'ht:news_item_title'), url: tag(n[1], 'ht:news_item_url'),
    }));
    return { term: tag(it, 'title'), traffic: tag(it, 'ht:approx_traffic'), news };
  });
}

function isoSec(iso) {
  const m = String(iso || '').match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  return m ? (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0) : null;
}

async function youtubePopular(key, region) {
  const d = await scout.fetchJson(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&chart=mostPopular&regionCode=${region}&maxResults=50&key=${key}`);
  return (d.items || []).map((v) => ({
    title: v.snippet.title, channel: v.snippet.channelTitle, views: Number(v.statistics.viewCount) || 0,
    seconds: isoSec(v.contentDetails.duration), url: `https://www.youtube.com/watch?v=${v.id}`,
    tags: (v.snippet.tags || []).slice(0, 5),
  }));
}

async function libraryHot() {
  return query(
    `SELECT v.platform, v.url, v.views, v.outlier_score, v.caption, v.analysis->>'why_it_works' AS why,
            f.name AS format, p.label
       FROM ca_videos v
       LEFT JOIN ca_format_videos fv ON fv.video_id = v.id
       LEFT JOIN ca_formats f ON f.id = fv.format_id
       LEFT JOIN ca_profiles p ON p.id = v.profile_id
      WHERE v.outlier_score >= 3 AND v.published_at > NOW() - interval '14 days'
      ORDER BY v.outlier_score DESC LIMIT 30`
  );
}

async function activeClients() {
  const cfg = await store.loadSettings();
  const hidden = new Set(cfg.hiddenClients);
  const groups = await store.clientGroups();
  const rows = await query('SELECT c.id, c.name, s.terms FROM kp_clients c LEFT JOIN ca_search s ON s.client_id = c.id ORDER BY c.name');
  return rows.filter((c) => !hidden.has(c.id) && (groups.canonicalOf[c.id] || c.id) === c.id)
    .map((c) => ({ name: c.name, niche: ((c.terms && c.terms.topics) || []).slice(0, 8) }));
}

async function scan({ by = '' } = {}) {
  if (running) return { skipped: 'running' };
  running = true;
  await store.ensureSchema();
  const row = await queryOne("INSERT INTO ca_trends (created_by) VALUES ($1) RETURNING id", [by]);
  try {
    const cfg = await store.loadSettings();
    const errors = [];
    const safe = (p, label) => p.catch((e) => { errors.push(`${label}: ${e.message}`); return []; });
    const [gtBG, gtUS, ytBG, ytUS, hot, clients] = await Promise.all([
      safe(googleTrends('BG'), 'Google Trends BG'),
      safe(googleTrends('US'), 'Google Trends US'),
      cfg.youtubeKey ? safe(youtubePopular(cfg.youtubeKey, 'BG'), 'YouTube BG') : [],
      cfg.youtubeKey ? safe(youtubePopular(cfg.youtubeKey, 'US'), 'YouTube US') : [],
      safe(libraryHot(), 'библиотека'),
      activeClients(),
    ]);
    const sources = {
      google_trends_bg: gtBG, google_trends_us: gtUS.slice(0, 15),
      youtube_bg: ytBG.slice(0, 30), youtube_us: ytUS.slice(0, 20),
      library_hot: hot.map((v) => ({ ...v, views: Number(v.views), outlier_score: Number(v.outlier_score), caption: String(v.caption || '').slice(0, 200) })),
      errors,
    };
    const { output, reviews } = await runStep('trends', { sources, clients, today: new Date().toISOString().slice(0, 10) }, null, {});
    const items = (output.trends || []).slice(0, 15);
    await execute(
      "UPDATE ca_trends SET status = 'done', summary = $2, items = $3, sources = $4, finished_at = NOW() WHERE id = $1",
      [row.id, String(output.summary || '').slice(0, 1500), JSON.stringify(items), JSON.stringify({ ...sources, review: (reviews[reviews.length - 1] || {}).score || null })]
    );
    console.log(`[content-agent trends] #${row.id}: ${items.length} тренда`);
    return { id: row.id, count: items.length };
  } catch (e) {
    await execute("UPDATE ca_trends SET status = 'error', error = $2, finished_at = NOW() WHERE id = $1", [row.id, String(e.message || e).slice(0, 500)]).catch(() => {});
    console.error('[content-agent trends]', e.message);
    return { id: row.id, error: e.message };
  } finally {
    running = false;
  }
}

async function list() {
  await store.ensureSchema();
  const scans = await query('SELECT id, status, created_by, created_at, finished_at, jsonb_array_length(items) AS count FROM ca_trends ORDER BY id DESC LIMIT 20');
  return { scans, running };
}

async function get(id) {
  await store.ensureSchema();
  return queryOne('SELECT * FROM ca_trends WHERE id = $1', [id]);
}

module.exports = { scan, list, get, googleTrends, isRunning: () => running };
