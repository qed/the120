---
title: "Spot-check fixtures miss the one that's different — assert the aggregate"
date: 2026-07-21
category: docs/solutions/logic-errors
module: content_pipeline
problem_type: silent_data_corruption
component: curriculum_parser
symptoms:
  - "A parser passes every count check (5 phases, 25 criteria, 125 tasks) but one item is silently wrong"
  - "Tests hard-code one or two known-good ids as fixtures and never assert the whole set holds the invariant"
  - "The wrong item is the exceptional one — the last, the differently-worded, the edge — exactly the one no fixture named"
root_cause: incomplete_invariant_check
resolution_type: test_and_validation_added
severity: high
tags: [parser, content, invariant, fixture-bias, manifest, validation, false-green]
---

# Spot-check fixtures miss the one that's different — assert the aggregate

## Problem

A parser turned the 125-task curriculum into a typed content package. A regex marked each criterion's closing task:

```ts
const COMPLETES_RE = /\s*\*\*This completes the criterion\.\*\*\s*$/;
```

24 of the 25 criteria end their final task with `**This completes the criterion.**`. The 25th — task **5.5.5**, the task that completes The Path itself — ends with `**This completes the criterion — and The Path.**`. The exact-match regex never matched it. Two failures shipped in one:

1. `completesCriterion` was `false` on the single task where it matters most — the program's final moment, which any completion celebration or portfolio seal would gate on.
2. The un-stripped `**…**` markdown was left inside `doneWhen` — the line a parent reads and answers yes/no to. The verifying adult would see literal asterisks in their bar.

Every gate was green. 128 tests passed. The manifest assertion passed. It committed.

## Root cause

Two compounding gaps, both the same shape:

**The tests spot-checked fixtures.** The only `completesCriterion` assertions named `1.1.5` and `2.3.6` — both of which use the common wording. No test asked "does *every* criterion have exactly one closer?" The `doneWhen`-stripping test checked only `1.1.5`. Fixture-based tests are biased toward the regular case by construction: you pick the ids you understand, which are the ones that behave.

**The validation checked cardinality, not content.** `assertMatchesManifest` verified 5/25/125 and the per-phase split — the package was the right *size*. It never checked that the package said the right *thing*. A count can't catch a field that is present but wrong.

The same bias produced two more misses caught in the same review: two live-outreach tasks (`1.3.4`, `1.5.5`) missing their `parent_present` safety flag — again the *closing* tasks of their sequences, which read like arithmetic in the title ("compute the funnel") but are ten more real-world doorsteps in the body.

## Resolution

**Fix the regex to match on the stable prefix, not the exact sentence:**

```ts
const COMPLETES_RE = /\s*\*\*This completes the criterion\b[^*]*\*\*\s*$/;
```

**Replace fixture spot-checks with aggregate invariants:**

```ts
// exactly one closer per criterion, 25 total — would have caught 5.5.5
for (const criterion of allCriteria) {
  expect(criterion.tasks.filter(t => t.completesCriterion)).toHaveLength(1);
}
// no markdown survives in ANY done-when line
for (const t of allTasks) expect(t.doneWhen).not.toContain("**");
```

**Add field-level checks to the validation, not just counts:** `assertMatchesManifest` now throws on a criterion without exactly one closer, and on any `doneWhen` containing `**`. Counts prove size; these prove content.

**Add a drift guard:** the build script that generates the committed module was not wired into a pretest hook, so a stale module could diverge from the parser undetected. A test now re-parses the source in-process and compares to the committed module byte-for-byte.

## Prevention

- **For parsed or generated content, assert the invariant over the whole set, not over named examples.** "Every criterion has exactly one closer" is a one-line loop and it catches the exceptional item; "1.1.5 is a closer" catches nothing you didn't already know.
- **Pick fixtures adversarially when you must use them.** The last item, the differently-worded item, the empty case — the ones you'd skip because they're annoying are the ones that break.
- **Cardinality checks and content checks are different guarantees.** "125 tasks parsed" and "every task's done-when line is clean prose" are both worth asserting, and the first will never imply the second.
- **A committed generated artifact needs a drift test** if its build step isn't in CI — otherwise the source and the artifact silently diverge.

## See also

- `docs/solutions/database-issues/silent-zero-row-update-em-dash-hyphen-title-drift-crm-library-2026-07-14.md` — the same em-dash-vs-hyphen family of near-miss string bugs, one table over
- `docs/solutions/test-failures/middleware-proxy-is-testable-next-experimental-testing-server-2026-07-21.md` — the other "green tests that prove nothing" from this build
- `docs/plans/2026-07-21-001-feat-the-path-t1-core-loop-plan.md` — Unit 3
