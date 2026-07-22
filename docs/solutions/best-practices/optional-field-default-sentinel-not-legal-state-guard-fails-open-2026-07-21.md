---
title: "A guard fails OPEN when an optional field's default equals a legal value — default to an unmatchable sentinel, not a real state"
date: 2026-07-21
category: best-practices
module: path-transition-engine
problem_type: best_practice
component: service_object
severity: high
applies_when:
  - "A transition/workflow engine looks up a row's `from` state through an OPTIONAL context field and defaults a missing value with `??` to a literal state string"
  - "That literal default happens to equal a legal `from` state for some transition, so an omitted field silently satisfies the existence/state guard instead of failing it (fails OPEN)"
  - "An 'already in target state' / idempotent / ahead-of-intent verdict is being applied to a persistent, multi-cause aggregate state (criterion/phase) rather than a per-item, single-cause state (task)"
  - "A pure state-machine or `*-rules.ts` module is reviewed before it has any production callers — code review is the only gate between the near-miss and runtime"
root_cause: logic_error
resolution_type: code_fix
related_components:
  - testing_framework
tags:
  - state-machine
  - transition-engine
  - fail-open
  - fail-closed
  - optional-field-default
  - sentinel-value
  - idempotent-verdict
  - the-path
  - ce-review
---

# A guard fails OPEN when an optional field's default equals a legal value

## Context

The Path progress engine (T1 Unit 7) is a pure, enumerable state machine: a table of
transition rows `{ name, scope, from, to, actor, verifying, precondition, cascade }`,
and one evaluator that refuses a transition unless the subject's *current* state
equals the row's `from`. Task-scope rows read the current state from a required field
(`ctx.task.state`); criterion-scope from `ctx.criterion.state`. Phase-scope
transitions (`phase_return`, modeled for T2) read it from an **optional** field,
`ctx.phase`, because a phase snapshot is only supplied for the one transition that
needs it.

The lookup defaulted the missing optional value:

```ts
function currentStateForScope(scope, ctx): string {
  if (scope === "task") return ctx.task.state;
  if (scope === "criterion") return ctx.criterion.state;
  return ctx.phase?.state ?? "review_underway"; // ← the trap
}
```

`"review_underway"` is not an arbitrary placeholder — it is the **exact `from`** of
`phase_return`, the only phase-scope row. So a caller that simply forgot to attach
`ctx.phase` got a transition that evaluated *as if the phase had been verified to be
in review*:

```ts
const current = currentStateForScope(row.scope, ctx); // "review_underway" (defaulted)
if (current !== row.from) return { ok: false, reason: "no_such_transition" };
// current === row.from → guard PASSES → an unchecked phase transition returns ok
```

An adult could reopen criteria under a phase that was actually `locked` or `sealed`,
with zero evidence the phase was ever in review — the existence/state guard that
exists precisely to refuse an out-of-state transition **silently passed**. This was a
fail-**open** guard on an authorization-adjacent decision. **Eight independent
reviewers flagged it in a single `/ce:review` pass.** It never reached runtime only
because this is a pure module with no callers yet — review was the sole gate.

## Guidance

**An optional field's "missing" default must be a value that can never satisfy the
downstream check.** For a guard of the form `if (current !== expected) refuse`, that
means a missing input must yield a value that is *unequal to every legal `expected`* —
i.e. `undefined`, or a reserved sentinel that is not a member of the domain — never a
real in-domain literal, and least of all one that happens to equal a valid target.

```ts
// FAIL CLOSED — a missing optional field can never match any row's `from`.
function currentStateForScope(scope, ctx): string | undefined {
  if (scope === "task") return ctx.task.state;
  if (scope === "criterion") return ctx.criterion.state;
  return ctx.phase?.state; // undefined when omitted → undefined !== row.from → refuse
}
```

`undefined !== "review_underway"` is always true, so an omitted `ctx.phase` now always
lands on `no_such_transition`. The guard fails closed by construction, not by the good
luck of the default never colliding with a real state.

