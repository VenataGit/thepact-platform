// Daily Report Scheduler
// Posts a structured morning summary to a Message Board every weekday at 9:30 Sofia time
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
    // Default: 9:30 AM weekdays Sofia time
    const cronExpr = s.daily_report_cron || '30 9 * * 1-5';
    // Message board ID to post into (default: 23)
    const boardId = parseInt(s.daily_report_board_id) || 23;

    if (_reportJob) { _reportJob.stop(); _reportJob = null; }

    if (!enabled) {
      console.log('  Daily report: disabled');
      return;
    }

    if (!cron.validate(cronExpr)) {
      console.warn('  Daily report: invalid cron expression:', cronExpr);
      return;
    }

    _reportJob = cron.schedule(cronExpr, () => generateAndPostDailyReport(boardId), {
      timezone: 'Europe/Sofia'
    });
    console.log(`  Daily report: scheduled at "${cronExpr}" Europe/Sofia → message board ${boardId}`);
  } catch (err) {
    console.log('  Daily report: skipped -', err.message);
  }
}

function escHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function generateAndPostDailyReport(boardId) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    const day3 = new Date(today);
    day3.setDate(day3.getDate() + 3);

    // Fetch all active cards with deadlines, board, column, assignees
    const { rows: cards } = await db.pool.query(`
      SELECT c.id, c.title, c.board_id, c.column_id, c.priority,
        c.due_on, c.publish_date, c.brainstorm_date, c.filming_date, c.editing_date, c.upload_date,
        c.completed_at, c.is_on_hold,
        b.title as board_title, col.title as column_title,
        COALESCE(
          (SELECT string_agg(u.name, ', ')
           FROM card_assignees ca JOIN users u ON ca.user_id = u.id WHERE ca.card_id = c.id),
          ''
        ) as assignee_names
      FROM cards c
      JOIN boards b ON c.board_id = b.id
      JOIN columns col ON c.column_id = col.id
      WHERE c.archived_at IS NULL AND c.trashed_at IS NULL AND c.completed_at IS NULL
      ORDER BY c.due_on ASC NULLS LAST, c.title
    `);

    // Helper: get earliest relevant deadline for a card
    function getEarliest(c) {
      const dates = [c.brainstorm_date, c.filming_date, c.editing_date, c.upload_date, c.publish_date, c.due_on]
        .filter(Boolean)
        .map(d => new Date(d));
      if (dates.length === 0) return null;
      dates.sort((a, b) => a - b);
      const future = dates.find(d => d >= today);
      return future || dates[dates.length - 1];
    }

    // Categorize cards
    const overdue = [];
    const dueToday = [];
    const dueTomorrow = [];
    const due2to3 = [];

    for (const c of cards) {
      if (c.is_on_hold) continue;
      const deadline = getEarliest(c);
      if (!deadline) continue;

      const deadlineStr = deadline.toISOString().split('T')[0];

      if (deadline < today) {
        const diffDays = Math.floor((today - deadline) / (1000 * 60 * 60 * 24));
        overdue.push({ ...c, deadline, diffDays });
      } else if (deadlineStr === todayStr) {
        dueToday.push({ ...c, deadline });
      } else if (deadlineStr === tomorrowStr) {
        dueTomorrow.push({ ...c, deadline });
      } else if (deadline <= day3) {
        due2to3.push({ ...c, deadline });
      }
    }

    // Sort overdue by most days first
    overdue.sort((a, b) => b.diffDays - a.diffDays);

    // Build HTML content with clickable links
    function cardLine(c, showDays) {
      const link = `<a href="#/card/${c.id}" style="color:#6fb3e0;text-decoration:none;font-weight:600">${escHtml(c.title)}</a>`;
      const days = showDays ? ` <em style="color:#e07070">(${c.diffDays} дни закъснение)</em>` : '';
      const location = ` · ${escHtml(c.board_title)} → ${escHtml(c.column_title)}`;
      const assignees = c.assignee_names ? ` · <span style="color:#a0c4e0">${escHtml(c.assignee_names)}</span>` : '';
      return `<div style="padding:4px 0">${link}${days}${location}${assignees}</div>`;
    }

    let html = '';

    if (overdue.length > 0) {
      html += `<h3 style="color:#e07070">⛔ Просрочени карти (${overdue.length})</h3>`;
      html += overdue.map(c => cardLine(c, true)).join('');
      html += '<br>';
    }

    if (dueToday.length > 0) {
      html += `<h3 style="color:#e0c040">🔴 Краен срок днес (${dueToday.length})</h3>`;
      html += dueToday.map(c => cardLine(c, false)).join('');
      html += '<br>';
    }

    if (dueTomorrow.length > 0) {
      html += `<h3 style="color:#e0c040">🟡 Краен срок утре (${dueTomorrow.length})</h3>`;
      html += dueTomorrow.map(c => cardLine(c, false)).join('');
      html += '<br>';
    }

    if (due2to3.length > 0) {
      html += `<h3 style="color:#e0a040">🟠 Краен срок след 2-3 дни (${due2to3.length})</h3>`;
      html += due2to3.map(c => cardLine(c, false)).join('');
    }

    if (!html) {
      html = '<div style="padding:20px;text-align:center;color:#888">Няма задачи с наближаващи крайни срокове. 🎉</div>';
    }

    // Format date in Bulgarian
    const dateOpts = { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' };
    const dateBg = today.toLocaleDateString('bg-BG', dateOpts);
    const title = `📊 Дневен отчет — ${dateBg}`;

    // Post to message board
    const { rows: [msg] } = await db.pool.query(
      `INSERT INTO message_board (user_id, title, content, category, board_id)
       VALUES (NULL, $1, $2, 'daily-report', $3) RETURNING *`,
      [title, html, boardId]
    );

    // Broadcast so open tabs see the new message
    broadcast({ type: 'message:created', message: { ...msg, user_name: 'Система' } });
    console.log(`  Daily report posted to message board ${boardId} (${overdue.length} overdue, ${dueToday.length} today, ${dueTomorrow.length} tomorrow, ${due2to3.length} in 2-3d)`);
  } catch (err) {
    console.error('Daily report generation error:', err.message);
  }
}

module.exports = { initDailyReport, generateAndPostDailyReport };
