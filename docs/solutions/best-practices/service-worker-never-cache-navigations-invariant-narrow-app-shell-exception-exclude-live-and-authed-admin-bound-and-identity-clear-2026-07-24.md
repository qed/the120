---
title: "A service worker must NEVER cache navigations (RSC payloads + authed HTML), but an offline-navigable sub-app needs exactly ONE exception: scope it to the narrowest route prefix, EXCLUDE the live-token and cross-cohort-admin subtrees inside that prefix, BOUND the cache, CLEAR it on identity change, and pin BOTH halves — the exception is scoped AND the general never-cache pin still reddens for every other navigation"
date: 2026-07-24
category: best-practices
module: path-fw-offline
problem_type: best_practice
component: sync_engine
severity: high
applies_when:
  - "A hand-rolled service worker enforces a never-cache-navigations rule (RSC/flight payloads and authenticated HTML must never be cached) and a NEW feature needs a sub-tree of the app to be navigable offline"
  - "You are about to widen `sw.js`'s fetch handler to cache navigation responses for some routes — the single most dangerous edit to a pinned SW invariant"
  - "An offline-navigable authenticated surface runs on a SHARED device (a kiosk, an event iPad) where sessions rotate and can end without an explicit sign-out"
  - "A cached-HTML shell coexists with a live-token or no-store poll surface (a projector board, a payment page) under the same route prefix"
related_components:
  - authentication
  - frontend_stimulus
tags:
  - service-worker
  - pwa
  - never-cache-navigations
  - offline
  - app-shell
  - cache-scoping
  - shared-device
  - parity-test
---

# The never-cache-navigations SW invariant, and how to add the one exception an offline sub-app needs

## Context

The Path service worker (`public/sw.js`) pins a hard rule: it caches ONLY the
`/offline` page and content-hashed `/_next/static/**` assets, and NEVER a navigation
response — because a navigation is either an authenticated HTML page (leaks a signed-in
user's content to whoever loads the URL next) or an RSC/flight payload (a `v1`-HTML /
`v2`-chunks `ChunkLoadError` waiting to happen). The rule was enforced only by a
source-parsing test (`sw-discipline.test.ts`), with no `docs/solutions/` write-up.

FW Unit 8 needed the Founders Weekend guide surface (`/path/fw`) to stay navigable
through a venue-wifi outage, which required — for the first time — caching some
navigations. This is the reusable shape for doing that without breaking the invariant.

## Guidance

Adding an offline-navigable sub-app to a worker that never caches navigations is a
FIVE-part edit. Skipping any one of the last four turns "offline navigation" into a
leak or an unbounded/stale-forever cache.

### 1. Scope the exception to the narrowest route prefix, as a single pure predicate

Make the app cache the SMALLEST possible set of navigations — one route prefix — and
express the decision as ONE predicate the fetch handler calls, so the general
never-cache path is the untouched default for everything else:

```js
if (request.mode === "navigate") {
  if (isFwAppShell(url)) { event.respondWith(fwAppShell(request)); return; } // the ONE exception
  // …every other navigation (all the rest of the app) keeps the never-cache fallback
}
```

### 2. EXCLUDE the dangerous subtrees INSIDE that prefix

Under the prefix live routes that must NOT be cached even though they match it. In this
case, two: the live board **token** subtree (`/path/fw/board` — a no-store poll surface
whose token URL must never be cached) and the cross-cohort **staff-ops** subtree
(`/path/fw/ops` — admin HTML that was never the offline target). The predicate excludes
both, at a segment boundary:

```js
function isFwAppShell(url) {
  const p = url.pathname;
  if (p !== FW_APP_SHELL_PREFIX && !p.startsWith(FW_APP_SHELL_PREFIX + "/")) return false;
  if (p === FW_BOARD_PREFIX || p.startsWith(FW_BOARD_PREFIX + "/")) return false; // live token
  if (p === FW_OPS_PREFIX   || p.startsWith(FW_OPS_PREFIX + "/"))   return false; // admin HTML
  return true;
}
```

