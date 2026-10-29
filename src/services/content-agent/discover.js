// Content агент — Откривателят: намира НОВИ профили извън въведените от нас.
//
// 1) Търсачът (агент + проверител) измисля думи за търсене по клиента — хаштагове за
//    TikTok/Instagram и търсения за YouTube Shorts на български и английски. Пазят се
//    в ca_search 30 дни, за да не се генерират всеки път.
// 2) Обща библиотека: откритите профили са ca_profiles с client_id = 0, role = 'library',
//    а topics = думите на нишата, по която са намерени. Видеата им са ca_videos с
//    client_id = 0 и outlier скор спрямо медианата на СОБСТВЕНИЯ им профил (както при
//    клиентските). Всеки клиент със сходни думи ползва библиотеката директно от базата.
// 3) При пускане на агентите: първо се ползва наличното в библиотеката, а новото търсене
//    тръгва фоново (най-много веднъж на 7 дни на клиент) — резултатът е за следващия път
//    и се вижда веднага в „Успешни видеа".
const { query, queryOne, execute } = require('../../db/pool');
const store = require('./store');
const scout = require('./scout');
const { runStep } = require('./agents');

const TERMS_MAX_AGE_DAYS = 30;
const DISCOVERY_EVERY_DAYS = 7;
const LIBRARY_REFRESH_DAYS = 7;
// Мащаб на едно търсене (Венци 29.10.2026: колкото се може повече, в рамките на лимита
// за Apify на клиента — ca_apify_budget_usd, по подразбиране $5). YouTube е безплатен.
const CANDIDATES = 40;           // кандидати от платформа преди Пазача на нишата
const KEEP_APIFY = 15;           // TikTok / Instagram: профили за проучване след пресяването
const KEEP_YOUTUBE = 20;         // YouTube: безплатно → повече
const MAX_REFRESH = 40;          // библиотечни профили за дърпане при едно търсене
const SEARCH_DAYS = 90;          // YouTube: видеа от последните 90 дни

const running = new Set();

