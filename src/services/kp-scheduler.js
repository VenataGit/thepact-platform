/**
 * KP Auto-Creation Scheduler
 *
 * Runs daily at 8:00 AM (weekdays). For each active KP client:
 * 1. If no KP card exists in "Измисляне" → create early (previous KP finished)
 * 2. If today >= auto_create_date (X working days before next KP) → create card
 */
const cron = require('node-cron');
const { query, queryOne, execute } = require('../db/pool');
const { broadcast } = require('../ws/broadcast');

function subtractWorkingDays(date, days) {
  const result = new Date(date);
  let subtracted = 0;
  while (subtracted < days) {
    result.setDate(result.getDate() - 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) subtracted++;
  }
  return result;
}

async function initKpScheduler() {
  try {
    // Run at 8:00 AM every weekday
    cron.schedule('0 8 * * 1-5', () => {
      runKpAutoCreate().catch(err => console.error('[KP Scheduler] Error:', err.message));
    });
    console.log('  KP scheduler: active (weekdays 8:00)');
  } catch (err) {
    console.log('  KP scheduler: skipped —', err.message);
  }
}

async function runKpAutoCreate() {
  try {
    // Load ALL settings used by this job in a single query (was 2 separate queries per run + 1 per client)
    const settingsRows = await query(
      "SELECT key, value FROM settings WHERE key IN ('kp_days_before_next_kp', 'kp_izmislyane_column_id', 'kp_calendar_window')"
    );
    const settings = {};
    for (const r of settingsRows) settings[r.key] = r.value;
    const daysBeforeNextKp = parseInt(settings.kp_days_before_next_kp) || 15;
    const izmislianeColId = settings.kp_izmislyane_column_id ? parseInt(settings.kp_izmislyane_column_id) : null;
    const calendarWindow = settings.kp_calendar_window ? parseInt(settings.kp_calendar_window) : 30;

    if (!izmislianeColId) {
      console.log('[KP Scheduler] No kp_izmislyane_column_id configured, skipping');
      return;
    }

    // Get all active clients
    const clients = await query('SELECT * FROM kp_clients WHERE active = true');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get first admin user as creator
    const admin = await queryOne("SELECT id, name FROM users WHERE role = 'admin' AND is_active = true ORDER BY id LIMIT 1");
    if (!admin) {
      console.log('[KP Scheduler] No admin user found, skipping');
      return;
    }

    // Eliminate N+1: load existing-card flags for ALL clients in ONE query
    // (was: SELECT existing card per client → N queries for N clients)
    const existingRows = clients.length > 0
      ? await query(
          `SELECT lower(client_name) AS cn FROM cards
           WHERE column_id = $1 AND archived_at IS NULL AND completed_at IS NULL
                 AND client_name = ANY($2)`,
          [izmislianeColId, clients.map(c => c.name)]
        )
      : [];
    const clientsWithCards = new Set(existingRows.map(r => r.cn));

    // Cache the column lookup (was queried once per client)
    const izmislianeCol = await queryOne(
      'SELECT id, board_id FROM columns WHERE id = $1',
      [izmislianeColId]
    );
    if (!izmislianeCol) {
      console.log('[KP Scheduler] Column not found:', izmislianeColId);
      return;
    }

    let created = 0;
    for (const client of clients) {
      // Check if card already exists in Измисляне (now O(1) lookup instead of DB roundtrip)
      if (clientsWithCards.has((client.name || '').toLowerCase())) continue;

      // No card exists — check if we should create
      let shouldCreate = false;
      let reason = '';

      if (client.next_kp_date) {
        const nkd = new Date(String(client.next_kp_date).split('T')[0] + 'T12:00:00');
        if (!isNaN(nkd.getTime())) {
          const autoDate = subtractWorkingDays(nkd, daysBeforeNextKp);
          if (today >= autoDate) {
            shouldCreate = true;
            reason = `scheduled (${daysBeforeNextKp} working days before ${nkd.toISOString().split('T')[0]})`;
          }
        }
      }

      // Early creation: no card in Измисляне at all → create now
      // This handles the case where previous KP was finished early
      if (!shouldCreate && client.next_kp_date) {
        shouldCreate = true;
        reason = 'early (no card in Измисляне, previous KP likely finished)';
      }

      if (!shouldCreate) continue;

      // Create the KP card via the same logic as the route
      try {
        const rawDate = client.next_kp_date || client.first_publish_date;
        if (!rawDate) continue;

        const firstPublishDate = (rawDate instanceof Date ? rawDate.toISOString() : String(rawDate)).split('T')[0];

        // calendarWindow already loaded once at top of function (was per-client query — N+1 fix)
        const videoCount = client.videos_per_month || 10;
        const kpNumber = client.current_kp_number || 1;

        // Distribute dates
        const gap = videoCount <= 1 ? calendarWindow : calendarWindow / (videoCount - 1);
        const publishDates = [];
        for (let i = 0; i < videoCount; i++) {
          const d = new Date(firstPublishDate + 'T12:00:00');
          d.setDate(d.getDate() + Math.round(i * gap));
          publishDates.push(d.toLocaleDateString('bg-BG', { day: '2-digit', month: '2-digit', year: 'numeric' }));
        }

        // Simple card content
        const title = `${client.name} КП-${kpNumber}`;
        const content = `<div>Дата за публикуване на първо видео: ${publishDates[0]}</div><div><br></div>` +
          `<div>Дати за публикуване на видеа:</div>` +
          publishDates.map(d => `<div>${d}</div>`).join('') +
          `<div><br></div>` +
          Array.from({ length: videoCount }, (_, i) => `<div>Видео ${i + 1} - ХХХ</div>`).join('');

        // izmislianeCol already loaded once at top of function (was per-client query — N+1 fix)
        const maxPos = await queryOne(
          'SELECT COALESCE(MAX(position), -1) + 1 as pos FROM cards WHERE column_id = $1', [izmislianeCol.id]
        );

        const card = await queryOne(
          `INSERT INTO cards (board_id, column_id, title, content, creator_id, client_name, kp_number, position)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          [izmislianeCol.board_id, izmislianeCol.id, title, content, admin.id, client.name, kpNumber, maxPos.pos]
        );

        // Update client dates
        const lastD = new Date(firstPublishDate + 'T12:00:00');
        lastD.setDate(lastD.getDate() + Math.round((videoCount - 1) * gap));
        const nextD = new Date(lastD);
        nextD.setDate(nextD.getDate() + Math.round(gap));

        await execute(
          `UPDATE kp_clients SET current_kp_number = $1, first_publish_date = $2, last_video_date = $3, next_kp_date = $4, publish_interval_days = $5, updated_at = NOW() WHERE id = $6`,
          [kpNumber + 1, nextD.toISOString().split('T')[0], lastD.toISOString().split('T')[0], nextD.toISOString().split('T')[0], Math.round(gap), client.id]
        );

        await execute(
          'INSERT INTO kp_audit_log (user_name, action, client_name, details) VALUES ($1,$2,$3,$4)',
          ['Система', 'auto_create_kp_card', client.name, `${reason} — card: ${title}`]
        );

        broadcast({ type: 'card:created', card });
        created++;
        console.log(`[KP Scheduler] Created: ${title} (${reason})`);
      } catch (err) {
        console.error(`[KP Scheduler] Failed for ${client.name}:`, err.message);
      }
    }

    if (created > 0) {
      console.log(`[KP Scheduler] ${created} card(s) auto-created`);
    }
  } catch (err) {
    console.error('[KP Scheduler] Error:', err.message);
  }
}

module.exports = { initKpScheduler, runKpAutoCreate };
