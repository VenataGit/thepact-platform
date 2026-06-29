// Service Worker registration + push-notification cleanup.
//
// Browser push notifications were REMOVED by request. We still register the service worker
// because it also does offline caching (see sw.js), but we no longer:
//   - ask for notification permission,
//   - show the "enable notifications?" prompt,
//   - subscribe to web push.
// We also proactively remove any push subscription a user enabled in an earlier version, so
// they stop receiving notifications.
(function() {
  'use strict';

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return null;
    try {
      return await navigator.serviceWorker.register('/sw.js');
    } catch (err) {
      console.warn('[SW] registration failed:', err.message);
      return null;
    }
  }

  // Remove a leftover push subscription from a previous version (best-effort).
  async function clearPushSubscription() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return;
      try {
        await fetch('/api/push/unsubscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
      } catch (e) { /* server cleanup is best-effort */ }
      await sub.unsubscribe();
      console.log('[push] removed leftover subscription');
    } catch (err) {
      console.warn('[push] cleanup failed:', err.message);
    }
  }

  async function init() {
    const reg = await registerServiceWorker();
    if (!reg) return;
    await navigator.serviceWorker.ready;
    await clearPushSubscription();
  }

  // Only run on the main app (not the login page).
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { if (document.querySelector('.nav')) init(); });
  } else {
    if (document.querySelector('.nav')) init();
  }
})();
