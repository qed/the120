---
title: "Deleting a `\"use server\"` export is the right call for security and a deploy-skew hazard at the same time: a browser still running the old bundle holds the action id, and the half of the sequence that already ran on the CLIENT is not rolled back when the server call fails"
date: 2026-07-27
category: best-practices
module: "First Profit (FW) — retiring signOutFwGuide when the staff bar took over sign-out (app/fp/lib/actions/fw-guide.ts, app/fp/fw/components/FwSignOutButton.tsx)"
problem_type: best_practice
component: server_actions
severity: medium
applies_when:
  - "You are DELETING an exported `\"use server\"` function rather than just removing the component that renders a form for it"
  - "The action is the final step of a sequence whose earlier steps already mutated CLIENT-side state (IndexedDB, localStorage, Cache Storage)"
  - "The surface is long-lived — a kiosk, a shared tablet, a PWA left open across a multi-day event — so 'they will reload eventually' is not a safe assumption"
  - "The project has no `deploymentId` configured and no confirmed platform skew protection (RESOLVED 2026-07-27 — see the discharged-debt note)"
  - "You are weighing 'leave it exported but unrendered' against 'delete it' — read the security half below before choosing the first"
related_components:
  - app/fp/lib/actions/fw-guide.ts
  - app/lib/staff-bar/actions.ts (signOutStaffBar — the replacement)
  - next.config.ts (no deploymentId)
tags:
  - server-actions
  - deploy-skew
  - next-16
  - pwa
  - offline
  - retirement
last_updated: 2026-07-27
---

# Deleting a `"use server"` export is correct AND a deploy-skew hazard — the old bundle still holds the action id

## Context

Staff Front Door Unit 4 retired three disagreeing sign-out controls in favour of one
persistent staff bar. One of them, `signOutFwGuide`, was a `"use server"` export driven
by a bare `<form action={signOutFwGuide}>` in the Founders Weekend ops header. It ran
no drain verdict, no device-evidence gate and no atomic clear — so a guide could
capture check-ins offline in the cohort view and then abandon the queue by signing out
from `/fp/fw/ops` two clicks later.

Two questions came up, and they pull in opposite directions.

**Should it be deleted, or just unrendered?** Deleted. Removing the form does not make
the action unreachable: every export of a `"use server"` file is independently
POST-addressable by its action id, whatever renders it. Next's own guide is explicit —
*"the route is reachable to anyone who can send the same POST… Render-time gating is
not a security boundary"*
(`node_modules/next/dist/docs/01-app/02-guides/server-actions.md:78,89`). An unrendered
sign-out with no drain gate is still a live ungated endpoint, and leaving it is exactly
how the ops header's version survived a whole unit of review unnoticed. This is the
same rule as `guard-function-with-no-callers-is-not-a-mechanism-…` read in reverse: an
unlinked *mutation* is still a mechanism.

**What does deleting it cost?** That is this document. A reliability reviewer traced
it, and it is not the obvious "the button 404s."

## Guidance

**Deleting an action is a two-sided decision. Take the security side — and then name
the skew window rather than discovering it at an event.**

The failure is not that a stale client gets an error. It is *which half of the sequence
already ran when it gets one.*

`FwSignOutButton` in the old bundle does this:

```ts
const outcome = await runFwSignOut({ actorUserId, actorIsFwGuide });  // CLIENT-side
if (outcome.kind === "sign_out") {
  await signOutFwGuide();          // SERVER — this id no longer resolves
  return;
}
```

`runFwSignOut` is the part that clears the device: it drains the queue, then wipes the
IndexedDB queue, the roster cache and the service-worker app-shell cache. It has
already completed and committed before the server call is attempted. So after the
deploy, a guide tapping that stale button gets:

- device residue **gone** — the iPad looks clean and handed-over-ready;
- session **still authenticated**, because `supabase.auth.signOut()` lives inside the
  body of the action that never executed;
- copy reading *"Couldn't sign out just now. Try again."*, which is a generic catch
  with no reload guidance — and retrying repeats the identical failure forever, because
  the bundle in memory is the problem.

That is the worst combination available: the state that says "this device is safe to
hand over" is true, and the state that actually matters is false.

**Three things to do, in order of cost:**

1. **Check for skew protection before deleting.** Next supports `deploymentId` in
   `next.config.ts` so a stale client is forced to hard-reload rather than invoking a
   missing action id. This repo has **none configured** (verified 2026-07-27), so there
   is no framework-level shortening of the window. Platform-level protection may exist
   but was not confirmed from the repo.
2. **Make the client's catch distinguish "your bundle is stale" from "try again."**
   A generic retry message is actively wrong here: retrying cannot work. Reload can.
