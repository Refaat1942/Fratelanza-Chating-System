/*
 * Minimal service worker: makes the app installable (PWA) and nothing else.
 * It deliberately does NOT cache anything — the inbox must always show live
 * data and a new deploy must never be shadowed by a stale cached bundle.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", () => {
  /* network only: let the browser handle every request */
});
