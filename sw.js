/* Service worker : met l'application en cache pour l'utiliser hors ligne.
 * Ne met en cache que les fichiers de l'application, jamais des données
 * (les observations restent dans IndexedDB, que ce fichier ne touche jamais). */
const CACHE = 'jm-app-v0.4.0';
const ASSETS = ['./', './index.html', './css/app.css', './js/config.js', './js/sync.js', './js/organize.js', './js/app.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png'];
// À l'installation, on télécharge chaque fichier du réseau (« reload ») et non du cache HTTP
// du navigateur : le nouveau cache ne peut pas contenir un ancien fichier.
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // rien d'autre ne passe par le cache
  // Réseau d'abord ; les fichiers (scripts, styles) sont revalidés auprès du serveur pour ne pas
  // mélanger d'anciennes et de nouvelles versions. Hors ligne : copie en cache.
  const req = e.request.mode === 'navigate' ? e.request : new Request(e.request, { cache: 'no-cache' });
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});
