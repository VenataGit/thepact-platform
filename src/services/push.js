// Web Push notification service
const webpush = require('web-push');
const config = require('../config');
const { query, execute } = require('../db/pool');

let pushEnabled = false;

function initPush() {
  if (!config.VAPID_PUBLIC_KEY || !config.VAPID_PRIVATE_KEY) {
    console.log('  [push] VAPID keys not configured — push notifications disabled');
    console.log('  [push] Run: node scripts/generate-vapid-keys.js');
    return;
  }

  webpush.setVapidDetails(
    config.VAPID_EMAIL,
    config.VAPID_PUBLIC_KEY,
    config.VAPID_PRIVATE_KEY
  );
  pushEnabled = true;
  console.log('  [push] Web Push notifications enabled');
}

// Send push notification to a specific user (all their devices)
async function sendPushToUser(userId, payload) {
  if (!pushEnabled) return;

  try {
    const subs = await query(
      'SELECT id, endpoint, keys_p256dh, keys_auth FROM push_subscriptions WHERE user_id = $1',
      [userId]
    );

    if (!subs.length) return;

    const body = JSON.stringify(payload);
    const staleIds = [];

    await Promise.allSettled(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
            },
            body
          );
        } catch (err) {
          // 404 or 410 = subscription expired/unsubscribed — remove it
          if (err.statusCode === 404 || err.statusCode === 410) {
            staleIds.push(sub.id);
          } else {
            console.warn('[push] send failed for sub', sub.id, ':', err.statusCode || err.message);
          }
        }
      })
    );

    // Clean up stale subscriptions
    if (staleIds.length) {
      await execute(
        'DELETE FROM push_subscriptions WHERE id = ANY($1::int[])',
        [staleIds]
      );
    }
  } catch (err) {
    console.error('[push] sendPushToUser error:', err.message);
  }
}

// Send push to multiple users
async function sendPushToUsers(userIds, payload) {
  if (!pushEnabled || !userIds.length) return;
  await Promise.allSettled(userIds.map(uid => sendPushToUser(uid, payload)));
}

// Send push to all users except one (e.g., the sender)
async function sendPushToAllExcept(excludeUserId, payload) {
  if (!pushEnabled) return;

  try {
    const subs = await query(
      'SELECT DISTINCT user_id FROM push_subscriptions WHERE user_id != $1',
      [excludeUserId]
    );
    const userIds = subs.map(s => s.user_id);
    await sendPushToUsers(userIds, payload);
  } catch (err) {
    console.error('[push] sendPushToAllExcept error:', err.message);
  }
}

module.exports = { initPush, sendPushToUser, sendPushToUsers, sendPushToAllExcept };
