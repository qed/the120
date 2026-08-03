---
title: Relaxing a composed predicate — split it, and audit bare callers of the inner half
module: funnel-deposit-gate
date: "2026-08-02"
problem_type: best_practice
component: payments
severity: high
applies_when:
  - "A feature relaxes or removes a gate implemented as predicate A composed of B && C"
  - "The inner predicate (B) is exported and may have its own callers"
  - "Different consumers of 'the same' check actually mean different things by it (parent-facing vs staff-facing)"
related_components:
  - authentication
  - testing_framework
tags:
  - predicate-composition
  - authorization
  - gate-relaxation
  - blast-radius
  - regression-pin
  - deposit-gate
---

# Relaxing a composed predicate — split it, and audit bare callers of the inner half

## Context

The nav-deposit-shortcut feature (2026-08-02) removes the offered-or-later approval
gate so parents can pay the $250 seat deposit before any staff decision. The plan's
first draft said: "relax `canReserveSeatForChild`" — the predicate the checkout route
consults. Three independent plan reviewers (feasibility, security, adversarial)
converged on the same discovery before implementation: the gate being removed did not
live in that function. It lived in the INNER half of a composition:

```ts
// the composition (before)
canReserveSeatForChild = canReserveSeat(status, deposits)        // ← the ladder gate
                         && applicantStateAllowsReserve(state);
```

`canReserveSeat` (the offered-or-later status ladder) was separately exported and had
three bare callers the plan never listed: the dashboard's legacy card, and two STAFF
CRM gates (`offerButtonState` in `app/crm/lib/offer-rules.ts`, the offer-email send
gate in `app/crm/lib/actions/reviews.ts`). Those staff gates mean something different
by the same check: "staff approved this child, so the offer email may be sent."

## Guidance

When a feature relaxes a gate implemented as a composed predicate:

1. **Find where the refusal actually lives.** Read the composition — the check you
   were told to relax is often the outer function; the behavior is in an inner half.
2. **Grep every caller of the inner half** before touching it. Consumers of "the same"
   predicate frequently mean different things by it (parent-facing eligibility vs
   staff-facing approval). List them in the plan by name.
3. **Split, don't loosen.** Rewrite the outer predicate to stop composing the inner
   one, and leave the inner byte-identical for its own callers:

```ts
// after: the parent gate no longer composes the staff ladder
export function canReserveSeatForChild(opts) {
  return (
    !hasPaidDeposit(opts.deposits) &&
    opts.status !== "waitlisted" &&          // the one status refusal that survives
    applicantStateAllowsReserve(opts.applicantState)
  );
}
// canReserveSeat (offered-or-later) is UNTOUCHED — staff offer-email gates keep it.
```

4. **Pin the inner half's unchanged semantics with a regression test** in the
   *consumer's* suite, so a future "cleanup" can't silently re-merge them:

```ts
// app/crm/__tests__/funnel-offer-rules.test.ts
it("the STAFF offer-email gate keeps offered-or-later — a draft child is never sendable", () => {
  for (const reviewStatus of ["draft", "submitted", "in_review"]) {
    expect(offerButtonState({ reviewStatus, deposits: [], ... })).toBe("not_offered");
  }
});
```

5. **Sweep the neighboring docblocks.** Every comment that described the old
   composition ("consumed by BOTH the dashboard CTA and the checkout route", "the
   authoritative gate") is now false; the unit's code review found four of them.

## Why This Matters

The failure mode is silent privilege widening in a surface nobody was looking at. Had
the relaxation been implemented by loosening `canReserveSeat` itself (the "smallest
diff"), unreviewed draft children would have become "sendable" in the staff CRM —
offer emails available for children no one approved — while every test on the feature
being built stayed green. The leak is invisible from the feature's own vantage point;
only a caller audit of the inner half exposes it.

The inverse failure also existed: rewriting only the outer predicate but forgetting
the inner half's third caller (the dashboard legacy card, still calling bare
`canReserveSeat`) would have left the feature broken for exactly the pre-funnel
children it targets — the CTA hidden by the retired ladder.

## When to Apply

- Any change described as "relax/remove/bypass the X gate" where X is a predicate —
  first establish whether X is a composition and where each clause's callers live.
- Exported helper predicates in shared modules (`data.ts`-style rule files): treat
  every export as having unknown callers until grepped.
- Reviews of such changes: ask "who else calls the inner half, and do they mean the
  same thing by it?" — three reviewers independently caught this one; the question
  generalizes.

## Examples

Real diff: `app/dashboard/data.ts` (`canReserveSeatForChild` stops composing
`canReserveSeat`; both docblocks rewritten), `app/dashboard/DashboardApp.tsx` (legacy
card switches to the new predicate), `app/crm/__tests__/funnel-offer-rules.test.ts`
(the staff-gate pin). Plan: `docs/plans/2026-08-02-001-feat-nav-deposit-shortcut-plan.md`.

Related, distinct learnings: [[key-a-state-machine-exception-by-previous-state-not-by-the-target-pairs-you-enumerated-2026-07-29]]
(how to key the surviving exception), `docs/solutions/security-issues/guard-function-with-no-callers-is-not-a-mechanism-...-2026-07-23.md`
(a guard is only as real as its callers — this doc is the dual: a guard's callers are
only as safe as your audit of them).
