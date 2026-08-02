---
title: A gate relaxation resurrects dead trigger branches — audit every guard keyed on the newly-possible state combination
module: funnel-deposit-gate
date: "2026-08-02"
problem_type: logic_error
component: database
severity: high
symptoms:
  - "Pay-then-submit family never gets a child_reviews row: the seeding trigger's live-paid early-return silently skips the first-submission seed"
  - "Early payer who hasn't picked a group is permanently locked out of the group step ('The group is locked once a seat deposit is paid')"
  - "No error anywhere — both cascades are silent skips/locks that only surface as missing CRM data and stuck parents weeks later"
root_cause: logic_error
resolution_type: migration
related_components:
  - payments
  - testing_framework
tags:
  - trigger-guards
  - dead-branch
  - gate-relaxation
  - state-combination
  - deposits
  - child-reviews
  - group-lock
---

# A gate relaxation resurrects dead trigger branches — audit every guard keyed on the newly-possible state combination

## Problem

Direct reserve (nav-deposit-shortcut U2) removed the offered-or-later approval gate
from the checkout route, making **paid-while-draft** a normal state combination.
Two DB triggers carried guards predicated on that combination being impossible —
and both went from dead code to live, wrong behavior the moment the gate relaxed.

## Symptoms

1. `children_seed_group_assignment` early-returns when a live paid deposit exists.
   Written when payment implied `offered`+ (long past the draft→submitted seed), the
   branch could never fire at seed time. Post-relaxation, every pay-then-submit
   family hits it: the `child_reviews` row is never created, the family vanishes
   from SeatsByGroup's committed/assigned counts, and the group-change reseed path
   can never repair it because…
2. `children_group_lock_guard` raises on ANY `group_slug` write while paid —
   including the FIRST pick (`'' → value`). An early payer who reserved before
   reaching the group step was locked out of their own application with only
   "contact admissions" as an exit.

## What Didn't Work

The unit's own test plan stopped at the JS seam (gate → webhook → gate over pure
functions) — the SQL trigger layer was invisible to it, and the plan's "System-Wide
Impact" listed callbacks and webhooks but not trigger guards keyed on deposit state.
The finding came from an adversarial reviewer explicitly asked "what does the
removal newly enable downstream?"

## Solution

Migration `20260902120000_direct_reserve_trigger_fixes.sql` (applied to prod same
day, verified via `pg_proc.prosrc` position checks):

- **Lock guard**: block only CHANGES of an already-set group
  (`NEW.group_slug is distinct from OLD.group_slug AND coalesce(OLD.group_slug,'') <> ''`).
  The first pick lands even while paid; a paid child's assignment still can't move.
- **Seeding**: while paid, skip ONLY group-change events — the first submission
  (`draft → submitted`) and the first pick (`OLD.group_slug = ''`) still seed.

Pinned by a migration-text scan in `app/api/__tests__/checkout.test.ts`.

## Why This Works

Both guards exist to protect one invariant — *a paid child's group assignment must
not move* — but were written broader than the invariant ("while paid, do nothing")
because at authoring time the broader form was equivalent: no paid child could be
pre-submission. The relaxation broke the equivalence, not the invariant. Narrowing
each guard to the invariant itself (block *moves*, allow *first writes*) restores
correct behavior in the new world without weakening the old one.

## Prevention

- **When a change makes a previously-impossible state combination possible, grep
  every trigger/guard whose condition references the states involved.** Here:
  `grep -l "status = 'paid'" supabase/migrations/` and read each hit asking "was
  this branch reachable before? is its behavior right when it becomes reachable?"
- Guards should encode the invariant, not the era's shorthand for it: "skip while
  paid" was shorthand for "don't move a paid assignment" — write the narrow form
  even when the broad form is currently equivalent.
- In review prompts for gate relaxations, explicitly ask what the removal *newly
  enables downstream* (webhooks, provisioning, DB triggers, cron sweeps) — the
  JS-level seam test cannot see the SQL layer.
- Related: [[relaxing-a-composed-predicate-split-it-and-audit-bare-callers-of-the-inner-half-2026-08-02]]
  (the same feature's other blast-radius lesson — callers of the inner predicate;
  this doc is the DB-side dual: consumers of the newly-possible state).
