-- Funnel wrap W7/W7a: the staff waitlist move.
--
-- ⚠ VERSION: verify against the LIVE list immediately before applying —
--   select version, name from supabase_migrations.schema_migrations
--   order by version desc limit 5;
-- The repo's file listing is not the truth in a two-lane repo (three
-- collisions logged in supabase/MIGRATION-LOCK.md). If 20260815120000 is
-- taken, rename this file to the next free slot before applying. Lane B
-- (funnel) holds the lock, so no transfer is needed.
--
-- What this adds:
--   1. `waitlisted` joins the child_reviews.review_status CHECK.
--   2. move_candidate() accepts it, AND — the load-bearing part — writes
--      children.applicant_state EXPLICITLY whenever the move starts from
--      or lands on `waitlisted`.
--
-- Why the explicit write. children_applicant_state_sync derives
-- applicant_state from status on UPDATE OF status, forward-only along
--   added → project_created → submitted → in_review → offered →
--   waitlisted → deposited → enrolled
-- `waitlisted` sits ABOVE `offered` in that order, so every move OFF the
-- waitlist is a backwards walk the trigger declines — leaving
-- children.status='offered' with applicant_state stuck at 'waitlisted',
-- which strands the family on the waitlist wall with checkout refused
-- (the U13 divergence class, exactly what W7a warns about).
--
-- The rule is keyed by PREVIOUS state, not by target pairs: any move whose
-- previous state is `waitlisted` gets the explicit write, including the
-- ordinary-menu `invited` that a target-pair rule would have missed.
--
-- Both columns are set in ONE update statement. The sync trigger fires
-- BEFORE UPDATE OF status and takes its forward-only baseline from
-- NEW.applicant_state — i.e. the value just written — so it can only ever
-- agree with the explicit value: `waitlisted` has no CASE arm (early
-- return), and a backwards target compares equal-index and declines.
-- Splitting this into two statements would move the invariant onto a
-- different trigger's service-role carve-out, so a scan test pins that the
-- function contains no separate applicant_state update.
--
-- The explicit write is conditional on applicant_state IS NOT NULL: NULL
-- means a pre-funnel child (the 20260805120000 contract), and waitlisting
-- one must not silently enrol it onto the funnel ladder.
--
-- The signature is UNCHANGED. Adding a parameter would mint a PostgREST
-- overload and every already-deployed caller would start getting 300s.

begin;

-- 1. Widen the CHECK. Drop by name, idempotently (a bare DROP fails on
--    re-run, and the lock file requires every statement be re-runnable).
--    Widening only: old deployed code never sends `waitlisted`, and the new
--    set is a strict superset, so this is safe to apply before the deploy.
--    Verified before authoring: select distinct review_status from
--    public.child_reviews returns no value outside the new list.
alter table public.child_reviews
  drop constraint if exists child_reviews_review_status_check;

alter table public.child_reviews
  add constraint child_reviews_review_status_check
  check (review_status in (
    'draft', 'submitted', 'in_review', 'invited', 'offered', 'member', 'waitlisted'
  ));

-- 2. move_candidate: accept `waitlisted`, and keep applicant_state honest
--    across the waitlist boundary.
create or replace function public.move_candidate(
  p_child_id uuid,
  p_review_status text,
  p_group text,
  p_note text,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_status text;
  v_family_id uuid;
  v_prev_applicant_state text;
  v_target_applicant_state text;
begin
  if p_review_status not in (
    'draft', 'submitted', 'in_review', 'invited', 'offered', 'member', 'waitlisted'
  ) then
    raise exception 'invalid review_status: %', p_review_status;
  end if;

  select review_status into v_prev_status
  from public.child_reviews
  where child_id = p_child_id;

  insert into public.child_reviews (child_id, review_status, group_assignment, reviewed_by)
  values (p_child_id, p_review_status, p_group, p_actor)
  on conflict (child_id) do update set
    review_status = excluded.review_status,
    group_assignment = coalesce(excluded.group_assignment, child_reviews.group_assignment),
    reviewed_by = excluded.reviewed_by,
    updated_at = now();

  -- W7: read the applicant_state BEFORE the write, so the previous-state
  -- rule can be evaluated. NULL = pre-funnel child; never touched.
  select applicant_state into v_prev_applicant_state
  from public.children
  where id = p_child_id;

  if v_prev_applicant_state is not null
     and (p_review_status = 'waitlisted' or v_prev_applicant_state = 'waitlisted')
  then
    v_target_applicant_state := case p_review_status
      when 'waitlisted' then 'waitlisted'
      when 'member'     then 'enrolled'
      when 'offered'    then 'offered'
      when 'invited'    then 'in_review'
      when 'in_review'  then 'in_review'
      when 'submitted'  then 'submitted'
      else null
    end;
  end if;

  -- Parent-dashboard stepper sync (the BEFORE UPDATE OF status guard lets
  -- service_role through; this RPC is callable by service_role only).
  -- ONE statement: see the header note on the sync trigger's NEW baseline.
  update public.children
  set status = p_review_status,
      applicant_state = coalesce(v_target_applicant_state, applicant_state),
      updated_at = now()
  where id = p_child_id;
  if not found then
    raise exception 'child % not found', p_child_id;
  end if;

  -- Family via child → parent → live family.
  select f.id into v_family_id
  from public.children c
  join public.families f
    on f.parent_id = c.parent_id
   and f.merged_into_id is null
  where c.id = p_child_id
  limit 1;

  if p_review_status = 'member' and v_family_id is not null then
    insert into public.family_stage_history (family_id, from_stage, to_stage, actor, note)
    values (v_family_id, null, 'member', p_actor, p_note);
  end if;

  insert into public.crm_audit_log (actor, action, family_id, child_id, metadata)
  values (p_actor, 'review-move', v_family_id, p_child_id,
    jsonb_build_object(
      'review_status', p_review_status,
      'previous_review_status', v_prev_status,
      'group_assignment', p_group,
      'note', p_note,
      'applicant_state_forced', v_target_applicant_state
    ));
end;
$$;

revoke all on function public.move_candidate(uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.move_candidate(uuid, text, text, text, uuid) to service_role;

commit;
