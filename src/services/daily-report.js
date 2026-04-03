// Daily Report Scheduler
// Posts a morning summary to Campfire at configured time (default: 9:30 Mon-Fri)
const cron = require('node-cron');
const db = require('../db/pool');
const { broadcast } = require('../ws/broadcast');

let _reportJob = null;

async function initDailyReport() {
  try {
    const { rows } = await db.pool.query(
      "SELECT key, value FROM settings WHERE key LIKE 'daily_report%'"
    );
    const s = {};
    for (const r of rows) s[r.key] = r.value;

    const enabled = s.daily_report_enabled !== 'false';
    const cronExpr = s.daily_report_cron || '30 9 * * 1-5';
    const roomId = parseInt(s.daily_report_room_id) || 1;

    if (_reportJob) { _reportJob.stop(); _reportJob = null; }

    if (!enabled) {
      console.log('  Daily report: disabled');
      return;
    }

    if (!cron.validate(cronExpr)) {
      console.warn('  Daily report: invalid cron expression:', cronExpr);
      return;
    }

    _reportJob = cron.schedule(cronExpr, () => generateAndPostDailyReport(roomId));
    console.log(`  Daily report: scheduled at "${cronExpr}" → room ${roomId}`);
  } catch (err) {
    console.log('  Daily report: skipped -', err.message);
  }
}

async function generateAndPostDailyReport(roomId) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const dayName = new Date().toLocaleDateString('bg-BG', {
      weekday: 'long', day: 'numeric', month: 'long'
    });

    // Cards due today with assignee names
    const todayRes = await db.pool.query(
      `SELECT c.id, c.title, b.title as board_title,
              COALESCE(
                (SELECT string_agg(u.name, ', ')
                 FROM card_assignees ca JOIN users u ON ca.user_id = u.id WHERE ca.card_id = c.id),
                ''
              ) as assignees
       FROM cards c JOIN boards b ON c.board_id = b.id
       WHERE c.archived_at IS NULL AND c.completed_at IS NULL AND c.due_on = $1
       ORDER BY c.title`,
      [today]
    );

    // Overdue count
    const overdueRes = await db.pool.query(
      `SELECT COUNT(*) FROM cards
       WHERE archived_at IS NULL AND completed_at IS NULL
         AND due_on IS NOT NULL AND due_on < $1`,
      [today]
    );
    const overdueCount = parseInt(overdueRes.rows[0].count);

    // Publish dates today
    const publishRes = await db.pool.query(
      `SELECT c.id, c.title, c.client_name FROM cards c
       WHERE c.archived_at IS NULL AND c.publish_date = $1
       ORDER BY c.title`,
      [today]
    );

    const todayCards = todayRes.rows;
    const publishCards = publishRes.rows;

    // Build message (uses **bold** markers parsed by frontend)
    const lines = [`📊 **Дневен отчет — ${dayName}**\n`];

    if (todayCards.length === 0 && publishCards.length === 0) {
      lines.push('✅ Няма задачи или публикации за днес.');
    } else {
      if (todayCards.length > 0) {
        lines.push(`📌 **Задачи с краен срок днес (${todayCards.length}):**`);
        for (const c of todayCards) {
          const who = c.assignees ? ` — ${c.assignees}` : '';
          lines.push(`• ${c.title}${who}`);
        }
      }
      if (publishCards.length > 0) {
        if (todayCards.length > 0) lines.push('');
        lines.push(`🎬 **Публикации за днес (${publishCards.length}):**`);
        for (const c of publishCards) {
          const client = c.client_name ? ` (${c.client_name})` : '';
          lines.push(`• ${c.title}${client}`);
        }
      }
    }

    if (overdueCount > 0) {
      lines.push('');
      lines.push(`🔴 Просрочени задачи: **${overdueCount}** — виж в <a href="#/reports?tab=overdue">Отчети</a>`);
    }

    const content = lines.join('\n');

    // Verify room exists
    const roomCheck = await db.pool.query('SELECT id FROM campfire_rooms WHERE id = $1', [roomId]);
    if (roomCheck.rows.length === 0) {
      console.error(`Daily report: campfire room ${roomId} not found`);
      return;
    }

    const msgRes = await db.pool.query(
      `INSERT INTO campfire_messages (room_id, user_id, content) VALUES ($1, NULL, $2) RETURNING *`,
      [roomId, content]
    );

    const msg = msgRes.rows[0];
    msg.user_name = 'Дневен отчет';
    msg.user_avatar = null;
    msg.is_system = true;

    broadcast({ type: 'campfire:message', roomId: parseInt(roomId), message: msg });
    console.log(`  Daily report posted to campfire room ${roomId} (${todayCards.length} due, ${publishCards.length} publish)`);
  } catch (err) {
    console.error('Daily report generation error:', err.message);
  }
}

module.exports = { initDailyReport, generateAndPostDailyReport };
