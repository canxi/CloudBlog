/**
 * CloudBlog Service Worker
 * Handles offline caching and "Add to Home Screen"
 */

const CACHE_VERSION = 'v1';
const STATIC_CACHE = `cloudblog-static-${CACHE_VERSION}`;
const PAGES_CACHE = `cloudblog-pages-${CACHE_VERSION}`;
const API_CACHE = `cloudblog-api-${CACHE_VERSION}`;

// Static assets to cache on install
const STATIC_ASSETS = [
  '/',
  '/offline.html',
  '/manifest.json',
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('cloudblog-') && name !== STATIC_CACHE && name !== PAGES_CACHE && name !== API_CACHE)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event - network-first for API, cache-first for static
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip cross-origin requests
  if (url.origin !== self.location.origin) return;

  // API requests: network-first with cache fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  // HTML pages: cache-first with offline fallback
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      caches.open(PAGES_CACHE).then((cache) =>
        cache.match(request).then((cached) => {
          const fetchPromise = fetch(request)
            .then((response) => {
              if (response.ok) {
                cache.put(request, response.clone());
              }
              return response;
            })
            .catch(() => {
              // Return offline page if available
              return caches.match('/offline.html') || new Response(
                'You are offline', { status: 503, headers: { 'Content-Type': 'text/plain' } }
              );
            });

          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  // Static assets: cache-first
  event.respondWith(cacheFirst(request, STATIC_CACHE));
});

// Cache-first strategy
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

// Network-first strategy
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'Offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// Handle messages from the main thread
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }

  // Precache specific pages on demand
  if (event.data.type === 'precache') {
    const urls = event.data.urls || [];
    caches.open(PAGES_CACHE).then((cache) => {
      urls.forEach((url) => {
        fetch(url).then((response) => {
          if (response.ok) cache.put(url, response);
        });
      });
    });
  }

  // Clear specific pages from cache
  if (event.data.type === 'clearCache') {
    caches.open(PAGES_CACHE).then((cache) => {
      cache.keys().then((keys) => {
        keys.forEach((key) => {
          if (key.url.includes(event.data.url)) {
            cache.delete(key);
          }
        });
      });
    });
  }
});
