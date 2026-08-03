---
title: "A user-writable route into a shared column flips its provenance for every other consumer: make it fill-only against existing authority"
module: fp-grade
date: 2026-08-03
problem_type: security_issue
component: database
severity: high
symptoms:
  - "A new child-session route (POST /api/fp/grade) could overwrite children.grade - a column Path provisioning, CRM dossiers, AddFounder, and sibling-adoption conflict logic all treat as parent/staff-set truth"
  - "No consumer of the column could tell a parent-set value from a child-typed one; a child's answer could re-route course-track placement and trip parent-onboarding conflicts"
root_cause: missing_permission
resolution_type: code_fix
tags: [provenance, shared-column, fill-only, service-role, idor, roster, grade, authority, children]
---

# A user-writable route into a shared column flips its provenance — make it fill-only

## Problem

Unit 3 of the full-path plan added `POST /api/fp/grade`: a child answers their
birth year once, and the route writes `children.birth_year` + derived `grade`
via service role. The IDOR guard was airtight (row resolved from the session
only) — but the adversarial review asked a different question: WHO is allowed
to mean what by this column? `children.grade` is consumed across The120 as
parent/staff-authoritative (progress-core band derivation, provision-core
course-track gates, CRM dossiers, AddFounder adoption, the sibling-adoption
conflict check). An unconditional write let a child-typed value silently
replace parent-set truth, with no marker distinguishing the authors.

## Symptoms

See frontmatter. The UI flow masked it (the ask only fires when the login
returns a null grade), but the route itself accepted a direct call against a
row whose grade a parent had already set.

## What Didn't Work

- Reasoning only about row-level authorization: "the session's own child row"
  is necessary but not sufficient when the COLUMN carries cross-product
  authority semantics.
- Trusting the UI gate: the client asking only-when-null is a behavior, not a
  contract; the route is the contract.

## Solution

Make the write **fill-only** (commits 37f39c6 → 09edb05, feat/fp-grade): the
route reads the row's current `birth_year`/`grade` first; if EITHER is already
set, it performs NO write and returns `{ok:true, grade: <derived-at-read>}` —
the same value the login produces. Idempotent, oracle-free (it is the caller's
own row), and the client adopts the authoritative value instead of replacing
it. Only a fully-blank pair is filled. Fault-injected tests prove no UPDATE
runs against pre-set values.

## Why This Works

The lower-privilege writer can add information where none exists but can never
displace a higher-authority author — provenance is preserved without needing
an authorship column or audit trail. Returning the authoritative value (rather
than refusing) keeps the client convergent: whatever the roster knows becomes
what the child's session displays.

## Prevention

- When ANY route lets a lower-authority principal write a column, grep every
  consumer of that column and ask whose value they believe they are reading.
  If the answer is "someone more authoritative", the write must be fill-only,
  go to a separate column, or carry an authorship marker.
- The check belongs in the route, not the UI: "the client only asks when
  blank" is not enforcement.
- Test it with fault injection: prove the no-write path by making the write
  fail loudly if attempted.
- Related: [[audit-a-new-shared-db-principal-before-introducing-it-inherited-role-policies-2026-08-01]]
  (who can touch what), [[stale-status-echo-full-row-upsert-vs-trigger-guard-coerce-not-raise-2026-07-14]]
  (roster authority on echo), and first-profit's
  `docs/solutions/integration-issues/a-cross-unit-contract-survives-only-as-a-failing-test-in-the-consumer-third-outcome-outbox-2026-08-03.md`
  (this unit's consumer-side contract discipline).
