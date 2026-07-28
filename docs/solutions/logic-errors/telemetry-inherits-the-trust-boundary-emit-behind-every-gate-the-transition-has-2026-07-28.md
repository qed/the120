---
module: funnel
date: "2026-07-28"
problem_type: logic_error
component: service_object
severity: critical
symptoms:
  - "An unauthenticated POST minted c2_applied conversions for arbitrary children"
  - "The c1 event stored the raw client source while the family stored the validated one — buckets that can never reconcile"
  - "A .range(0,4999) read against a documented max-rows=1000 server made the truncation refusal dead code"
root_cause: missing_permission
resolution_type: code_fix
tags:
  - telemetry
  - events
  - emit-order
  - trust-boundary
  - segmentation
  - postgrest-max-rows
  - dead-guard
---

# Telemetry inherits the trust boundary: emit behind every gate the transition has

## Problem

U16's event stream is the yardstick ad spend will trust — and its first
draft was poisonable three ways, all found by the review pair:

1. **The emit ran before the gates.** `c2_applied` fired right after body
   parsing — before auth, before the RLS ownership read, before the
   non-draft check, before the atomic once-per-submit claim. An
   unauthenticated `curl` with any child UUID inflated the C2 conversion
   and forged the child's CRM stage; every legitimate retry double-counted.
   The comment claimed the emit sat "after the auth check below" — code
   that did not exist.
2. **The tuple dodged the sanitizer.** `sanitizeEventProperties` guarded
   the `properties` jsonb, but `entry_source` is a COLUMN — the raw `?src=`
   query param and the raw capture input were stored verbatim, so free text
   (and phantom segmentation buckets the validated family row would never
   match) bypassed the no-PII rule entirely.
3. **A documented lesson, un-enforced, repeated itself.** The repo carries
   a solution doc stating PostgREST max-rows here is 1000 and server-
   enforced; the stage read still asked for 5000 rows in one range with a
   `length >= 5000` refusal — dead code over a read that silently truncated
   to the OLDEST events, freezing every family's displayed stage in the
   past: the exact lie the refusal was written to prevent.

## Solution

1. The emit moved inside the won claim — behind auth, ownership, status,
   and the dedupe flip, and AWAITED (a serverless freeze after the 200 must
   not eat the money metric). Test pins the ORDER (emit offset > claim
   offset in source), not just the emit's existence.
2. Sources reach the tuple only through `readCtaSource` (fail-closed
   vocabulary) at every call site; the enricher resolves `entry_source`
   from the STAMPED family row for downstream events, so C1 and C2/C3
   agree by construction.
3. The stage read pages in 1000-row windows filtered to the queue's child
   ids, with a page ceiling that refuses. The other metric distortions in
   the same family: the R57 tuple became SERVER truth (the child's prior
   group), a re-confirm emits nothing, texture events attribute a childId
   only through the caller's own RLS read, and the property sanitizer's
   64-char bound (which silently dropped real 66-char Stripe session ids)
   was found by testing with a REAL-length id instead of a short fixture.

## Why This Works

An analytics event is a claim about a transition. If the transition has
gates — auth, ownership, idempotency — an emit outside them is a claim
anyone can make. Putting the emit inside the last gate makes the event
exactly as trustworthy as the transition itself; validating tuple columns
at the same choke point as properties closes the "the sanitizer exists,
just not here" gap.

## Prevention

- For every emit, name the boundary it must sit behind, and pin the ORDER
  in a test — a contains-scan passes for the vulnerable placement too.
- A sanitizer's coverage is a claim to verify per FIELD: columns and
  properties are different code paths.
- When a solution doc documents a server limit, encode the limit in the
  test fake the same day — a lesson without an enforcing test repeated
  itself here within four days.
- Fixture realism matters at boundaries: a 9-char fake session id passed
  where every real 66-char one failed.
