---
title: "When you collapse or DEFER a feature, the deprecated request field usually lives on MORE THAN ONE boundary schema — relax them together, and `.strip()` (accept-and-ignore) rather than `.strict()`-reject the field during the transition, or the in-flight client can satisfy no consistent shape"
date: 2026-08-01
category: best-practices
module: fp-signup
problem_type: best_practice
component: api-contract
symptoms:
  - "A field was removed from one request schema but a sibling endpoint still hard-requires it, so no single client payload satisfies both during the transition"
  - "An in-flight client that still sends a now-deprecated field is 401'd by a `.strict()` schema mid-migration"
  - "Deprecating a request field looked done because the obvious endpoint was updated — the other endpoint that also carried it was missed"
root_cause: design_gap
resolution_type: workflow_improvement
severity: medium
tags:
  - api-contract
  - zod
  - deprecation
  - transition
  - strict-vs-strip
  - feature-flagging
related_components:
  - api-contract
  - fp-signup
---

# Deferring a feature: relax EVERY boundary schema carrying the field, and `.strip()` during the transition

## Context

Slice B's username re-scope collapsed First Profit child creation from two paths
(path a: parent-set password; path b: provisioned Workspace address) down to one, and
DEFERRED path b to a future piece. The obvious change was to drop `credentialChoice`
from the child-mint route's schema.

But `credentialChoice` lived on **two** boundary schemas, filled at two different
steps of the same flow: the signup START route (`signup-rules.ts`) *and* the child
route (`child/route.ts`). U14 relaxed the child route (removed the field, switched to
`.strip()`) but left the START schema still hard-requiring `credentialChoice` under
`.strict()`. The review flagged it: mid-transition there is a window where the client
must send the field to pass START but must not rely on it at the child step — and once
the FP client stops sending it (U15), a `.strict()` START schema would 401 it. No
single client shape satisfies both surfaces at once unless they're relaxed together.

## What Didn't Work

- **Updating only the "main" endpoint.** A request field is part of a *contract*, and
  a multi-step flow often re-declares that contract on several endpoints. Fixing the
  one you were thinking about leaves the others as strict landmines the client trips on
  the moment it stops sending the field.
- **`.strict()`-rejecting the deprecated field during the transition.** While an
  in-flight client (a deployed SPA, a mobile app, a queued job) still sends the field,
  a `.strict()` schema that now forbids it turns every in-flight request into a hard
  refusal — a self-inflicted outage during the rollout.

## Solution

1. **Enumerate every boundary schema that carries the field before removing it.**
   `grep` the field name across all route/validation modules; a multi-step flow's
   field is often declared per step. Relax them in the same unit (or explicitly track
   the remainder as the next unit's first task).
2. **`.strip()` (accept-and-ignore), not `.strict()`-reject, during the transition.**
   ```ts
   // child route: field removed from the schema; .strip() (zod default) silently
   // drops an incidental credentialChoice from an in-flight client instead of 401'ing.
   const childSchema = z.object({ attemptId: z.uuid(), childFirstName: z.string(),
                                  childPassword: z.string().min(1) }); // no .strict()
   ```
   Nothing branches on the stripped field; the canonical shape is enforced by the named
   fields being required. Once every client has stopped sending it, you can tighten
   back to `.strict()` in a later cleanup.
3. **When you remove the code that CREATES a resource, remove its compensation/teardown
   too — but first prove no other path still creates it.** U14 removed the path-b
   provisioning-claim teardown from `runCompensation`; that was safe only because no
   single-path code enqueues a claim anymore. Verify (a test asserting the claim table
   stays empty) before deleting the backstop.

## Why This Matters

A feature's request contract is distributed across the endpoints of its flow, plus the
client. Deprecating a field is a coordinated relaxation across all of them, sequenced
so the client is never caught between two surfaces with incompatible requirements. The
transition tool is `.strip()` (tolerant) → migrate clients → `.strict()` (tight), not
a single hard cutover that assumes every client updates atomically.

## When to Apply

Any time you remove/deprecate a request field, collapse a multi-path feature, or defer
one branch of a flow: grep the field across all boundary schemas, relax them together,
`.strip()` through the transition, and drop dependent teardown only after proving the
resource it cleaned up is no longer created.