3. **Order the sequence so the irreversible client half runs LAST where you can.**
   The replacement (`signOutStaffBar`) inherits the same ordering — client clear, then
   server sign-out — and its docblock now states the consequence plainly rather than
   implying the device is unchanged. That ordering is defensible (the clear only runs
   once the queue is verifiably drained, so nothing is *lost*), but it is a choice, and
   it is the choice that decides what a skew failure looks like.

## Why This Matters

The instinct on reading "deleting a Server Action breaks stale clients" is *"that is
generic Next behaviour, every rename does it."* True, and not the point. What makes it
worth a document is the **asymmetry between the two halves of a client-driven
sequence**: the client half is committed local state mutation, the server half is a
network call that can vanish under a deploy. Any sequence shaped
`mutate-locally → call-action` inherits this, and the more careful the local mutation
is (atomic, verified, irreversible by design), the worse the half-completed state is.

The surface matters too. This is a PWA on shared iPads at multi-day events. "They'll
reload" is a reasonable assumption for a desktop CRM and an unreasonable one for a
tablet that stays open on one screen for three days.

## When to Apply

Reach for this whenever a `"use server"` export is being removed or renamed and any of
the `applies_when` conditions hold — especially the first two together. The check is
one question: **if this call fails because the id no longer exists, what has already
happened on the device, and does the user's screen tell them the truth about it?**

Not applicable to adding actions, or to actions that are the first step of their own
sequence (a failed call there leaves nothing half-done).

## Examples

**The retirement, as it landed** (`app/fp/lib/actions/fw-guide.ts`) — the export is
gone and replaced by a comment that carries the reasoning, so the next person does not
re-add it:

```ts
/**
 * ⚠️ GUIDE SIGN-OUT IS NOT HERE ANY MORE, AND MUST NOT COME BACK.
 *
 * DELETED rather than left unexported-but-present: a `"use server"` function is
 * POST-addressable independently of whatever renders a form for it, so an unrendered
 * sign-out action is still a live ungated endpoint.
 */
```

**The assertion that keeps it gone** (`app/lib/staff-bar/__tests__/bar-wiring.test.ts`)
— a repo-wide scan over comment-stripped production source, because "gone" and
"unlinked" are the distinction that matters:

```ts
it("the FW ops header's ungated sign-out action no longer exists anywhere", async () => {
  expect(await scanFor("signOutFwGuide")).toEqual([]);
});
```

**DEBT DISCHARGED (Staff Front Door Unit 5, 2026-07-27).** The paragraph below is the
note as it stood when this doc shipped; both owed items were paid in the reliability
pass it named. `next.config.ts` now sets `deploymentId`, resolved
`NEXT_DEPLOYMENT_ID` → `VERCEL_DEPLOYMENT_ID` → `VERCEL_GIT_COMMIT_SHA` (undefined
locally, deliberately — skew protection would fight `next dev`'s fast-refresh loop),
and the resolution ORDER is pinned by a test that sets all three variables to distinct
values and re-imports the config — after a first draft that mirrored the production
formula was shown to pass for any order when the variables are unset. With it, a stale
tab's next client navigation hard-reloads instead of calling a dead action id.

> *As originally written:* no `deploymentId` was added and no stale-bundle copy was
> written. Both were left as a recorded decision for the reliability pass rather than
> smuggled into a unit about mounting a nav bar. If you are reading this because a
> guide reported "it says it can't sign me out and the button never works," that is
> this, and the fix on the device is a hard reload.

**The residual exposure `deploymentId` does NOT close:** the hard reload triggers on a
client-side NAVIGATION after the mismatch is detected. A long-lived tab that invokes a
Server Action directly without navigating first — the drain loop under the Web Lock is
exactly that shape — can still hit the new server once with the old bundle's
expectations during the rollout window. Widened result unions must therefore stay
old-client-safe for one deploy (see the `unavailable` member's rollout note in
`fw-sync-engine.ts`).

## Related

- `docs/solutions/security-issues/guard-function-with-no-callers-is-not-a-mechanism-client-side-supabase-auth-bypasses-server-guards-2026-07-23.md`
  — the same reachability rule for guards rather than mutations.
- `docs/solutions/best-practices/shared-db-taking-core-must-not-live-in-a-use-server-file-server-action-boundary-2026-07-17.md`
  — unwanted *presence* of an action; this doc is unwanted *absence*.
- `docs/solutions/logic-errors/retire-in-place-soft-delete-keeps-the-relationship-row-so-the-write-path-stays-reachable-guard-the-mutation-choke-point-2026-07-24.md`
  — guard the mutation choke point; deleting the action is that rule applied.
- `docs/solutions/best-practices/a-server-side-timeout-does-not-bound-a-request-that-never-lands-bound-the-clients-own-await-2026-07-27.md`
  — the sibling case where the client's own await is what needs bounding.
