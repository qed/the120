---
title: "A plan's data-state assumption is a dependency on every writer of that column, not just the ones it edits"
module: development_workflow
date: 2026-08-04
problem_type: best_practice
component: development_workflow
severity: medium
category: best-practices
related_components:
  - documentation
  - tooling
tags: [planning, scope-boundaries, assumptions, coupling, write-paths, review]
applies_when:
  - "A plan declares a scope boundary such as 'no product code changes'"
  - "A design depends on a column staying empty, staying null, or holding a particular value for a period of time"
  - "Reviewing a plan whose correctness rests on the current state of data rather than on code it controls"
---

# A plan's data-state assumption is a dependency on every writer of that column, not just the ones it edits

## Context

A provisioning plan declared **"No product code changes in either repo"** as a
scope boundary, and separately built its central mechanism on a data-state
assumption: write `children.grade`, leave `children.birth_year` empty, and
`resolveChildGrade` will fall through to the stored grade forever. That is what
made the "no code changes" claim true — nothing had to be modified for it to work.

It was false. `app/lib/funnel/miniapp-core.ts` builds a `birth_year` patch and
persists it for `status='draft'` children when a parent opens their application
page — and provisioning inserts children as exactly that. A parent signing in
would have flipped every one of those children onto the birth-year derivation
branch, silently re-banding them: the youngest child would have derived a grade
outside the program's 3–12 range and rendered band-null, which the requirements
explicitly forbade.

The boundary the plan stated ("which files we edit") and the boundary that
actually governed correctness ("which behaviours we depend on") were different
boundaries, and only one of them was written down.

## Guidance

**When a design rests on a column's state, enumerate every writer of that column
and list them in the plan by name.** Not the writers you are adding — all of
them. One grep:

```bash
rg -n "birth_year" app --type ts | rg -v "__tests__" | rg -iE "update|upsert|insert|patch|set"
```

That is the whole technique. It takes a minute and it is the difference between
an assumption and a dependency you have actually checked.

**Prefer writing the value to assuming its absence.** "This column stays empty"
is a claim about every future actor in the system. "This column holds 2014" is a
claim about one row you control. The fix here was to write a real `birth_year`
calibrated so the derivation produces the intended grade — which made the design
robust to the prefill path instead of fragile to it, and cost nothing.

**Say what the scope boundary is a boundary on.** "No product code changes" reads
as a safety property and is really a statement about the diff. If a plan depends
on product behaviour it does not own, that dependency belongs in the plan
regardless of whether any of those files appear in its file list.

## Why This Matters

A scope boundary is the thing reviewers use to decide what they do *not* need to
check. A boundary drawn around the diff quietly excuses everyone from examining
the coupled write paths — so the assumption is never tested by anybody, and it
fails in production against real data, at whatever moment a user happens to open
an unrelated page.

The failure is also invisible in review: no diff shows it, because the dangerous
code is code nobody changed.

## When to Apply

Any time a plan contains a sentence of the form "X stays empty / stays null /
does not change" and X is not a column the plan exclusively owns. Also any time a
plan claims a change is inert because it adds rather than modifies — inertness is
a property of the whole system's write paths, not of the diff.

## Related

- [relaxing-a-composed-predicate-split-it-and-audit-bare-callers-of-the-inner-half](relaxing-a-composed-predicate-split-it-and-audit-bare-callers-of-the-inner-half-2026-08-02.md)
  — the same lesson on the call-graph axis (who *calls* this). This doc is the
  read/write axis (who *writes* this).
- [stale-writer-schema-poison](../database-issues/stale-writer-schema-poison-2026-07-30.md)
  — "the question is never 'is the new code correct' — it is what every version
  still running does."
- [a-clean-cutover-precondition-collapses-a-planned-transition-retirement-unit-verify-the-end-state-anyway](a-clean-cutover-precondition-collapses-a-planned-transition-retirement-unit-verify-the-end-state-anyway-2026-08-01.md)
  — **amendment:** its scope-boundary bullet is about what you must *change*;
  this is about what you must not assume *stays still*.
