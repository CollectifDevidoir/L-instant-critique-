// Service worker : rend l'application installable et utilisable hors connexion.
// Stratégie « réseau d'abord » : on sert toujours la dernière version publiée
// quand le réseau répond, la copie en cache sinon.
const CACHE = 'instant-critique-v3';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './favicon.svg',
  './src/css/app.css', './src/js/app.js', './src/js/data.js', './src/js/srs.js', './src/js/session.js', './src/js/store.js', './src/js/pdf.js',
  './src/data/oeuvres.json', './src/data/cartes.json', './src/data/liens.json', './src/data/glossaire.json',
  './assets/icons/icon-192.png', './assets/icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const fonts = url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com');
  if (!sameOrigin && !fonts) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))),
  );
});
