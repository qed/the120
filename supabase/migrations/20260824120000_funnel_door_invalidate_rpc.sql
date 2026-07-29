-- First Profit funnel — dashboard-reconnect Unit 8 (plan 2026-07-29-001,
-- R6/R7): change the door AND retire the composed project in ONE
-- transaction, CAS-guarded, with the Unit-7 edit-horizon condition inside
-- it so this write path cannot bypass the lock.
--
-- Version 20260824120000 chosen from the LIVE schema_migrations ledger
-- (top row 20260823120000_funnel_edit_horizon, queried immediately before
-- authoring per supabase/MIGRATION-LOCK.md). Apply via the Management API
-- playbook (docs/solutions/integration-issues/
-- supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md).
--
-- WHY AN RPC (the plan's Key Technical Decision): client-side supabase-js
-- has no transactions, and the door write (children.group_slug) and the
-- project retirement (projects.status) must land or fail TOGETHER — a
-- sequential pair leaves a stale project under a changed door, or a
-- changed door under a live project, whenever the second write fails.
-- RPCs are the repo's cross-table-atomic pattern (provision_lease,
-- provision_reassign_local_part, deposit_refund_release).
--
-- SECURITY INVOKER, deliberately — unlike the service-role RPCs above.
-- The caller is the FAMILY session (supabaseServer: anon key + session
-- cookies, role `authenticated`), so RLS applies inside the function
-- body: the children UPDATE reaches only the family's own children and
-- the projects UPDATE only their children's projects ("projects: own
-- children's projects", 20260808120000). No ownership check is written
-- here because Postgres already answers it with zero rows.
--
-- THE CAS TOKEN is projects.ai_regeneration_count — the same column the
-- regen reservation CASes on (reserveRegeneration, compose-core). Chosen
-- over updated_at because (a) it is the established conflict arbiter for
-- this row, (b) it is an exact integer the client already holds (the
-- ProjectView), while a timestamptz echo loses precision crossing
-- PostgREST/JSON and would manufacture false conflicts, and (c) the race
-- the confirm dialog must catch is precisely a concurrent REGENERATION
-- (the plan's error path: second tab regenerates between dialog display
-- and accept). A concurrent family EDIT does not move the counter and is
-- deliberately not a conflict: the dialog authorizes retiring the project
-- IDENTITY (id, named to the parent), not a byte-exact body, and an edit
-- in another tab is the same project still being retired.
--
-- VERDICTS (the discriminated return the core maps):
--   'changed'  — both writes landed; the transaction commits.
--   'locked'   — the children UPDATE matched zero rows: the child left
--                the pre-submission class (edit horizon, reconnect U7).
--                The caller loaded the child through RLS immediately
--                before calling, so zero rows here is the state
--                condition, not visibility. Returned, not raised — no
--                write happened, so there is nothing to roll back.
--   conflict   — RAISED (errcode P0121, message
--                'funnel_door_change_conflict') when the expected project
--                row is not (active, this child's, at the echoed regen
--                count). Raised rather than returned so the ALREADY-DONE
--                children write rolls back with it — the atomicity the
--                whole function exists for. Mirrored by
--                DOOR_CHANGE_CONFLICT_SIGNAL / DOOR_CHANGE_CONFLICT_ERRCODE
--                in app/lib/funnel/applicant-rules.ts.
--
-- LOCK ORDER (the P1 deadlock fix, 2026-07-29): every OTHER writer of a
-- projects row is a single-statement UPDATE that (1) takes the projects
-- row lock, then (2) fires projects_edit_horizon_guard, whose FOR SHARE
-- read locks the owning children row (docs/solutions/database-issues/
-- a-cross-table-trigger-guard-must-lock-the-row-it-reads-for-share-
-- 2026-07-29.md). This function's original order — children UPDATE first,
-- then projects UPDATE — was the AB/BA inverse of that, so a door change
-- racing any concurrent projects writer (regen reserve, draft save, edit
-- save) could deadlock: each holds the other's first lock. The fix is to
-- take the SAME first lock as everyone else — an explicit FOR UPDATE on
-- the expected project row BEFORE touching children — so all writers
-- acquire projects-then-children and the cycle cannot form.
--
-- DEFENSE IN DEPTH: the projects UPDATE fires projects_edit_horizon_guard
-- (20260823120000, BEFORE UPDATE, FOR SHARE read of children). For the
-- legal cohort — a child the children UPDATE just matched in
-- ('added','project_created'), whose row THIS transaction now holds a
-- lock on, so no concurrent submit can slip between the two statements —
-- the guard passes. If it ever raises (P0120), the transaction rolls back
-- whole and the core maps it to the same locked verdict: two independent
-- mechanisms, either alone sufficient.
--
-- 'abandoned' (not 'paused') is the retirement status: projects_status_check
-- vocabulary is active|paused|abandoned, and a project retired under a door
-- change is permanently superseded — the child re-composes a NEW row behind
-- the new door (fresh ai_regeneration_count = 0 by column default, which is
-- the regen-allowance reset, structural rather than hand-rolled). Freeing
-- the projects_one_active_per_child slot is what makes that re-compose
-- insert possible.
--
-- The NO-project door change never calls this function: it keeps the plain
-- conditional children write (miniapp-core writeGroup) — one table, no
-- transaction needed.
--
-- Idempotent: CREATE OR REPLACE + re-runnable GRANT/REVOKE.
-- Emergency rollback (this repo carries no down migrations):
--   drop function if exists public.change_door_and_invalidate_project(uuid, text, uuid, integer);

