// Content агент — Скаутът: дърпа последните видеа от профилите на клиента
// (собствени, конкуренти, вдъхновение) и смята outlier скор.
//
// outlier скор = гледанията на видеото ÷ медианата на гледанията на ДРУГИТЕ видеа от
// същия профил. Медиана, не средно — едно мега-вайръл видео не изкривява нормата.
// 3× = интересно, 5× = outlier, 10×+ = пробив.
//
// Източници: YouTube Data API v3 (официално, безплатно, ключ в ca_youtube_api_key);
// TikTok / Instagram / Facebook през Apify (ca_apify_token, актьорите са настройка).
const { query, queryOne, execute } = require('../../db/pool');
const store = require('./store');

const PER_PROFILE = 30;
const MAX_AGE_HOURS = 72;          // профил, обновен по-скоро, не се дърпа пак
const MIN_BASELINE = 5;            // под толкова други видеа медианата е ненадеждна
const SHORT_MAX_SEC = 180;         // YouTube Shorts са до 3 минути

// ---------- помощни ----------

function num(...vals) {
  for (const v of vals) {
    const n = Number(v);
    if (v !== undefined && v !== null && v !== '' && Number.isFinite(n)) return Math.round(n);
  }
  return null;
}

function dateOf(...vals) {
  for (const v of vals) {
    if (v === undefined || v === null || v === '') continue;
    const d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

function median(arr) {
  const a = arr.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// Ръчката от линка, ако не е въведена отделно.
function handleOf(p) {
  if (p.handle) return String(p.handle).trim().replace(/^@/, '');
  const u = String(p.url || '');
  let m;
  if ((m = u.match(/tiktok\.com\/@([^/?#]+)/i))) return m[1];
  if ((m = u.match(/instagram\.com\/([^/?#]+)/i))) return m[1];
  if ((m = u.match(/youtube\.com\/@([^/?#]+)/i))) return m[1];
  if ((m = u.match(/youtube\.com\/channel\/([^/?#]+)/i))) return m[1];
  return '';
}

async function fetchJson(url, opts = {}, timeoutMs = 60_000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ac.signal });
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch { json = null; }
    if (!r.ok) {
      const msg = (json && (json.error?.message || json.error?.type)) || text.slice(0, 200);
      throw new Error(`HTTP ${r.status}: ${msg}`);
    }
    return json;
  } finally {
    clearTimeout(t);
  }
}

// ---------- YouTube ----------

function isoDurationSec(iso) {
  const m = String(iso || '').match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

async function fetchYoutube(p, key) {
  if (!key) throw new Error('няма YouTube API ключ (Настройки на Content агента)');
  const h = handleOf(p);
  if (!h) throw new Error('не разпознавам канала — въведи @handle или линк към канала');
  const base = 'https://www.googleapis.com/youtube/v3';
  const byId = /^UC[\w-]{20,}$/.test(h);
  const ch = await fetchJson(`${base}/channels?part=contentDetails&${byId ? 'id' : 'forHandle'}=${encodeURIComponent(byId ? h : '@' + h)}&key=${key}`);
  const uploads = ch && ch.items && ch.items[0] && ch.items[0].contentDetails.relatedPlaylists.uploads;
  if (!uploads) throw new Error('каналът не е намерен');
  const pl = await fetchJson(`${base}/playlistItems?part=contentDetails&maxResults=50&playlistId=${uploads}&key=${key}`);
  const ids = (pl.items || []).map((i) => i.contentDetails.videoId).filter(Boolean);
  if (!ids.length) return [];
  const vs = await fetchJson(`${base}/videos?part=snippet,statistics,contentDetails&id=${ids.join(',')}&key=${key}`);
  return (vs.items || [])
    .map((v) => ({
      video_id: v.id,
      url: `https://www.youtube.com/shorts/${v.id}`,
      caption: v.snippet.title + (v.snippet.description ? `\n${v.snippet.description.slice(0, 400)}` : ''),
      duration_sec: isoDurationSec(v.contentDetails.duration),
      views: num(v.statistics.viewCount),
      likes: num(v.statistics.likeCount),
      comments: num(v.statistics.commentCount),
      shares: null, saves: null,
      published_at: dateOf(v.snippet.publishedAt),
    }))
    .filter((v) => v.duration_sec == null || v.duration_sec <= SHORT_MAX_SEC)
    .slice(0, PER_PROFILE);
}

// ---------- Apify (TikTok / Instagram / Facebook) ----------

async function runApify(actor, input, token) {
  if (!token) throw new Error('няма Apify токен (Настройки на Content агента)');
  const id = String(actor || '').trim().replace('/', '~');
  if (!/^[\w.-]+~[\w.-]+$/.test(id)) throw new Error(`невалиден Apify актьор „${actor}"`);
  const url = `https://api.apify.com/v2/acts/${id}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&timeout=280`;
  const items = await fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }, 300_000);
  return Array.isArray(items) ? items : [];
}

// Актьорите връщат различни имена на полетата — взимаме първото налично.
function mapApifyItem(it) {
  const id = it.id || it.shortCode || it.postId || it.video_id || it.videoId || it.url || it.webVideoUrl;
  if (!id) return null;
  return {
    video_id: String(id),
    url: it.webVideoUrl || it.url || it.postUrl || it.videoUrl || (it.shortCode ? `https://www.instagram.com/reel/${it.shortCode}/` : ''),
    caption: String(it.text || it.caption || it.description || it.title || '').slice(0, 1500),
    duration_sec: num(it.videoMeta && it.videoMeta.duration, it.videoDuration, it.duration, it.playback_duration),
    views: num(it.playCount, it.videoPlayCount, it.videoViewCount, it.viewsCount, it.views, it.play_count, it.video_view_count),
    likes: num(it.diggCount, it.likesCount, it.likes, it.reactionsCount, it.reactions_count),
    comments: num(it.commentCount, it.commentsCount, it.comments, it.comments_count),
    shares: num(it.shareCount, it.sharesCount, it.shares, it.share_count),
    saves: num(it.collectCount, it.savesCount, it.saves),
    published_at: dateOf(it.createTimeISO, it.timestamp, it.createTime, it.time, it.date, it.publishedAt, it.creation_time),
  };
}

function apifyInput(platform, p) {
  const h = handleOf(p);
  if (platform === 'tiktok') {
    if (!h) throw new Error('не разпознавам TikTok профила — въведи @handle или линк');
    return { profiles: [h], resultsPerPage: PER_PROFILE, profileScrapeSections: ['videos'], shouldDownloadVideos: false, shouldDownloadCovers: false, shouldDownloadSubtitles: false };
  }
  if (platform === 'instagram') {
    if (!h) throw new Error('не разпознавам Instagram профила — въведи @handle или линк');
    return { username: [h], resultsLimit: PER_PROFILE };
  }
  if (!p.url) throw new Error('за Facebook трябва линк към страницата');
  return { startUrls: [{ url: p.url }], resultsLimit: PER_PROFILE };
}

// ---------- обновяване ----------

async function fetchProfile(p, cfg) {
  if (p.platform === 'youtube') return fetchYoutube(p, cfg.youtubeKey);
  if (['tiktok', 'instagram', 'facebook'].includes(p.platform)) {
    const items = await runApify(cfg.actors[p.platform], apifyInput(p.platform, p), cfg.apifyToken);
    return items.map(mapApifyItem).filter((v) => v && v.views != null).slice(0, PER_PROFILE);
  }
  throw new Error('тази платформа не се проучва автоматично');
}

async function rescoreProfile(profileId) {
  const vids = await query('SELECT id, views FROM ca_videos WHERE profile_id = $1 AND views IS NOT NULL', [profileId]);
  const all = vids.map((v) => Number(v.views));
  for (const v of vids) {
    const others = all.filter((_, i) => vids[i].id !== v.id);
    const med = others.length >= MIN_BASELINE ? median(others) : null;
    const score = med && med > 0 ? Math.min(Number(v.views) / med, 99999999) : null;
    await execute('UPDATE ca_videos SET outlier_score = $2 WHERE id = $1', [v.id, score == null ? null : score.toFixed(2)]);
  }
  return { median: median(all), count: all.length };
}

async function refreshProfile(p, cfg) {
  try {
    const videos = await fetchProfile(p, cfg);
    for (const v of videos) {
      await execute(
        `INSERT INTO ca_videos (profile_id, client_id, platform, video_id, url, caption, duration_sec, views, likes, comments, shares, saves, published_at, fetched_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
         ON CONFLICT (platform, video_id, profile_id) DO UPDATE SET
           url = EXCLUDED.url, caption = EXCLUDED.caption, duration_sec = EXCLUDED.duration_sec,
           views = EXCLUDED.views, likes = EXCLUDED.likes, comments = EXCLUDED.comments,
           shares = EXCLUDED.shares, saves = EXCLUDED.saves,
           published_at = COALESCE(EXCLUDED.published_at, ca_videos.published_at), fetched_at = NOW()`,
        [p.id, p.client_id, p.platform, v.video_id, v.url || '', v.caption || '', v.duration_sec, v.views, v.likes, v.comments, v.shares, v.saves, v.published_at]
      );
    }
    const s = await rescoreProfile(p.id);
    const stats = { median: s.median, count: s.count, fetched: videos.length, error: '' };
    await execute('UPDATE ca_profiles SET stats = $2, last_scraped_at = NOW() WHERE id = $1', [p.id, JSON.stringify(stats)]);
    return { id: p.id, ok: true, ...stats };
  } catch (e) {
    const stats = { ...(p.stats || {}), error: String(e.message || e).slice(0, 300) };
    await execute('UPDATE ca_profiles SET stats = $2 WHERE id = $1', [p.id, JSON.stringify(stats)]);
    return { id: p.id, ok: false, error: stats.error };
  }
}

/** Обновява профилите на клиента. force = и тези, обновени наскоро. */
async function refreshClient(clientId, { force = false } = {}) {
  await store.ensureSchema();
  const cfg = await store.loadSettings();
  const profiles = await query(
    `SELECT * FROM ca_profiles WHERE client_id = $1 AND active = TRUE AND platform IN ('youtube','tiktok','instagram','facebook')
       AND ($2 OR last_scraped_at IS NULL OR last_scraped_at < NOW() - ($3 || ' hours')::interval)`,
    [clientId, force, String(MAX_AGE_HOURS)]
  );
  const results = [];
  for (const p of profiles) results.push(await refreshProfile(p, cfg));
  return results;
}

/** Най-успешните видеа на клиента (и от конкурентите/вдъхновението) — за анализатора и за екрана. */
async function topOutliers(clientId, { limit = 25, minScore = 2, days = 365 } = {}) {
  await store.ensureSchema();
  return query(
    `SELECT v.id, v.analysis, v.transcript, v.analysis_error, v.platform, v.url, v.caption, v.views, v.likes, v.comments, v.shares, v.saves, v.duration_sec,
            v.published_at, v.outlier_score, p.label, p.handle, p.role, (p.stats->>'median') AS profile_median
       FROM ca_videos v JOIN ca_profiles p ON p.id = v.profile_id
      WHERE v.client_id = $1 AND p.active = TRUE AND v.outlier_score >= $2
        AND (v.published_at IS NULL OR v.published_at > NOW() - ($3 || ' days')::interval)
      ORDER BY v.outlier_score DESC LIMIT $4`,
    [clientId, minScore, String(days), limit]
  );
}

async function hasProfiles(clientId) {
  await store.ensureSchema();
  return !!(await queryOne("SELECT 1 FROM ca_profiles WHERE client_id = $1 AND active = TRUE AND platform IN ('youtube','tiktok','instagram','facebook') LIMIT 1", [clientId]));
}

module.exports = { refreshClient, refreshProfile, topOutliers, hasProfiles, median, mapApifyItem, handleOf, isoDurationSec, runApify, fetchJson };
