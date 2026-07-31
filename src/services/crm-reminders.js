// CRM напомняния — единственият автоматизъм, който наистина държи един CRM жив:
// всяка сутрин отговорникът получава списък със сделките, чиято следваща стъпка е
// за днес или е просрочена, плюс броя на застоялите.
//
// `reminded_on` пази датата на последното напомняне за сделката, за да не идва
// едно и също съобщение всеки ден, докато стъпката не бъде преместена.
const cron = require('node-cron');
const { query, execute } = require('../db/pool');
const { sendPushToUser } = require('./push');
const { broadcast } = require('../ws/broadcast');

const CRON = '30 8 * * 1-5'; // делнични дни, 8:30 (сървърът върви на европейско време)

async function runCrmReminders() {
  let due = [];
  try {
    due = await query(
      `SELECT d.id, d.title, d.company, d.owner_id, d.next_step, d.next_step_at
         FROM crm_deals d
        WHERE d.archived = FALSE AND d.status = 'open'
          AND d.owner_id IS NOT NULL
          AND d.next_step_at IS NOT NULL
          AND d.next_step_at <= CURRENT_DATE
          AND (d.reminded_on IS NULL OR d.reminded_on < CURRENT_DATE)`
    );
  } catch (err) {
    // Таблиците още не съществуват (пресен деплой) — тихо подминаваме.
    return 0;
  }
  if (!due.length) return 0;

  const byOwner = new Map();
  due.forEach((d) => {
    if (!byOwner.has(d.owner_id)) byOwner.set(d.owner_id, []);
    byOwner.get(d.owner_id).push(d);
  });

  for (const [ownerId, deals] of byOwner) {
    const overdue = deals.filter((d) => String(d.next_step_at).slice(0, 10) < new Date().toISOString().slice(0, 10));
    const title = overdue.length
      ? `CRM: ${deals.length} ${deals.length === 1 ? 'сделка чака' : 'сделки чакат'} (${overdue.length} просрочени)`
      : `CRM: ${deals.length} ${deals.length === 1 ? 'сделка' : 'сделки'} за днес`;
    const body = deals
      .slice(0, 5)
      .map((d) => `• ${d.company ? d.company + ' — ' : ''}${d.title}: ${d.next_step || 'следваща стъпка'}`)
      .join('\n') + (deals.length > 5 ? `\n… и още ${deals.length - 5}` : '');

    try {
      await execute(
        `INSERT INTO notifications (user_id, type, title, body, reference_type, reference_id, sender_name)
         VALUES ($1, 'crm', $2, $3, 'crm', $4, 'CRM')`,
        [ownerId, title, body, deals[0].id]
      );
    } catch (e) { console.error('[crm-reminders notify]', e.message); }
    sendPushToUser(ownerId, { title, body: body.split('\n')[0], tag: 'crm-daily', url: '/#/crm' });
  }

  try {
    await execute(
      'UPDATE crm_deals SET reminded_on = CURRENT_DATE WHERE id = ANY($1::int[])',
      [due.map((d) => d.id)]
    );
  } catch (e) { console.error('[crm-reminders mark]', e.message); }

  broadcast({ type: 'crm:changed' });
  return due.length;
}

function initCrmReminders() {
  if (!cron.validate(CRON)) return;
  cron.schedule(CRON, () => {
    runCrmReminders().catch((err) => console.error('[crm-reminders]', err.message));
  });
  console.log('  CRM reminders: всеки делник в 8:30');
}

module.exports = { initCrmReminders, runCrmReminders, CRON };
