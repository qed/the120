---
title: "An idempotency key whose UNIQUENESS SCOPE is wider than the operation it names silently swallows distinct writes — and reports them as successful replays"
date: 2026-07-23
category: docs/solutions/logic-errors
module: path / First Profit (FW) check-in write path — fw_move_task
problem_type: logic_error
component: database
symptoms:
  - "Two students in one batch check-in shared a client_id; the second student's tap returned `replayed` and was never recorded"
  - "`replayed` is a success-shaped outcome, so the guide was told the tap had already been captured — no error, no retry prompt"
  - "Under concurrency the same collision moved a progress row to `verified` while ON CONFLICT DO NOTHING silently dropped its event, leaving a state change with no audit row"
  - "The column's own schema comment said 'the EXACTLY-ONCE key, per (student, task, tap)' while the unique index was on (client_id) alone"
  - "Every test passed: the suite only ever replayed one client_id against the SAME (student, task)"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags:
  - idempotency
  - exactly-once
  - partial-unique-index
  - on-conflict
  - dedupe-key
  - append-only-audit
  - postgres
  - code-review
  - the-path
---

# An idempotency key scoped wider than the operation it names

## Problem

Founders Weekend check-ins are exactly-once: the offline queue mints a
`client_id` per tap, and a replayed drain must be a no-op rather than a second
event. Unit 1 shipped the column with this comment:

```sql
-- client_id is the EXACTLY-ONCE key, per (student, task, tap).
alter table public.path_task_events add column if not exists client_id text;

create unique index if not exists path_task_events_client_id_key
  on public.path_task_events (client_id)
  where client_id is not null;
```

Read those two statements together. The comment defines the key as identifying a
**(student, task, tap)** triple. The index enforces uniqueness over **`client_id`
alone** — globally, across every student and every task in a shared events table.

Unit 3's RPC then probed with the same global scope:

```sql
if p_client_id is not null and exists (
  select 1 from public.path_task_events e where e.client_id = p_client_id
) then
  return query select 'replayed'::text, v_from, v_author;
  return;
end if;
```

Nothing enforced that two students' `client_id` values differ. The values are
caller-supplied (`clientIds: z.record(z.uuid(), z.string())`), and two future
units — a CSV importer and an offline drain engine — were each going to mint them
under their own scheme.

## Symptoms

1. **Sequential loss.** A batch where two different students carry the same
   `client_id`: student 1's event commits with that value; student 2's call
   matches student 1's event on the global probe and returns `replayed`. Student
   2's check-in never happens. Because `replayed` is a *legitimate success
   shape*, the guide is told the tap was already recorded — no error surfaces.
2. **Concurrent state/event split.** Two colliding calls for *different* rows
   race. They lock different rows so they never block each other; both pass the
   probe before either commits; both UPDATEs apply. Then the loser's
   `on conflict (client_id) … do nothing` silently drops **its own event**. A
   progress row is now `verified` with no event recording who decided it — in an
   append-only log whose entire purpose is that guarantee.
3. **Green tests.** The suite replayed one `client_id` against the same
   `(student, task)` and asserted `replayed`. That is the case the global scope
   gets right.

## What Didn't Work

**Reasoning from the comment instead of the constraint.** Every reader — the
schema author, the RPC author, three reviewers — read "per (student, task, tap)"
and carried that model forward. The comment was a *specification*; the index was
the *implementation*; nobody diffed them. The RPC's probe was then written to
match the index, so the two halves of the mechanism agreed with each other and
disagreed only with the documentation.

**Adding a TypeScript duplicate-value check.** A first draft rejected batches
whose `clientIds` record contained duplicate values. That guards one caller
(a Server Action) against one shape of the bug, while leaving the importer, the
drain engine, and any future caller exposed — and it treats a collision as
illegal when, under a correctly-scoped key, a collision is simply *harmless*.
Guarding the caller was solving the symptom at the wrong layer.

## Solution

Make the constraint say what the comment always claimed. Scope the uniqueness —
and every read of it — to the operation the key identifies:

```sql
-- Create the replacement BEFORE dropping the old one, so no window exists
-- without a uniqueness guard at all.
create unique index if not exists path_task_events_student_task_client_id_key
  on public.path_task_events (student_id, task_id, client_id)
  where client_id is not null;

drop index if exists public.path_task_events_client_id_key;
```

