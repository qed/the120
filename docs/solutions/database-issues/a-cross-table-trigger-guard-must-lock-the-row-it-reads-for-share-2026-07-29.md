---
title: A cross-table trigger guard must lock the row it reads — a plain SELECT races the commit window
date: 2026-07-29
category: database-issues
module: funnel-edit-horizon
problem_type: database_issue
symptoms:
  - A projects edit issued while a children submit is in flight lands successfully even though the child commits as submitted
  - The guard "works" in every sequential test and rehearsal but has a timing window under concurrent requests
root_cause: async_timing
resolution_type: migration
severity: high
related_components:
  - database
tags: [trigger, for-share, read-committed, toctou, cross-table, edit-lock, supabase]
---

# A cross-table trigger guard must lock the row it reads — a plain SELECT races the commit window

## Problem

The edit-horizon guard (`projects_edit_horizon_guard`, migration `20260823120000`) is a BEFORE UPDATE trigger on `projects` that reads the owning child's `applicant_state` from `children` to decide whether the edit is allowed. With a plain `SELECT`, the guard is correct sequentially but racy concurrently.

## Symptoms

- Under READ COMMITTED (the Supabase default), the trigger's `SELECT` sees only transactions committed *before it starts*. A projects UPDATE racing an in-flight children submit reads the pre-submission state, allows the write, and both commit — a project edit lands "inside" the submission.
- Same-table conditional writes don't have this problem: the door-confirm path's `.update(...).in("applicant_state", [...])` evaluates its predicate against the current row version atomically. The asymmetry is easy to miss — the technique that makes single-table guards airtight is structurally unavailable to a cross-table trigger.

## What Didn't Work

- Assuming the class-derived state check ("at-or-past submitted by ladder position") closed the TOCTOU. It closes the *enumeration* hole, not the *timing* hole — the read itself was still unordered relative to the concurrent state write.
- Relying on rehearsals: a rolled-back DO block exercises the logic sequentially; it cannot produce the commit-window interleaving.

## Solution

Lock the row the guard reads:

```sql
select applicant_state into v_state
  from public.children
 where id = OLD.child_id
   for share;
```

`FOR SHARE` conflicts with the row lock a concurrent `children` UPDATE holds, so the trigger's read blocks until the in-flight submit commits — then sees `submitted` and refuses. (`FOR KEY SHARE` would NOT work: it only conflicts with key-column updates, and `applicant_state` is not a key column.)

Because `CREATE OR REPLACE FUNCTION` is idempotent, an already-applied trigger function can be amended and re-applied through the Management API **without inserting a second ledger row** — execute only the function-replacement SQL and read back `pg_get_functiondef` to confirm.

## Why This Works

The race is two writers with no ordering: the state write (children) and the guarded write (projects) in separate transactions. `FOR SHARE` imposes the ordering at exactly the granularity needed — the guard's read serializes against writes to the one row whose value it is about to trust. Everything else (class keying, fail-closed unknown states, service_role exemption) stays unchanged. (2026-08-03 note: the service_role-only exemption assumption was later revised - a guard whose threat is PostgREST clients must also exempt JWT-less sessions, and a guard reading client-keyed state must gate on ownership BEFORE its lookup since BEFORE-ROW triggers fire ahead of RLS WITH CHECK; see [[before-row-trigger-fires-before-rls-with-check-gate-on-ownership-and-exempt-jwt-less-sessions-2026-08-03]].)

## Prevention

- Whenever a trigger (or any guard) reads a *different table's* row to authorize a write, ask what happens if that row is mid-update in another transaction. If the answer matters, lock the read (`FOR SHARE`), or restructure so the predicate and the write target share a row.
- `FOR KEY SHARE` vs `FOR SHARE`: match the lock to the column being trusted — non-key columns need `FOR SHARE`.
- **The trigger silently defines a canonical lock order for everyone else.** Every single-statement `projects` UPDATE now acquires projects→children (its own row lock, then the trigger's `FOR SHARE`). Any multi-statement transaction touching both tables MUST take the same order — the U8 door-change RPC originally locked children→projects and was a textbook AB/BA deadlock with a concurrent regen (caught in review; fixed with a leading `SELECT … FOR UPDATE` on the projects row, plus 40P01 mapped to a retryable conflict as belt and braces).
- Keep an emergency rollback snippet with any live guard (this repo carries no down migrations):
  ```sql
  drop trigger if exists projects_edit_horizon_guard on public.projects;
  drop function if exists public.projects_edit_horizon_guard();
  ```
- UI corollary from the same unit: when a lock is discovered mid-session, affordances that normally "save then navigate" must **navigate without writing** — retrying a write the guard will always refuse strands the user (see `keepProject` in `app/start/child/[childId]/MiniAppShell.tsx`).

## Related Issues

- `docs/solutions/logic-errors/key-a-state-machine-exception-by-previous-state-not-by-the-target-pairs-you-enumerated-2026-07-29.md` — the enumeration half of guarding this state machine; this doc is the timing half.
- `docs/solutions/database-issues/upsert-insert-arm-poisons-excluded-status-guard-coercion-submit-fails-2026-07-14.md` — why the guard deliberately has no INSERT arm (the insert path is guarded server-side in `composeProjectCore` instead).
- `docs/solutions/security-issues/rls-enabled-zero-policies-but-the-server-code-is-postgrest-anon-key-2026-07-28.md` — RLS scopes *who*; it took this trigger to scope *when* (the family session could previously edit projects post-submission).
