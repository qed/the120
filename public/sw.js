/**
 * The Path service worker (T1 Unit 11) — THIN by design; hand-rolled because
 * Serwist's Next plugin is webpack-only and Next 16 builds with Turbopack.
 *
 * Served from the ORIGIN ROOT (outside the /fp proxy matcher, so an expired
 * session can never break an update fetch) but registered with scope "/fp" —
 * narrowing needs no Service-Worker-Allowed header, and a Path SW bug can
 * never intercept a marketing route. Registration is guarded by hostname
 * (sync-rules.shouldRegisterServiceWorker) so preview deployments never
 * register a worker; parity with the app's constants is pinned by
 * app/fp/lib/__tests__/sw-discipline.test.ts.
 *
 * DISCIPLINE (each line is a plan requirement):
 *   - Never cache navigations or RSC payloads (?_rsc= flight requests are
 *     plain fetches, not mode:"navigate" — they fall through untouched).
 *   - Precache ONLY the /offline route (+ its content-hashed assets); runtime
 *     cache-first ONLY for /_next/static/** (immutable by construction).
 *   - No blind skipWaiting: the page shows an update toast and posts
 *     "path-skip-waiting" on user action (v1 HTML requesting v2 chunks is a
 *     ChunkLoadError).
 *   - Uploads/queue NEVER run here — iOS kills a backgrounded SW mid-transfer.
 *     The Background Sync handler only nudges open pages ("path-drain").
 *
 * THREE caches: the PRECACHE (the /offline page + its assets — replaced whole
 * at install, never trimmed), the RUNTIME cache (content-hashed static
 * assets, bounded — see STATIC_CACHE_MAX_ENTRIES), and the FW APP-SHELL cache
 * (FW Unit 8 — the ONE narrowly-scoped exception to never-cache-navigations,
 * see the FW block in the fetch handler). The version literals are static, so
 * activate()'s sweep only fires when this file changes; the runtime bound is
 * what stops superseded builds' hashed assets accumulating forever on a child's
 * phone (performance review).
 *
 * FW APP-SHELL EXCEPTION (Unit 8, Decision 15). A guide iPad must NAVIGATE while
 * offline mid-loop, so this worker may cache navigations — but ONLY under
 * /fp/fw, and NEVER the /fp/fw/board token subtree (a live no-store poll
 * surface whose token URL must not be cached). Every Path navigation, and the
 * board, keep the original never-cache posture. The roster itself is IndexedDB,
 * not cached here — this is the smallest possible touch on the pinned invariant,
 * and app/fp/lib/__tests__/sw-discipline.test.ts pins BOTH halves (the FW
 * exception is scoped; the Path pin still reddens for a Path navigation).
 */

// KEPT STABLE across the /fp rename (Unit 10): these cache names — and the
// "path-skip-waiting" / "path-drain" message strings below — are internal SW
// keys, NOT routes. Renaming them orphans every installed device's caches for
// zero user value. The route-bearing constants (FW_*_PREFIX) DID move to /fp.
const PRECACHE_NAME = "path-sw-precache-v1";
const RUNTIME_CACHE_NAME = "path-sw-runtime-v1";
const FW_SHELL_CACHE_NAME = "path-sw-fw-shell-v1";
const OFFLINE_URL = "/offline";
const STATIC_PREFIX = "/_next/static/";
/** The FW guide shell — cacheable navigations (Unit 8). */
const FW_APP_SHELL_PREFIX = "/fp/fw";
/** The board token subtree — EXCLUDED from the exception (live, no-store). */
const FW_BOARD_PREFIX = "/fp/fw/board";
/** Staff ops — EXCLUDED (cross-cohort admin HTML was never the offline target). */
const FW_OPS_PREFIX = "/fp/fw/ops";
/** Cap on runtime-cached static assets — oldest-inserted trimmed on insert. */
const STATIC_CACHE_MAX_ENTRIES = 80;
/** Cap on cached FW app-shell navigations — bounded like the static runtime cache,
 *  so a multi-day event's hundreds of visited student/task URLs can't accumulate
 *  unboundedly (performance review). Oldest-inserted trimmed on insert. */
const FW_SHELL_CACHE_MAX_ENTRIES = 24;

/** Whether a navigation URL is a cacheable FW app-shell route: under /fp/fw,
 *  but NOT the board token subtree and NOT staff ops. The single predicate the
 *  exception rests on — mirrors isFwAppShellPath in fw-sync-rules.ts. */
