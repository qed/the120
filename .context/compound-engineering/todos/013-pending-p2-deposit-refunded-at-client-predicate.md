---
status: pending
priority: p2
issue_id: "013"
tags: [dashboard, deposits, correctness]
dependencies: []
---

# Client Deposit type/select omits refunded_at — wizard lock state can disagree with the DB guards

## Problem Statement

The DB's live-paid predicate is `status = 'paid' AND refunded_at IS NULL` (group lock + seeding triggers). The dashboard's `depositPaid` uses `status === 'paid'` alone and the deposits select doesn't fetch `refunded_at`. If a refund sets `refunded_at` without flipping `status`, the wizard shows Group/Workshops as locked while the DB would actually accept the edit — the parent loses an entitlement the refund re-opened (Adversarial reviewer residual, P2).

## Proposed Solutions

### Option 1: Fetch refunded_at and align the predicate

**Approach:** Add `refunded_at` to the deposits select and `Deposit` type in app/dashboard/store.tsx / data.ts; change `depositPaid` to `status === 'paid' && !refunded_at`. Audit the Stripe webhook to confirm what a refund actually writes (if it flips status too, this is pure defense-in-depth).

**Effort:** 1 hour. **Risk:** Low.

## Recommended Action

**To be filled during triage.**

## Acceptance Criteria

- [ ] Client lock predicate string-for-string matches the DB triggers' live-paid predicate
- [ ] Webhook refund behavior documented in the code comment

## Work Log

### 2026-07-14 - Initial Discovery

**By:** Claude Code (ce:review autofix — adversarial reviewer)
