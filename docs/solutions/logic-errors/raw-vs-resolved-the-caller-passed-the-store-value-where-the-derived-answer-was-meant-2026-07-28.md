---
title: "Raw vs resolved: the caller passed the stored selection where the derived answer was meant — and the pure function's own tests could not see it"
date: 2026-07-28
category: logic-errors
module: app/start/children/ChildrenFlow.tsx
problem_type: logic_error
component: frontend
severity: high
symptoms:
  - "Adding a sibling on a fresh device moves the active child to the brand-new sibling, stealing focus from a further-progressed child"
  - "The pure function (activeChildAfterAdd) passes every test — its contract is correct; the caller handed it the wrong argument"
  - "Only reproduces when the selection is IMPLICIT (resolved by fallback) rather than explicitly persisted — fresh browser, cleared storage, second device"
root_cause: logic_error
resolution_type: code_fix
last_updated: 2026-07-28
related_components:
  - frontend
tags:
  - raw-vs-resolved
  - wiring
  - pure-functions
  - active-child
  - caller-contract
---

# Raw vs resolved: the caller passed the store value where the derived answer was meant

## Problem

Funnel U7's active-child rules are two pure functions:

- `resolveActiveChild(children, selectedId)` — the ANSWER: the explicit
  selection if valid, else the furthest-progressed child.
- `activeChildAfterAdd(previousSelectedId, addedChildId)` — R31's guarantee
  that adding a sibling never moves the active child: returns
  `previousSelectedId ?? addedChildId`.

Both are correct, and fully tested. The component wired them like this:

```tsx
const active = resolveActiveChild(children, selectedId);  // resolved answer
…
persistSelection(activeChildAfterAdd(selectedId, result.childId));  // RAW value
```

`selectedId` is the raw localStorage value. It is null on any fresh device,
cleared storage, or a session created elsewhere — while `active` correctly
shows the furthest-progressed child as Active on screen. Add a sibling in that
state and `activeChildAfterAdd(null, newChildId)` hands the brand-new child
the active slot: the progress bar and every downstream screen swing away from
a child mid-application. The exact outcome R31 forbids, in the exact wiring
whose comment said "only the FIRST child becomes active."

Two reviewers found it independently. Same round, same module, the same shape
in miniature: `gradeVerdict` used `Number.parseInt`, whose lenient prefix
parse turns `"7abc"` into 7 and `"4.5"` into 4 — the RAW string accepted where
a RESOLVED (validated) integer was meant.

## What Didn't Work

- **Testing the pure function harder.** Its two tests (`null → new`,
  `"first" → "first"`) both pass under the buggy wiring, because the bug is in
  which argument the caller supplies. No amount of contract coverage sees a
  caller.
- **The types.** Both the raw value and the resolved id are `string | null`.
  The compiler cannot distinguish a value from the answer derived from it when
  they share a type.
- **Reading the component.** The variable was named `selectedId` and the
  parameter `previousSelectedId` — the names AGREED, which is what made the
  wrong wiring read as right.

## Solution

Pass the resolved answer, and pin the wiring:

```tsx
persistSelection(activeChildAfterAdd(active?.id ?? null, result.childId));
```

```ts
// environment: "node" cannot mount the component, so the caller-side half of
// the contract is a wiring assertion:
expect(flow).toMatch(/activeChildAfterAdd\(\s*active\?\.id/);
expect(flow).not.toMatch(/activeChildAfterAdd\(\s*selectedId/);
```

And for the miniature: a grade string is legal only when it is nothing but
digits — `/^\s*\d+\s*$/` before parsing, never `parseInt`'s prefix parse.

## Why This Works

Any value that exists in both a **raw** form (what was stored, typed, or
received) and a **resolved** form (what a rule derived from it) is a wiring
hazard: the two agree most of the time, so the wrong choice passes every test
that exercises the common case. The divergence lives exactly in the fallback
paths — fresh device, junk input — which are also the paths least likely to be
in the author's manual testing.

The discipline: **once a resolver exists, the raw value's only consumer is the
resolver.** Every other use site takes the resolved answer. A raw value read
past its resolver is the bug, structurally, even when today's tests pass.

## Prevention

1. When a module exports both a raw accessor and a resolver, audit every
   caller of the RAW one: each is either the resolver itself or a defect.
2. Name them so the wrong wiring reads wrong: `storedSelectionId` vs
   `activeChild` would not have agreed with `previousSelectedId`.
3. For client components under a node-only test environment, add the wiring
   assertion — the pure tests prove the contract, the scan proves the caller.
4. `Number.parseInt` is a prefix parse, not a validator. Validate the string's
   SHAPE first; parse second.

## Related Issues

- `docs/solutions/security-issues/an-inert-defensive-branch-has-no-behavioural-signature-assert-the-wiring-2026-07-27.md`
  — the wiring-assertion discipline this applies.
- `docs/solutions/logic-errors/a-shared-cta-component-hardcodes-one-attribution-for-every-page-it-mounts-on-2026-07-28.md`
  — the previous unit's cousin: a correct vocabulary consumed with the wrong
  member. Correctness of the parts does not compose into correctness of the
  wiring.
