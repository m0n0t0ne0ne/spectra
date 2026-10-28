// Offline shell for the browser version: cache the app files; food data and AI calls always use the network.
const CACHE = 'spectra-1.0.3';
const SHELL = ['./', './index.html', './manifest.webmanifest', './js/app.js', './js/api.js', './js/nutrients.js', './js/nutrient-info.js', './js/foodicon.js', './js/insights.js', './js/lookup.js', './js/prompts.js', './js/paste.js', './js/pipeline.js', './js/scanner.js', './js/store.js', './icons/icon.svg', './fonts/manrope-latin.woff2', './vendor/zxing-0.20.0.min.js', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Network first so updates show up; fall back to the cached shell offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});
