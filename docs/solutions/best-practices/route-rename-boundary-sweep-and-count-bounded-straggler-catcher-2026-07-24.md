---
title: "Whole-app route rename: a boundary-regex sweep + a COUNT-BOUNDED straggler catcher (a per-file allowlist strip gets hijacked by a reused literal)"
date: 2026-07-24
module: first-profit
problem_type: best_practice
component: testing_framework
severity: medium
related_components: [development_workflow, authentication, tooling]
tags: [route-rename, straggler-test, allowlist, count-bounded, next-redirects, service-worker, vitest-include]
applies_when:
  - "Renaming a whole route tree / app segment (e.g. /path → /fp) across a large codebase"
  - "Writing a scanning test that proves a mechanical sweep is complete via a named allowlist"
  - "A route rename must keep some 'path'-named internal identifiers (IDB stores, SW caches, cron paths) stable"
  - "Moving a Next.js route tree that a proxy/middleware gates and a PWA manifest scopes"
---

# Whole-app route rename: a boundary-regex sweep + a COUNT-BOUNDED straggler catcher

## Context

FW Unit 10 renamed the entire `/path` app to `/fp` (First Profit): `git mv app/path app/fp`, plus sweeping `@/app/path/` import specifiers and `/path` route literals to `/fp`, moving the PWA manifest scope + user-facing brand strings, moving the proxy `UNGUARDED` set + matcher, and adding a 308 redirect — all in one mechanical commit. The unit shipped a repo-wide **straggler-catcher test** as the proof the sweep left nothing behind. A 9-persona review broke the first version of that test in two independent ways, and surfaced four more rename-specific gotchas. This captures the tested playbook.

## Guidance

### 1. The straggler catcher's allowlist must be COUNT-BOUNDED, not a per-file string strip

