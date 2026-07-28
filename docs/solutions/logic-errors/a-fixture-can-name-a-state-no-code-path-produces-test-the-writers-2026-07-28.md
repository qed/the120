---
module: funnel
date: "2026-07-28"
problem_type: logic_error
component: database
severity: critical
symptoms:
  - "The offer email pointed families at a Reserve button whose server gate refused them, permanently"
  - "All 17 unit tests passed: the fixture said applicantState 'offered', a value no code path could produce"
  - "Routing on applicant_state was unreachable for its dashboard/waitlist branches"
root_cause: missing_workflow_step
resolution_type: migration
tags:
  - state-machine
  - writers
  - fixtures
  - unreachable-state
  - trigger
  - sync
  - two-column
---

# A fixture can name a state no code path produces: test the WRITERS of a state column, not just its readers

## Problem

U13's checkout gate reads `applicant_state` and admits `offered`-or-later.
The test proved it: `canReserveSeatForChild({applicantState: "offered"})` →
true. Both reviewers then traced every writer of the column in the repo and
found exactly two: `'added'` (add-a-child) and `'project_created'` (compose).
The staff offer path — `move_candidate`, `sendOfferEmail` — writes
`children.status` only. So `applicant_state: "offered"` was a value that
existed ONLY in the test fixture: a staff offer left every funnel child's
checkout refused server-side while the offer email pointed the family at the
dashboard's Reserve button. The routing built on the same column
(`postSubmitDestination`) had dashboard/waitlist branches no real row could
reach.

## Symptoms

A green suite whose fixtures include ladder states the ladder cannot climb
to. Readers thoroughly tested; the writer side assumed.

## What Didn't Work

Testing the predicate. A gate is one half of a contract; the other half is
that something ADVANCES the state the gate admits. Each half can be
individually correct while the pair is a dead end.

## Solution

The bridge lives at the DB layer so every writer path inherits it —
`children_applicant_state_sync` (migration `20260810120000`, applied to
production): a BEFORE UPDATE OF status trigger that derives
`applicant_state` from `children.status` transitions for funnel children
(NULL = pre-funnel, untouched), forward-only, mapping
submitted/in_review/invited/offered/member onto the applicant ladder. It
composes with the existing guards: parents cannot forge `status='offered'`
(children_status_guard), so they cannot forge the derived state either.

Belt to that brace: the family-facing routing became TWO-column
(`postSubmitDestination` also reads `children.status`), because pre-funnel
children keep a NULL state forever and the sync only covers funnel rows.

And the test that should have caught it now exists: a migration-scan pinning
the sync trigger's existence and mapping — the writers, not just the reader.

## Why This Works

A state column is a contract between its writers and its readers. When the
readers' tests use hand-built fixtures, nothing checks that the fixture's
states are REACHABLE. Pinning the writer (the trigger, the RPC, the action
that advances the state) closes the loop: deleting the bridge reddens the
suite even though every predicate still returns the right answer for the
right input.

## Prevention

- When adding a reader of a state column (gate, router, renderer), grep for
  the WRITERS of every state the reader distinguishes. A state with zero
  writers is either dead vocabulary or a missing bridge — decide which, in
  the same unit.
- Prefer deriving mirrored state at the layer all writers share (a DB
  trigger) over syncing in one caller — the next writer path inherits it
  for free.
- Two vocabularies describing one process (children.status vs
  applicant_state) need either a sync mechanism or two-column readers;
  ideally both, since back-compat rows (NULL) outlive the sync's adoption.
- In reviews, "trace every writer of this column" is a one-grep check with
  outsized yield — both U13 reviewers found the critical this way.
