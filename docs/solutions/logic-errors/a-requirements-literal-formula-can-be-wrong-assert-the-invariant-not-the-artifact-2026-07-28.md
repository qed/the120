---
module: dashboard
date: "2026-07-28"
problem_type: logic_error
component: service_object
severity: critical
symptoms:
  - "birthYearForGrade(12) returned '2027' — a child born next year — and the 4-digit checklist regex accepted it"
  - "The unit's own tests asserted the wrong values verbatim, locking the bug in as characterization"
  - "Mirror-parity fixtures built from typed objects could not reach the divergence living in each mirror's raw-parse path"
root_cause: logic_error
resolution_type: code_fix
tags:
  - requirements
  - formula
  - characterization
  - invariant
  - parity
  - raw-shape
  - birth-year
---

# A requirement's literal formula can be wrong: assert the invariant, not the artifact

## Problem

R47 says, verbatim: "birth year auto-calculated as `2026 − 11 + grade` and
editable." Implemented faithfully, that formula INCREASES with grade — grade 8
gives 2023 (a three-year-old in grade 8), grade 12 gives 2027 (born next
year). The requirement's own evident intent (a grade-6 child aged 11 → 2015)
is `2021 − grade`, which decreases with grade. The two coincide only at grade
3 — presumably how the formula survived whoever wrote it. Both U12 reviewers
found it by EXECUTING the function across the full grade range rather than
reading it.

Worse: the unit's first test asserted `birthYearForGrade(11) === "2026"` —
the formula's own output — so the suite was green while shipping impossible
data that the `/^\d{4}$/` checklist item happily counted as done.

## Symptoms

A test suite that restates the implementation ("the formula returns what the
formula returns") instead of the property that makes the output meaningful
("no offered grade may yield a future or implausible birth year").

## What Didn't Work

- Implementing the requirement verbatim. Requirements are written by people;
  an arithmetic expression in prose gets no compiler.
- Spot-checking at one input. Grade 3 → 2018 is right under BOTH formulas.
- The same trap in mirror form: the three-mirror parity tests converted a
  well-typed dashboard `Child` into the other two mirrors' input shapes — so
  the raw-jsonb divergence (dashboard clamps unknown academic plans to "",
  CRM/nurture accepted any non-empty string: 88 vs 100, by execution) was
  structurally unreachable by every fixture, despite the plan explicitly
  demanding fixtures "built from the RAW stored shape".

## Solution

1. `birthYearForGrade` implements the intent (`2021 − grade`), with a comment
   quoting the requirement's literal text and why it is wrong; flagged to
   Peter in the PR since the requirement document still carries it.
2. An INVARIANT test alongside the value tests:

```ts
for (let g = 3; g <= 12; g++) {
  const y = Number(birthYearForGrade(g));
  expect(y).toBeLessThanOrEqual(2018);   // youngest offered
  expect(y).toBeGreaterThanOrEqual(2009); // oldest offered
}
```

3. Raw-shape parity: a dedicated test feeds the SAME raw academics jsonb
   through each mirror's own entry path (`rowToChild`+`checklist`,
   `dossierChecklist`, `dossierCompleteness`) and asserts one number — plus
   the mirrors now share the plan vocabulary so unknown plans fail closed
   everywhere.

## Why This Works

A value test pins an artifact; an invariant test pins what the artifact is
FOR. When the artifact is derived from a requirement, the invariant is the
only defense against the requirement itself being wrong — the value test
will faithfully lock in any bug the spec carries. And parity between mirrors
only means something when each mirror is exercised through the path real
data takes into it; converting one mirror's typed output into the others'
inputs tests the conversion, not the mirrors.

## Prevention

- When implementing a formula from a spec, EXECUTE it across its full domain
  and sanity-check the extremes before writing the value tests. Ranges,
  monotonicity, and "can this output even exist" are one-line assertions.
- If the spec's text and its worked example disagree, the example is usually
  the intent — implement the example, quote the text in a comment, and flag
  the discrepancy to the spec's owner rather than silently picking either.
- Parity fixtures enter through each system's own front door (raw stored
  shape), never through another system's sanitized output.
