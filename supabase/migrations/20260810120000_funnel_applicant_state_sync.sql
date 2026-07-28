-- First Profit funnel — Unit 13 (plan 2026-07-27-002, R49a/F5): the offer
-- bridge, for real. Both U13 reviewers converged on the same critical: no
-- code path anywhere advances `applicant_state` past 'project_created' —
-- move_candidate writes children.status only, so a staff offer left every
-- funnel child's checkout refused server-side (canReserveSeatForChild
-- requires applicant_state offered-or-later) while the offer email pointed
-- the family at the dashboard's Reserve button.
--
-- Lane B holds the migration lock (re-read immediately before authoring).
-- Apply via the Management API playbook.
--
-- The fix lives at the DB layer so EVERY path bridges: the staff RPC
-- (service role), the family submit (authenticated status flip), and any
-- future writer. When a FUNNEL child's status moves, applicant_state
-- derives from it — forward-only, per the applicant ladder. Pre-funnel
-- children (applicant_state IS NULL) are untouched: their NULL is the
-- back-compat contract the checkout predicate already honours.
--
-- Trigger interplay (deliberate):
-- - children_applicant_state_guard fires on UPDATE OF applicant_state and
--   coerces non-service-role writes. This trigger fires on UPDATE OF
--   status; an update touching only status never enters the guard, so the
--   sync applies for both roles.
-- - children_status_guard already constrains WHO can move status (parents:
--   draft → submitted only). Deriving from status therefore inherits its
--   protections — a parent cannot forge 'offered' through this trigger
--   because they cannot write status='offered' in the first place.

create or replace function public.children_applicant_state_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mapped text;
  v_order text[] := array['added','project_created','submitted','in_review','offered','waitlisted','deposited','enrolled'];
  v_old_idx int;
  v_new_idx int;
begin
  -- Funnel children only; the NULL of pre-funnel children is load-bearing.
  if NEW.applicant_state is null then
    return NEW;
  end if;
  if NEW.status is not distinct from OLD.status then
    return NEW;
  end if;

  v_mapped := case NEW.status
    when 'submitted' then 'submitted'
    when 'in_review' then 'in_review'
    when 'invited'   then 'in_review'  -- assessment invite is still pre-offer
    when 'offered'   then 'offered'
    when 'member'    then 'enrolled'
    else null                          -- draft (or unknown): no derivation
  end;
  if v_mapped is null then
    return NEW;
  end if;

  -- Forward-only: the ladder never walks backwards off a status echo.
  v_old_idx := coalesce(array_position(v_order, NEW.applicant_state), 0);
  v_new_idx := coalesce(array_position(v_order, v_mapped), 0);
  if v_new_idx > v_old_idx then
    NEW.applicant_state := v_mapped;
  end if;
  return NEW;
end;
$$;

drop trigger if exists children_applicant_state_sync on public.children;
create trigger children_applicant_state_sync
  before update of status on public.children
  for each row execute function public.children_applicant_state_sync();

-- Backfill: funnel children whose status ran ahead while the bridge was
-- missing (idempotent; forward-only by the same mapping).
update public.children
set applicant_state = case status
  when 'submitted' then 'submitted'
  when 'in_review' then 'in_review'
  when 'invited'   then 'in_review'
  when 'offered'   then 'offered'
  when 'member'    then 'enrolled'
end
where applicant_state is not null
  and status in ('submitted', 'in_review', 'invited', 'offered', 'member')
  and coalesce(array_position(
        array['added','project_created','submitted','in_review','offered','waitlisted','deposited','enrolled'],
        applicant_state), 0)
    < coalesce(array_position(
        array['added','project_created','submitted','in_review','offered','waitlisted','deposited','enrolled'],
        case status
          when 'submitted' then 'submitted'
          when 'in_review' then 'in_review'
          when 'invited'   then 'in_review'
          when 'offered'   then 'offered'
          when 'member'    then 'enrolled'
        end), 0);
