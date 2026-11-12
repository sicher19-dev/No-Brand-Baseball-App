/* No Brand Baseball - service worker: cache the app shell, network first so updates land right away. */
var CACHE = 'nbb-shell-v3';
var SHELL = ['./', './index.html', './app.css', './app.js', './backend.js', './config.js', './roster.js', './vendor/supabase.js',
             './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return; // reports and the backend go straight to the network
  // 'no-cache' makes the browser revalidate with GitHub Pages (cheap ETag check) instead of
  // trusting its 10-minute HTTP cache, so app updates reach pitchers on the next open.
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      return res;
    }).catch(function () { return caches.match(e.request); })
  );
});
