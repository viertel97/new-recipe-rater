const SW_VERSION = "v1";
const PRECACHE = `precache-${SW_VERSION}`;
const RUNTIME = `runtime-${SW_VERSION}`;
const MAX_RUNTIME_ENTRIES = 200;

const PRECACHE_URLS = [
  "/",
  "/swipe",
  "/add",
  "/offline",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PRECACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Purge old versioned caches
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== PRECACHE && k !== RUNTIME)
          .map((k) => caches.delete(k))
      );
      // LRU eviction on runtime cache if over limit
      const runtimeCache = await caches.open(RUNTIME);
      const requests = await runtimeCache.keys();
      if (requests.length > MAX_RUNTIME_ENTRIES) {
        const toDelete = requests.slice(0, requests.length - MAX_RUNTIME_ENTRIES);
        await Promise.all(toDelete.map((r) => runtimeCache.delete(r)));
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin GETs
  if (request.method !== "GET" || url.origin !== location.origin) return;

  // /api/media/* — cache-first (immutable served media)
  if (url.pathname.startsWith("/api/media")) {
    event.respondWith(cacheFirst(request, RUNTIME));
    return;
  }

  // /_next/static/* — cache-first (hashed filenames)
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, RUNTIME));
    return;
  }

  // Navigation requests — network-first, fallback /offline
  if (request.mode === "navigate") {
    event.respondWith(networkFirstNav(request));
    return;
  }

  // Everything else — network-first, fallback cache
  event.respondWith(networkFirst(request));
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached ?? new Response("Offline", { status: 503 });
  }
}

async function networkFirstNav(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(RUNTIME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cache = await caches.open(RUNTIME);
    const cached = await cache.match(request);
    if (cached) return cached;
    const offline = await caches.match("/offline");
    return offline ?? new Response("Offline", { status: 503 });
  }
}
