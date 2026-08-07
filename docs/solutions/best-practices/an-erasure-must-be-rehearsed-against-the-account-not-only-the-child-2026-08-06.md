---
module: funnel/erase-family
tags: [erasure, data-rights, foreign-keys, restrict, tripwire, auth-users]
problem_type: latent-defect-found-live
---

# An erasure must be rehearsed against the ACCOUNT, not only the child

## The incident

The first live family erasure (2026-08-06, the handoff-verification test family)
deleted every child cleanly and then stranded on the very last step: the parent
`auth.users` delete returned 23503. The blocker was `path_role_grants.user_id ->
auth.users ON DELETE RESTRICT` — a verifier grant that provisioning mints for
EVERY v3 parent, so the failure was not an edge case but the universal case. It
was finished by hand-issued SQL.

## Why nothing caught it earlier

The erasure coverage tripwire (`erase-family-schema.ts`) was scoped structurally
— but only on reaching a CHILD: tables carrying `child_id` / `profile_id`
suffixed columns. A row keyed on the PARENT'S AUTH ACCOUNT was invisible to the
audit by construction. The eraser's unit tests had the same blind spot: the fake
db enforced exactly the RESTRICT FKs the author knew about.

## The fix, in layers

1. **Sweep**: `PARENT_AUTH_RESTRICT_SWEEP` (rules) + step 8b (core) deletes the
   parent-keyed RESTRICT referrers (`path_role_grants.user_id`,
   `path_notification_sends.recipient_user_id`) immediately before the account
   delete — INSIDE the zero-stranded branch, because the send log is the
   notification pipeline's only idempotency record: delete it while a stranded
   child's task events survive and the cron re-derives the rows and re-emails
   the parent who asked to be erased.
2. **Tripwire legs**: scope now also matches `(^|_)user_id$`, `(^|_)parent_id$`
   and `(^|_)student_id$`. The new legs immediately caught two REAL findings:
   the CRM `families` row survives erasure with an identity snapshot
   (parent name/email/phone + kids' names — flagged as an open retention
   obligation), and the whole Path student graph (task progress/events/reviews/
   evidence/notifications) RESTRICT-blocks step 4 for any ACTIVE child.
   The graph drain landed the next day (step 3b, 2026-08-07): evidence objects
   deleted at the store first under a student-folder namespace guard, then the
   eight tables leaf-first past the one inter-table RESTRICT (evidence →
   task_progress). Its own adversarial review added three load-bearing rules:
   the row loop STOPS on the first failed delete (the send log must never
   outlive its derivation inputs, or the notification cron re-derives and
   re-emails the erasure-requesting parent); the evidence read PAGINATES
   (PostgREST truncates unranged selects at 1000 rows silently, and the DELETE
   is not row-capped — an unpaginated read destroys the only record of every
   key past the first page while the bytes survive); and
   `path_fw_replay_rejects` joined the drain (cohort membership concedes FW
   attendance, and a replay-reject about the child is the child's data).
3. **Fake parity**: the test fake's `deleteAuthUser` and
   `path_student_profiles` delete now enforce the same RESTRICTs production
   has, so the suite can no longer certify an ordering the live schema refuses.

## The lessons

- **A dry-run against an empty family proves the ORDER, not the COVERAGE.** The
  test family was fresh; only a live run against rows that real usage accrues
  (grants, send logs, task events) exposes the referrers you did not model.
- **Enumerate FK referrers from `pg_constraint`, not from memory.** The fix
  started with one query listing every FK into `auth.users` with its delete
  rule; every decision in the sweep is traceable to that list.
- **A structural tripwire is only as good as its link vocabulary.** "Hangs off
  a child" missed rows hanging off the parent; each new leg costs a handful of
  ledger lines and caught real residual-PII the day it was added.
- **A fail-closed strand is an acceptable posture; a wrong comment is not.**
  The "staff-only referrers" claim was false (`path_parent_invites` columns are
  parent-held — zero rows ever, flow retired, but the ledger now says so
  honestly instead of by accident).