function isFwAppShell(url) {
  const p = url.pathname;
  if (p !== FW_APP_SHELL_PREFIX && !p.startsWith(FW_APP_SHELL_PREFIX + "/")) return false;
  if (p === FW_BOARD_PREFIX || p.startsWith(FW_BOARD_PREFIX + "/")) return false;
  if (p === FW_OPS_PREFIX || p.startsWith(FW_OPS_PREFIX + "/")) return false;
  return true;
}

/** Network-first for the FW app shell: keep the freshest shell, but fall back to
 *  the last cached one so a mid-loop outage lands on the roster the guide last saw
 *  rather than the generic /offline page. Bounded — see FW_SHELL_CACHE_MAX_ENTRIES. */
async function fwAppShell(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(FW_SHELL_CACHE_NAME);
    await cache.put(request, response.clone()).catch(() => {
      /* a shell we could not cache costs an offline nav, never the online one */
    });
    // Trim oldest-inserted entries past the cap (the STATIC cache's discipline).
    const keys = await cache.keys();
    if (keys.length > FW_SHELL_CACHE_MAX_ENTRIES) {
      await Promise.all(
        keys.slice(0, keys.length - FW_SHELL_CACHE_MAX_ENTRIES).map((k) => cache.delete(k))
      );
    }
    return response;
  } catch {
    const cached = await caches.match(request, { cacheName: FW_SHELL_CACHE_NAME });
    return cached || (await caches.match(OFFLINE_URL)) || Response.error();
  }
}

/** Precache the offline page AND the hashed assets its HTML references, so the
 *  fallback renders styled even on a cold offline start. */
async function precacheOffline(cache) {
  const response = await fetch(OFFLINE_URL, { credentials: "same-origin" });
  if (!response.ok) throw new Error("offline page precache failed: " + response.status);
  const html = await response.clone().text();
  await cache.put(OFFLINE_URL, response);
  const assetUrls = [...new Set(html.match(/\/_next\/static\/[^"'\s>]+/g) || [])];
  await Promise.all(
    assetUrls.map((url) =>
      cache.add(url).catch(() => {
        /* a missing asset degrades styling, never installation */
      })
    )
  );
}

self.addEventListener("install", (event) => {
  // Deliberately NO skip-waiting here — see the message handler.
  event.waitUntil(caches.open(PRECACHE_NAME).then(precacheOffline));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (k) =>
              k !== PRECACHE_NAME &&
              k !== RUNTIME_CACHE_NAME &&
              k !== FW_SHELL_CACHE_NAME &&
              k.startsWith("path-sw-")
          )
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  // The ONLY skipWaiting — user pressed the update toast (never blind).
  if (event.data === "path-skip-waiting") self.skipWaiting();
});

self.addEventListener("sync", (event) => {
  // Chromium-only Background Sync: a free NUDGE, never the mechanism. The
  // drain itself runs in page context.
  if (event.tag === "path-drain") {
    event.waitUntil(
      self.clients
        .matchAll({ type: "window" })
        .then((clients) => clients.forEach((c) => c.postMessage("path-drain")))
    );
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    // FW app-shell EXCEPTION (Unit 8): the ONLY navigations this worker caches,
    // and only the guide shell — never the board token subtree, never anything
    // outside /fp/fw. Network-first with a cached-shell fallback.
    if (isFwAppShell(url)) {
      event.respondWith(fwAppShell(request));
      return;
    }
    // Every other navigation — all of the Path, and the board — network always;
    // the cached /offline page ONLY on failure. The response is NEVER cached.
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match(OFFLINE_URL);
        return cached || Response.error();
      })
    );
    return;
  }

  // Content-hashed static assets: cache-first (a hash change is a new URL).
  // caches.match() checks the precache too, so the offline page's own assets
  // are served from the untrimmed precache even after runtime trimming.
  if (url.pathname.startsWith(STATIC_PREFIX)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const cache = await caches.open(RUNTIME_CACHE_NAME);
        const response = await fetch(request);
        if (response.ok) {
          await cache.put(request, response.clone());
          // Bounded: trim oldest-inserted runtime entries past the cap. The
          // precache (the offline page + its assets) is a separate cache and
          // is never trimmed.
          const keys = await cache.keys();
          if (keys.length > STATIC_CACHE_MAX_ENTRIES) {
            await Promise.all(keys.slice(0, keys.length - STATIC_CACHE_MAX_ENTRIES).map((k) => cache.delete(k)));
          }
        }
        return response;
      })()
    );
  }

  // Everything else — RSC payloads (?_rsc=), Server Actions, signed media URLs
  // — passes through untouched.
});
