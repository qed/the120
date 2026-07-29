---
module: funnel
date: "2026-07-29"
problem_type: best_practice
component: cron
severity: high
applies_when:
  - "A state flip happens inline (webhook, action) but its external effect runs out-of-band via a sweep"
  - "The sweep is wired into whichever cron already existed, at that cron's cadence"
  - "The un-swept state carries real exposure (a live account, an unrevoked grant, undelivered money)"
symptoms:
  - "A refund flipped the claim to suspend_pending atomically — and the Workspace suspend waited for the WEEKLY retention cron: up to 7 days of live minor's mailbox after the family left"
root_cause: config_error
resolution_type: workflow_improvement
tags:
  - cron
  - cadence
  - out-of-band
  - sweep
  - exposure-window
  - suspend
---

# Out-of-band cleanup latency IS the exposure window — pick the sweep cadence from the harm, not the nearest cron

## Context

U8's design was right: never an external Google call inside the refund
webhook's transaction; flip `suspend_pending` atomically, let a sweep do
the suspend. The plan said "the retention cron also drives the
suspend_pending sweep" — so the sweep was wired into the retention cron,
which runs **weekly** (its own cadence, chosen for purge grace windows,
nothing to do with suspension). The adversarial reviewer priced it: a
refund on Tuesday leaves a departed family's minor-holding mailbox live
until Monday 9am.

## Guidance

When an inline flip defers its effect to a sweep, the sweep's cadence is
a SECURITY/CORRECTNESS parameter, not plumbing. Derive it from the
question *"how long may this state exist un-acted-on before it is harm?"*
— and give the sweep its own cron if the host cron's answer differs:

```json
{ "path": "/api/cron/funnel-lifecycle", "schedule": "20 * * * *" }
```

The weekly host keeps running the same sweeps as a belt-and-braces repeat
(all idempotent — repetition must be free before you may repeat).

Second, structural, lesson from the same review: sweeps that ride a host
cron must sit **outside the host's try** — an early throw in the host's
own work (a paginate refusal, a DB blip) otherwise starves every
piggybacked duty until the next scheduled run, silently.

## Why This Matters

"Wire it into the cron we already have" feels free and reads fine in
review, because the sweep code itself is correct. The defect lives in a
schedule string in vercel.json that no unit test touches. Latency-as-
exposure only becomes visible when someone prices the worst-case timeline
end to end.

## When to Apply

Every deferred-effect design: suspension, revocation, key rotation,
outbox drains, compensation retries. Ask at review: what is the maximum
time between the flip and the sweep, and is that number acceptable
*as a security property*? Pin the schedule
(`funnel-provisioning-migration.test.ts` pins the lifecycle entry's
hourly shape so a future consolidation can't silently regress it).
