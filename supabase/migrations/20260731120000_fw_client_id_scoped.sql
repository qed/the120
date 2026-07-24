-- First Profit — Weekend Cohort Sprints, Unit 3 (follow-up): scope the
-- exactly-once key to the tap it identifies.
--
-- WHY THIS EXISTS. Unit 1 shipped `client_id` with a GLOBAL partial unique index
-- (`path_task_events_client_id_key on (client_id) where client_id is not null`)
-- while its own comment defined the value as "the EXACTLY-ONCE key, per
-- (student, task, tap)". Unit 3's adversarial review found the gap between those
-- two statements, and it is a data-loss bug, not a tidiness one:
--
--   * SEQUENTIAL LOSS. A batch (or two successive taps) where two DIFFERENT
--     students carry the same client_id value: the first student's event commits
--     with that client_id; the second student's call then hits the RPC's global
--     replay probe, matches the FIRST student's event, and returns `replayed`.
--     `replayed` is a success-shaped outcome, so the guide is told the tap was
--     already recorded. The second student's check-in is silently gone.
--
--   * CONCURRENT STATE/EVENT SPLIT. Two colliding-client_id calls for different
--     rows racing: they lock different rows so they never block each other, both
--     pass the probe before either commits, both UPDATEs apply — and then the
--     loser's `on conflict … do nothing` silently drops ITS event. Net result: a
--     progress row moved to `verified` with NO event recording who decided it.
--     That is precisely the append-only-audit guarantee the Path's whole event
--     table exists to provide.
--
-- Nothing prevented a colliding value: `clientIds` is a caller-supplied record,
-- and Units 7 (importer) and 8 (offline drain) will both mint these keys under
-- their own schemes.
--
-- THE FIX is to make the key mean what it was documented to mean. Scoping the
-- uniqueness to (student_id, task_id, client_id) dissolves both failure modes at
-- once: two students sharing a value now occupy different keys, so the collision
-- becomes harmless rather than lossy, and no TS-side duplicate check is needed
-- (an earlier draft of this fix added one; with the key scoped correctly it would
-- guard nothing).
--
-- Apply via the Management API — `supabase db push` is dead here (no DB
-- password). See docs/solutions/integration-issues/supabase-cli-stale-db-
-- password-management-api-workaround-2026-07-13.md. APPLY IMMEDIATELY; no holds.
--
-- APPLY ORDER: after 20260728120000 (creates the index being replaced) and
-- 20260730120000 (creates the function being replaced). Both are already applied.
--
-- Rollout phase: INDEX SWAP + FUNCTION REPLACE. Seeds nothing, backfills nothing.
-- Idempotent (`drop index if exists` / `create unique index if not exists` /
-- `create or replace function`) — re-applying is a no-op.
--
-- SAFETY OF THE INDEX SWAP: the new index is strictly WEAKER than the old one
-- (every (client_id) unique set is also unique under (student_id, task_id,
-- client_id)), so no existing row can violate it and the build cannot fail on
-- data. Built without CONCURRENTLY for the same reason the Unit 1 header gives:
-- the Management API submits the file as one implicit transaction, and CREATE
-- INDEX CONCURRENTLY cannot run inside one.
--
-- PRE-APPLY:
--   1. select count(*) from public.path_task_events where client_id is not null;
--      -- expected 0 today (no FW client_ids written yet). A non-zero count is
--      -- still safe (the new index is weaker) but means real taps exist and the
--      -- swap should run outside an active event window.
--   2. select indexname from pg_indexes where tablename='path_task_events'
--       and indexname='path_task_events_client_id_key';        -- 1 row
-- POST-APPLY (verify BEFORE recording the version):
--   3. select indexname from pg_indexes where tablename='path_task_events'
--       and indexname='path_task_events_student_task_client_id_key';  -- 1 row
--   4. select indexname from pg_indexes where tablename='path_task_events'
--       and indexname='path_task_events_client_id_key';        -- 0 rows (dropped)
--   5. select to_regprocedure(
--        'public.fw_move_task(uuid,text,text,uuid,uuid,timestamptz,uuid,text)');
--      -- non-null
--   6. select proname from pg_proc where proname='move_path_task';  -- still 1 row
--   7. Only then: record the version.
--
-- ROLLBACK: recreate the single-column index and re-apply 20260730120000's
-- function body. Both are in the repo; neither loses data.

-- ═══════════════════════════════════════════════════════ the scoped index ══
-- Order matters: create the replacement BEFORE dropping the old one, so there is
-- no window (even inside the transaction) where a concurrent insert has no
-- uniqueness guard at all.
create unique index if not exists path_task_events_student_task_client_id_key
  on public.path_task_events (student_id, task_id, client_id)
  where client_id is not null;

drop index if exists public.path_task_events_client_id_key;

