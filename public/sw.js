// ThePact Service Worker — Network-first caching (push notifications removed)
const CACHE_NAME = 'thepact-v1';
const PRECACHE_URLS = [
  '/',
  '/css/base.css',
  '/css/layout.css',
  '/css/kanban.css',
  '/css/card-detail.css',
  '/css/chat-campfire.css',
  '/css/dashboard.css',
  '/css/modals-toasts.css',
  '/css/board-responsive.css',
  '/img/logo-white.svg',
  '/img/icon-192.png',
];

// Install: precache essential assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: network-first strategy (always get fresh content, fall back to cache)
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET, API calls, WebSocket upgrades, auth endpoints
  if (event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/auth/')) return;
  if (url.pathname.startsWith('/uploads/')) return;
  if (url.pathname === '/ws') return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache successful responses
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Network failed — try cache
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          // Offline fallback for navigation requests — serve cached index
          if (event.request.mode === 'navigate') {
            return caches.match('/');
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});
