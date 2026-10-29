// Content агент — износ на базата с видеа към компютъра в офиса.
//
// Венци (29.10.2026): всичко намерено и научено (профили, видеа, анализи, транскрипти)
// да стои като база данни на компютъра с агента, достъпна за Claude там, и да се ползва
// наново за всеки клиент без ново скрейпване. Платформата остава източникът (агентите
// ползват PostgreSQL), а компютърът дърпа промените на части (ai-agent/worker.js →
// sync_db.py → SQLite в D:\Content Agent\База\content.db).
const { query } = require('../../db/pool');
const store = require('./store');

/**
 * Промените след (since, afterId) — подредени по момент на промяна, после по id.
 * Връща { videos, profiles, clients, next, done }.
 */
async function exportChanges({ since, afterId = 0, limit = 500 }) {
  await store.ensureSchema();
  const sinceIso = since && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(String(since)) ? String(since) : '1970-01-01T00:00:00Z';
  const lim = Math.max(1, Math.min(1000, Number(limit) || 500));
  // Курсорът е текст с микросекунди — Date в JS реже до милисекунди и страниците зациклят.
  const videos = await query(
    `SELECT x.*, to_char(x.changed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS changed_key FROM (
       SELECT v.id, v.profile_id, v.client_id, v.platform, v.video_id, v.url, v.caption, v.duration_sec,
              v.views, v.likes, v.comments, v.shares, v.saves, v.published_at, v.outlier_score,
              v.analysis, v.transcript, v.analysis_error, v.fetched_at, v.analyzed_at,
              GREATEST(v.fetched_at, COALESCE(v.analyzed_at, v.fetched_at)) AS changed_at
         FROM ca_videos v) x
      WHERE (x.changed_at, x.id) > ($1::timestamptz, $2::int)
      ORDER BY x.changed_at, x.id
      LIMIT $3`,
    [sinceIso, Number(afterId) || 0, lim]
  );
  // Профилите и клиентите са малко — идват цели всеки път.
  const [profiles, clients] = await Promise.all([
    query(`SELECT id, client_id, platform, url, handle, label, role, active, topics, lang, source, stats, last_scraped_at, created_at
             FROM ca_profiles ORDER BY id`),
    query(`SELECT c.id, c.name, c.is_active, s.terms
             FROM kp_clients c LEFT JOIN ca_search s ON s.client_id = c.id ORDER BY c.id`),
  ]);
  const last = videos[videos.length - 1];
  return {
    videos, profiles, clients,
    next: last ? { since: last.changed_key, after_id: last.id } : { since: sinceIso, after_id: Number(afterId) || 0 },
    done: videos.length < lim,
  };
}

module.exports = { exportChanges };
