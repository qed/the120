---
title: "A test fixture that hands the code a value the real flow has to DERIVE hides every derivation failure — the child was minted first-name-only, but the provisioning test canned last_name='Ng', so nobody noticed the address deriver throws on an empty surname until a stateful end-to-end test read the real minted row"
date: 2026-08-01
category: logic-errors
module: fp-signup
problem_type: logic_error
component: testing
symptoms:
  - "A unit test passes green but the real end-to-end flow fails at a step that derives a value from data an earlier step actually wrote"
  - "A fixture pre-seeds a field (a name, an id, a slug) that production would have to compute — so the computation is never exercised"
  - "A feature works in every unit test and fails the first time it runs against real data"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags:
  - testing
  - fixtures
  - end-to-end
  - derivation
  - seams
  - provisioning
related_components:
  - testing
  - fp-signup
---

# A fixture that supplies a value the real flow must derive hides derivation failures

## Problem

First Profit signup mints a child with a **first name only** (the child route
captures no surname; `children.last_name` is NULL). Path b then provisions a Google
Workspace address by deriving a local part from the child's name. The provisioning
deriver, `buildFwLocalBase(first, last)`, is a funnel primitive that builds
`first.last` and **throws** when the last-name part folds to zero address-safe
characters.

Every path-b provisioning unit test passed — because the test fixture seeded the
child row with `last_name: "Ng"`. That canned surname is a value the *real* signup
flow never produces (it only ever writes a first name). So the tests exercised
`buildFwLocalBase("Sasha", "Ng")` (fine) while production would run
`buildFwLocalBase("Sasha", "")` (throws → the claim parks `exception` → the mint
compensates → **the parent's "provision a Workspace address" signup fails**). The bug
was invisible to the entire unit suite and only surfaced when a stateful end-to-end
test minted a real first-name-only child with the actual `createChild` and let the
provisioning step read *that* row back.

## Symptoms

- A step that derives a value (an email local part, a slug, a normalized name, a
  foreign key) fails in production on input the unit tests never fed it, because the
  fixtures pre-supplied the derived value or supplied source data shaped unlike the
  real writer's output.
- `grep` shows the failing derivation is only ever called in tests with a
  hand-written fixture, never with the output of the real upstream writer.

## Solution

Two parts: fix the derivation for the real data shape, and change the test that
should have caught it.

1. **Fix (Option A): derive from what the flow actually captures.** Since FP children
   are first-name-only, add a first-name-only deriver
   (`buildFwLocalBaseFromFirstName` → a bare `<slug(first)>@domain`), still run
   through the same `foldToAscii` guard and collision-suffixer, and inject it into the
   FP provisioning path only (the funnel/deposit path keeps `first.last`). Do **not**
   synthesize a fake surname — it becomes a lasting contact address for a minor.
2. **Test change: a stateful end-to-end store where each step reads what the prior
   step wrote.** Replace canned fixtures with a mutable in-memory store threaded
   through the *real* `startSignup → verify → recordConsent → createChild →
   driveProvisioning`. The child row the provisioner reads is the one `createChild`
   actually wrote (first name, NULL surname) — so the deriver runs on real data and
   the throw reproduces in a test.

## Why This Works

A unit test with a hand-authored fixture proves "the code works on the fixture." When
the fixture supplies a value the production flow must *derive*, the test silently
asserts a precondition the real flow never satisfies. A stateful end-to-end test
removes the human from the middle of the pipeline: the only data any step sees is
what a real prior step produced, so a mismatch between "what the writer writes" and
"what a later reader needs to derive" becomes a failing test instead of a production
incident.

## Prevention

- **Fixtures must match the real WRITER's output, field-for-field, especially for
  fields a later step derives from.** If production writes only `first_name`, a
  fixture that adds `last_name` is testing a world that can't happen. Ask of every
  seeded field: "does the real upstream step actually produce this, in this shape?"
- **For any derive-from-upstream-data step, add one stateful end-to-end test** where
  the value is produced by the real writer, not seeded. Per-unit tests stay (fast,
  focused), but at least one test must let the deriver run on genuine upstream output.
- **A canned value that happens to be derivable is a landmine for the next reader.**
  When you must seed such a value in a focused test, comment that the *end-to-end*
  test is the real coverage of that seam, so a later edit doesn't delete the e2e test
  and leave the canned one as the sole (false) proof.
- **Reconcile any client-side PREVIEW of a derived value with the server deriver.**
  Here the signup UI previewed `first@domain` while the backend built `first.last`
  and then couldn't build it at all — the preview promised an address the backend
  couldn't mint. Preview and producer must share the derivation rules.
- Sibling: the "test the composed sequence, not each half" doc (unwired producer →
  gate fails closed) — same family (per-unit mocks hide seams), different failure:
  that one is a missing call, this one is a fixture supplying what a call should
  derive.
