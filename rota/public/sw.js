/* eslint-disable no-undef */
//
// HRestroSewa Rota — service worker. Separate from the main app's worker (different
// origin), but the same rule: NOTHING carrying live data is ever cached. A staff
// member shown a cached rota is shown shifts that may have changed.
//
// Cached: /_next/static/* (content-hashed, immutable), /icons/*, and /offline.
// Never touched: API calls (they go to the main app's origin anyway), POSTs, pages.
// Pages are network-only, falling back to /offline when the network is gone.
//
// Bump VERSION to retire old caches on the next activation.

const VERSION = "v1";
const STATIC_CACHE = `rota-static-${VERSION}`;
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      // A failed precache must not kill the worker — install without it instead.
      try {
        const cache = await caches.open(STATIC_CACHE);
        await cache.add(new Request(OFFLINE_URL, { cache: "reload" }));
      } catch {
        // offline page unavailable until the next install
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith("rota-static-") && k !== STATIC_CACHE).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // the backend API, fonts, etc.

  // Immutable build output and our own icons: cache-first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })()
    );
    return;
  }

  // Pages: always the network; the offline page only when there is none.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(req);
        } catch {
          const cache = await caches.open(STATIC_CACHE);
          return (await cache.match(OFFLINE_URL)) ?? Response.error();
        }
      })()
    );
  }
});
