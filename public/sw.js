// Offline support: pages you've visited, and the code they need, keep working without a connection.
// Pages are network-first (so deploys show up at once); hashed build files and vendored wasm are cache-first.
const VERSION = 'v2';
const PAGES = `pages-${VERSION}`;
const ASSETS = `assets-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(PAGES).then((c) => c.addAll(['/', '/offline'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      // only our own old page/asset caches; downloaded AI models (rounder-models-*, transformers-cache) stay
      .then((keys) => Promise.all(keys.filter((k) => /^(pages|assets)-/.test(k) && k !== PAGES && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// search/: the palette's content-hashed index and tool vectors, so search keeps working offline too
const immutable = (path) => /^\/(_astro|vendor|fonts|icons|models|search)\//.test(path);

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // other origins (model hubs, exchange rates) manage their own caching
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(PAGES).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(request)) || (await caches.match('/offline')) || Response.error()),
    );
    return;
  }

  if (immutable(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            // only whole, successful responses; range requests for media come back as 206
            if (res.status === 200) {
              const copy = res.clone();
              caches.open(ASSETS).then((c) => c.put(request, copy));
            }
            return res;
          }),
      ),
    );
  }
});