To prove zero `/path` route literals survive, the test scans every tracked source file for `/path` at a route boundary and subtracts a **named allowlist** (the one legitimate survivor: the 308 redirect *source* in `next.config.ts`, plus the rename's own regression-test literals in `proxy-rules.test.ts`).

The naive implementation strips *every* occurrence of each allowlisted literal from the file before scanning:

```ts
// ❌ NAIVE — hijackable. A second, bogus `/path/:path*` redirect reusing the
// allowlisted literal is silently exempted; a new stray matches("/path") slips through.
for (const lit of allowedLiterals) scan = scan.split(lit).join("");
if (scan.match(ROUTE_BOUNDARY)) stragglers.push(...);
```

Two reviewers independently broke this — one planted a second `{ source: "/path/:path*", destination: "/wrong" }` redirect, the other a new `matches("/path")` assertion — and **both left the suite green**. The allowlist is supposed to permit exactly the known occurrences; a whole-file strip permits *unlimited* reuse of any allowlisted string.

Fix: give each allowlist entry an exact `count` and consume a per-file budget — strip at most `count` occurrences, so a duplicate/reused occurrence beyond the cap still reddens. Add a companion assertion pinning each literal to *exactly* `count`, which also catches a deleted guardrail (dead allowlist entry):

```ts
const CONTENT_ALLOWLIST = [
  { file: "next.config.ts", literal: '"/path/:path*"', count: 1 },
  { file: "app/crm/__tests__/proxy-rules.test.ts", literal: '"/path"', count: 1 },
  // …one entry per legitimate old-path literal, each capped.
];

// Check 2 — per-file budget:
const budget = new Map<string, number>();
for (const a of CONTENT_ALLOWLIST) if (a.file === file) budget.set(a.literal, (budget.get(a.literal) ?? 0) + a.count);
for (const line of lines) {
  let scan = line;
  for (const [lit, remaining] of budget) {
    let rem = remaining;
    while (rem > 0 && scan.includes(lit)) { scan = scan.replace(lit, ""); rem--; } // string arg → one occurrence
    budget.set(lit, rem);
  }
  if (scan.match(ROUTE_BOUNDARY)) stragglers.push(...);
}

// Freshness — exact count, both directions (dead entry OR duplicate reddens):
const occurrences = readFileSync(a.file, "utf8").split(a.literal).length - 1;
expect(occurrences).toBe(a.count);
```

Prove it: plant a duplicate and confirm the test goes **red** before trusting it green.

### 2. A single boundary-regex sweep separates routes from KEEP-STABLE identifiers automatically

One rule — replace `/path` only when followed by `/`, a quote (`"` `'` `` ` ``), `?`, or end-of-line — cleanly rewrites imports (`@/app/path/`, `../app/path/`), comment file-paths, vitest globs, and route literals in one pass, while leaving every keep-stable identifier untouched **with no manual per-file carve-out**:

```
RE = /\/path(?=[/"'`?]|$)/gm   →  replace with /fp
```

This works because the identifiers that must NOT move are, by construction, outside the boundary set:
- IndexedDB / SW cache / message names — `path-offline-queue`, `path-sw-*`, `path-skip-waiting`, `path-drain`, `fw-offline-queue` — have **no leading slash**, so `/path` never matches.
- Cron routes `/api/cron/path-notifications` — `/path` is followed by `-`.
- The manifest file `/path.webmanifest` and assets `/path-icon-*.png` — followed by `.`/`-`.

Renaming any of those orphans installed users' queues/caches or breaks a cron/asset URL for zero value, so keeping them stable is deliberate — and the sweep gives it to you free. The **only** hand edits are the files you deliberately exclude: the redirect map (`next.config.ts`, whose old `/path` source must survive) and the manifest (routes → `/fp`, brand → new name).

### 3. Brand copy is a SEPARATE sweep the route test can't cover

The straggler test scans route literals and import specifiers — it is blind to bare-word brand copy. A grep for the exact brand (`"The Path"`) **misses lowercase/possessive variants**: `"a Path account"`, `"Your Path"`, `"Path family"`, `"{name}'s Path is still being set up"`. A reviewer found four such misses sitting right next to already-renamed strings. Grep `\bPath\b` across rendered surfaces (`components/**`, `lib/actions/**`, `lib/notify/**`) and hand-classify: rename user-facing copy; keep code comments (historical) and domain terms (`kind='path'` cohorts, `PATH_ROLES`).

### 4. `rm -rf .next` after a route rename (stale dev-types phantom error)

`next build` fails type-check with a phantom error referencing the OLD route (`Type '"/path"' is not assignable to type 'LayoutRoutes'`) when a previously-running `next dev` left a stale `.next/dev/types/` snapshot from before the rename. The build compiles fine; only the generated route-type validator is stale. `rm -rf .next && npm run build` clears it. (Also: a running dev server holds file handles under the moved dir, so `git mv` fails with `Permission denied` on Windows — stop `next dev` first.)

### 5. Redirects run BEFORE the proxy — drop the old prefix from the matcher

Next.js `redirects()` in `next.config.ts` resolve *before* `proxy.ts`/middleware (confirmed in `node_modules/next/dist/docs`). So a `permanent` 308 `/path/:path* → /fp/:path*` owns the entire old tree, and the proxy `matcher` should be **narrowed to `/fp` only** (drop `/path/:path*`). This is order-robust: even if middleware ran first, a matcher that no longer covers `/path` lets the request fall through to the redirect rather than gate-redirecting a session-less `/path/sign-in` to the wrong door. `:path*` (zero-or-more) also carries the bare `/path` case and the query string automatically.

## Why This Matters

A rename's failure modes are all *silent*: a green test that proves nothing, a moved test directory that stops running, an orphaned cache, a half-renamed brand, a session-less door redirected to the wrong place. The count-bounded allowlist is the sharpest lesson — an allowlist-based scanning test that strips by string is only as strong as its *cardinality* assumption, and "the redirect source is the only `/path`" is a cardinality claim the strip silently drops. This is the same abstract trap as a migration-parity allowlist hijacked by an unrelated column (see below): **a scanning test's allowlist must be scoped tightly enough that a new, unintended match can't reuse an existing exemption.**

## When to Apply

- Any whole-tree route/segment rename in a large codebase where a mechanical sweep needs a proof-of-completeness test.
- Whenever a scanning/parity test uses a named allowlist — bound each entry (by count, line, or scope), and add a freshness assertion so a dead entry reddens.
- Next.js route moves gated by middleware and scoped by a PWA manifest/service worker.

## Examples

- **Keep-stable, documented inline:** `QUEUE_DB_NAME = "path-offline-queue"` stays; the comment says *why* ("internal DB key, not a route; renaming orphans installed devices' queues"). The plan required this rationale inline at each decision site.
- **Operational tail:** a device that installed the PWA under the old `/path` scope (e.g. a Founders-Weekend guide iPad) will, post-rename, tap its home-screen icon → 308 outside the old scope → drop from standalone to a browser tab. No data loss (queues key on the unrenamed store), but plan a re-install briefing.

## See also

- `docs/solutions/test-failures/migration-scanning-parity-test-must-scope-to-its-table-unrelated-column-hijacks-the-allowlist-2026-07-23.md` — the same "allowlist too broad → hijacked" failure mode in the migration-parity domain (sibling learning).
- `docs/solutions/test-failures/vitest-include-allowlist-new-test-dirs-silently-never-run-2026-07-18.md` — the moved-suite trap; update the include glob + its guard in the same commit as a directory move.
- `docs/solutions/test-failures/middleware-proxy-is-testable-next-experimental-testing-server-2026-07-21.md` — assert the real router (`unstable_doesMiddlewareMatch`) so the matcher change is tested.
- `docs/solutions/best-practices/service-worker-never-cache-navigations-invariant-narrow-app-shell-exception-exclude-live-and-authed-admin-bound-and-identity-clear-2026-07-24.md` — the SW route-prefix constants that move to `/fp` vs the cache names that stay.
