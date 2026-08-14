const CACHE_NAME = 'tornei-scuola-offline-v9';

const APP_SHELL = [
  './',
  './index.html',
  './admin.html',
  './admin/',
  './admin/index.html',
  './live.html',
  './gym.html',
  './favicon.svg',
  './image.png',
  './css/style.css',
  './js/app-config.js',
  './js/archive.js',
  './js/auth.js',
  './js/csv-import.js',
  './js/db.js',
  './js/device.js',
  './js/events.js',
  './js/gym-screen.js',
  './js/knockout-bracket.js',
  './js/live.js',
  './js/main-admin.js',
  './js/main-index.js',
  './js/main-live.js',
  './js/matches.js',
  './js/offline.js',
  './js/offline-store.js',
  './js/onboarding.js',
  './js/reports.js',
  './js/schedule.js',
  './js/teams.js',
  './js/telegram.js',
  './js/utils.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => Promise.allSettled(APP_SHELL.map((url) => cache.add(url))))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => {
          if (request.mode === 'navigate' || request.destination === 'document') {
            return caches.match('./index.html');
          }
          return new Response('', { status: 504, statusText: 'Offline asset unavailable' });
        });
    })
  );
});
