/**
 * KP Auto-Creation Scheduler
 *
 * Runs daily at the configured time (Админ → КП-Автоматизация; default 08:00
 * Europe/Sofia, weekdays). For each active KP client without an active КП card
 * at the destination → create the next one (via the shared kp-create service,
 * so the scheduler produces EXACTLY the same card as the manual button —
 * Basecamp Pre-Production by default, the local kanban when kp_bc_enabled=false).
 *
 * Settings: kp_auto_create_enabled ('true'/'false'), kp_auto_create_time ('HH:MM'),
 * kp_auto_create_weekends ('true' = и събота/неделя). Saving any of them restarts
 * the cron (restartKpScheduler, hooked in routes/admin.js).
 */
const cron = require('node-cron');
const { query, queryOne, execute } = require('../db/pool');
const kpc = require('./kp-create');
const { getServiceAuth } = require('./basecamp-token');

let task = null;

async function initKpScheduler() {
  try {
    const cfg = await kpc.loadKpConfig();
    if (task) { task.stop(); task = null; }
    if (!cfg.autoEnabled) {
      console.log('  KP scheduler: disabled (kp_auto_create_enabled=false)');
      return;
    }
    const m = cfg.autoTime.match(/^(\d{1,2}):(\d{2})$/);
    const hour = Math.min(23, parseInt(m[1], 10));
    const minute = Math.min(59, parseInt(m[2], 10));
    const dow = cfg.autoWeekends ? '*' : '1-5';
    task = cron.schedule(`${minute} ${hour} * * ${dow}`, () => {
      runKpAutoCreate().catch(err => console.error('[KP Scheduler] Error:', err.message));
    }, { timezone: 'Europe/Sofia' });
    console.log(`  KP scheduler: active (${cfg.autoWeekends ? 'всеки ден' : 'делнични дни'} ${cfg.autoTime} BG, дестинация: ${cfg.bcEnabled ? 'Basecamp' : 'локална'})`);
  } catch (err) {
    console.log('  KP scheduler: skipped —', err.message);
  }
}

// Re-read the settings and re-arm the cron (called after admin saves kp_auto_create_*).
async function restartKpScheduler() {
  await initKpScheduler();
}

async function runKpAutoCreate() {
  try {
    const cfg = await kpc.loadKpConfig();
    if (!cfg.autoEnabled) return;

    // Get all active clients
    const clients = await query('SELECT * FROM kp_clients WHERE active = true');
    if (!clients.length) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get first admin user as creator (local cards + audit)
    const admin = await queryOne("SELECT id, name FROM users WHERE role = 'admin' AND is_active = true ORDER BY id LIMIT 1");
    if (!admin) {
      console.log('[KP Scheduler] No admin user found, skipping');
      return;
    }

    // Which clients already have an active КП card at the destination?
    let auth = null, dest = null, clientsWithCards;
    if (cfg.bcEnabled) {
      // The scheduler always acts as the ThePactAlerts bot (no logged-in user here).
      try {
        auth = await getServiceAuth();
        dest = await kpc.resolveKpDestination(auth, cfg);
      } catch (err) {
        console.error('[KP Scheduler] Basecamp недостъпен:', err.message);
        return;
      }
      const existing = await kpc.findExistingKpCards(auth, cfg, dest, clients);
      clientsWithCards = new Set(existing.keys());
    } else {
      if (!cfg.localColumnId) {
        console.log('[KP Scheduler] No kp_izmislyane_column_id configured, skipping');
        return;
      }
      const existingRows = await query(
        `SELECT lower(client_name) AS cn FROM cards
         WHERE column_id = $1 AND archived_at IS NULL AND completed_at IS NULL
               AND client_name = ANY($2)`,
        [cfg.localColumnId, clients.map(c => c.name)]
      );
      clientsWithCards = new Set(existingRows.map(r => r.cn));
    }

    let created = 0;
    for (const client of clients) {
      if (clientsWithCards.has((client.name || '').toLowerCase())) continue;

      // No card exists — check if we should create
      let shouldCreate = false;
      let reason = '';

      if (client.next_kp_date) {
        const nkd = new Date(String(client.next_kp_date).split('T')[0] + 'T12:00:00');
        if (!isNaN(nkd.getTime())) {
          const autoDate = kpc.subtractWorkingDaysSimple(nkd, cfg.daysBeforeNextKp);
          if (today >= autoDate) {
            shouldCreate = true;
            reason = `scheduled (${cfg.daysBeforeNextKp} working days before ${nkd.toISOString().split('T')[0]})`;
          }
        }
      }

      // Early creation: no active card at the destination at all → create now
      // (handles the case where the previous KP was finished early).
      if (!shouldCreate && client.next_kp_date) {
        shouldCreate = true;
        reason = 'early (няма активна КП карта, предишният КП вероятно е приключен)';
      }

      if (!shouldCreate) continue;

      try {
        const rawDate = client.next_kp_date || client.first_publish_date;
        if (!rawDate) continue;
        const firstPublishDate = (rawDate instanceof Date ? rawDate.toISOString() : String(rawDate)).split('T')[0];

        const result = await kpc.createKpForClient({
          client, firstPublishDate, cfg, auth, dest, creatorId: admin.id,
        });

        await execute(
          'INSERT INTO kp_audit_log (user_name, action, client_name, details) VALUES ($1,$2,$3,$4)',
          ['Система', 'auto_create_kp_card', client.name,
           `${reason} — ${result.basecamp ? `Basecamp карта: ${result.title} (${result.url})` : `card: ${result.title}`}`]
        );

        created++;
        console.log(`[KP Scheduler] Created: ${result.title}${result.basecamp ? ' → Basecamp' : ''} (${reason})`);
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

module.exports = { initKpScheduler, restartKpScheduler, runKpAutoCreate };