### 3. BOUND the exception cache like the static one

An event runs for days across ~90 students; each visited student/task URL is a distinct
navigation. Cap and trim oldest-inserted, exactly as the static runtime cache does — an
unbounded authed-shell cache accretes hundreds of pages and invites the browser's own
storage-pressure eviction to drop the roster shell the guide most needs:

```js
const keys = await cache.keys();
if (keys.length > FW_SHELL_CACHE_MAX_ENTRIES)
  await Promise.all(keys.slice(0, keys.length - FW_SHELL_CACHE_MAX_ENTRIES).map(k => cache.delete(k)));
```

### 4. CLEAR the cache on identity change (shared device)

The cache holds authenticated HTML with no session scoping. Sign-out clears it — but a
session can END WITHOUT sign-out (app killed, grant revoked, forgotten). On a shared
event device the NEXT guide to authenticate could be served the prior guide's cached
page offline, bypassing every server authorization check. So the client reconciles a
persisted "cache owner" on every mount and PURGES all residue (queue, roster cache, AND
the SW shell cache) on a mismatch, before the new guide can navigate:

```ts
if (prior !== null && prior !== actorUserId) await purgeFwResidue(); // queue + roster + caches.delete(shell)
```

### 5. Pin BOTH halves, and mutation-test the pin

The `sw.js` predicate is a HAND-MIRRORED copy of a pure TS predicate (`isFwAppShellPath`
in `fw-sync-rules.ts`), because a worker script can't import a module. Pin:

- the pure predicate's BEHAVIOR (segment-boundary include, board/ops exclude, `/path`
  outside the prefix never cacheable) — mutation guards that redden if an exclusion is
  dropped or the prefix is relaxed to `/path`;
- the `sw.js` copy's PARITY (it references the same prefix constants, opens only the FW
  shell cache, and is bounded);
- the GENERAL navigate clause STILL never caches — slice it out of the source and assert
  it contains no `cache.put`/`cache.add`/`caches.open`, so the pin holds for every
  non-exception navigation and a regression there reddens a test.

## Why This Matters

A worker that caches an authenticated navigation is a cross-user data leak with no
server round trip in the loop to catch it, and one that caches an RSC payload is a
white-screen `ChunkLoadError` on the next deploy. The temptation, once "cache the app
shell" is on the table, is to cache the whole route subtree behind one prefix check.
That single check silently swept a live board token and cross-cohort staff admin HTML
into a shared iPad's cache. The invariant is only as strong as its narrowest exception,
and an exception this dangerous has to be scoped, excluded, bounded, identity-cleared,
AND pinned on both sides — or the pin that protected the whole app quietly stops
protecting the part that needed it most.

## When to Apply

- Any edit to a hand-rolled service worker's fetch handler that would cache a navigation
  response for the first time, or widen an existing app-shell exception.
- Any offline-navigable authenticated PWA surface on a shared/kiosk device.
- Whenever a cached-HTML route prefix contains a live-token, no-store, or higher-privilege
  subtree — exclude it explicitly and test the exclusion.

## Related

- `app/path/lib/__tests__/sw-discipline.test.ts` — the source-parsing pin for both the
  general never-cache rule and the scoped FW exception (the mechanism this doc explains).
- `best-practices/force-dynamic-app-router-page-cannot-be-no-store-pii-free-shell-plus-no-store-feed-2026-07-24.md` — the sibling "authed content at the edge" learning (the board's PII-free shell + no-store feed), the reason the board subtree is excluded here.
- `best-practices/offline-drain-reuses-a-fail-closed-signal-across-a-safety-boundary-irreversible-action-needs-tri-state-2026-07-24.md` — the same unit's data-loss-at-the-seam learning; the identity-clear in step 4 is one of its "irreversible action" boundaries.
