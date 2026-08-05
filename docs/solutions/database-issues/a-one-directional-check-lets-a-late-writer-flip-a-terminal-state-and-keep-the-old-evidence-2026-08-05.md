---
module: fp-image-lab
date: "2026-08-05"
problem_type: database_issue
component: database
severity: high
symptoms:
  - "A derived keep-rate metric can exceed 100%: more numerator rows than the denominator admits"
  - "A row reads state='done' while still carrying failure_reason='timeout' from an earlier finalize"
  - "The two CHECK constraints written to protect the metric permit the exact row that breaks it"
root_cause: incomplete_constraint
resolution_type: migration
tags:
  - check-constraint
  - biconditional
  - state-machine
  - terminal-state
  - derived-metrics
  - timeout
  - now-is-transaction-time
---

# A one-directional CHECK lets a late writer flip a terminal state and keep the old evidence

## Problem

`fp_image_lab_images` records one AI-image generation attempt. Two columns are
the evidence a later model-selection decision reads: `storage_key` (bytes
landed) and `failure_reason` (why it didn't). Both were guarded, deliberately,
"because these two columns ARE the evidence the model decision reads":

```sql
-- the original, one-directional form
check (state <> 'done'   or (storage_key is not null and content_type is not null))
check (state <> 'failed' or failure_reason is not null)
```

Read them as implications: *done ⇒ has object*, *failed ⇒ has reason*. Neither
converse is asserted, so a `done` row carrying `failure_reason = 'timeout'`
satisfies both constraints completely.

## Symptoms

Nothing fails loudly. The corruption shows up one layer away, in a statistic:

- Unit 6 computes per-model keep rate and **excludes** `timeout` /
  `safety_blocked` rows from the denominator (they are our adapter's artifact
  and a pending vendor allowlist, not the model's answer).
- The numerator counts rows with `verdict = 'keep'`.
- A row that is `done` (so keepable, so in the numerator) **and** carries
  `failure_reason = 'timeout'` (so excluded from the denominator) is counted
  once on top and zero times underneath.

Keep rate goes above 100%, and it does so preferentially for whichever model
times out most — the exact comparison the feature exists to make, biased toward
the worst-behaving vendor.

## What Didn't Work

Reasoning about the writer instead of the constraint. The argument "our finalize
path only ever writes one outcome per row" is true of the code as written and
irrelevant: the row is reachable by two *sequential* writes, seconds apart, from
one request.

## Why This Happens (the concrete sequence)

1. `T+0` — cell attempted; a vendor call is dialled.
2. `T+60s` — the serverless function hits its wall clock. The error path
   finalizes `state='failed', failure_reason='timeout'`.
3. The vendor request was never actually cancelled (or a warm handler completes
   it). At `T+95s` the success path writes `storage_key`, `content_type`,
   `state='done'`.

Every CHECK passes. Nothing forbids leaving a terminal state, and nothing
requires clearing the evidence of the state you left.

## Solution

Make each implication **biconditional**, so the state and its evidence cannot
disagree in either direction:

```sql
constraint fp_image_lab_images_done_iff_object check (
  (state = 'done') = (storage_key is not null and content_type is not null)
),
constraint fp_image_lab_images_failed_iff_reason check (
  (state = 'failed') = (failure_reason is not null)
)
```

Now step 3 raises a constraint violation the route can log, instead of silently
producing a row that two different queries disagree about.

The same review pass added the sibling constraints that were missing for the
same reason — each one an "if/only if" the prose already assumed:

```sql
-- a verdict is a judgement about an IMAGE, so there must be one
constraint … check (verdict is null or state = 'done'),
constraint … check ((verdict is null) = (verdict_at is null)),
-- money only where a call was actually dialled …
constraint … check (billed or (cost_estimated is null and cost_reported is null)),
constraint … check (not billed or attempted_at is not null)
```

## Why This Works

A one-directional CHECK encodes *"this state requires this evidence."* What the
metric actually depends on is *"this evidence belongs to exactly this state."*
Those differ precisely when a row can be written more than once — which is
whenever a timeout path and a success path can both reach the same row, i.e. any
external call with a client- or platform-imposed deadline.

## Prevention

- **Ask "can this row be written twice?" before choosing the implication
  direction.** If yes, biconditional is the default and one-directional is the
  exception that needs a reason.
- **Constrain every column a derived metric reads**, not just the ones that feel
  like state. `cost_estimated` had the same "for done rows only" rule stated in
  a comment and no constraint; it now has one.
- **When a metric excludes rows by column A and includes them by column B,
  write the constraint that keeps A and B consistent.** The >100% result is
  diagnostic of exactly that gap.
- Parity-test the shape, not just the presence — a regex asserting
  `state <> 'done' or …` passes happily against the broken form:

```ts
expect(
  /\(\s*state\s*=\s*'done'\s*\)\s*=\s*\(\s*storage_key\s+is\s+not\s+null/i.test(sql)
).toBe(true);
```

## A second constraint-adjacent trap from the same migration

`created_at timestamptz not null default now()` — **`now()` is the TRANSACTION
timestamp**, not the statement or row timestamp. Every row inserted by one
statement (here: all cells of one compare run, minted together before any vendor
call) gets a byte-identical `created_at`, so an index on `(run_id, created_at)`
has no order to read and the side-by-side grid's column order is whatever the
executor returns. A plan change silently swaps the columns a user is comparing.
Sibling rows minted together need an explicit ordinal (`cell_ordinal smallint`),
or `created_at, id` as a tiebreak — never `created_at` alone.

## Related

- `docs/solutions/logic-errors/a-fixture-can-name-a-state-no-code-path-produces-test-the-writers-2026-07-28.md`
  — test the writers of a state column, not just its readers. The same lens
  found this: the constraint was verified against the writer we *meant* to have,
  not against every writer that can reach the row.
- `docs/solutions/logic-errors/a-row-level-cas-protects-the-row-not-the-intent-double-submit-mints-a-fresh-row-that-passes-2026-08-05.md`
  — the other guard on this table whose comment over-claimed its own scope.
- A sibling learning on the `feat/new-user-flow-v3` branch (module `fp-cover`)
  covers the adjacent rule about *which* state to write and when — "a status
  value that names queued work is a promise; do not write it until something
  queues it." Not linked by path here because that branch is unmerged and the
  file does not exist on `main`.
