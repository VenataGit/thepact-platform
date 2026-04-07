// Email Notification Service
// Uses nodemailer if configured, otherwise silently skips
const config = require('../config');
const db = require('../db/pool');

let transporter = null;

function initEmail() {
  // Only init if SMTP is configured
  if (!config.SMTP_HOST || !config.SMTP_USER) {
    console.log('  Email service: disabled (no SMTP config)');
    return;
  }

  try {
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT || 587,
      secure: config.SMTP_PORT === 465,
      auth: {
        user: config.SMTP_USER,
        pass: config.SMTP_PASS
      }
    });
    console.log(`  Email service: ready (${config.SMTP_HOST})`);
  } catch {
    console.log('  Email service: disabled (nodemailer not installed)');
  }
}

async function shouldSendEmail(userId, eventType) {
  if (!transporter) return false;
  try {
    const prefs = await db.queryOne(
      `SELECT * FROM user_email_preferences WHERE user_id = $1`, [userId]
    );
    if (!prefs) return true; // Default: send
    const prefMap = {
      'assignment': prefs.on_assignment,
      'mention': prefs.on_mention,
      'checkin': prefs.on_checkin,
      'comment': prefs.on_comment
    };
    return prefMap[eventType] !== false;
  } catch {
    return false;
  }
}

async function sendEmail(to, subject, html) {
  if (!transporter) return;
  try {
    await transporter.sendMail({
      from: config.SMTP_FROM || `ThePact <${config.SMTP_USER}>`,
      to,
      subject,
      html: wrapTemplate(subject, html)
    });
  } catch (err) {
    console.error('Email send error:', err.message);
  }
}

function wrapTemplate(title, content) {
  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#1a2730;color:#e8ecee;padding:40px 20px">
      <div style="max-width:560px;margin:0 auto;background:#1e2f3a;border:1px solid #2a3f4d;border-radius:12px;padding:32px">
        <div style="margin-bottom:20px">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#1cb0f6;margin-right:8px"></span>
          <strong style="color:#fff;font-size:15px">The Pact</strong>
        </div>
        <h2 style="color:#fff;font-size:18px;margin-bottom:16px">${title}</h2>
        <div style="color:#8fa3b0;font-size:14px;line-height:1.6">${content}</div>
        <div style="margin-top:24px;padding-top:16px;border-top:1px solid #2a3f4d;font-size:12px;color:#566d7a">
          <a href="https://thepact.pro" style="color:#1cb0f6;text-decoration:none">Отвори ThePact →</a>
        </div>
      </div>
    </body>
    </html>
  `;
}

// Convenience functions for specific notification types
async function notifyAssignment(userId, cardTitle, assignerName) {
  if (!await shouldSendEmail(userId, 'assignment')) return;
  try {
    const user = await db.queryOne(`SELECT email FROM users WHERE id = $1`, [userId]);
    if (!user?.email) return;
    await sendEmail(user.email, `Нова задача: ${cardTitle}`,
      `<p><strong>${assignerName}</strong> ти възложи картата <strong>${cardTitle}</strong>.</p>
       <p><a href="https://thepact.pro" style="color:#1cb0f6">Виж в ThePact →</a></p>`
    );
  } catch (e) {
    console.warn('[email] notifyAssignment failed for user', userId, '-', e.message);
  }
}

async function notifyMention(userId, cardTitle, mentionerName) {
  if (!await shouldSendEmail(userId, 'mention')) return;
  try {
    const user = await db.queryOne(`SELECT email FROM users WHERE id = $1`, [userId]);
    if (!user?.email) return;
    await sendEmail(user.email, `Споменат си в: ${cardTitle}`,
      `<p><strong>${mentionerName}</strong> те спомена в <strong>${cardTitle}</strong>.</p>
       <p><a href="https://thepact.pro" style="color:#1cb0f6">Виж в ThePact →</a></p>`
    );
  } catch (e) {
    console.warn('[email] notifyMention failed for user', userId, '-', e.message);
  }
}

module.exports = { initEmail, sendEmail, notifyAssignment, notifyMention };
