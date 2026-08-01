---
title: "A read-only gate that only SELECTs a nullable 'binding' column is not a binding — it passes repeatedly for different targets; claim the column atomically with a CAS UPDATE"
date: 2026-08-01
category: logic-errors
module: fp-signup
problem_type: logic_error
component: authorization
symptoms:
  - "A gate is supposed to bind one authorization (consent, license, slot) to one target (child, resource), but the same authorization passes the gate for multiple targets"
  - "The gate SELECTs a row and checks a nullable column; while the column is still NULL it returns ok for any target"
root_cause: logic_error
severity: high
tags:
  - authorization
  - consent
  - cas
  - race
  - binding
  - idempotency
  - postgres
related_components:
  - security
  - fp-signup
---

# A read-only gate over a nullable binding column is not a binding — claim it atomically

## Problem

First Profit's parental-consent gate (`consentGate`) is supposed to enforce "one
parental consent authorizes exactly one child." It was implemented as a read:
`SELECT ... FROM fp_parental_consent WHERE signup_attempt_id = :attempt AND
revoked_at IS NULL`, then "if the row's `child_id` is NULL (not yet bound) OR equals
this child, return ok." Child-mint code (a later unit) was expected to write
`child_id` back at mint time.

That is not a binding. While `child_id` is still NULL, the gate returns **ok for any
`childId`**. A retry, a race, or a bug that calls the gate twice with two different
children — before either write-back lands — passes both times. One legal consent
record could authorize minting two different child accounts, which is exactly the
compliance failure the "binding" existed to prevent. The check-then-act (read the
NULL, later write the child) has a gap where the invariant does not hold.

## Symptoms

- The gate's own tests documented "child not yet bound" and "bound to the same
  child" as both passing — with no write in between — which is the tell: nothing
  claims the column, so nothing stops a second, different claim.
- The binding is described in comments/docstrings as guaranteed, but grep shows the
  gate only ever runs a SELECT.

## Solution

Make the gate CLAIM the column atomically instead of reading it — a compare-and-set
UPDATE that both checks and binds in one statement:

```sql
UPDATE fp_parental_consent
   SET child_id = :childId
 WHERE signup_attempt_id = :attemptId
   AND revoked_at IS NULL
   AND (child_id IS NULL OR child_id = :childId)   -- unclaimed, or already ours
 RETURNING id;
```

- One row returned → claimed (or re-affirmed our own prior claim — idempotent).
- Zero rows → refuse: either no active consent (`missing`) or it is already bound to
  a **different** child (`child_mismatch`).

Back it with a DB uniqueness invariant so concurrency can't create two claimable
rows in the first place: a partial unique index `(signup_attempt_id) WHERE revoked_at
IS NULL`. Now "one consent → one child" is enforced by the write and the schema, not
assumed by a downstream step.

## Why This Works

The CAS UPDATE collapses check-and-bind into a single atomic statement, so there is
no window where two different children can both pass. `(child_id IS NULL OR child_id
= :childId)` makes the first claim win and a re-claim by the same child idempotent
(retry-safe), while a claim by a different child matches zero rows and is refused.
The gate stops being advisory and becomes the enforcement point.

## Prevention

- **If a gate's job is to BIND one thing to one thing, the gate must WRITE the
  binding, not read a column a later step is trusted to fill.** A read-only gate
  over a nullable target column is satisfiable repeatedly until something claims it —
  and "something will claim it later" is a check-then-act race.
- **Prefer a claiming UPDATE ... WHERE (col IS NULL OR col = :me) RETURNING** over
  "SELECT, decide, then UPDATE." One statement, no window, idempotent for the
  rightful owner.
- **Pair it with a DB uniqueness constraint** (often partial) so the claimable set is
  provably at most one — the app-level CAS and the schema-level unique index reinforce
  each other (see the sibling note on consent/audit tables needing a unique binding).
- This is the same shape as `claim-before-spend` and the provisioning `provision_lease`
  CAS in this repo: reserve/claim atomically, act only on a won claim.
