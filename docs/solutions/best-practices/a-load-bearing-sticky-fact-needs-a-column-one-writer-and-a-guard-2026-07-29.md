---
title: A load-bearing sticky fact needs a column, one exempt writer, and a DB guard
date: 2026-07-29
category: best-practices
module: funnel-arrival
problem_type: best_practice
component: database
severity: medium
applies_when:
  - A product behavior must key on "has X ever happened" (monotonic, never un-happens)
  - The tempting source for that fact is an existing telemetry/event row or a mutable state column
tags: [sticky-fact, monotonic, arrived-at, telemetry, trigger-guard, register-flip]
---

# A load-bearing sticky fact needs a column, one exempt writer, and a DB guard

## Context

The R12 dashboard register flip keys on "has any child ever completed arrival." Two tempting sources existed and both were wrong: the `student_account_created` telemetry event (best-effort — failures are swallowed, the table is admin-only with no parent-scoped read path) and the provisioning claim's current state (mutable — refund release and the suspend sweep move it, which would un-flip the family's dashboard weeks later).

## Guidance

A monotonic product fact gets three things, together:

1. **A durable column on a family-readable table** (`children.arrived_at timestamptz`), backfilled from the most reliable set-once relic (here `mailbox_ready_at`, which survives refund/suspend) with the event log only as belt-and-braces — never alone.
2. **Exactly one writer, idempotent by construction**: the same code path that establishes the fact stamps it with an `IS NULL` write guard (first stamp wins; re-drives are no-ops). Not routed through any swallow-everything telemetry channel; a failed stamp logs loudly and the system self-heals on retry.
3. **A DB guard matching the repo's sensitive-column precedent**: a `BEFORE UPDATE OF <col>` trigger, service-role-exempt via the *equality early-return* (`if auth.role() = 'service_role' then return NEW` — a NULL role then fails closed, unlike a `<>` comparison that a NULL slips past), raising a stable errcode. App-layer discipline (the store's row-mapper omitting the column) is a courtesy, not the mechanism — a column-unrestricted RLS UPDATE policy makes every unguarded column parent-writable via PostgREST.

## Why This Matters

Without (1), the fact is unreadable or falsifiable-by-omission. Without (2), the sticky guarantee is one refactor away from breaking. Without (3), the fact is self-service-editable the moment anything real (billing, seat gates, staff views) starts trusting it — and the review that catches it may come after that trust was added.

## When to Apply

- Any "ever happened" flag: first arrival, first payment, terms accepted, onboarding completed.
- Retrofit check: if a rendered behavior keys on an event-log query or a mutable state column and must never regress, it needs this treatment.

## Examples

Migration `20260825120000_funnel_arrived_at.sql`: ADD COLUMN (clause-gated alone) → backfill (before the guard, so from-scratch runs backfill unimpeded) → guard function + trigger (P0122 `funnel_arrived_at_guard`). Consumer: `dashboardRegister(children)` in `app/lib/funnel/session-rules.ts` — pure, keyed only on `arrivedAt != null`.

## Related

- `docs/solutions/logic-errors/telemetry-inherits-the-trust-boundary-emit-behind-every-gate-the-transition-has-2026-07-28.md` — why the event channel can't carry product facts.
- `docs/solutions/database-issues/a-cross-table-trigger-guard-must-lock-the-row-it-reads-for-share-2026-07-29.md` — this unit's sibling guard, and the FOR SHARE/lock-order rules if a guard ever reads across tables.
- `docs/solutions/database-issues/add-column-if-not-exists-skips-the-whole-clause-constraint-included-2026-07-27.md` — the clause-gating rule the migration follows.
