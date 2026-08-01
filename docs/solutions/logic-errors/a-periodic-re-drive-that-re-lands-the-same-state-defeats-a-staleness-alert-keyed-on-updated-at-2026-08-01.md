---
title: "Adding a periodic re-drive over rows that another periodic sweep watches for staleness turns a once-only ops alert into an every-tick page storm — a no-op re-write that bumps updated_at / clears the alert stamp is not free"
date: 2026-08-01
category: logic-errors
module: fp-signup
problem_type: logic_error
component: background-jobs
symptoms:
  - "A stall/staleness alert that used to fire once now fires on every cron tick for the same rows"
  - "A row in a designed-indefinite 'parked/pending' steady state keeps re-triggering an alert meant for genuine stalls"
  - "Two independent periodic jobs touch the same table; one job's writes reset the bookkeeping the other job's dedup depends on"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags:
  - cron
  - background-jobs
  - alerting
  - dedup
  - idempotency
  - updated-at
  - state-machine
related_components:
  - error-handling
  - fp-signup
related_docs:
  - out-of-band-cleanup-latency-is-the-exposure-window
---

# A periodic re-drive that re-lands the same state defeats a staleness alert keyed on updated_at

## Problem

First Profit Slice B added a re-drive cron (`sweepPendingFpProvisioningClaims`) so
that child mailboxes enqueued at signup — which have no Stripe-webhook arrival to
drive them — still get provisioned. It re-leases each `pending` claim hourly and
runs the drive, which `land()`s the state (writing `updated_at`, clearing
`ops_alerted_at`).

The same table already had a *second* periodic job: `sweepStaleProvisioningClaims`,
which pages ops for any non-terminal claim older than 60 minutes ("paid families
waiting"), deduplicated by stamping `ops_alerted_at` so each stall pages once.

Throughout the Slice B build, Google Workspace is deliberately unconfigured
(`GOOGLE_WORKSPACE_SA_KEY` absent), so every path-b claim parks `pending`
**forever by design**. Each hour the new re-drive re-lands that same `pending`
state — bumping `updated_at` and clearing `ops_alerted_at`. So every hour the stale
sweep sees a "60-minute-old, never-alerted" claim and pages again. A once-only alert
became an hourly page for every parked child, including every staging test child and
the entire Unit 11 acceptance window — training ops to ignore the exact page that
also covers real funnel stalls.

## Symptoms

- An alert with working dedup suddenly re-fires every tick for the same entities.
- The entities are in a state the system intends to hold indefinitely (a park, a
  wait-for-config, a manual-review queue) — not actually stalling.
- Nothing in the *alerting* job changed; a *different* job started re-touching the
  rows.

## Solution

Two independent fixes; the first is the robust one:

1. **Exclude the designed-steady-state rows from the staleness alert.** A monitor
   that pages on age cannot, by itself, tell a genuine stall from a park the system
   means to hold forever. Give the park a recognizable marker and skip it:
   ```ts
   // alertStaleClaims core: don't page claims parked for the known, expected reason.
   const WORKSPACE_UNCONFIGURED_PENDING_REASON = "workspace credential not configured";
   const stale = claims.filter(c => c.pending_reason !== WORKSPACE_UNCONFIGURED_PENDING_REASON);
   ```
   Genuine funnel stalls (any other reason, or none) still page exactly once.

2. **Don't reset dedup bookkeeping on a no-op re-write.** A re-drive that lands the
   *identical* state should not clear `ops_alerted_at` or bump `updated_at`. This
   alone is fragile here because the lease RPC and `finishRun` both touch
   `updated_at` independently — which is *why* fix 1 (exclude by intent, not by
   timestamp) is preferred.

## Why This Works

The staleness alert's dedup was an implicit contract: "`updated_at` advances and
`ops_alerted_at` clears only on a *meaningful* transition." A new periodic writer
that re-lands the same state every tick silently breaks that contract. Marking the
intended-indefinite park as a first-class, recognizable state lets the monitor
distinguish "waiting as designed" from "stuck" — which is the distinction the alert
was actually meant to draw all along.

## Prevention

- **Before adding a periodic job over a table, list every *other* periodic job that
  reads or writes those rows.** Ask what bookkeeping (timestamps, alert stamps,
  lease columns, retry counts) each depends on, and whether your job's writes reset
  it. Two cron jobs over one table couple through the columns they share.
- **A "no-op re-park" is a write.** Re-landing the same state still bumps
  `updated_at` and may clear alert/dedup stamps. If a downstream consumer treats
  `updated_at` as "time of last *meaningful* change," a re-writer that touches it
  every tick is a silent regression.
- **An age-based stall alert needs a way to except designed-indefinite states.**
  "Non-terminal for > N minutes" conflates "stuck" with "parked on purpose"
  (awaiting config, in a manual-review queue, rate-limit-backed-off). Model the
  intended wait as its own recognizable reason and exclude it, rather than letting
  the monitor page on it.
- **Test the interaction, not just each job.** A unit test of the re-drive alone and
  a unit test of the stale sweep alone both pass; the bug only appears when the same
  row is swept by both across two ticks. Write that two-tick, two-job test: assert a
  parked row pages at most once while a genuinely stalled row still pages.
- Sibling: the out-of-band-cleanup-latency note (why these sweeps exist and their
  cadence) and the pure-decision-starved-by-hand-listed-SQL-prefilter note (the
  companion re-drive fix that pinned the drivable-state allowlist so a new
  non-terminal state can't silently starve).
