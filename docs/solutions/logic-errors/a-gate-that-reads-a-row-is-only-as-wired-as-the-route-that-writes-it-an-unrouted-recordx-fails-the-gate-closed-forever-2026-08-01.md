---
title: "A gate that READS a row is only as wired as the route that WRITES it — a recordX() implemented as a pure function but never exposed as an HTTP route means the gate it feeds fails closed forever, and per-call mocks hide it because each half passes its own tests"
date: 2026-08-01
category: logic-errors
module: fp-signup
problem_type: logic_error
component: orchestration
symptoms:
  - "A multi-step flow's gate always refuses in production even though both the gate and the writer it depends on have passing unit tests"
  - "A record/claim/write function exists and is tested, but grep shows no route or caller invokes it"
  - "The end-to-end flow was never exercised as a sequence; each step is mocked to succeed in isolation"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags:
  - orchestration
  - integration
  - gate
  - unwired
  - fail-closed
  - testing
  - consent
related_components:
  - fp-signup
  - testing
---

# A gate that reads a row is only as wired as the route that writes it

## Problem

First Profit's child-mint enforces parental consent with `consentGate` — a CAS
`UPDATE fp_parental_consent … WHERE signup_attempt_id = :attemptId …` that claims an
existing consent row. The function that WRITES that row, `recordConsent`, was fully
implemented in `consent-core.ts` (echo version+hash, freshness check, server-derived
identity) and had passing unit tests.

But `recordConsent` was **never exposed as an HTTP route and never called by
anything except its own tests.** The route inventory was `signup`, `verify`, `child`,
`consent-policy` — no `consent` route. So in the real flow the client verified, then
called the child-mint, and `consentGate` found **zero rows** → `consent_required` →
generic 401. The end-to-end child mint could never succeed. Both halves were "done"
and green; the seam between them did not exist.

This is the inverse of the classic "guard function with no callers" (a guard nobody
calls enforces nothing). Here the *writer* nobody calls means the *gate* that reads
its output can never be satisfied — it fails **closed** forever. Fail-closed is the
safe direction (no child was minted without consent), which is exactly why it's
dangerous: nothing crashed, no test went red, the product just quietly didn't work
end to end.

## Symptoms

- A gate/claim reads a row keyed on some id; in production it always returns
  "missing"/"refused" even for legitimate input.
- `grep recordX` (or the insert into that table) returns the implementation, its
  tests, and nothing else — no route handler, no job, no caller in the request path.
- Every automated test mocks the surrounding calls per-call to return success, so no
  test ever drives the actual call *sequence*.

## Solution

Wire the writer into the flow as its own step, in the right place in the sequence:

```
verify (adopts parent session)
   → POST /api/fp/signup/consent   →  recordConsent()   // the missing route
   → POST /api/fp/signup/child     →  consentGate() claims the row just written
```

- Add the route (`app/api/fp/signup/consent/route.ts`) mirroring the sibling route's
  CORS/auth/rate-limit posture; parse the parent Bearer, call `recordConsent`, map
  `duplicate → idempotent success`, release the strike only on `outage`.
- Place it **after** the step that satisfies the writer's own preconditions (here:
  the parent session must exist and the attempt be `verified`) and **before** the gate
  that consumes it.
- Carry the data the writer needs across any async gap. The consent fields
  (age band, dob, jurisdiction, echoed version+hash) were validated-then-discarded at
  the earlier step, so the client had to persist and re-send them at consent time.

## Why This Works

A gate and its writer are two halves of one invariant; the invariant only holds when a
caller connects them in the live request path. Implementing `recordConsent` as a pure,
tested function is necessary but not sufficient — "there is a function that could write
the row" is not "the row gets written." Exposing it as a routed step that the client
actually calls is what makes the gate reachable.

## Prevention

- **When you add a gate/claim that READS a row, immediately find the WRITE path and
  confirm a real caller (route/job/handler) creates that row in the live flow** — not
  just a function that could. If the writer has no caller, the gate is dead (open or
  closed). Grep the writer's name and the table insert; if the only hits are the impl
  and its tests, it's unwired.
- **Test the composed SEQUENCE, not each half.** Per-call mocks that each return
  success prove the units and hide the seam. Write one flow test that drives the real
  call order and FAILS if a required step (the consent POST) is absent — assert the
  writer is invoked between its precondition step and its consumer step. That single
  test would have caught this at build time.
- **Fail-closed is safe but silent.** A missing step that makes a gate refuse won't
  crash or redden a suite; it just makes the feature not work. Treat "the happy path
  has never been run end to end against real routes" as an untested state, and cover
  it before calling the flow done.
- **Keep the separately-recorded step separate.** The fix is to ADD the consent
  route, not to fold consent fields into the mint's `.strict()` body — the writer's
  guarantees (echo-binds-to-rendered, server-derived identity, freshness) depend on it
  being its own authenticated step.
- Sibling: `guard-function-with-no-callers-is-not-a-mechanism…` (the read-side twin —
  a guard nobody calls); and the consent atomic-CAS + SET-NULL docs (the gate this
  writer feeds).
