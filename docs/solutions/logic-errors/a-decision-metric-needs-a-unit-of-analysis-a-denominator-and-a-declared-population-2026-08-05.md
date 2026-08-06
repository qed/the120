---
module: fp-image-lab
date: "2026-08-05"
problem_type: logic_error
component: api
severity: high
symptoms:
  - "A filtered page renders 100% keep rate on every card, screenshot-able and indistinguishable from an unfiltered one"
  - "The more a model is iterated on, the worse it scores — retries inflate its denominator"
  - "A half-reviewed model scores lower than a fully-reviewed one purely for being unfinished"
root_cause: design_gap
resolution_type: code_fix
tags:
  - metrics
  - decision-evidence
  - denominator
  - unit-of-analysis
  - filtered-aggregate
  - keep-rate
---

# A decision metric needs a unit of analysis, a denominator, and a declared population

## Problem

The Image Lab exists to answer one question: **which image model should the panel
engine ship?** The answer is a per-model "keep rate" — how often a staff reviewer
marks a generated image as good — shown beside per-model cost.

The maths was carefully defensive in one respect. Failures that are *our*
artifacts — an adapter timeout, a safety block from a vendor allowlist we have
not been granted — were deliberately excluded from the denominator, on the
explicit reasoning that folding them in would score a vendor for our own
infrastructure.

Three separate reviewers then found the same metric wrong in three other ways,
all of which the exclusion rule's own logic should have caught.

## Symptoms

**1. Wrong unit of analysis.** A retry appends a new row sharing
`(run_id, model_id, cell_ordinal)`, and a reviewer may retry a *completed* cell
to get a better variant. The stats counted **rows**:

```
cell #3, gpt-image-2:  attempt 1 done (unjudged)
                       attempt 2 done (unjudged)
                       attempt 3 done → kept
                       → completions 3, keeps 1 → 33%
```

for a cell the reviewer considers a success. The more a model is iterated on, the
worse it scores — and the inverse abuse (retry a weak model until one lands, judge
only the winner) is equally invisible.

**2. Wrong denominator.** `keeps / done` put unjudged completions in the
denominator, so the number tracked *review progress*:

| model | done | judged | keeps | shown |
|---|---|---|---|---|
| A | 10 | 10 | 6 | 60% |
| B | 10 | 5 | 5 | **50%** |

Model B was kept on every image anyone looked at and scores lower than A. The
module excluded our timeouts so as not to score the vendor for our artifacts —
then admitted an artifact of our own review pace into the same ratio.

**3. Undeclared population.** The stats were computed over the *filtered* row set.
`?verdict=keep` therefore rendered **100% keep rate on every model card**;
`?verdict=reject` rendered 0%. The code's own comment claimed *"The copy names the
filter beside the stats so the reader always knows which population produced the
number"* — but the filter object was never passed to the stats component. The
result is a shareable screenshot that is a restatement of the URL.

A fourth, quieter version of the same fault: a 1000-row image cap combined with a
settable 200-run page meant the oldest runs came back with zero images and were
silently pruned — so asking for *more* runs displayed *fewer*, and the headline
described a suffix of the data, beneath copy asserting "History is complete by
design — nothing is ever pruned."

## Why This Happens

Each of the three is the same omission at a different level:

> A metric that drives a decision is not a formula. It is a formula **plus** a
> unit of analysis, **plus** an explicit denominator rule, **plus** a statement of
> the population it was computed over.

The formula was reviewed carefully — that is why the timeout exclusion exists. The
other three were never written down anywhere, so nobody reviewed them, and each
defaulted to whatever the code happened to iterate.

The tell in all three cases is that the number stayed *plausible*. Nothing crashed,
nothing looked empty; the value just quietly answered a different question than the
label claimed.

## Solution

```
unit:        the latest eligible attempt per (run_id, model_id, cell_ordinal)
             — one cell contributes one data point, however many times it was retried
denominator: judged = keeps + rejects           (null when 0, never 0 and never NaN)
excluded:    requested/stale rows; every failure; and — belt and braces — a `done`
             row still carrying an excluded failure reason
reported     unjudged      (so partial review is visible, not silently priced in)
alongside:   attemptsPerCell (so iteration is visible, not penalised)
             anomalies     (so the census buckets sum to attempts)
population:  the active filter is rendered beside the number, and the keep rate is
             SUPPRESSED entirely when a verdict filter is active
```

Plus: derive the row cap from the page size rather than fixing it, and show an
explicit truncation banner when the cap is hit instead of pruning silently.

## Prevention

- **Name the unit of analysis before writing the formula.** "Per what?" is the
  first question, and retries/attempts/versions are where it usually goes wrong.
  Anything that appends a row per attempt will inflate a naive denominator.
- **Decide explicitly what "not yet measured" does to the denominator.** Unjudged,
  pending, and excluded are three different things, and only one of them belongs
  in the divisor. Report the other two beside the ratio.
- **A filtered aggregate must render its filter.** If a number can be computed over
  a subset, the subset is part of the number. The strongest form is to refuse to
  render the metric when the filter makes it tautological — `?verdict=keep`
  producing "100% keep rate" is not a number, it is the query.
- **Make the census sum.** If the buckets you display do not add up to the total
  you display, some row is in a state nobody named — surface it as its own count
  rather than letting it vanish.
- **A cap that silently prunes is worse than an error.** When a limit is hit, say
  so; a completeness claim in the copy plus a silent truncation in the loader is
  the pairing that turns a bounded query into a false statement.
- Test with a fixture that can *distinguish* the choices: a model with 3 attempts
  on one cell, a partially-judged model, and a filtered page. Each of these three
  bugs survived a green suite because every fixture used one attempt per cell,
  fully judged, unfiltered.

## Related

- `docs/solutions/database-issues/a-one-directional-check-lets-a-late-writer-flip-a-terminal-state-and-keep-the-old-evidence-2026-08-05.md`
  — the schema-level version of the same concern: a row that lands in two buckets
  pushes this very keep rate above 100%.
- `docs/solutions/logic-errors/a-classifier-that-reads-free-text-containing-user-content-lets-the-user-steer-it-2026-08-05.md`
  — the other way this metric was corrupted: misfiled failures leaving the
  denominator based on a child's word choice.
