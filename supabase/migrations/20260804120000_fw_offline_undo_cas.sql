-- First Profit — Weekend Cohort Sprints, Unit 9 (hardening): the offline-only
-- undo CAS + the reject idempotency backstop.
--
-- ONE migration, two independent hardening items the Unit-8 review carried here
-- (plan Unit 9, items #1 and #2). Both are corrections to the offline drain, and
-- both are backed by their own tests (fw-move-task-parity.test.ts for the CAS SQL;
-- fw-sync-engine.test.ts for the behaviour). Bundled because they touch the same
-- surface — the drain's write path — and neither is worth its own migration.
--
--   1. fw_move_task gains an OPTIONAL `p_expected_verified_by` param — a conditional
--      compare-and-swap that fires ONLY on `undo`, and ONLY when the param is
--      non-null (the offline REPLAY path). Online undo passes null → no CAS → any
--      guide may still undo any decision live (the INTENDED online cross-actor undo,
--      plan Decision 9). This closes the Unit-8 P1: the same-actor undo guard is a
--      client-side check-then-act (the drain reads verified_by, evaluates the guard,
--      THEN replays through runFwCheckIn → fw_move_task, which did not re-check the
--      author). Between the guard-read and the replay a concurrent cross-actor
--      decision can land and be reverted unguarded. The CAS makes the replay atomic:
--      the drain passes the author it guard-checked, and the undo applies only while
--      verified_by still matches. A stale undo is now classified `cross_actor_undo`
--      instead of silently reverting the new decision.
--
--   2. path_fw_replay_rejects gains a UNIQUE index on (client_id, student_id,
--      task_id) where client_id is not null — the DB backstop `writeFwReject`'s
--      probe-then-insert lacked. Genuinely concurrent drains (a device auto-drain +
--      a CLI `npm run fw drain` of an exported file) could double-write a reject; the
--      probe closes the common case but not the race. Against this index the writer
--      tolerates the collision the way `ensureAnonymizeAudit` does: probe-then-insert,
--      then treat a 23505 unique violation as success (functionally ON CONFLICT DO
--      NOTHING, done in application code via `isUniqueViolation`, not the SQL clause).
--
-- ⚠️ APP-CODE DEPLOY COUPLING (review-flagged). The signature change is safe only in
-- the direction "old code → new schema": a currently-deployed 8-named-arg call resolves
-- to the new 9-arg function with p_expected_verified_by defaulting to null (no CAS,
-- identical online behavior). It is NOT safe in reverse — `runFwCheckIn`/`fwMoveTask`
-- now send `p_expected_verified_by` on EVERY call (checkmark/not_yet/undo alike), so the
-- app-code change that ships with this migration would error on EVERY fw_move_task RPC
-- (not just undo) against the pre-Unit-9 8-arg function. Therefore: this migration MUST
-- be applied to the DB before (or atomically with) the Vercel deploy of the fw-checkin-
-- core.ts change — the standing "apply migrations as authored, ahead of the code PR"
-- convention already satisfies this — and a ROLLBACK that restores the 8-arg function
-- (see ROLLBACK below) MUST roll the app code back too, or FW check-ins break wholesale.
--
-- Apply via the Management API — `supabase db push` is dead here (no DB password).
-- See docs/solutions/integration-issues/supabase-cli-stale-db-password-management-
-- api-workaround-2026-07-13.md. APPLY IMMEDIATELY; no holds (Chicago cancelled
-- 2026-07-23, every migration applies as authored).
--
-- APPLY ORDER: after 20260731120000 (the function this replaces) and 20260728120000
-- (the path_fw_replay_rejects table this indexes). Both are already applied.
--
-- Rollout phase: INDEX ADD + FUNCTION SIGNATURE CHANGE. Seeds nothing, backfills
-- nothing. Idempotent: `create unique index if not exists`, `drop function if
-- exists` the old 8-arg signature, `create or replace` the 9-arg one.
--
-- ⚠️ WHY THE DROP. Adding a parameter changes the function's identity — a bare
-- `create or replace` with a 9th arg would create a SECOND, distinct fw_move_task
-- (8-arg + 9-arg overloads), and a PostgREST call with 8 named args would then be
-- ambiguous (PGRST203). So the old 8-arg signature is dropped FIRST, inside this
-- one implicit transaction, so no external caller ever sees the gap. Nothing in the
-- database depends on the function (no view, no trigger), so the drop is safe and
-- needs no CASCADE.
--
-- SAFETY OF THE INDEX: the reject table holds only genuinely-distinct
-- (client_id, student_id, task_id) triples today (production `path_fw_replay_rejects`
-- is empty — Unit 8 wrote none), so the unique build cannot fail on existing data.
-- Built without CONCURRENTLY: the Management API submits the file as one implicit
-- transaction, and CREATE INDEX CONCURRENTLY cannot run inside one.
--
-- PRE-APPLY (run before submitting, same Management API session):
--   1. select to_regprocedure(
--        'public.fw_move_task(uuid,text,text,uuid,uuid,timestamptz,uuid,text)');
--      -- non-null: the current 8-arg function exists and is what we replace.
--   2. select to_regclass('public.path_fw_replay_rejects');   -- non-null
--   3. select indexname from pg_indexes where tablename='path_fw_replay_rejects'
--       and indexname='path_fw_replay_rejects_client_scope_key';   -- 0 rows (new)
-- POST-APPLY (verify BEFORE recording the version):
--   4. select to_regprocedure(
--        'public.fw_move_task(uuid,text,text,uuid,uuid,timestamptz,uuid,text,uuid)');
--      -- non-null: the new 9-arg function exists.
--   5. select to_regprocedure(
--        'public.fw_move_task(uuid,text,text,uuid,uuid,timestamptz,uuid,text)');
--      -- NULL: the old 8-arg overload is gone (no ambiguity for PostgREST).
--   6. select proname, prosecdef from pg_proc where proname='move_path_task';
--      -- still exactly 1 row, prosecdef true — proof this file left it alone.
--   7. select has_function_privilege('anon', '<9-arg sig>', 'execute'),
--             has_function_privilege('authenticated', '<9-arg sig>', 'execute');
--      -- both false.
--   8. select indexname from pg_indexes where tablename='path_fw_replay_rejects'
--       and indexname='path_fw_replay_rejects_client_scope_key';   -- 1 row
--   9. Only then: record the version in supabase_migrations.schema_migrations.
--
-- ROLLBACK: `drop function public.fw_move_task(...9-arg...)` then re-apply
-- 20260731120000's body; `drop index public.path_fw_replay_rejects_client_scope_key`.
-- Both are in the repo; neither loses data.

-- ═══════════════════════════════════ 1. the reject idempotency backstop ══════════
-- Scope matches the OPERATION `writeFwReject` dedupes on: one reject per
-- (client_id, student_id, task_id). Partial (`where client_id is not null`) because
-- client_id is nullable on this table and a reject that carries no client_id (a shape
-- that should not arise — every queue entry carries one) must still be recordable
-- rather than colliding on a NULL key. The scope mirrors the events table's own
-- exactly-once key (student_id, task_id, client_id); the reject is the same tap's
-- failure record, so it dedupes on the same tuple. See docs/solutions/logic-errors/
-- idempotency-key-unique-scope-must-match-the-operation-… (the events-table
-- instance): a key scoped to client_id alone would be wrong here too.
create unique index if not exists path_fw_replay_rejects_client_scope_key
  on public.path_fw_replay_rejects (client_id, student_id, task_id)
  where client_id is not null;

-- ═══════════════════════════════════ 2. fw_move_task, with the offline-only CAS ══
-- Drop the 8-arg overload before creating the 9-arg one (see the ⚠️ note above).
drop function if exists public.fw_move_task(
  uuid, text, text, uuid, uuid, timestamptz, uuid, text
);

-- Identical to 20260731120000 except for the offline-only CAS: a new optional
-- `p_expected_verified_by` param, one conditional term in the UPDATE's WHERE, and one
-- new `cross_actor_undo` classification arm. The full rationale for every other line
-- lives in 20260730120000 / 20260731120000; this body is reproduced whole because
-- `create or replace function` has no patch form, and a partial copy would be a
-- second, drifting definition.
create or replace function public.fw_move_task(
  p_student_id uuid,
  p_task_id text,
  p_action text,
  p_actor uuid,
  p_cohort_id uuid,
  p_captured_at timestamptz default null,
  p_action_id uuid default null,
  p_client_id text default null,
  -- OFFLINE-ONLY CAS (plan Decision 9 / Unit 9). null on every online tap — no CAS,
  -- so any guide may undo any decision live. Non-null ONLY on an offline undo REPLAY,
  -- carrying the author the drain's same-actor guard checked; the undo then applies
  -- only while verified_by still equals it. Ignored for checkmark/not_yet.
  p_expected_verified_by uuid default null
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
  -- state the UPDATE below actually sees, and the zero-row branch classifies against
  -- a value nothing can move under it. v_author is the current author under the lock —
  -- the value the CAS below compares p_expected_verified_by against.
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

  -- EXACTLY-ONCE, SCOPED TO THIS TAP'S (student, task).
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
        end
    -- ⬇⬇ THE OFFLINE-ONLY CAS. Conditional on both p_expected_verified_by being
    -- non-null AND the action being undo — so it is vacuously true for every online
    -- tap and for checkmark/not_yet, preserving the intended online cross-actor undo.
    -- On an offline undo replay it makes the undo atomic with the author the drain
    -- guard-checked: a concurrent cross-actor decision landing between that guard read
    -- and this replay flips verified_by, this term goes false, the UPDATE matches zero
    -- rows, and the row is classified `cross_actor_undo` below instead of reverting the
    -- new decision unguarded. Do NOT drop the two escape clauses — an unconditional
    -- `p.verified_by = p_expected_verified_by` would break online cross-actor undo.
    and (
      p_expected_verified_by is null
      or p_action <> 'undo'
      or p.verified_by = p_expected_verified_by
    );

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

  elsif p_action = 'undo' and p_expected_verified_by is not null
        and v_from in ('verified', 'not_yet')
        and v_author is distinct from p_expected_verified_by then
    -- THE CAS-REFUSED ARM. The row is still a decision (v_from is verified/not_yet, so
    -- the state guard would have passed), but its author changed between the drain's
    -- same-actor guard read and this replay — the ONE thing the CAS exists to catch.
    -- Distinguished from a plain `refused` so the drain records `cross_actor_undo`, the
    -- reject the same-actor guard would have raised had it seen the new author. NO EVENT,
    -- no row change: the concurrent decision stands, the stale undo is held for staff.
    v_outcome := 'cross_actor_undo';
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

revoke all on function public.fw_move_task(uuid, text, text, uuid, uuid, timestamptz, uuid, text, uuid) from public;
revoke all on function public.fw_move_task(uuid, text, text, uuid, uuid, timestamptz, uuid, text, uuid) from anon, authenticated;
grant execute on function public.fw_move_task(uuid, text, text, uuid, uuid, timestamptz, uuid, text, uuid) to service_role;
