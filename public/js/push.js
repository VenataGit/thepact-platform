// Push Notification registration & Service Worker management
(function() {
  'use strict';

  // Register Service Worker
  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return null;
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      console.log('[SW] registered, scope:', reg.scope);
      return reg;
    } catch (err) {
      console.warn('[SW] registration failed:', err.message);
      return null;
    }
  }

  // Subscribe to push notifications
  async function subscribeToPush(reg) {
    if (!('PushManager' in window)) {
      console.log('[push] Push API not supported');
      return false;
    }

    try {
      // Get VAPID key from server
      const res = await fetch('/api/push/vapid-key');
      if (!res.ok) return false;
      const { publicKey } = await res.json();
      if (!publicKey) return false;

      // Check existing subscription
      let sub = await reg.pushManager.getSubscription();

      if (!sub) {
        // Request permission
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          console.log('[push] Permission denied');
          return false;
        }

        // Subscribe
        const applicationServerKey = urlBase64ToUint8Array(publicKey);
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });
      }

      // Send subscription to server
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: sub.endpoint,
          keys: {
            p256dh: btoa(String.fromCharCode.apply(null, new Uint8Array(sub.getKey('p256dh')))),
            auth: btoa(String.fromCharCode.apply(null, new Uint8Array(sub.getKey('auth')))),
          },
        }),
      });

      console.log('[push] Subscribed successfully');
      return true;
    } catch (err) {
      console.warn('[push] Subscribe error:', err.message);
      return false;
    }
  }

  // Unsubscribe from push
  async function unsubscribeFromPush() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/push/unsubscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
        console.log('[push] Unsubscribed');
      }
    } catch (err) {
      console.warn('[push] Unsubscribe error:', err.message);
    }
  }

  // Check if push is active
  async function isPushSubscribed() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      return !!sub;
    } catch { return false; }
  }

  // Helper: VAPID key conversion
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  // Auto-init: register SW and prompt for push after login
  async function init() {
    const reg = await registerServiceWorker();
    if (!reg) return;

    // Wait for SW to be ready
    await navigator.serviceWorker.ready;

    // Auto-subscribe if already granted, or show prompt on first visit
    const permission = Notification.permission;
    if (permission === 'granted') {
      await subscribeToPush(reg);
    } else if (permission === 'default') {
      // Show a non-intrusive prompt after 3 seconds
      setTimeout(() => showPushPrompt(reg), 3000);
    }
  }

  // Non-intrusive push permission prompt
  function showPushPrompt(reg) {
    // Don't show if already dismissed recently
    const dismissed = localStorage.getItem('thepact-push-dismissed');
    if (dismissed) {
      const dismissedAt = parseInt(dismissed);
      // Don't ask again for 7 days
      if (Date.now() - dismissedAt < 7 * 24 * 60 * 60 * 1000) return;
    }

    const toast = document.createElement('div');
    toast.className = 'push-prompt';
    toast.innerHTML = `
      <div class="push-prompt__content">
        <span class="push-prompt__icon">🔔</span>
        <span class="push-prompt__text">Искаш ли да получаваш известия за съобщения и задачи?</span>
      </div>
      <div class="push-prompt__actions">
        <button class="btn btn-sm push-prompt__yes">Да</button>
        <button class="btn btn-sm btn-ghost push-prompt__no">По-късно</button>
      </div>
    `;

    toast.querySelector('.push-prompt__yes').onclick = async () => {
      toast.remove();
      await subscribeToPush(reg);
    };

    toast.querySelector('.push-prompt__no').onclick = () => {
      toast.remove();
      localStorage.setItem('thepact-push-dismissed', Date.now().toString());
    };

    document.body.appendChild(toast);

    // Auto-dismiss after 15 seconds
    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 15000);
  }

  // Expose globally
  window.ThePactPush = {
    init,
    subscribe: async () => {
      const reg = await navigator.serviceWorker.ready;
      return subscribeToPush(reg);
    },
    unsubscribe: unsubscribeFromPush,
    isSubscribed: isPushSubscribed,
  };

  // Auto-init when DOM is ready (only if user is logged in)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      // Check if we're on the main app (not login page)
      if (document.querySelector('.nav')) init();
    });
  } else {
    if (document.querySelector('.nav')) init();
  }
})();
