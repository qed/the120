---
title: "A force-dynamic Next.js App Router page can't be served no-store — keep PII off the page (PII-free shell) and stream it through a no-store poll feed"
date: 2026-07-24
problem_type: best_practice
module: path
component: authentication
severity: high
applies_when:
  - "Building an UNAUTHENTICATED tokened page (App Router) that must render PII"
  - "You want Cache-Control: no-store on a force-dynamic page and it isn't sticking"
  - "A projector / kiosk / polling read surface renders minors' or users' data"
related_components:
  - tooling
  - database
tags:
  - nextjs
  - app-router
  - force-dynamic
  - cache-control
  - no-store
  - pii
  - unauthenticated
  - polling
---

# A force-dynamic App Router page can't be served `no-store` — use a PII-free shell + a `no-store` poll feed

## Context

FW Unit 6 ships the projected cohort board (`/path/fw/board/[token]`): an
UNAUTHENTICATED, token-gated read surface a venue projector shows, rendering
minors' first-name + last-initial. The hard requirement (plan's critical hold)
was `Cache-Control: private, no-store` **and** `noindex` on the page and its poll
feed, so no shared cache ever retains a frame of a minor's name.

The page is `export const dynamic = "force-dynamic"` (the token lookup needs the
service-role client at request time, and the env-less build must never prerender
it — see `build-issues/env-less-build-hangs-render-time-supabase-clients-…`).

The trap: **you cannot pin a force-dynamic App Router page's `Cache-Control` to
`no-store`.** Next fixes it to `no-cache, must-revalidate`, and neither
`next.config.ts` `headers()` nor the proxy/middleware (`NextResponse.next()`)
overrides it. This was verified empirically, not assumed (curl below).

## Guidance

**Do not try to force `no-store` onto the page.** Instead, keep PII off the page
entirely and stream every sensitive field through a `no-store` **route-handler
feed** that the client polls:

1. **The page renders a PII-FREE shell only** — a title and static structure
   (here: the cohort slug + the grid's column skeleton, which is program metadata,
   not a child). No names, no per-user data. Its unavoidable `no-cache,
   must-revalidate` then protects nothing sensitive.
2. **All PII flows through a `route.ts` feed** (`.../feed/route.ts`), which is a
   Route Handler — those CAN set arbitrary response headers, so it carries
   explicit `private, no-store, must-revalidate` on its `Response`.
3. **The client component polls the feed** on mount and hydrates the board. First
   paint is the shell (< 1s to fill), and the sensitive payload never lands in a
   cacheable response.
4. **Set `X-Robots-Tag: noindex, nofollow` for the whole subtree** in
   `next.config.ts` `headers()` (this DOES apply to the page — Next only overrides
   `Cache-Control`, not other custom headers), plus `robots` metadata on the page.

`headers()` in `next.config.ts` and middleware both apply *additive* headers to a
page (the `X-Robots-Tag` proves it), but a page's `Cache-Control` is owned by
Next's rendering and wins over both. Route Handlers own their own `Response`, so
that's where hard `no-store` belongs.

## Why This Matters

Getting this wrong ships a minor's name in a `no-cache` HTML frame on an
unauthenticated URL — arguably serveable from a shared cache after revalidation.
The PII-free-shell split makes the page's cache header *irrelevant to privacy*:
there is nothing sensitive to cache. It's a strictly stronger guarantee than
arguing that `no-cache, must-revalidate` on PII is "good enough," and it survives
future Next changes to force-dynamic cache behavior.

Bonus: it decouples the instant first paint (static shell, server-rendered) from
the live data (polled feed), which is exactly what a projector wants anyway.

## When to Apply

Any UNAUTHENTICATED (or token-in-URL) App Router page that must render
user/PII data AND must not be cached. Authenticated pages usually get `no-store`
for free — `@supabase/ssr`'s cookie `setAll` stamps no-store cache headers on
responses that set auth cookies (see `proxy.ts`). An unauthenticated board has no
session/cookies, so it never hits that path and falls to Next's dynamic default —
which is the whole reason this pattern is needed.

## Examples

**Verify the ceiling (don't assume it):**

```
# force-dynamic page — Next's default, NOT your no-store:
$ curl -sI https://…/path/fw/board/<token> | grep -i cache-control
Cache-Control: no-cache, must-revalidate      # next.config no-store was IGNORED
$ curl -sI https://…/path/fw/board/<token> | grep -i x-robots-tag
X-Robots-Tag: noindex, nofollow               # next.config header DID apply

# the feed (Route Handler) — hard no-store, and it carries the PII:
$ curl -sI https://…/path/fw/board/<token>/feed | grep -iE 'cache-control|x-robots'
Cache-Control: private, no-store, must-revalidate
X-Robots-Tag: noindex, nofollow
```

**Page (PII-free shell):**

```tsx
// board/[token]/page.tsx
export const dynamic = "force-dynamic";
export const metadata = { title: "…", robots: { index: false, follow: false } };

export default async function Page({ params }) {
  const { token } = await params;
  const auth = await resolveBoardToken(db, { token });   // per-request hash check
  if (!auth.ok) notFound();
  const shell = await loadBoardShell(db, { cohortId: auth.cohortId }); // title + columns, NO names
  return <Board token={token} shell={shell} />;          // client polls /feed for PII
}
```

**Feed (Route Handler owns its headers):**

```ts
// board/[token]/feed/route.ts
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "private, no-store, must-revalidate", "X-Robots-Tag": "noindex, nofollow" };

export async function GET(_req, { params }) {
  const { token } = await params;
  const auth = await resolveBoardToken(db, { token });
  if (!auth.ok) return new Response(null, { status: 404, headers: NO_STORE }); // one 404 for every refusal
  const board = await loadBoard(db, { cohortId: auth.cohortId });              // carries the names
  return new Response(JSON.stringify(board), { status: 200, headers: { ...NO_STORE, "Content-Type": "application/json" } });
}
```

Grep the rendered page HTML in a test/verification pass to *prove* no PII leaked
into it (`curl … | grep -oE 'Maya|Theo|…'` → empty).

---

## Related pattern from the same unit: fold append-only events by a monotonic/semantic key, never a random id

The board's read model folds a cohort's append-only `path_task_events` into a
current state per `(student, task)` by taking the last event. The first cut sorted
by `(at_ms, id)` — but `at` is millisecond-truncated (`Date.parse`) and `id` is a
random `gen_random_uuid()`. A same-millisecond checkmark/undo pair (an offline
drain replays a captured pair back-to-back with no human delay) then resolves by
**coin flip**, and because the comparator is deterministic it can *stably* report
the wrong current state — inflated aggregates, or a silently dropped result.

Fix: tiebreak on a field that correlates with true order. Here that's
`captured_at` (the guide's tap time, which a single actor's drain queue preserves
in order): sort `(at_ms, captured_at_ms, id)`, with the random `id` only as the
last-resort determinism backstop. General rule: **when folding append-only events
whose insert timestamp can tie, break the tie with a monotonic sequence or a
semantic ordering field — a random UUID is not an ordering.** If neither exists,
add a `bigserial`/sequence column rather than trusting id order.

## Related

- `docs/solutions/build-issues/env-less-build-hangs-render-time-supabase-clients-and-undefined-fetch-url-2026-07-17.md` — why the board routes are `force-dynamic` with no render-time client (the constraint that forces this whole pattern).
- `docs/solutions/security-issues/state-changing-email-links-mutate-on-get-scanner-prefetch-false-confirm-2026-07-16.md` — the sibling tokened-URL discipline: GET never mutates, one 404 for every refusal, no existence leak.
