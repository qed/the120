-- First Profit funnel — Unit 10 (plan 2026-07-27-002): the two schema gaps
-- the U10 review pair confirmed by execution.
--
-- Lane B holds the migration lock (supabase/MIGRATION-LOCK.md — re-read
-- immediately before authoring, per the standing rule). Apply via the
-- Management API playbook (docs/solutions/integration-issues/
-- supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md).
--
-- 1. `projects` RLS POLICY. The U1 migration enabled RLS with zero policies
--    on the theory that "parents reach projects through server code, never
--    PostgREST" — but the funnel's server code IS PostgREST: supabaseServer()
--    is the anon key plus the parent's session cookies (role `authenticated`),
--    and the funnel cores are forbidden from supabaseAdmin by design. Under
--    RLS-with-no-policy every compose would burn the model call and then fail
--    the insert with 42501, and every re-entry read would see zero rows.
--    Parent-scoped policy mirroring "children: own children".
--
-- 2. `applicant_state` write guard. U10 makes the applicant ladder
--    load-bearing (compose advances added → project_created; later units gate
--    money on the higher rungs), but the FOR ALL policy on children lets a
--    parent session PATCH applicant_state to any CHECK-valid rung via crafted
--    REST — the same gap children_status_guard closed for `status`, closed
--    the same way: COERCE non-service-role changes back except the parent-
--    driven transitions (today exactly one: added → project_created).

-- ------------------------------------------------- projects: parent scope
drop policy if exists "projects: own children's projects" on public.projects;
create policy "projects: own children's projects" on public.projects
  for all
  using (
    child_id in (select id from public.children where parent_id = auth.uid())
  )
  with check (
    child_id in (select id from public.children where parent_id = auth.uid())
  );

-- --------------------------------------- applicant_state: one-way, coercing
create or replace function public.children_applicant_state_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return NEW;
  end if;
  if TG_OP = 'INSERT' then
    -- Parents create children at the ladder's entry rung (or off-ladder,
    -- for legacy dashboard paths that never set it). A crafted insert at
    -- 'deposited' would fabricate funnel progress.
    if NEW.applicant_state is not null
       and NEW.applicant_state is distinct from 'added' then
      NEW.applicant_state := 'added';
    end if;
    return NEW;
  end if;
  if NEW.applicant_state is distinct from OLD.applicant_state then
    -- The one transition parent-facing server code drives today. Later
    -- units extend this list as they add rungs; everything else keeps the
    -- DB's value and accepts the rest of the row (the coercion pattern —
    -- children_guard_hardening.sql — so a stale full-row upsert never
    -- rejects legitimate edits).
    if not (
      OLD.applicant_state = 'added'
      and NEW.applicant_state = 'project_created'
    ) then
      NEW.applicant_state := OLD.applicant_state;
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists children_applicant_state_guard on public.children;
create trigger children_applicant_state_guard
  before insert or update of applicant_state on public.children
  for each row execute function public.children_applicant_state_guard();
