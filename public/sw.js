/* ------------------------------------------------------------------ *
 * PomoFlow service worker — offline shell, nothing clever            *
 * ------------------------------------------------------------------ *
 * Chrome only offers the install prompt to a page whose service worker
 * has a fetch handler, so this file exists as much for installability
 * as for offline use.
 *
 * Strategy is network-first for every same-origin GET: while online the
 * user always gets the freshly deployed file (this matters — every
 * deploy rewrites version.js and may rewrite the rest), and the cache is
 * only consulted when the network fails. That also means a stale cache
 * can never win, so the cache name needs bumping only when the precache
 * list itself changes.
 */

const CACHE = "pomoflow-shell-v1";

// Everything needed to cold-start the app offline. version.js is a build
// artifact and may be missing in an un-built checkout, hence the
// individual (failure-tolerant) adds below rather than cache.addAll.
const SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/version.js",
  "/manifest.json",
  "/icon.svg",
  "/icon-maskable.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Only cache real, complete responses — an opaque or error response
        // would poison the offline shell.
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        // A navigation to any in-scope URL is still the same single page.
        if (request.mode === "navigate") {
          const shell = await caches.match("/index.html") || await caches.match("/");
          if (shell) return shell;
        }
        return Response.error();
      })
  );
});
