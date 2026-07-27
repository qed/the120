---
title: Memoizing an auth gate that redirects — React cache() around a throwing gate
date: 2026-07-27
category: docs/solutions/best-practices
module: crm auth / staff front door
problem_type: best_practice
component: authentication
applies_when:
  - A gate is called by both a layout and the pages inside it
  - Chrome that depends on identity is mounted across several nested layouts
  - You are about to wrap a `redirect()`-throwing function in `cache()`
tags:
  - react-cache
  - request-memoization
  - auth-gate
  - next-app-router
  - redirect
  - supabase
---

# Memoizing an auth gate that redirects

## Context

`requireStaff()` is the authoritative CRM/staff gate: a Supabase `getUser()`
round trip plus an indexed `staff` row lookup, then a verdict that either
returns a session or `redirect()`s. Roughly forty call sites.

Layouts and the pages inside them **both** gate, deliberately — Next 16 layouts
do not re-render on soft navigation, so a page leaning on its layout alone
would be gated only on the render that happened to mount it. That correctness
decision costs two round trips per full render, and Staff Front Door Units 3
and 4 were about to mount staff-dependent chrome across three more layouts, on
venue wifi.

The obvious fix is React's `cache()`. The non-obvious part is that this gate
**throws**.

## Guidance

Wrapping the throwing gate directly is safe here, and it is what shipped:

```ts
// app/crm/lib/auth.ts
export const requireStaff = cache(async function requireStaff(): Promise<StaffSession> {
  // ... getUser(), staff row, resolveStaffAccess()
  if (verdict === "login") redirect("/crm/login");
  if (verdict === "forbidden") redirect("/crm/staff-only");
  return { staffId: user!.id, email: staffRow!.email };
});
```

Three conditions make it safe. Check all three before copying it:

**1. Zero arguments.** The memo key is the empty argument list, so there is one
verdict per request and nothing to get wrong. React's `cache()` keys on
argument *reference* equality — the reason `loadFamilyContextCached` takes
primitives (`userId`, `familyId`) rather than the per-call `db` client, which
would never hit. Adding a parameter to a zero-arg cached function silently
changes its cache key; that invariant is load-bearing and unenforced.

**2. The throw is a `redirect()`, and replaying it is correct.** The digest is
re-thrown to every later caller in the same request — which is the same answer
they would have paid a round trip to be told. A gate's verdict cannot
legitimately change mid-request.

**3. Nothing writes the gated table in request scope.** `requireStaff()` reads
`staff`; the only writer in the repo is `scripts/seed-staff.ts`, which runs
outside a request. If an admin surface ever gains "deactivate this staff
member", this argument needs revisiting — the memoized verdict would go stale
for the rest of that request.

**Also: read the query's error.** Unrelated to caching but found in the same
review — the `staff` lookup discarded `.error`, so a transient database fault
and a revoked account both rendered as a 404 with nothing to tell them apart
afterwards. Log it and stay fail-closed.

## Why This Matters

This repo now has **two shapes** for the same problem, and the difference is
deliberate rather than drift:

| Shape | Where | Form |
|---|---|---|
| Split | `fw-auth.ts`, `family-loader.ts` | `cache()` a **non-throwing** loader (`loadFwSession`, `loadFamilyContextCached`); leave the throwing wrapper (`requireFwSession`) uncached |
| In place | `crm/lib/auth.ts` | `cache()` the throwing gate itself |

The split is the more conservative shape and the right default for new code —
the memoized thing is a plain loader with no control flow in it.

In-place was chosen for `requireStaff()` because it gives all ~40 existing call
sites the benefit without touching any of them, where the split would need a
new exported loader plus a rewrite of every caller for identical savings. It
matches the DAL example in Next's own authentication guide
(`node_modules/next/dist/docs/01-app/02-guides/authentication.md`), which wraps
`redirect()` inside `cache()` exactly this way.

The trap is the docblock, not the code. The first version claimed to be
"following the precedent" set by `fw-auth.ts` — it **inverts** it. Two
reviewers caught the false claim independently. A comment that miscites its own
precedent is worse than no comment: the next author copies the citation.

## When to Apply

- **Reach for the split shape by default.** Memoize a loader, redirect outside
  it.
- **Reach for in-place** when an existing throwing gate already has many
  callers and the split would be a mechanical rewrite of all of them for the
  same result. Say so in the docblock, and say which shape you are *not*
  following.
- **Do not reach for either** if the gated table is written during a request,
  or if the function takes arguments that are not primitives.

## Examples

The measurable claim, and its limit:

```
Before   layout gate: getUser() + staff row
         page gate:   getUser() + staff row      → 4 network hops
After    one memoized verdict                    → 2 network hops
```

None of this is covered by a test, and cannot be under this repo's config
(`environment: "node"`, no jsdom, no request-scoped React render harness — the
same class of limitation already recorded for `proxy.ts`). It rests on reading
React's `cache()` implementation, on Next's own documented pattern, and on the
two working precedents two files away. Reviewers verified all three; a future
change to `requireStaff()`'s signature would break it with nothing going red.

## Related

- `docs/solutions/security-issues/an-inert-defensive-branch-has-no-behavioural-signature-assert-the-wiring-2026-07-27.md`
  — same unit, same underlying theme: a correctness property that no test in
  this repo can observe needs something other than a test to hold it up.
- `docs/solutions/ui-bugs/server-action-rejection-no-try-finally-freezes-capture-modal-2026-07-20.md`
  — the client-side consequence of this same gate throwing `NEXT_REDIRECT`.
- Plan: `docs/plans/2026-07-27-001-feat-staff-front-door-plan.md` (Unit 2,
  trap 12). Unit 5 carries **B5**: neither `requireStaff()` call is wrapped in
  a timeout, the same gap B4 records for `loadFwSession`.
