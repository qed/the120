---
title: "router.push() immediately followed by router.refresh() races the Next 16 client cache — revalidatePath + redirect from the Server Action instead"
date: 2026-07-28
category: ui-bugs
module: first-profit
problem_type: logic_error
component: fw-actions
symptoms:
  - "Submit appears to do nothing: form stays open, roster unchanged; the destination only materialises on a manual reload (checks 2.5.8, 3.10.2, 2.4.2)"
  - "Freshly created record initially absent from search on the destination page"
root_cause: logic_error
resolution_type: code_fix
severity: high
last_updated: 2026-07-28
related_components:
  - fw-student
  - fw-guide
tags:
  - next16
  - router-cache
  - server-actions
  - revalidatePath
  - redirect
  - next-redirect
---

# router.push() + router.refresh() races the Next 16 client cache — navigate from the Server Action instead

## Problem

Three client forms (`FwQuickCreate`, `FwSignInForm`, `ClaimGuideInviteForm`) followed a successful Server Action with:

```tsx
router.push(target);
router.refresh();
```

In Next 16, `refresh()` clears the client Router Cache for the current route while the in-flight `push()` is still resolving against it — the navigation gets superseded or re-resolved, and the user stays put. Separately, the mutating action (`quickCreateFwStudent`) called no `revalidatePath`, so the new record was stale-missing from the roster even after a navigation.

## Solution

Move both concerns into the action (per `node_modules/next/dist/docs` for THIS Next version — `use-router.md` explicitly says `router.refresh()` does not invalidate the server cache):

1. Capture the core result; early-return every `!ok` variant unchanged (typed results the form renders). Partial-success paths (e.g. "password set but sign-in hiccuped") must STAY typed returns, not redirects.
2. On full success: `revalidatePath(...)` for every listing that shows the mutated data, then `redirect(target)` — **outside any try/catch** (it throws `NEXT_REDIRECT`).
3. Client side: the awaited action now *rejects* on success. Reuse `app/fp/lib/next-redirect.ts` `isNextRedirect(e)` in the catch to let the redirect pass through, keep pending-state reset in `finally` (sibling doc: `server-action-rejection-no-try-finally-freezes-capture-modal-2026-07-20.md`).

The server-action redirect response carries the destination's Flight payload rendered after the mutation (and after any session-cookie change), so one round trip replaces the racing pair.

## Prevention

- Never pair `router.push()` with `router.refresh()`. Bare `router.refresh()` (no push) after a mutate-in-place action remains a legitimate pattern.
- Every mutating FW action calls `revalidatePath` for the listings it dirties — `fw-ops.ts` (~12 sites) and `fw-import.ts` are the reference pattern; `fw-student.ts` was the omission.
- Return-contract caution: the action's success arm becomes unreachable (redirect throws). Keep the exported result types unchanged (deploy-skew: stale kiosk bundles still `if (res.ok)`) and comment the unreachable arm on the type itself.

## Related

- Branch `fix/fp-bug-work-order`, plan `docs/plans/2026-07-28-001-fix-fp-blockers-shouldfix-plan.md` (Unit 1).
- `docs/solutions/best-practices/memoizing-an-auth-gate-that-redirects-react-cache-throwing-gate-2026-07-27.md` — the read-side twin (layouts don't re-render on soft navigation).
