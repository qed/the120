---
title: "A confirmation gate placed in ONE entry point is bypassed by every other call site — and re-reading live state when it resolves lets it authorize something it never named"
date: 2026-07-24
category: logic-errors
module: path / First Profit (FW) — the guide check-in surface
problem_type: logic_error
component: frontend
symptoms:
  - "A mandatory 'this rings the bell' confirm fired on the first tap but not on Retry, because both Retry buttons called the guarded function directly instead of the wrapper holding the gate"
  - "The confirm dialog named the LIVE selection rather than a snapshot, so a selection changed while the dialog's error banner was up could be written under a dialog that named somebody else"
  - "Both paths are reached by ordinary use on the failure mode the system is designed around (a dropped request, then a retry) — not by unusual input"
  - "Nothing failed in tests: the gate, the selection builder, and the write path were each correct and each individually tested"
root_cause: logic_error
resolution_type: code_fix
severity: high
related_components:
  - user_interface
  - api_integration
tags:
  - guard-placement
  - single-entry-point
  - confirmation-dialog
  - snapshot-vs-live-state
  - retry-path
  - composition-bug
  - code-review
  - the-path
  - first-profit
---

# A confirmation gate in one entry point is bypassed by every other call site

## Problem

FW's check-in surface must show a one-tap confirm before recording task `1.2.4`
— the "first dollar", which rings a physical bell in a room full of families.
The plan states it precisely: the confirm fires **once per action, naming every
selected student, never skipped**.

It was implemented as a wrapper around the writer:

```tsx
// The gate — correct, and correctly used by the three action buttons.
const request = (action: FwAction) => {
  if (action === "checkmark" && isFirstDollarTask(taskId)) {
    setConfirming(action);      // open the dialog; submit happens on "Yes"
    return;
  }
  void submit(action, selected);
};
```

Two other call sites did not go through it:

```tsx
// action-level retry, rendered on the error banner
onClick={() => void submit(lastAction, selected)}
// per-student retry, for the students whose outcome was ambiguous
onClick={() => void submit(lastAction, retryIds)}
```

So: guide taps Checkmark on 1.2.4 for three students → confirm appears → "Yes —
ring it" → the request fails on venue wifi (the failure this whole system is
built around) → error banner with **Retry** → tap Retry → **the write lands and
the bell rings with no confirm at all.**

A second, sharper bug sat underneath it. `confirming` held only the *action*, and
the dialog rendered `selected` — a `const` recomputed every render from live
picker state:

```tsx
First dollar for {selected.map(nameOf).join(", ")}?
```

The batch picker stays interactive behind the error banner. A guide who swapped a
teammate before tapping Retry would write a set that **no dialog had ever named**.

## Symptoms

1. The confirm fired on the first attempt and never on any retry.
2. `results`/`firstDollar` were also replaced rather than merged, so a narrowed
   retry additionally wiped the standing bell banner for a child who had already
   earned it (a separate P1 in the same function).
3. Every unit test passed. The gate was right, `fwBatchStudentIds` was right, the
   write path was right — the defect lived only in which of them called which.

## What Didn't Work

**Testing the pieces.** `isFirstDollarTask`, `fwFirstDollarStudents`, the batch
planner, and the decision table all had thorough tests. None of them could see
this, because none of them is where the bug was: the bug was that *one* of three
call sites had the gate in front of it.

**Reading the component.** The gate is visibly correct and sits directly above
the buttons that use it. Its docstring even restates the requirement. The two
bypassing call sites are ~200 lines further down, inside error-state JSX that
only renders after a failure — visually and mentally separate from the "normal"
path where the gate lives.

It took an adversarial reviewer explicitly constructing the failure sequence
(tap → fail → retry) to surface it.

## Solution

**One entry point, and a snapshot instead of live state.**

```tsx
const [confirming, setConfirming] = useState<{
  action: FwAction;
  studentIds: string[];   // SNAPSHOT — not re-read when the dialog resolves
} | null>(null);

/**
 * THE ONLY WAY A CHECK-IN IS SUBMITTED. Every entry point — the three action
 * buttons, the action-level Retry, the per-student Retry — comes through here.
 */
const beginSubmit = (action: FwAction, studentIds: readonly string[]) => {
  if (busy || studentIds.length === 0) return;
  if (action === "checkmark" && isFirstDollarTask(taskId)) {
    setConfirming({ action, studentIds: [...studentIds] });
    return;
  }
  void submit(action, studentIds);
};
```

Every call site now passes through it, and the dialog both names and submits the
snapshot:

```tsx
First dollar for {confirming.studentIds.map(nameOf).join(", ")}?
…
onClick={() => {
  const { action, studentIds } = confirming;
  setConfirming(null);
  void submit(action, studentIds);
}}
```

The retry sites also stopped re-reading live state — they pass `lastSubmitted`,
the exact set the failed attempt was for:

```tsx
onClick={() => beginSubmit(lastAction, lastSubmitted)}
```

## Why This Works

Two distinct properties, and the fix needs both:

1. **The gate is unbypassable because there is no other door.** `submit` is now
   called from exactly two places: `beginSubmit` (which gates) and the confirm's
   own handler (which is downstream of the gate). Adding a third caller means
   adding it to `beginSubmit`, because that is what is in scope where new buttons
   get written.

2. **What the dialog names is what gets written.** Snapshotting severs the
   dialog's contents from any state that can change while it is open. A
   confirmation that re-reads live state at resolution time is not a
   confirmation — it authorizes a decision it never showed.

## Prevention

- **Put a mandatory gate in the function everyone calls, not in a wrapper
  callers may skip.** If the guarded operation is exported/reachable at all,
  assume some path reaches it directly. Grep for the guarded function's name
  before merging: every call site should be the gate itself or provably
  downstream of it.

- **Look at the error/retry JSX specifically.** Guards get written on the happy
  path where the feature is being built. Retry, undo, "try again", and recovery
  affordances are written later, often in a different render branch, and they are
  the natural place for a bypass to hide. They are also disproportionately likely
  to be the path a user is on when something irreversible happens.

- **A confirmation must capture its subject, not re-derive it.** Store what was
  shown. Any dialog that renders `liveThing` and then acts on `liveThing` has a
  window between the two, and any UI still interactive behind it can widen that
  window arbitrarily.

- **Ask "what is the second way to reach this?" for every irreversible effect.**
  The effect here rings a physical bell; elsewhere it might be a charge, a send,
  or a delete. Enumerate call sites rather than trusting the one you wrote.

## Related Issues

- `docs/solutions/security-issues/guard-function-with-no-callers-is-not-a-mechanism-client-side-supabase-auth-bypasses-server-guards-2026-07-23.md`
  — the direct predecessor, one step along the same spectrum. That one is a guard
  with **zero** callers; this is a guard with **some** callers. The shared lesson:
  a guard's existence says nothing about its coverage, and only enumerating call
  sites does.
- `docs/solutions/logic-errors/idempotent-primitive-plus-unconditional-caller-rotated-a-live-credential-reuse-the-existing-verdict-2026-07-23.md`
  — the third in this family, and the one that named the pattern: two correct,
  well-tested functions composed wrongly, in a layer nothing tests. Same feature,
  same month, third occurrence.
- `docs/solutions/ui-bugs/server-action-rejection-no-try-finally-freezes-capture-modal-2026-07-20.md`
  — the failure mode that makes the retry path load-bearing in the first place.
- Plan: `docs/plans/2026-07-23-001-feat-fw-cohort-sprints-plan.md` (Unit 4,
  Decision 6).
