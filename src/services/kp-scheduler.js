/**
 * KP Auto-Creation Scheduler
 *
 * Runs daily at the configured time (Админ → КП-Автоматизация; default 08:00
 * Europe/Sofia, weekdays). За всеки активен клиент пуска следващия КП план, когато е
 * дошла датата по график (kp-create.kpAutoCreateDate — толкова работни дни преди
 * първото видео, че да остават поне N работни дни до срока за готов план). Графикът е
 * ВОДЕЩ: от 25.09.2026 картата излиза дори ако предишният план още е отворен (Венци).
 * Отворен предишен план спира само ПОДРАНИЛОТО пускане („по-рано" — когато планът е
 * приключил преди срока). Всичко минава през общия kp-create service,
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
const workdays = require('./workdays');
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
    const todayStr = workdays.ymd(new Date());

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

    // Предпазител за клиент с изостанали дати (next_kp_date отпреди месеци): без него
    // „по график" би му пускало по една нова карта ВСЕКИ ден, докато графикът догони
    // днешната дата. Нормалният ритъм е един план на ~месец, така че при здрави данни
    // този предпазител не се задейства никога.
    const recentRows = await query(
      `SELECT DISTINCT lower(client_name) AS cn FROM kp_audit_log
        WHERE action IN ('auto_create_kp_card','create_kp_card')
          AND created_at > NOW() - INTERVAL '7 days'`
    );
    const createdRecently = new Set(recentRows.map(r => r.cn));

    let created = 0;
    for (const client of clients) {
      const key = (client.name || '').toLowerCase();
      // „Зает" = предишният план още има активна главна КП карта преди „В продукция".
      // От 25.09.2026 това НЕ спира графика (Венци: „Трябва да се пусне задачата по
      // график, без значение дали бавим предишния контент план или не") — спира само
      // подранилото пускане.
      const busy = clientsWithCards.has(key);

      let shouldCreate = false;
      let reason = '';

      if (client.next_kp_date) {
        // pg връща DATE като Date обект, а не като низ — toDateStr разбира и двете
        // (преди 25.09.2026 тук стоеше String(...).split('T'), което даваше Invalid Date
        // и заради това проверката „по график" не се задействаше НИКОГА).
        const nkd = kpc.toDateStr(client.next_kp_date);
        if (/^\d{4}-\d{2}-\d{2}$/.test(nkd)) {
          const autoDate = kpc.kpAutoCreateDate(nkd, cfg);
          if (todayStr >= autoDate) {
            if (createdRecently.has(key)) {
              console.log(`[KP Scheduler] ${client.name}: по график за ${autoDate}, но вече има създаден КП план през последните 7 дни — пропускам (изостанали дати?)`);
            } else {
              shouldCreate = true;
              reason = `по график (картата трябваше да излезе на ${autoDate}, първо видео ${nkd})`;
              if (busy) reason += ' — предишният план още е отворен, но графикът е водещ';
            }
          }
        }
      }

      // Няма активна ГЛАВНА КП карта преди „В продукция" → пускаме следващия план
      // веднага, без значение колко дни по-рано е (Венци, 30.07.2026): щом планът е
      // минал напред, екипът може да мисли следващия, вместо да чака срока.
      if (!shouldCreate && !busy && client.next_kp_date) {
        shouldCreate = true;
        reason = dest && dest.readyColumnTitle
          ? `по-рано (главната КП карта е стигнала „${dest.readyColumnTitle}" или е приключена — готови сме за следващия)`
          : 'по-рано (няма активна главна КП карта, предишният план вероятно е приключен)';
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