**Secondary rule — an "already done / idempotent" verdict must be scoped to per-item,
single-cause state, never a persistent aggregate.** The same evaluator distinguishes
"behind" (`no_such_transition`) from "ahead / idempotent" (`already_in_target_state`,
which a caller may adopt as a no-op success — the ahead-of-intent case from the
[three-way echo learning](../database-issues/stale-status-echo-full-row-upsert-vs-trigger-guard-coerce-not-raise-2026-07-14.md)).
That verdict is only sound where the target state *uniquely proves the transition
happened*. `verified` on a task means "this task is verified" — genuinely idempotent.
But `returned` on a criterion or phase is a **persistent, multi-cause** state: it may
be an earlier, different return. Treating `current === row.to` as idempotent there
would silently swallow a genuinely-new second return (and its audit note):

```ts
// Idempotent-adopt ONLY for per-item task targets; aggregates fall through to refuse.
if (row.scope === "task" && current !== undefined && current === row.to) {
  return { ok: false, reason: "already_in_target_state" }; // e.g. verify on already-`verified`
}
return { ok: false, reason: "no_such_transition" }; // a criterion/phase already `returned`
```

## Why This Matters

A default chosen for convenience becomes load-bearing the moment it coincides with a
value a guard treats as valid. The failure is invisible: no exception, no wrong-type
error, no failing happy-path test — the guard returns the *authorizing* answer for an
input that should have been refused. It is the fail-open twin of the [silent
zero-row `UPDATE`](../database-issues/silent-zero-row-update-em-dash-hyphen-title-drift-crm-library-2026-07-14.md),
where a coincidental *non*-match caused a silent no-op; here a coincidental *match*
causes a silent pass. Both come from trusting value-equality as proof of semantic
correctness.

It compounds with time: today there is exactly one phase-scope row, so the collision is
"only" one transition; the day a second phase-scope row lands with a different `from`,
the same defaulting either wrongly admits or wrongly refuses a caller who omitted the
field — and still silently, because nothing exercises the omitted-field path unless a
test deliberately constructs it.

## When to Apply

- Any lookup that resolves a value from an **optional** field and hands the result to
  an equality/membership guard — default to `undefined`/sentinel, not an in-domain literal.
- Any state machine, workflow, or rules engine where "current state" is compared to an
  "expected/from" state to decide whether an action is legal.
- Any "already done / idempotent / no-op success" verdict — restrict it to per-item,
  single-cause target states; never grant it to a persistent aggregate that multiple
  distinct actions can produce.
- Reviewing a **pure module before it has callers**: the omitted-optional-field and
  aggregate-idempotency paths are exactly the ones no happy-path test covers, so assert
  them explicitly (e.g. "phase_return with `ctx.phase` omitted refuses"; "a criterion
  already `returned` is `no_such_transition`, not `already_in_target_state`").

## Examples

Fail-closed test that pins the fix (would have caught the original bug):

```ts
it("FAILS CLOSED when ctx.phase is omitted — no silent match on a default state", () => {
  const out = evaluateTransition("phase_return", phaseCtx({ phase: undefined }));
  expect(out.ok).toBe(false);
  if (!out.ok) expect(out.reason).toBe("no_such_transition");
});

it("a CRITERION already `returned` is no_such_transition, not already_in_target_state", () => {
  const c = criterionOf(3, "verified", { state: "returned" });
  const out = evaluateTransition("criterion_return", ctx({ criterion: c, /* … valid input … */ }));
  expect(out.ok).toBe(false);
  if (!out.ok) expect(out.reason).toBe("no_such_transition");
});
```

## Related

- [Fail-closed type-guard: untyped service-role rows into closed unions](fail-closed-type-guard-untyped-service-role-rows-into-closed-unions-2026-07-21.md)
  — the nearest sibling (same Path T1 `ce:review` pass, same "don't let an absent/unrecognized
  input coerce into a trusted value; fail closed" principle), one code path over.
- [Stale status echo — coerce, don't raise; three-way echo interpretation](../database-issues/stale-status-echo-full-row-upsert-vs-trigger-guard-coerce-not-raise-2026-07-14.md)
  — the origin of the ahead/behind distinction this doc's secondary rule scopes: only the
  genuinely-ahead per-item case gets the "adopt the authoritative value" treatment.
- [Aggregate invariants, not fixture spot-checks](../logic-errors/aggregate-invariants-not-fixture-spot-checks-for-parsed-content-2026-07-21.md)
  — the companion test discipline: enumerate the whole table (every row, every refusal), because
  the exceptional row is the one a named fixture never covers.
- Plan: `docs/plans/2026-07-21-001-feat-the-path-t1-core-loop-plan.md` — Unit 7.