```sql
-- the probe, rescoped
if p_client_id is not null and exists (
  select 1 from public.path_task_events e
    where e.student_id = p_student_id
      and e.task_id    = p_task_id
      and e.client_id  = p_client_id
) then
  return query select 'replayed'::text, v_from, v_author;
  return;
end if;

-- …and both ON CONFLICT targets follow the new index
on conflict (student_id, task_id, client_id) where client_id is not null do nothing;
```

The index swap is **strictly weakening** — every set unique under `(client_id)`
is also unique under `(student_id, task_id, client_id)` — so it cannot fail on
existing data, which is what makes it safe to apply to a live table.

Proven against production in a self-rolling-back `DO` block:

| scenario | before | after |
|---|---|---|
| student1, `cid=shared` | applied | applied |
| student2, **same** cid | `replayed` — **lost** | **applied** |
| student1, different task, same cid | `replayed` — **lost** | **applied** |
| student1, same task, same cid (real replay) | `replayed` | `replayed` |

…plus the invariant that closes the concurrent variant: every `verified` row has
a corresponding event.

## Why This Works

Scoping the key to `(student_id, task_id, client_id)` does not merely *reject*
the collision — it makes the collision **meaningless**. Two students sharing a
value now occupy different index entries, so there is nothing to detect and
nothing to refuse. That is why the TypeScript duplicate-check became unnecessary
and was removed: with the key scoped correctly, it would guard nothing.

The concurrent state/event split disappears for the same reason. That failure
needed two writes to *different rows* to collide on the *same key*; once the key
includes the row's identity, two different rows can never collide.

## Prevention

- **A dedupe key's unique index must be scoped to exactly the tuple its name and
  documentation claim.** If the comment says "per (X, Y, tap)", the index is
  `unique (X, Y, key)` — not `unique (key)`. Read the comment and the constraint
  *as a diff*, not as reinforcement. A key scoped WIDER than its operation does
  not merely over-reject; it silently swallows legitimately distinct work and,
  because dedupe outcomes are success-shaped, reports that as normal.
- **Ask "what happens when two different operations present the same key?"**
  For a correctly scoped key the answer is "nothing, they are different rows."
  If the answer is "one of them is discarded," the scope is wrong. This question
  takes ten seconds and is not answered by any test that replays a single key
  against a single operation.
- **Test the cross-entity collision, not just the same-entity replay.** The
  natural test — "replay the same client_id for the same student and task, expect
  a no-op" — passes under both the correct and incorrect scope. The test that
  distinguishes them is two *different* students sharing one value.
- **`ON CONFLICT … DO NOTHING` after a state change is a silent-loss primitive.**
  Whenever an INSERT that records *what just happened* can be swallowed by a
  conflict while the state change it records has already committed, the pair is
  only safe if the conflict target can never fire for a genuinely new operation.
  Check that property explicitly.
- **When a caller-side guard is the proposed fix for a constraint-side bug,
  suspect the layer.** If the constraint were right, would the guard exist? If
  not, fix the constraint.

## Related

- `docs/solutions/best-practices/webhook-idempotency-record-dedupe-key-after-idempotent-effect-and-scope-cancels-by-provenance-2026-07-17.md`
  — the sibling concern: dedupe key *ordering* (record after the effect) and
  provenance scoping. This doc is about the key's *uniqueness scope*; together
  they cover both axes of getting a dedupe key wrong.
- `docs/solutions/best-practices/no-transaction-multi-step-write-compensation-post-write-verify-cas-scoped-claim-2026-07-22.md`
  — the CAS-scoped-claim discipline the RPC's row lock follows.
- `docs/solutions/logic-errors/idempotent-primitive-plus-unconditional-caller-rotated-a-live-credential-reuse-the-existing-verdict-2026-07-23.md`
  — same feature, same week, same shape of lesson one layer up: an idempotent
  primitive composed with a caller that did not branch on *how* it succeeded.
- `docs/solutions/test-failures/migration-parity-assertions-that-cannot-fail-clause-scope-and-comment-stripping-2026-07-23.md`
  — found in the same review; the parity test that was supposed to pin this SQL
  had assertions that could not fail.
- Migrations: `20260728120000_fw_cohort_sprints.sql` (the original global index),
  `20260731120000_fw_client_id_scoped.sql` (the fix).
  Plan: `docs/plans/2026-07-23-001-feat-fw-cohort-sprints-plan.md` (Unit 3).
