-- Funnel wrap, W7 follow-up: close the `draft` gap in move_candidate.
--
-- ⚠ VERSION: verify against the LIVE list immediately before applying —
--   select version, name from supabase_migrations.schema_migrations
--   order by version desc limit 5;
--
-- THE BUG (found by a backfilled review of the merged unit; no family was
-- affected, production held zero waitlisted rows at the time).
--
-- The explicit-write CASE had arms for waitlisted/member/offered/invited/
-- in_review/submitted — and none for `draft`. `draft` is a member of
-- REVIEW_STATUSES and `moveCandidateSchema` is `z.enum(REVIEW_STATUSES)`,
-- so the server action accepts it; only the StatusMenu's MOVE_STAGES list
-- omits it, and that is client-side decoration, not a constraint.
--
-- So: move a waitlisted child to `draft` and the CASE fell through to
-- `else null`, `coalesce(null, applicant_state)` kept the stale
-- `waitlisted`, and children.status became `draft`. The forward-only
-- ladder then declines every later advance (submitted=2 is below
-- waitlisted=5), so the family is routed to the waitlist wall forever
-- while checkout answers "submit the dossier first". That is precisely
-- the divergence class the original migration was written to end — it
-- just closed the doors it enumerated and left one open.
--
-- THE FIX, and why `project_created` rather than null or a no-op:
-- `draft` means the application is open for editing again, so the state
-- must sit BELOW `submitted` for the ladder to work on resubmit. NULL is
-- wrong — it means "not a funnel applicant at all" (the 20260805120000
-- contract) and would quietly drop a funnel child off the ladder.
-- `project_created` is the truthful rung: the child exists and has a
-- project, but nothing is submitted.
--
-- The lesson is recorded in docs/solutions/logic-errors/
-- key-a-state-machine-exception-by-previous-state-... : an exception
-- keyed by ORIGIN still has to answer for every possible TARGET.

begin;

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
      -- Re-opened for editing: must sit BELOW submitted or the ladder
      -- never advances again. Every REVIEW_STATUSES value now has an arm.
      when 'draft'      then 'project_created'
      else null
    end;

    -- Belt and braces: if a status is ever added to the CHECK without an
    -- arm here, refuse loudly rather than silently stranding the family
    -- the way the missing `draft` arm did.
    if v_target_applicant_state is null then
      raise exception
        'move_candidate: no applicant_state mapping for review_status % (leaving % would strand the family)',
        p_review_status, v_prev_applicant_state;
    end if;
  end if;

  update public.children
  set status = p_review_status,
      applicant_state = coalesce(v_target_applicant_state, applicant_state),
      updated_at = now()
  where id = p_child_id;
  if not found then
    raise exception 'child % not found', p_child_id;
  end if;

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
