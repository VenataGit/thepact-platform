// Automatic Check-in Scheduler
// Sends notifications to all users when a check-in question is due
const cron = require('node-cron');
const db = require('../db/pool');
const { broadcast } = require('../ws/broadcast');
const { sendPushToUser } = require('./push');

const activeJobs = new Map(); // questionId -> cronJob

async function initCheckInScheduler() {
  try {
    const { rows } = await db.query(
      `SELECT id, question, schedule_cron FROM checkin_questions WHERE is_active = TRUE`
    );
    for (const q of rows) {
      scheduleQuestion(q);
    }
    console.log(`  Check-in scheduler: ${rows.length} active questions`);
  } catch (err) {
    // Table might not exist yet, that's ok
    console.log('  Check-in scheduler: skipped (tables not ready)');
  }
}

function scheduleQuestion(question) {
  // Remove old job if exists
  if (activeJobs.has(question.id)) {
    activeJobs.get(question.id).stop();
  }

  if (!cron.validate(question.schedule_cron)) {
    console.warn(`  Invalid cron for check-in ${question.id}: ${question.schedule_cron}`);
    return;
  }

  const job = cron.schedule(question.schedule_cron, async () => {
    await triggerCheckIn(question.id, question.question);
  });

  activeJobs.set(question.id, job);
}

async function triggerCheckIn(questionId, questionText) {
  try {
    // Get all active users
    const { rows: users } = await db.query(
      `SELECT id, name FROM users WHERE is_active = TRUE`
    );

    // Create notification for each user
    for (const user of users) {
      await db.execute(
        `INSERT INTO notifications (user_id, type, title, body, reference_type, reference_id)
         VALUES ($1, 'system', 'Check-in', $2, 'checkin', $3)`,
        [user.id, questionText, questionId]
      );
      sendPushToUser(user.id, {
        title: 'Check-in',
        body: questionText,
        tag: `checkin-${questionId}`,
        url: '/#/checkins',
      });
    }

    // Broadcast WS event
    broadcast({ type: 'checkin:reminder', questionId, question: questionText });
  } catch (err) {
    console.error('Check-in trigger error:', err.message);
  }
}

function refreshQuestion(question) {
  scheduleQuestion(question);
}

function removeQuestion(questionId) {
  if (activeJobs.has(questionId)) {
    activeJobs.get(questionId).stop();
    activeJobs.delete(questionId);
  }
}

module.exports = { initCheckInScheduler, refreshQuestion, removeQuestion };