-- ═════════════════════════════════════════════════════ fw_move_task, rescoped ══
-- Identical to 20260730120000 except for the three places the idempotency key is
-- referenced. The full rationale for every other line lives in that file; this
-- body is reproduced whole because `create or replace function` has no patch
-- form, and a partial copy would be a second, drifting definition.
--
-- The changes, all of one kind:
--   * the replay probe now filters on (student_id, task_id, client_id)
--   * both `on conflict` targets now name the composite partial index
create or replace function public.fw_move_task(
  p_student_id uuid,
  p_task_id text,
  p_action text,
  p_actor uuid,
  p_cohort_id uuid,
  p_captured_at timestamptz default null,
  p_action_id uuid default null,
  p_client_id text default null
)
returns table (outcome text, state text, verified_by uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_to text;
  v_from text;
  v_author uuid;
  v_band text;
  v_captured timestamptz;
  v_rows int;
  v_outcome text;
  v_state_out text;
  v_author_out uuid;
begin
  -- The HARDCODED target map, mirrored by FW_ACTION_TARGETS in fw-rules.ts.
  v_to := case p_action
    when 'checkmark' then 'verified'
    when 'not_yet'   then 'not_yet'
    when 'undo'      then 'locked'
    else null
  end;
  if v_to is null then
    raise exception 'unknown fw action: %', p_action;
  end if;

  v_captured := least(coalesce(p_captured_at, now()), now());

  -- Read the row AND take its lock, so the from_state stamped on the event is the
  -- state the UPDATE below actually sees, and the zero-row branch classifies
  -- against a value nothing can move under it.
  select p.state, p.verified_by into v_from, v_author
    from public.path_task_progress p
    where p.student_id = p_student_id and p.task_id = p_task_id
    for update;

  if v_from is null then
    return query select 'missing'::text, null::text, null::uuid;
    return;
  end if;

  -- Defense-in-depth on the cohort stamp (Decision 3): a forged stamp is not a
  -- failed write but a permanent lie in an append-only log.
  if not exists (
    select 1
      from public.path_cohort_members m
      join public.path_cohorts c on c.id = m.cohort_id
      where m.student_id = p_student_id
        and m.cohort_id = p_cohort_id
        and c.kind = 'fw'
  ) then
    return query select 'cohort_invalid'::text, v_from, v_author;
    return;
  end if;

  -- EXACTLY-ONCE, SCOPED TO THIS TAP'S (student, task). Scoping is the whole
  -- point of this migration: a global probe would match a DIFFERENT student's
  -- event that happened to carry the same client_id and silently swallow this
  -- student's check-in as a replay.
  if p_client_id is not null and exists (
    select 1 from public.path_task_events e
      where e.student_id = p_student_id
        and e.task_id = p_task_id
        and e.client_id = p_client_id
  ) then
    return query select 'replayed'::text, v_from, v_author;
    return;
  end if;

  if p_action = 'checkmark' then
    select sp.band into v_band
      from public.path_student_profiles sp where sp.id = p_student_id;
  end if;

  update public.path_task_progress p
  set
    state = v_to,
    verified_by = case when p_action in ('checkmark', 'not_yet') then p_actor else null end,
    verified_role = case when p_action in ('checkmark', 'not_yet') then 'adult' else null end,
    snapshot_band = case
      when p_action = 'checkmark' then coalesce(p.snapshot_band, v_band)
      else p.snapshot_band
    end,
    decided_at = case when p_action = 'undo' then null else now() end,
    updated_at = now()
  where p.student_id = p_student_id
    and p.task_id = p_task_id
    -- ⬇⬇ THE STATE GUARD. Lives INSIDE the UPDATE on purpose: hoisting it into an
    -- `if` above the statement converts a compare-and-swap into a check-then-act
    -- and reintroduces the lost update it exists to prevent.
    and case p_action
          when 'checkmark' then p.state in ('locked', 'available', 'in_progress', 'submitted', 'not_yet')
          when 'not_yet'   then p.state in ('locked', 'available', 'in_progress', 'submitted')
          when 'undo'      then p.state in ('verified', 'not_yet')
        end;

  get diagnostics v_rows = row_count;

  if v_rows > 0 then
    insert into public.path_task_events
      (student_id, task_id, transition, from_state, to_state, actor, actor_role,
       cohort_id, captured_at, action_id, client_id)
    values
      (p_student_id, p_task_id, p_action, v_from, v_to, p_actor, 'adult',
       p_cohort_id, v_captured, p_action_id, p_client_id)
    on conflict (student_id, task_id, client_id) where client_id is not null do nothing;

    v_outcome := 'applied';
    v_state_out := v_to;
    v_author_out := case when p_action in ('checkmark', 'not_yet') then p_actor else null end;

  elsif p_action = 'not_yet' and v_from = 'not_yet' then
    -- The RE-ATTEMPT arm. The row is deliberately NOT touched — not its state,
    -- not its author, not its decided_at: the DECISION is unchanged, so its
    -- author is unchanged, and only an EVENT is appended.
    insert into public.path_task_events
      (student_id, task_id, transition, from_state, to_state, actor, actor_role,
       cohort_id, captured_at, action_id, client_id)
    values
      (p_student_id, p_task_id, p_action, v_from, v_to, p_actor, 'adult',
       p_cohort_id, v_captured, p_action_id, p_client_id)
    on conflict (student_id, task_id, client_id) where client_id is not null do nothing;

    v_outcome := 're_attempt';
    v_state_out := v_from;
    v_author_out := v_author;

  elsif v_from = v_to then
    -- checkmark onto `verified`, or undo onto `locked`. NO EVENT, no row change.
    v_outcome := 'already_done';
    v_state_out := v_from;
    v_author_out := v_author;

  else
    -- not-yet onto `verified` (undo first), or undo from a Path work state.
    v_outcome := 'refused';
    v_state_out := v_from;
    v_author_out := v_author;
  end if;

  return query select v_outcome, v_state_out, v_author_out;
end;
$$;

revoke all on function public.fw_move_task(uuid, text, text, uuid, uuid, timestamptz, uuid, text) from public;
revoke all on function public.fw_move_task(uuid, text, text, uuid, uuid, timestamptz, uuid, text) from anon, authenticated;
grant execute on function public.fw_move_task(uuid, text, text, uuid, uuid, timestamptz, uuid, text) to service_role;
