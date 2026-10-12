/*
 * The dashboard opens with no signal: this keeps a copy of the dashboard's page and its files
 * on the phone. The page is fetched from the network first (so a new version always arrives
 * when there is signal) and the copy is used only when the network fails. Fingerprinted build
 * files (/assets/…) never change, so the copy is used first for them. The API is never cached.
 */
const CACHE = 'pragya-dashboard-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

const isPage = (url) => /^\/landing\/([a-z]{2,6}\/)?admin\/?/.test(url.pathname);
const isAsset = (url) => url.pathname.startsWith('/assets/') || /^\/(favicon|fonts)/.test(url.pathname);

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate' && isPage(url)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(url.pathname, copy));
          }
          return response;
        })
        .catch(() => caches.match(url.pathname).then((cached) => cached || caches.match('/landing/admin/'))),
    );
    return;
  }

  if (isAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
