---
title: "A BEFORE-ROW trigger fires before RLS WITH CHECK: gate on ownership first, and define role exemptions by threat model (JWT-less is not a client)"
module: fp-game
date: 2026-08-03
problem_type: security_issue
component: database
severity: high
symptoms:
  - "A BEFORE INSERT trigger keyed on a client-supplied column (NEW.profile_id) raises distinguishable errors (cap-reached vs FK-shape) for profiles the caller does not own, before RLS ever refuses the row"
  - "An authenticated child probing another profile's UUID can learn whether it exists and whether it hit today's cap - a cross-tenant existence/activity oracle"
  - "A CASCADE delete from fp_player_profiles aborts with 'is append-only' when the profile delete runs from a JWT-less session (dashboard SQL editor, maintenance script)"
root_cause: missing_permission
resolution_type: migration
tags: [rls, trigger, with-check, oracle, enumeration, service-role, cascade, append-only, postgrest, fp-task-feedback]
---

# A BEFORE-ROW trigger fires before RLS WITH CHECK — gate on ownership first, and exempt JWT-less sessions by threat model

## Problem

The `fp_task_feedback` daily-cap trigger (review of `feat/fp-task-feedback`,
commits a74c7ec → 0bc2c49) had two blind spots that survived an otherwise
careful RLS design:

1. **The oracle**: `fp_task_feedback_daily_cap_guard()` is a BEFORE INSERT
   trigger that looks up and counts rows keyed by `NEW.profile_id`. Postgres
   evaluates BEFORE-ROW triggers **before** the RLS `WITH CHECK` on the final
   row. The trigger therefore ran its lookup/count against ANY profile id the
   client supplied — and its distinguishable outcomes (cap-reached exception
   vs fall-through to the FK error) leaked whether a foreign profile exists
   and whether it is capped today, to a caller RLS would have refused anyway.
2. **The over-narrow exemption**: the companion append-only guard allowed only
   `auth.role() = 'service_role'`. A CASCADE delete of feedback rows (fired by
   deleting the parent `fp_player_profiles` row) runs the per-row BEFORE
   DELETE trigger in the *deleting session's* context — and a dashboard SQL
   session, a maintenance script as `postgres`, or an Admin-API-triggered
   cascade carries **no PostgREST JWT at all**, so `auth.role()` is not
   `service_role` and the guard aborts the whole profile deletion (a
   COPPA-relevant flow).

## Symptoms

- Probing inserts with a victim `profile_id` return "daily feedback cap
  reached" or an FK error instead of the uniform RLS denial — response shape
  varies with someone else's private state.
- `delete from fp_player_profiles where id = ...` in the SQL editor fails with
  `fp_task_feedback is append-only` even though the FK is ON DELETE CASCADE.

## What Didn't Work

- Relying on the RLS `WITH CHECK` alone: it is airtight for the WRITE, but it
  runs after the trigger — trigger side effects (errors, timing) are outside
  its protection.
- Copying the `service_role`-only exemption from sibling guards: those tables
  (fp_ledger, fp_player_saves) are ON DELETE RESTRICT, so their delete path is
  always an explicit, known-service-role call; CASCADE changed the execution
  context without anyone choosing it.

## Solution

In the trigger, gate on ownership FIRST and stand aside silently — let RLS
produce the one uniform denial:

```sql
-- OWNERSHIP GATE (fires before RLS WITH CHECK — see header):
if auth.role() <> 'service_role'
   and NEW.profile_id not in (select id from public.fp_player_profiles
                               where user_id = (select auth.uid())) then
  return NEW;  -- silent: the RLS WITH CHECK emits the only signal
end if;
```

Define guard exemptions by THREAT MODEL, not by role list. The append-only
guard exists to stop PostgREST *clients*; a JWT-less session is by definition
not one:

```sql
if auth.role() = 'service_role'
   or current_setting('request.jwt.claims', true) is null
   or current_setting('request.jwt.claims', true) = '' then
  return OLD;  -- service role and JWT-less (dashboard/maintenance/cascade) pass
end if;
raise exception 'fp_task_feedback is append-only';
```

Both fixes are pinned by the migration-parity test (ownership-gate presence,
JWT-less clauses, and lock-before-count ordering inside the extracted function
body).

## Why This Works

RLS policies constrain rows; they do not constrain what a trigger DOES while
deciding. Any privileged read a BEFORE-ROW trigger performs against
client-supplied keys happens in a window RLS never sees, so the trigger must
apply the same ownership predicate as the policy — and must fail
*indistinguishably* (stand aside, don't raise) so no new response shape exists.
And a guard's allow-list is a statement of threat model: `service_role` names a
caller, but the actual boundary is "PostgREST client vs not" — the JWT's
absence is the reliable marker for "not".

## Prevention

- When authoring any BEFORE-ROW trigger on a client-writable table that reads
  state keyed by a client-supplied column, add the ownership gate first and
  return silently on non-ownership. Test: a cross-tenant insert attempt must
  produce byte-identical refusals whether the foreign profile exists, is
  capped, or neither.
- When a guard exempts `service_role`, ask: which legitimate sessions carry NO
  JWT? Dashboard SQL, `postgres` maintenance, and CASCADEs triggered by either.
  If the guard's threat is PostgREST clients, exempt JWT-less sessions
  explicitly.
- ON DELETE CASCADE changes *who runs* row triggers: cascaded rows fire in the
  deleting session's context. Re-audit every trigger on the child table when
  switching RESTRICT → CASCADE.
- Related: [[a-cross-table-trigger-guard-must-lock-the-row-it-reads-for-share-2026-07-29]]
  (the locking half of trigger-guard discipline — note its "service_role
  exemption stays unchanged" assumption predates this learning),
  [[rls-with-check-pins-values-not-columns-column-scope-the-grant-to-protect-created-at-2026-07-31]]
  (the grant half), and the enumeration-oracle family
  ([[re-audit-an-accepted-enumeration-side-channel-when-the-login-identifier-becomes-a-unique-credential-2026-08-01]]).
