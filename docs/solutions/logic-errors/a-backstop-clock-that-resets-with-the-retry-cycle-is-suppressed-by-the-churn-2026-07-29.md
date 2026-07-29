---
module: funnel
date: "2026-07-29"
problem_type: logic_error
component: service_object
severity: medium
symptoms:
  - "The 7-day forwarding-verification alert could never fire for a parent whose email changed more often than weekly — every change started a fresh cycle and reset the clock"
  - "The families most likely to need the backstop (unstable email situations) were exactly the ones it silently skipped"
root_cause: incomplete_state_tracking
resolution_type: code_fix
tags:
  - backstop
  - alert-suppression
  - retry-cycle
  - first-ever-stamp
  - forwarding
  - w14
---

# A backstop clock that resets with the retry cycle is suppressed by the churn — pair it with a never-cleared first stamp

## Problem

W14's black-hole bound: a forwarding verification the parent never clicks
pages ops after 7 days. The clock was `forwarding_requested_at`, stamped
per request cycle — and a parent's email change deliberately starts a new
cycle (fresh target, fresh verification, fresh stamp, alert stamp
cleared). The adversarial reviewer composed the two correct behaviors into
a hole: change email every 6 days and no cycle ever ages past the bound.
The backstop is defeated by exactly the churn it exists to catch.

## What Didn't Work

Reasoning per-cycle. Each cycle's behavior was right in isolation
(re-arm the alert for a genuinely new request; never re-send inside a
cycle). The failure only appears over a SEQUENCE of cycles — no single
transition is wrong.

## Solution

A second timestamp with the opposite lifecycle: `forwarding_first_
requested_at`, stamped once when the first request ever goes out and
**never cleared by anything**. The overdue rule and the sweep page when
EITHER clock crosses its bound:

```ts
if (cycleAge >= FORWARDING_VERIFY_ALERT_DAYS * day) return true;   // 7d per cycle
if (totalAge >= FORWARDING_TOTAL_ALERT_DAYS * day) return true;    // 21d across all cycles
```

```ts
// adapter CAS, after winning a stampRequested transition:
await db.from(CLAIM_TABLE)
  .update({ forwarding_first_requested_at: now })
  .eq("child_id", childId)
  .is("forwarding_first_requested_at", null); // once, ever
```

## Why This Works

The suppression needs the clock to be resettable; the fix is a clock
nothing resets. Both clocks are still needed: per-cycle catches the
ordinary case fast, total-age catches the churny case at all.

## Prevention

For any alert/backstop keyed to a retryable cycle, ask: **what sequence
of legitimate cycle-restarts keeps the clock forever young?** If one
exists, add a monotone companion (first-ever stamp, restart counter)
that the restart path cannot touch. Pinned in
`funnel-arrival-rules.test.ts` ("the TOTAL-age backstop pages a
flip-flopping target even when every cycle stays young").
