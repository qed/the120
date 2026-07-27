---
title: "A phased plan's unit boundary is a SCHEDULE, not a proof that a swap is atomic: when unit N is told to remove something unit N+1 replaces, executing it literally leaves `main` with neither — verify the replacement is reachable, and encode the invariant as a count that reddens at zero AND at two"
date: 2026-07-27
category: workflow-issues
module: "Staff Front Door plan Units 3–4 — the FW cache-owner reconcile (app/fp/fw/components/FwPwa.tsx, app/lib/staff-bar/StaffBar.tsx)"
problem_type: workflow_issue
component: development_workflow
severity: high
applies_when:
  - "A multi-unit plan schedules a REMOVAL in one unit because a later unit supplies the replacement"
  - "Two components would both own one piece of global state (a localStorage key, a singleton, a registration) during a transition"
  - "A plan's Files list and its prose disagree about WHEN something moves"
  - "You are about to execute a plan instruction that would leave the default branch in a state no unit intended"
  - "A hazard is currently prevented only by a component not being mounted yet"
related_components:
  - app/fp/fw/components/FwPwa.tsx
  - app/lib/staff-bar/StaffBar.tsx
  - app/lib/staff-bar/__tests__/bar-wiring.test.ts
tags:
  - phased-plans
  - refactoring
  - transition-safety
  - invariant-tests
  - compound-engineering
---

# A plan's unit boundary is a schedule, not a proof of atomicity

## Context

A 12-unit plan assigned Unit 3 to build a new nav bar and Unit 4 to mount it. Unit 3's
**Files** list said, of an effect the new bar would take over:

> Modify: `app/fp/fw/components/FwPwa.tsx` (**remove** the `reconcileFwCacheOwner`
> effect — it moves here)

That effect purges a departing guide's cached roster and authenticated app shell when a
shared device changes hands. It is a security control.

Executed literally, Unit 3 would have deleted it — and Unit 3 does **not** mount the
replacement. Between the two pull requests, `main` would carry **no cache-owner
reconcile at all**, on the one route subtree where shared iPads change hands, during
the weeks before a live children's event.

Neither unit intended that state. The plan's own Key Technical Decisions section
actually said the right thing — "removed **when the bar takes it over**" — but the
Files list is what an implementer follows, and the two disagreed.

## Guidance

**Before executing a scheduled removal, check that the replacement is reachable from
production code at the moment you remove it.** Not written. Not merged. *Reachable* —
imported and mounted on the surface that needs it.

If it is not, defer the removal to the unit that mounts the replacement, and record the
reasoning at both sites:

```tsx
// ⚠️ THIS EFFECT MOVES TO `StaffBar` IN UNIT 4, NOT HERE. The plan lists the
// removal under Unit 3, but the removal is only safe at the moment the bar takes
// it over — and Unit 4 is what mounts the bar in `app/fp/fw/(app)/layout.tsx`.
// Deleting it a PR early would leave `main` with no reconcile at all on the one
// subtree where shared iPads change hands. Running BOTH would race two reconciles
// on one localStorage key, which is why Unit 4 deletes this and not something else.
```

**Then stop relying on the comment.** A comment is read by whoever happens to open the
file; the next implementer is working from the plan, in a different file. Encode the
invariant as a test:

```ts
/** A call, not a mention — both files discuss the reconcile in comments. */
const callsReconcile = (source: string) => /reconcileFwCacheOwner\(\s*\{/.test(source);
const mountsStaffBar = /<StaffBar[\s/>]/.test(FW_APP_LAYOUT);

it("has exactly one reconcile owner mounted in the FW subtree, right now", () => {
  const owners = [mountsStaffBar, callsReconcile(FW_PWA)].filter(Boolean).length;
  expect(owners).toBe(1);
});
```

## Why this matters

**Count, do not assert a direction.** The obvious test — "if the bar is mounted, the old
effect must be gone" — is vacuously true today, because the bar is not mounted. It
would protect nothing until the exact moment it was needed, and a vacuous assertion is
indistinguishable from a passing one.

Counting **owners** reddens in both directions, and both directions are real failures:

| Owners | Meaning | How it happens |
|---|---|---|
| **0** | No reconcile anywhere | Someone executes the plan's literal instruction early |
| **1** | Correct | Today (FwPwa), and after Unit 4 (StaffBar) |
| **2** | Two reconciles racing one localStorage key | Unit 4 mounts the bar and forgets the deletion |

Both failure modes are silent at runtime. Neither produces an error, a failing request,
or a visible symptom — one loses a security control, the other corrupts a key through a
race. This is precisely the class where a test is the only thing that will ever notice.

The deviation itself must also be surfaced in the PR and in the plan's checkbox, not
just in code. A reviewer comparing the diff to the plan will otherwise read a *missing*
change as an oversight and "fix" it.

## When to apply

See `applies_when`. The sharpest trigger: **a plan tells you to delete something, and
you cannot point at the line of production code that replaces it.** That is not a
scheduling detail — it is a gap in `main`, and `main` is what ships if the next unit
slips.

Note the corollary for the *plan author*: when a removal and its replacement land in
different units, say so in the Files list of BOTH, or put the removal in the unit that
mounts the replacement. The prose being right does not help if the checklist is wrong.

## Related

- `docs/solutions/security-issues/an-inert-defensive-branch-has-no-behavioural-signature-assert-the-wiring-2026-07-27.md` — why the invariant is asserted as a count rather than left to behaviour; same instinct, different subject.
- `docs/solutions/best-practices/route-rename-boundary-sweep-and-count-bounded-straggler-catcher-2026-07-24.md` — the other place this repo proves a multi-file change complete with a scanning test, and its Aftermath section on cross-unit fragility.
- `docs/solutions/best-practices/service-worker-never-cache-navigations-invariant-scoped-app-shell-exception-2026-07-24.md` — documents what `reconcileFwCacheOwner` is protecting.
