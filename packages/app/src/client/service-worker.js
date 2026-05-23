// Runtime-cache service worker. Filenames downstream of Bun.build can be
// hashed, so we can't precache a known asset list — instead, we cache
// successful same-origin GETs as they happen and fall back to the cache (and
// /index.html for navigations) when the network is unavailable. RPC traffic
// is always network-only.

// APP_SHELL precaches the stable-path resources needed to render an offline
// shell. The authoritative list of PWA assets the server publishes lives in
// `PWA_FILES` in packages/app/src/server/index.ts; APP_SHELL is the subset
// the browser must have on hand for an offline first paint (omitting e.g.
// the maskable icon and the SW itself).
const CACHE = "anywhen-v1";
const APP_SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

// The "always network-only" namespace must mirror the server's routing
// table in packages/app/src/server/index.ts (which currently dispatches
// `/rpc/*` to the oRPC handler and `/api/health` to the health endpoint).
// Keep this predicate broader than any single route — it covers the whole
// `/api/*` namespace so a new server endpoint added under `/api/...` is not
// silently served from cache. Adding a new top-level RPC-ish prefix on the
// server requires extending this predicate.
const isRpcPath = (url) => url.pathname.startsWith("/rpc/") || url.pathname.startsWith("/api/");

// Write res into the cache under key, fire-and-forget. Errors are logged but
// not propagated — a failed cache write is non-fatal; the response still
// reaches the client.
const cacheWrite = (key, res) => {
  caches
    .open(CACHE)
    .then((cache) => cache.put(key, res))
    .catch((err) => console.warn("[sw] cache write failed", err));
};

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (isRpcPath(url)) return;

  if (req.mode === "navigate") {
    // Network-first for navigations: serve fresh HTML, cache it for offline,
    // fall back to the cached shell when the network is unavailable.
    event.respondWith(
      fetch(req)
        .then((res) => {
          cacheWrite("/index.html", res.clone());
          return res;
        })
        .catch(async () => (await caches.match("/index.html")) ?? Response.error()),
    );
    return;
  }

  // Cache-first for all other same-origin GETs: return cached copy
  // immediately if present, and in parallel kick off a network fetch to
  // refresh the cache for the next visit.
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      const networkPromise = fetch(req).then((res) => {
        // res.type === "basic" confirms same-origin (guards against opaque
        // responses slipping through if the origin check above ever relaxes).
        if (res.ok && res.type === "basic") cacheWrite(req, res.clone());
        return res;
      });
      return cached ?? (await networkPromise);
    })(),
  );
});
