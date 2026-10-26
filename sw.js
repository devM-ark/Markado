// Markado service worker: keeps the app itself (pages, scripts, icons) on the device so it opens with no connection.
// Only the app's own files are handled here. Requests to the server (Apps Script) pass straight through: the data is
// kept separately by offline.js, and changes are never queued here.
//
// Strategy: network first, so a new version reaches users as soon as they are online; the saved copy is used only
// when the network fails or is very slow.

var CACHE = 'markado-shell-v1';
var SHELL = [
  'teacher.html', 'teacher-login.html', 'config.js', 'api.js', 'offline.js', 'privacy.html', 'terms.html', 'sf9.js', 'sf9-frames.js',
  'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
  'assets/icons/home.svg', 'assets/icons/print.svg',
];
var NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // one missing file must not stop the rest being saved
      return Promise.all(SHELL.map(function (url) { return cache.add(url).catch(function () {}); }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.filter(function (n) { return n !== CACHE; }).map(function (n) { return caches.delete(n); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function fromNetworkThenCache(request) {
  return new Promise(function (resolve, reject) {
    var settled = false;
    var timer = setTimeout(function () {
      if (settled) return;
      caches.match(request, { ignoreSearch: true }).then(function (hit) { if (hit && !settled) { settled = true; resolve(hit); } });
    }, NETWORK_TIMEOUT_MS);
    fetch(request).then(function (response) {
      clearTimeout(timer);
      if (response && response.ok) {
        var copy = response.clone();
        caches.open(CACHE).then(function (cache) { cache.put(request, copy); });
      }
      if (!settled) { settled = true; resolve(response); }
    }).catch(function () {
      clearTimeout(timer);
      caches.match(request, { ignoreSearch: true }).then(function (hit) {
        if (settled) return;
        settled = true;
        if (hit) resolve(hit); else reject(new Error('offline and not saved'));
      });
    });
  });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // the Apps Script server, fonts, ...: not ours to keep
  event.respondWith(fromNetworkThenCache(request));
});
