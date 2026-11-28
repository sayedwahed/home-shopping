/* Home Shopping service worker (system 9 of the spec).
   Static assets only: cache-first for /static/ (CSS, JS, images).
   HTML pages and API responses are NEVER cached — the storefront,
   prices and click counts must always be fresh. */

var CACHE = "home-shopping-static-v2";

self.addEventListener("install", function (event) {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    })
  );
});

self.addEventListener("fetch", function (event) {
  var url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  // Only same-origin /static/ requests are cached.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf("/static/") !== 0) return;
  event.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(event.request).then(function (hit) {
        if (hit) return hit;
        return fetch(event.request).then(function (resp) {
          if (resp && resp.status === 200) cache.put(event.request, resp.clone());
          return resp;
        });
      });
    })
  );
});

/* Web push (system 10): show the notification the server sent. */
self.addEventListener("push", function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  var title = (data.notification && data.notification.title) || "Home Shopping";
  var body = (data.notification && data.notification.body) || "";
  var url = (data.data && data.data.url) || "/";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      icon: "/static/icons/icon-192.png",
      data: { url: url }
    })
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(clients.openWindow(url));
});