create or replace function public.change_door_and_invalidate_project(
  p_child_id uuid,
  p_new_slug text,
  p_expected_project_id uuid,
  p_expected_regen_count integer
) returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_rows integer;
begin
  -- (0) LOCK ORDERING: take the project-row lock FIRST — the same first
  -- lock every single-statement projects writer takes before its U7
  -- trigger FOR-SHAREs the children row (see the LOCK ORDER header note
  -- and docs/solutions/database-issues/a-cross-table-trigger-guard-must-
  -- lock-the-row-it-reads-for-share-2026-07-29.md). Matching zero rows
  -- here is FINE and deliberate: this statement only orders the locks;
  -- the CAS'd UPDATE below remains the sole authority that raises the
  -- conflict. RLS applies inside the subquery (SECURITY INVOKER), so a
  -- foreign project row locks nothing.
  if p_expected_project_id is not null then
    perform id
       from public.projects
      where id = p_expected_project_id
        and child_id = p_child_id
        for update;
  end if;

  -- (a) The door write, with the Unit-7 edit-horizon condition EMBEDDED —
  -- the same allow-set as miniapp-core's writeGroup, so this path cannot
  -- bypass the lock. NULL applicant_state is deliberately absent: a
  -- pre-funnel child has no funnel door to change (refused earlier by the
  -- core; the row condition is the guarantee).
  update public.children
     set group_slug = p_new_slug
   where id = p_child_id
     and applicant_state in ('added','project_created');
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return 'locked';
  end if;

  -- (b) Retire the expected active project — CAS on ai_regeneration_count,
  -- scoped to this child and to 'active' (the one-active partial index's
  -- predicate). Fires projects_edit_horizon_guard (defense in depth, see
  -- header). Zero rows = the snapshot the dialog authorized is stale
  -- (regenerated, already retired, or never this child's) — RAISE so the
  -- children write above rolls back with it: no half-applied change.
  update public.projects
     set status = 'abandoned',
         updated_at = now()
   where id = p_expected_project_id
     and child_id = p_child_id
     and status = 'active'
     and ai_regeneration_count = p_expected_regen_count;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'funnel_door_change_conflict'
      using errcode = 'P0121',
            detail = 'the expected active project was not found at the echoed version; the snapshot the confirm dialog authorized is stale',
            hint = 'refresh to load the current project, then confirm again';
  end if;

  return 'changed';
end;
$$;

-- The family session is the ONLY caller. Default function privileges grant
-- EXECUTE broadly; narrow to authenticated (SECURITY INVOKER + RLS would
-- make an anon call a zero-row no-op anyway — belt and brace).
revoke execute on function public.change_door_and_invalidate_project(uuid, text, uuid, integer) from public, anon;
grant execute on function public.change_door_and_invalidate_project(uuid, text, uuid, integer) to authenticated;
