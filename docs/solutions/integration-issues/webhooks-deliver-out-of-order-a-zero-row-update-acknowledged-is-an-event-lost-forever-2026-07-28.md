---
module: funnel
date: "2026-07-28"
problem_type: integration_issue
component: payments
severity: critical
symptoms:
  - "A refund arriving before its `completed` matched zero rows, returned 200, and was never redelivered"
  - "The delayed `completed` then recorded status='paid' — money returned, books counting a paid seat, forever"
  - "A partial $50 refund marked the whole $250 deposit refunded, reopening the Reserve button"
root_cause: async_timing
resolution_type: code_fix
tags:
  - stripe
  - webhook
  - ordering
  - zero-row-update
  - partial-refund
  - idempotency-key
  - toctou
---

# Webhooks deliver out of order: a zero-row update acknowledged is an event lost forever

## Problem

Stripe guarantees delivery, not ORDER. U14's refund handler ran
`UPDATE deposits SET status='refunded' WHERE stripe_payment_intent = X` and
returned success on `!error` — but a zero-row update has no error. A
`charge.refunded` arriving before its `checkout.session.completed` (delayed
by earlier 500-retries, or a near-instant fraud refund) matched nothing,
answered 200, and Stripe never resent it. The delayed `completed` then wrote
a fresh `paid` row: the family's money went back, and the books counted a
paid seat permanently. Three sibling defects rode the same review: the
per-attempt idempotency key let a double-click mint two payable sessions;
`charge.refunded` fires for PARTIAL refunds too (marking a $50 goodwill
refund as fully refunded reopened the $250 Reserve button); and the
read-then-write fulfil verdict could overwrite a refund committing between
its SELECT and its UPSERT.

## Symptoms

Everything 200. Nothing retried. The inconsistency only exists ACROSS
events, so no single handler ever observes it.

## What Didn't Work

- Treating "no database error" as "the event was applied". For UPDATE-shaped
  handlers, zero matched rows IS the failure mode that encodes out-of-order
  delivery — and it is silent by default.
- Idempotency-by-uniqueness on the row the OTHER event creates: the refund's
  idempotency lived on a row that didn't exist yet.
- A pure verdict function guarding a non-atomic write (TOCTOU).

## Solution

1. **Zero rows = non-200.** The refund update appends `.select()` and
   returns failure when nothing matched; the route answers 500 and Stripe
   retries until the `completed` lands and the row exists. (Residual,
   documented: a refund whose row will NEVER land — the double-paid second
   session — retries to exhaustion with a loud log as the staff signal.)
2. **Full refunds only flip status.** `charge.refunded === true` (the
   boolean) gates the status change; partial refunds log loudly as a staff
   ledger event.
3. **The conditional write moved into SQL** (`deposit_fulfil` RPC): the
   paid upsert carries `WHERE deposits.refunded_at IS NULL AND status <>
   'refunded'` atomically, and catches the one-live-paid 23505 inside the
   function. PostgREST cannot express a conditional upsert; the race
   between verdict-read and write closes only at the statement.
4. **Child-scoped idempotency key with STABLE params** (`deposit:{childId}`,
   no per-attempt metadata): a double-click replays the SAME open session
   instead of minting a second payable one; `expires_at` shortens the
   window to Stripe's 30-minute minimum. The persisted attempt row remains
   purely the policy-acceptance record, linked to the session post-create.
5. New status vocabulary (`pending`/`failed`/`expired`) closes the gate it
   grew past: a pending bank-debit deposit blocks a second checkout for
   the days it clears.

## Why This Works

Out-of-order delivery means every handler must be correct when its
prerequisite event has not happened yet. The two honest options are: make
the handler's no-op DETECTABLE (zero rows → retry until ordered), or make
the write itself carry the cross-event condition (the SQL WHERE). Both are
used here; the pure verdict remains as documentation and first-pass filter,
but the guarantee lives where it can actually hold.

## Prevention

- Every UPDATE-shaped webhook handler returns matched-row count, and zero
  rows maps to retry — unless a comment explains why absence is fine.
- For any status-flipping event, read the SPEC for its partial/edge
  variants (`charge.refunded` fires on partials; `completed` fires unpaid).
- Idempotency keys must have stable request params; a key that changes per
  click is a dedupe defeat, not a dedupe.
- When a new status value joins a vocabulary, grep every consumer of the
  column the same day — a gate that never learned the new word fails open.
