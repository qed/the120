-- First Profit funnel — dashboard-reconnect Unit 7 (plan 2026-07-29-001,
-- R13): the edit horizon. Once a child reaches applicant_state 'submitted'
-- or later, no funnel mutation may edit their pre-submission artifacts.
--
-- Version 20260823120000 chosen from the LIVE schema_migrations ledger
-- (top row 20260822120000_funnel_lifecycle_hardening, queried immediately
-- before authoring per supabase/MIGRATION-LOCK.md). Apply via the
-- Management API playbook (docs/solutions/integration-issues/
-- supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md).
--
-- WHY DB-LEVEL (the plan's Key Technical Decision): the lock predicate
-- lives on children.applicant_state, but project edit and regen write the
-- PROJECTS table, and PostgREST cannot express a cross-table conditional
-- update — a core-level check-then-write would be exactly the TOCTOU the
-- lock forbids. The door-confirm write on children carries its own
-- single-table conditional (WHERE applicant_state IN (...)) natively in
-- miniapp-core, so children need no new trigger — and the children trigger
-- stack (children_status_guard's coercing INSERT arm, the upsert/EXCLUDED
-- poisoning of 2026-07-14) stays untouched.
--
-- KEYED BY PREVIOUS-STATE CLASS, not enumerated target pairs (the
-- 2026-07-29 waitlist learning): the rule is "the owning child's CURRENT
-- state is at-or-past 'submitted'", expressed as an array_position
-- comparison against the ladder — so any future rung added past
-- 'submitted' is covered for free, and no list of forbidden writes is
-- maintained. The ladder array below is pinned to APPLICANT_STATES by
-- app/lib/__tests__/funnel-migration-parity.test.ts.
--
-- SCOPE: BEFORE UPDATE only. No INSERT arm — composeProjectCore's insert
-- is arbitrated by the one-active-per-child partial index, and a BEFORE
-- INSERT branch here would be the EXCLUDED-poisoning trap all over again
-- if any writer ever upserts. No DELETE arm — the only deletes are the
-- children FK cascade.
--
-- SERVICE-ROLE EXEMPTION (verified writers, 2026-07-29): the retention
-- cron (app/api/cron/funnel-retention/route.ts) runs as supabaseAdmin and
-- must purge/notice projects of submitted+ children; CRM reads projects
-- but never writes them. Same carve-out shape as
-- children_applicant_state_guard. NOTE the rehearsal trap: the Management
-- API runs as `postgres`, which is NOT exempt — set
-- request.jwt.claims '{"role":"service_role"}' inside a rolled-back DO
-- block to rehearse service paths.
--
-- ERROR CONTRACT (client-recognized): errcode 'P0120', message
-- 'funnel_edit_locked'. Mirrored by EDIT_LOCKED_ERRCODE /
-- EDIT_LOCKED_SIGNAL in app/lib/funnel/applicant-rules.ts; the funnel
-- cores map it to a distinct {kind:"locked"} result — never the generic
-- retry copy.

create or replace function public.projects_edit_horizon_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state text;
  v_order text[] := array['added','project_created','submitted','in_review','offered','waitlisted','deposited','enrolled'];
begin
  -- Staff/service writers (retention purge) keep full access.
  if auth.role() = 'service_role' then
    return NEW;
  end if;

  -- FOR SHARE closes the commit-window race: under READ COMMITTED a plain
  -- SELECT here could read the child's PRE-submission state while a children
  -- submit was in flight — a projects UPDATE racing that commit would then
  -- pass the check and land inside the window. FOR SHARE conflicts with the
  -- row lock the concurrent children UPDATE holds, so this read BLOCKS until
  -- the submit commits, then sees 'submitted' and refuses.
  select applicant_state into v_state
    from public.children
   where id = OLD.child_id
     for share;

  -- NULL = pre-funnel child (load-bearing back-compat): never locked here.
  -- A known state locks at-or-past 'submitted'; an unknown state (CHECK
  -- should make this impossible) fails CLOSED via coalesce to a high
  -- index — a mangled row must not reopen a submitted application.
  if v_state is not null
     and coalesce(array_position(v_order, v_state), 999)
         >= array_position(v_order, 'submitted') then
    raise exception 'funnel_edit_locked'
      using errcode = 'P0120',
            detail = 'child applicant_state is at or past submitted; pre-submission artifacts are read-only',
            hint = 'changes go through admissions@the120.school';
  end if;
  return NEW;
end;
$$;

drop trigger if exists projects_edit_horizon_guard on public.projects;
create trigger projects_edit_horizon_guard
  before update on public.projects
  for each row execute function public.projects_edit_horizon_guard();
