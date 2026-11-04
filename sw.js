// Offline support. Bump VERSION when publishing an update.
const VERSION = 'lore-v6';
const FILES = ['./', 'index.html', 'style.css', 'manifest.webmanifest', 'icon.svg', 'js/app.js', 'js/model.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES).then(() => Promise.all(['/core/suite.js', '/core/text.js'].map(u => c.add(u).catch(() => {}))))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x.startsWith('lore-') && x !== VERSION).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => { const cp = r.clone(); caches.open(VERSION).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
