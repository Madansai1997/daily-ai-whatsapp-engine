/* JARVIS service worker — Web Push delivery + notification clicks + PWA app-shell cache. */

const CACHE = "jarvis-shell-v2";
const SHELL = ["/console/", "/console/index.html", "/console/manifest.webmanifest",
               "/console/icon-192.png", "/console/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

/* Serve the console shell offline; NEVER intercept API/auth (anything outside /console/). */
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || !url.pathname.startsWith("/console/")) return; // backend passes through
  if (event.request.mode === "navigate") {
    // Network-first so new deploys are picked up; fall back to the cached shell when offline.
    event.respondWith(fetch(event.request).catch(() => caches.match("/console/index.html")));
    return;
  }
  // Hashed static assets: cache-first, then network (and cache the fresh copy).
  event.respondWith(
    caches.match(event.request).then((hit) =>
      hit || fetch(event.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy)).catch(() => {});
        return res;
      }).catch(() => hit)
    )
  );
});

self.addEventListener("push", (event) => {
  let data = { title: "JARVIS", body: "New notification" };
  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "JARVIS", {
      body: data.body || "",
      tag: "jarvis-notification",
      renotify: true,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        for (const client of list) {
          if (client.url.includes("/console") && "focus" in client) return client.focus();
        }
        if (self.clients.openWindow) return self.clients.openWindow("/console/");
      })
  );
});