const norm = (t) => String(t || '').toLowerCase().replace(/^#+/, '').trim();
const uniq = (arr, max) => [...new Set((arr || []).map(norm).filter(Boolean))].slice(0, max);

async function getSearch(clientId) {
  await store.ensureSchema();
  return queryOne('SELECT * FROM ca_search WHERE client_id = $1', [clientId]);
}

function allTopics(terms) {
  if (!terms) return [];
  return uniq([...(terms.topics || []), ...(terms.tiktok_hashtags || []), ...(terms.instagram_hashtags || [])], 40);
}

// ---------- думите за търсене ----------

async function ensureTerms(client, { force = false, usage } = {}) {
  const row = await getSearch(client.id);
  const fresh = row && row.terms_updated_at && (Date.now() - new Date(row.terms_updated_at).getTime()) < TERMS_MAX_AGE_DAYS * 86400_000;
  if (row && fresh && !force && allTopics(row.terms).length) return { terms: row.terms, cached: true };

  const caps = await query(
    `SELECT caption FROM ca_videos WHERE client_id = $1 AND caption <> '' ORDER BY outlier_score DESC NULLS LAST LIMIT 15`,
    [client.id]
  );
  const ctx = {
    client,
    memory: await store.memoryText(client.id),
    profiles: await store.profilesText(client.id),
    ownCaptions: caps.map((c) => `- ${String(c.caption).slice(0, 300)}`).join('\n'),
  };
  const { output, reviews } = await runStep('search', ctx, null, usage);
  const terms = {
    topics: uniq(output.topics, 15),
    tiktok_hashtags: uniq(output.tiktok_hashtags, 10).map((t) => t.replace(/\s+/g, '')),
    instagram_hashtags: uniq(output.instagram_hashtags, 10).map((t) => t.replace(/\s+/g, '')),
    youtube_queries_bg: (output.youtube_queries_bg || []).map(String).filter(Boolean).slice(0, 5),
    youtube_queries_en: (output.youtube_queries_en || []).map(String).filter(Boolean).slice(0, 5),
    why: String(output.why || '').slice(0, 500),
    review_score: (reviews[reviews.length - 1] || {}).score || null,
  };
  await execute(
    `INSERT INTO ca_search (client_id, terms, terms_updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (client_id) DO UPDATE SET terms = $2, terms_updated_at = NOW()`,
    [client.id, JSON.stringify(terms)]
  );
  return { terms, cached: false };
}

// ---------- библиотеката ----------

/** Успешни видеа от общата библиотека, които пасват на нишата на клиента. */
async function libraryOutliers(clientId, { limit = 20, minScore = 2, days = 180 } = {}) {
  const row = await getSearch(clientId);
  const topics = allTopics(row && row.terms);
  if (!topics.length) return [];
  return query(
    `SELECT v.id, v.analysis, v.transcript, v.analysis_error, v.platform, v.url, v.caption, v.views, v.likes, v.comments, v.shares, v.saves, v.duration_sec,
            v.published_at, v.outlier_score, p.label, p.handle, p.role, p.lang, (p.stats->>'median') AS profile_median
       FROM ca_videos v JOIN ca_profiles p ON p.id = v.profile_id
      WHERE p.client_id = 0 AND p.active = TRUE AND p.topics && $1::text[] AND v.outlier_score >= $2
        AND (v.published_at IS NULL OR v.published_at > NOW() - ($3 || ' days')::interval)
      ORDER BY v.outlier_score DESC LIMIT $4`,
    [topics, minScore, String(days), limit]
  );
}

async function upsertLibraryProfile({ platform, handle, url, label, topics, lang }) {
  const existing = await queryOne(
    'SELECT * FROM ca_profiles WHERE client_id = 0 AND platform = $1 AND lower(handle) = lower($2)', [platform, handle]);
  if (existing) {
    await execute(
      `UPDATE ca_profiles SET topics = ARRAY(SELECT DISTINCT unnest(topics || $2::text[])) WHERE id = $1`,
      [existing.id, topics]
    );
    return { row: existing, isNew: false };
  }
  const row = await queryOne(
    `INSERT INTO ca_profiles (client_id, platform, url, handle, label, role, topics, lang, source, created_by)
     VALUES (0, $1, $2, $3, $4, 'library', $5, $6, 'discovery', 'Откривател') RETURNING *`,
    [platform, url || '', handle, String(label || handle).slice(0, 200), topics, lang || '']
  );
  return { row, isNew: true };
}

// Профили, които вече познаваме (на клиента) — не ги „откриваме" наново.
async function knownHandles(clientId) {
  const rows = await query('SELECT platform, lower(handle) AS h, url FROM ca_profiles WHERE client_id = $1', [clientId]);
  const set = new Set();
  for (const r of rows) {
    const h = r.h || scout.handleOf(r).toLowerCase();
    if (h) set.add(`${r.platform}:${h}`);
  }
  return set;
}

// Групира резултатите от търсенето по автор и подрежда авторите по най-доброто им видео.
function pickAuthors(items, known, platform) {
  const by = {};
  for (const it of items) {
    if (!it.author || it.views == null) continue;
    const key = it.author.toLowerCase();
    if (known.has(`${platform}:${key}`)) continue;
    const a = by[key] = by[key] || { author: it.author, label: it.label || it.author, best: 0, fans: it.fans || 0, n: 0, samples: [] };
    a.best = Math.max(a.best, it.views);
    a.n += 1;
    if (it.caption && a.samples.length < 2) a.samples.push(String(it.caption).slice(0, 160));
  }
  // По-силно: много гледания спрямо последователите (малък профил с вайръл видео).
  return Object.values(by)
    .filter((a) => a.best >= 5000)
    .sort((x, y) => (y.best / Math.max(y.fans || 0, 1000)) - (x.best / Math.max(x.fans || 0, 1000)))
    .slice(0, CANDIDATES);
}

async function searchTiktok(terms, cfg, known, ctx) {
  const tags = (terms.tiktok_hashtags || []).slice(0, 10);
  if (!tags.length || !cfg.apifyToken) return [];
  const items = await scout.runApify(cfg.actors.tiktok, {
    hashtags: tags, resultsPerPage: 30, shouldDownloadVideos: false, shouldDownloadCovers: false, shouldDownloadSubtitles: false,
  }, cfg.apifyToken, { ...ctx, maxItems: tags.length * 30 });
  const mapped = items.map((it) => {
    const am = it.authorMeta || {};
    return { author: am.name || it['authorMeta.name'] || '', label: am.nickName || am.name || '', fans: Number(am.fans) || 0, views: Number(it.playCount) || null, caption: it.text || '' };
  });
  return pickAuthors(mapped, known, 'tiktok').map((a) => ({
    platform: 'tiktok', handle: a.author, url: `https://www.tiktok.com/@${a.author}`, label: a.label, lang: '',
    best: a.best, fans: a.fans, samples: a.samples,
  }));
}

async function searchInstagram(terms, cfg, known, ctx) {
  const tags = (terms.instagram_hashtags || []).slice(0, 10);
  if (!tags.length || !cfg.apifyToken) return [];
  // 'reels', не 'posts': 'posts' връща най-новите публикации (снимки отпреди минути, без
  // харесвания) — нищо не минава прага. 'reels' дава видеата с гледанията им (videoPlayCount).
  const items = await scout.runApify(cfg.actors.instagram_hashtag, { hashtags: tags, resultsLimit: 30, resultsType: 'reels' },
    cfg.apifyToken, { ...ctx, maxItems: tags.length * 30 });
  const mapped = items.map((it) => ({
    author: it.ownerUsername || (it.owner && it.owner.username) || '',
    label: it.ownerFullName || it.ownerUsername || '',
    fans: 0,
    views: Number(it.videoPlayCount || it.videoViewCount || it.likesCount) || null,
    caption: it.caption || '',
  }));
  return pickAuthors(mapped, known, 'instagram').map((a) => ({
    platform: 'instagram', handle: a.author, url: `https://www.instagram.com/${a.author}/`, label: a.label, lang: '',
    best: a.best, fans: a.fans, samples: a.samples,
  }));
}

async function searchYoutube(terms, cfg, known) {
  if (!cfg.youtubeKey) return [];
  const base = 'https://www.googleapis.com/youtube/v3';
  const after = new Date(Date.now() - SEARCH_DAYS * 86400_000).toISOString();
  const queries = [
    ...(terms.youtube_queries_bg || []).map((q) => ({ q, lang: 'bg' })),
    ...(terms.youtube_queries_en || []).map((q) => ({ q, lang: 'en' })),
  ];
  const channels = {};
  for (const { q, lang } of queries) {
    const s = await scout.fetchJson(`${base}/search?part=snippet&type=video&videoDuration=short&order=viewCount&maxResults=50` +
      `&publishedAfter=${encodeURIComponent(after)}&relevanceLanguage=${lang}&q=${encodeURIComponent(q)}&key=${cfg.youtubeKey}`);
    const ids = (s.items || []).map((i) => i.id && i.id.videoId).filter(Boolean);
    if (!ids.length) continue;
    const vs = await scout.fetchJson(`${base}/videos?part=statistics,snippet&id=${ids.join(',')}&key=${cfg.youtubeKey}`);
    for (const v of (vs.items || [])) {
      const id = v.snippet.channelId;
      if (!id || known.has(`youtube:${id.toLowerCase()}`)) continue;
      const c = channels[id] = channels[id] || { id, label: v.snippet.channelTitle, best: 0, lang, samples: [] };
      c.best = Math.max(c.best, Number(v.statistics.viewCount) || 0);
      if (c.samples.length < 2) c.samples.push(String(v.snippet.title || '').slice(0, 160));
    }
  }
  return Object.values(channels).filter((c) => c.best >= 5000).sort((a, b) => b.best - a.best).slice(0, CANDIDATES)
    .map((c) => ({ platform: 'youtube', handle: c.id, url: `https://www.youtube.com/channel/${c.id}`, label: c.label, lang: c.lang,
      best: c.best, fans: 0, samples: c.samples }));
}

// ---------- Пазачът на нишата ----------

/** Оставя само профилите, които наистина пасват на клиента (агент + проверител). */
async function filterRelevant(client, terms, cands, usage) {
  if (!cands.length) return [];
  const ctx = {
    client, terms: { topics: terms.topics, why: terms.why },
    memory: (await store.memoryText(client.id)).slice(0, 12000),
    candidates: cands.map((c) => ({ platform: c.platform, handle: c.handle, label: c.label, best_views: c.best, followers: c.fans || null, examples: c.samples || [] })),
  };
  try {
    const { output } = await runStep('relevance', ctx, null, usage);
    const keep = new Map((output.keep || []).map((k, i) => [`${k.platform}:${String(k.handle).toLowerCase()}`, i]));
    return cands.filter((c) => keep.has(`${c.platform}:${String(c.handle).toLowerCase()}`))
      .sort((a, b) => keep.get(`${a.platform}:${String(a.handle).toLowerCase()}`) - keep.get(`${b.platform}:${String(b.handle).toLowerCase()}`));
  } catch (e) {
    console.warn('[content-agent discover] Пазачът на нишата:', e.message);
    return cands; // без пресяване, но не спираме търсенето
  }
}

// ---------- самото откриване ----------

async function discover(clientId, { force = false, usage } = {}) {
  if (running.has(clientId)) return { skipped: 'running' };
  running.add(clientId);
  try {
    const client = await store.getClient(clientId);
    if (!client) throw new Error('клиентът не е намерен');
    const cfg = await store.loadSettings();
    if (!cfg.apifyToken && !cfg.youtubeKey) return { skipped: 'no-keys' };

    const { terms } = await ensureTerms(client, { force: false, usage });
    const topics = allTopics(terms);
    const known = await knownHandles(clientId);
    const found = { tiktok: 0, instagram: 0, youtube: 0 };
    const errors = [];
    const spentBefore = (await store.apifySpent(clientId)).usd;
    const ctx = { clientId, source: 'discover' };

    const searches = [['tiktok', searchTiktok, KEEP_APIFY], ['instagram', searchInstagram, KEEP_APIFY], ['youtube', searchYoutube, KEEP_YOUTUBE]];
    for (const [name, fn, keepN] of searches) {
      try {
        const cands = await fn(terms, cfg, known, ctx);
        const kept = (await filterRelevant(client, terms, cands, usage)).slice(0, keepN);
        for (const c of kept) {
          const { isNew } = await upsertLibraryProfile({ ...c, topics });
          if (isNew) found[name] += 1;
        }
      } catch (e) {
        errors.push(`${name}: ${String(e.message || e).slice(0, 200)}`);
      }
    }

    // Дърпаме видеата на библиотечните профили за тази ниша (нови или по-стари от 7 дни).
    const stale = await query(
      `SELECT * FROM ca_profiles WHERE client_id = 0 AND active = TRUE AND topics && $1::text[]
          AND (last_scraped_at IS NULL OR last_scraped_at < NOW() - ($2 || ' days')::interval)
        ORDER BY last_scraped_at NULLS FIRST LIMIT $3`,
      [topics, String(LIBRARY_REFRESH_DAYS), MAX_REFRESH]
    );
    let refreshed = 0;
    let budgetHit = false;
    for (const p of stale) {
      // YouTube е безплатен — върви и когато лимитът за Apify е изчерпан.
      if (budgetHit && p.platform !== 'youtube') continue;
      const r = await scout.refreshProfile(p, cfg, { clientId, source: 'library' });
      if (r.ok) refreshed += 1;
      else if (r.budget) budgetHit = true;
      else errors.push(`${p.platform} ${p.handle}: ${r.error}`);
    }

    const spent = await store.apifySpent(clientId);
    const result = {
      at: new Date().toISOString(), found, refreshed, errors: errors.slice(0, 10),
      apify_usd: Math.round((spent.usd - spentBefore) * 100) / 100, apify_total_usd: Math.round(spent.usd * 100) / 100,
      apify_budget_usd: cfg.apifyBudget, budget_hit: budgetHit || errors.some((e) => /лимитът/.test(e)),
    };
    await execute(
      `INSERT INTO ca_search (client_id, last_discovery_at, last_result) VALUES ($1, NOW(), $2)
       ON CONFLICT (client_id) DO UPDATE SET last_discovery_at = NOW(), last_result = $2`,
      [clientId, JSON.stringify(result)]
    );
    console.log(`[content-agent discover] ${client.name}: нови ${JSON.stringify(found)}, обновени ${refreshed}` + (errors.length ? `, грешки ${errors.length}` : ''));
    // Новите успешни видеа се анализират фоново (сваляне, транскрипт, кадри).
    require('./video-analysis').analyzeInBackground(clientId);
    return result;
  } finally {
    running.delete(clientId);
  }
}

/** Пуска откриването фоново, ако не е пускано скоро (или force). Никога не хвърля. */
async function discoverInBackground(clientId, { force = false } = {}) {
  try {
    if (running.has(clientId)) return { started: false, running: true };
    if (!force) {
      const row = await getSearch(clientId);
      if (row && row.last_discovery_at && (Date.now() - new Date(row.last_discovery_at).getTime()) < DISCOVERY_EVERY_DAYS * 86400_000) {
        return { started: false, recent: true };
      }
    }
    setImmediate(() => discover(clientId, { force }).catch((e) => console.error('[content-agent discover]', e.message)));
    return { started: true };
  } catch (e) {
    console.error('[content-agent discover]', e.message);
    return { started: false, error: e.message };
  }
}

const isRunning = (clientId) => running.has(clientId);

module.exports = { ensureTerms, libraryOutliers, discover, discoverInBackground, isRunning, getSearch, allTopics, pickAuthors };
