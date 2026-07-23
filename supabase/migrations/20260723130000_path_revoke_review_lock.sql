-- The Path T1 Unit 12 review fix — serialize revoke's path_reviews reconcile
-- under the same advisory lock the other two review writers take.
--
-- Adversarial finding: move_path_task's revoke branch (20260722120000) flips an
-- open review to `returned` with a PLAIN UPDATE, while path_maybe_open_review
-- and return_path_criterion both serialize on
-- pg_advisory_xact_lock(hashtext(student), hashtext(criterion)). An unlocked
-- revoke racing a locked criterion-return could decide the review row first,
-- making the ceremony's decide match zero rows and silently discarding the
-- returning parent's task selection and note. This re-creates move_path_task
-- identical to the applied version EXCEPT the revoke branch now (a) resolves
-- the criterion first and (b) takes the same lock before touching path_reviews
-- — all three writers of a criterion's review row now serialize.
--
-- Apply via the Management API (playbook in docs/solutions/integration-issues/
-- supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md).
-- Precheck: to_regprocedure('public.move_path_task(uuid,text,text,text,uuid,text,text,timestamptz,text)')
-- non-null. Verify after: prosrc contains 'pg_advisory_xact_lock' in the revoke
-- branch. Record the version ONLY after the DDL succeeds.
--
-- Rollout phase: RPC amendment only. Idempotent (create or replace).

create or replace function public.move_path_task(
  p_student_id uuid,
  p_task_id text,
  p_transition text,
  p_expected_from text,
  p_actor uuid,
  p_actor_role text,
  p_band text default null,
  p_submitted_at timestamptz default null,
  p_note text default null
)
returns table (wrote boolean, state text, verified_by uuid, decided_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_to text;
  v_rows int;
  v_wrote boolean;
  v_version text;
  v_criterion text;
  v_seq int;
  v_next_task text;
begin
  v_to := case p_transition
    when 'unlock'   then 'available'
    when 'open'     then 'in_progress'
    when 'submit'   then 'submitted'
    when 'withdraw' then 'in_progress'
    when 'verify'   then 'verified'
    when 'not_yet'  then 'not_yet'
    when 'resume'   then 'in_progress'
    when 'revoke'   then 'not_yet'
    else null
  end;
  if v_to is null then
    raise exception 'unknown path transition: %', p_transition;
  end if;

  update public.path_task_progress p
  set
    state = v_to,
    verified_by = case
      when p_transition = 'verify' then p_actor
      when p_transition = 'revoke' then null
      else p.verified_by
    end,
    verified_role = case
      when p_transition = 'verify' then p_actor_role
      when p_transition = 'revoke' then null
      else p.verified_role
    end,
    snapshot_band = case
      when p_transition = 'unlock' then coalesce(p.snapshot_band, p_band)
      else p.snapshot_band
    end,
    submit_received_at = case when p_transition = 'submit' then now() else p.submit_received_at end,
    submitted_at = case
      when p_transition = 'submit' then coalesce(p_submitted_at, now())
      else p.submitted_at
    end,
    decided_at = case
      when p_transition in ('verify', 'not_yet', 'revoke') then now()
      else p.decided_at
    end,
    updated_at = now()
  where p.student_id = p_student_id
    and p.task_id = p_task_id
    and p.state = p_expected_from
    -- §9.5 defense-in-depth: only the original verifier may revoke.
    and (p_transition <> 'revoke' or p.verified_by = p_actor);

  get diagnostics v_rows = row_count;
  v_wrote := v_rows > 0;

  if v_wrote then
    insert into public.path_task_events
      (student_id, task_id, transition, from_state, to_state, actor, actor_role, note)
    values
      (p_student_id, p_task_id, p_transition, p_expected_from, v_to, p_actor, p_actor_role, p_note);

    if p_transition = 'verify' then
      select p.program_version_id, p.criterion_id into v_version, v_criterion
        from public.path_task_progress p
        where p.student_id = p_student_id and p.task_id = p_task_id;

      select seq into v_seq
        from public.path_unit_tasks
        where program_version_id = v_version and task_id = p_task_id;

      select task_id into v_next_task
        from public.path_unit_tasks
        where program_version_id = v_version and criterion_id = v_criterion and seq = v_seq + 1;

      if v_next_task is not null then
        update public.path_task_progress np
          set state = 'available',
              snapshot_band = coalesce(np.snapshot_band, p_band),
              updated_at = now()
          where np.student_id = p_student_id and np.task_id = v_next_task and np.state = 'locked';
        if found then
          insert into public.path_task_events
            (student_id, task_id, transition, from_state, to_state, actor, actor_role, note)
          values
            (p_student_id, v_next_task, 'unlock', 'locked', 'available', null, 'system', null);
        end if;
      end if;

      perform public.path_maybe_open_review(p_student_id, v_criterion, p_actor);
    end if;

    if p_transition = 'revoke' then
      -- Resolve the criterion FIRST, then take the SAME advisory lock
      -- path_maybe_open_review and return_path_criterion take, so a revoke's
      -- review reconcile can never interleave with an open or a ceremony
      -- decide on the same criterion (Unit 12 adversarial review).
      select p.criterion_id into v_criterion
        from public.path_task_progress p
        where p.student_id = p_student_id and p.task_id = p_task_id;

      if v_criterion is not null then
        perform pg_advisory_xact_lock(hashtext(p_student_id::text), hashtext(v_criterion));

        update public.path_reviews r
          set state = 'returned', decided_by = p_actor, decided_at = now()
          where r.student_id = p_student_id and r.scope = 'criterion'
            and r.scope_id = v_criterion and r.state = 'review_underway';
      end if;
    end if;
  end if;

  return query
    select v_wrote, p.state, p.verified_by, p.decided_at
    from public.path_task_progress p
    where p.student_id = p_student_id and p.task_id = p_task_id;
end;
$$;

revoke all on function public.move_path_task(uuid, text, text, text, uuid, text, text, timestamptz, text) from public;
revoke all on function public.move_path_task(uuid, text, text, text, uuid, text, text, timestamptz, text) from anon, authenticated;
grant execute on function public.move_path_task(uuid, text, text, text, uuid, text, text, timestamptz, text) to service_role;
