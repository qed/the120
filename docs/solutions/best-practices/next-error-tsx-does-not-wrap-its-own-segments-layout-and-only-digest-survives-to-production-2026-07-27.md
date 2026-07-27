---
title: "next error.tsx does not wrap its own segment's layout — and only `digest` survives to production, so a boundary cannot branch on cause"
date: 2026-07-27
module: app (error boundaries; /staff, /crm, root)
category: best-practices
problem_type: best_practice
tags: [nextjs, error-boundary, error-tsx, global-error, unstable_retry, route-groups, app-router]
applies_when:
  - "Adding error.tsx to a segment whose LAYOUT is the thing that can throw"
  - "Deciding between reset() and unstable_retry() in a boundary"
  - "Writing boundary copy that depends on WHY the error was thrown"
  - "Placing a boundary above a route group like (app)"
---

# next error.tsx does not wrap its own segment's layout — and only `digest` survives, so a boundary cannot branch on cause

Three placement facts and one serialization fact, all verified against
`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`
(Next 16.2.10) during Staff Front Door Unit 5, when `requireStaff()` and
`requireFwSession()` started THROWING a retryable `IdentityUnavailableError` and
suddenly it mattered enormously which boundary would catch it.

## Guidance

**1. `error.tsx` wraps a segment's children and NESTED layouts — never the
`layout.tsx` in its OWN segment.** (`error.md:96`: "It does **not** wrap the
`layout.js` or `template.js` above it in the same segment.") Consequences in this
repo, worth internalizing as the two canonical cases:

- `app/staff/layout.tsx` gates. Its throw bubbles PAST `app/staff/error.tsx` to the
  root `app/error.tsx`. The `/staff` boundary catches only what the PAGE throws
  (which re-gates through the same memoized function, so the gate is covered on both
  renders — by two different boundaries).
- `app/crm/(app)/layout.tsx` gates, and `app/crm/error.tsx` DOES catch it — because
  `(app)` is a route group, which is organizational only and does not create a
  segment boundary of its own; the gating layout is therefore a *nested* layout below
  `app/crm/`'s segment, and nested layouts ARE wrapped.

So whether "the boundary catches the gate" flips on whether the gate's layout sits in
the boundary's own segment or one below it. Do not reason by directory adjacency.

**2. The root `app/error.tsx` cannot catch the ROOT layout; only `global-error.tsx`
can** — and a global-error must carry its own `<html>`/`<body>`, i.e. a second full
document to maintain. Skip it while the root layout fetches nothing and gates
nothing; write that reasoning down where the root boundary lives so the absence reads
as a decision.

**3. `unstable_retry()` re-FETCHES and re-renders; `reset()` only clears the error
state and re-renders the same payload.** (Added v16.2.0.) For any error whose fix is
"ask the server again" — a timed-out auth read, an unreadable row — `reset()` renders
a Try-again button that cannot try anything: it replays the same failure without a
network round trip and lands the user straight back on the boundary. Use
`unstable_retry` and say so in a comment, because `reset` is the name people reach
for. Give the button a short post-tap cooldown: this screen appears precisely when
the backend is degraded, and every affected device rapid-tapping re-fetch is a small
thundering herd aimed at the thing already down.

**4. In production, Server Component `error.message` is REPLACED; only `digest`
reaches the client.** A boundary therefore cannot branch on what threw — any
cause-specific behaviour that works in dev is lying in prod. Choose the copy by WHICH
FILE mounts the boundary (a build-time fact), not by the error. This is what forced
the copy split here: the root boundary fronts anonymous marketing visitors AND the
bubbled staff-layout throw, so it says something true for both readers ("Something
went wrong loading this page") — the identity-specific "you are still signed in" is
reserved for boundaries whose audience is behind a gate by construction. A security
review had flagged the un-split version as a false authentication claim to anonymous
visitors.

## Testing this under `environment: "node"`

The components cannot render, so: put every sentence in a pure exported copy function
with tests, keep boundaries as thin wrappers, and pin the WIRING (which file passes
which variant) with a comment-stripped source scan — a flipped variant survived every
behavioural test in this repo until the scan existed. Log `error.digest` client-side
in the boundary; it is the only join key to the server log line that knows the cause.

## Related

- `docs/solutions/best-practices/memoizing-an-auth-gate-that-redirects-react-cache-throwing-gate-2026-07-27.md`
  — the gates that throw into these boundaries; React `cache()` replays a rejection
  identically to every caller in the request (verified against React 19's source).
- `docs/solutions/best-practices/offline-drain-reuses-a-fail-closed-signal-across-a-safety-boundary-irreversible-action-needs-tri-state-2026-07-24.md`
  item 6 — why the gates throw a retryable UNKNOWN instead of answering wrongly.
