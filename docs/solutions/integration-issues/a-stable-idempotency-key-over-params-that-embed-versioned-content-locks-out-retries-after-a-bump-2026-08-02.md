---
title: A stable idempotency key over params that embed versioned content locks out retries for 24h after a bump — put the version in the key
module: funnel-deposit-gate
date: "2026-08-02"
problem_type: integration_issue
component: payments
severity: high
symptoms:
  - "After a REFUND_POLICY text bump, a child with an abandoned pre-bump checkout session gets a generic 500 ('Could not start checkout') on every retry for up to 24h"
  - "Stripe returns idempotency_error (same key, different params); the route's catch-all turns it into an undifferentiated 500"
  - "Orphan deposit_attempts rows (no stripe_session_id) accumulate on each retry"
root_cause: logic_error
resolution_type: code_fix
related_components:
  - database
  - testing_framework
tags:
  - stripe
  - idempotency-key
  - policy-version
  - checkout
  - deploy-window
  - versioned-params
---

# A stable idempotency key over params that embed versioned content locks out retries for 24h after a bump — put the version in the key

## Problem

The checkout session's idempotency key was `deposit:${childId}` — deliberately
stable so a double-click replays the same open session instead of minting a second
payable one. But the session params embed `REFUND_POLICY.text` (the Stripe-rendered
consent text). Stripe retains an idempotency key→params mapping for **24 hours**,
independent of the session's own 30-minute expiry, and refuses a reused key whose
params differ (`idempotency_error`).

## Symptoms

Sequence (found by adversarial review of the 2026-08-02.1 policy bump, before it
shipped): parent opens checkout pre-deploy and abandons it → policy text deploys →
parent returns with a fresh bundle, passes the version echo, and the route creates a
session with the SAME key but DIFFERENT `custom_text` → Stripe 400s with
`idempotency_error`, which nothing recognizes → generic 500, repeated on every retry
until the key ages out. The child is effectively locked out of paying for up to 24h,
and each retry strands an attempt row.

## What Didn't Work

The design reasoned carefully about deploy-window staleness for the *version echo*
(stale tabs 409 and recover on refresh) but not for the *idempotency key* — the two
share a root cause (the deploy changes what checkout presents) with different
retention windows (bundle cache vs Stripe's 24h).

## Solution

Include the version of the embedded content in the key, so the key is stable exactly
as long as the params are:

```ts
// app/lib/funnel/deposit-core.ts (before → after)
idempotencyKey: `deposit:${childId}`                             // version-blind
idempotencyKey: `deposit:${childId}:${REFUND_POLICY.version}`    // rotates with params
```

(Same for the `:notos` degraded-mode key.) Double-click replay within a policy era is
unchanged; a bump gets a fresh key and never collides. Pinned in
`app/api/__tests__/checkout.test.ts` with keys asserted via
`` `deposit:child-1:${REFUND_POLICY.version}` `` so future bumps can't regress it.

A companion pin makes the bump rule executable rather than a comment: the live
`REFUND_POLICY.version` and `policyHash(REFUND_POLICY.text)` are pinned TOGETHER, so
a text edit without a version bump reddens a test instead of silently decoupling
recorded acceptances from what parents saw.

## Why This Works

An idempotency key's correct scope is "the identity of this exact operation." When
params embed versioned content, the version is part of the operation's identity —
omitting it makes two different operations collide. The 24h Stripe retention is
longer than every other cache in the system (bundle, session, CDN), so this is the
last collision anyone thinks of.

## Prevention

- When building an idempotency key, enumerate every input baked into the params and
  ask which can change ACROSS DEPLOYS; any that can belongs in the key.
- When reviewing a "content bump" change (policy text, price, rendered copy inside a
  priced API call), check the idempotency key derivation, not just version echoes.
- Recognize `idempotency_error` distinctly from other Stripe errors in
  catch-blocks that special-case anything (here `isMissingTosUrlError`) — an
  undifferentiated 500 hid the failure mode.
- Related: docs/solutions/logic-errors/idempotency-key-unique-scope-wider-than-the-operation-it-names-silently-swallows-distinct-writes-2026-07-23.md
  (the dual failure: a key too WIDE swallows distinct writes; this doc: a key too
  NARROW in time collides across versions).
