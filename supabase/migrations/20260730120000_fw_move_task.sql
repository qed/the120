-- First Profit — Weekend Cohort Sprints, Unit 3: the FW transition executor.
--
-- ONE function, no DDL. `fw_move_task` is the SIBLING of `move_path_task`
-- (20260722120000_path_progress.sql), and `move_path_task` is UNTOUCHED by this
-- file — that is the point of plan Decision 1. The Path executor's verify
-- cascade (unlock-next, path_maybe_open_review) and its revoke semantics are
-- CORRECT for the Path and wrong for Founders Weekend (origin FW-D12): a guide
-- drills to any task in the 125-task catalog and taps it, with no gating, no
-- predecessor rule, no review ceremony. Forking the EXECUTOR keeps the Path's
-- tested surface frozen; the two share the events table, not code.
--
-- Apply via the Management API — `supabase db push` is dead here (no DB
-- password). See docs/solutions/integration-issues/supabase-cli-stale-db-
-- password-management-api-workaround-2026-07-13.md.
--
-- APPLY IMMEDIATELY, once its dependencies are in place. (An earlier revision of
-- this plan held FW migrations for a ~Jul 28 Chicago-rehearsal checkpoint; that
-- rehearsal was cancelled 2026-07-23 and the hold is retired repo-wide.)
--
-- ⚠️ APPLY ORDER — this function READS COLUMNS THAT ONLY EARLIER FW MIGRATIONS
-- ADD, so it must be applied third:
--   1. 20260728120000_fw_cohort_sprints.sql  — path_task_events.cohort_id /
--      captured_at / action_id / client_id (+ its partial unique index),
--      path_student_profiles.band, path_cohort_members, path_cohorts.kind
--   2. 20260729120000_fw_guide_invites.sql   — no SQL dependency here; ordered
--      by its own timestamp
--   3. THIS FILE
-- Applying this one first does not fail at CREATE time (plpgsql bodies are not
-- validated against the catalog until execution) — it fails at the first guide's
-- first tap, on an event weekend. So the precheck below is not optional.
--
-- Rollout phase: FUNCTION ONLY. Creates no table, seeds nothing, backfills
-- nothing. `create or replace` — re-applying is a no-op.
--
-- PRE-APPLY (run before submitting, same Management API session):
--   1. select to_regclass('public.path_task_progress'),
--             to_regclass('public.path_cohort_members'),
--             to_regclass('public.path_student_profiles');   -- all non-null
--   2. select count(*) from information_schema.columns
--       where table_schema='public' and table_name='path_task_events'
--         and column_name in ('cohort_id','captured_at','action_id','client_id');
--      -- MUST be 4. Fewer means migration 1 has not been applied; STOP.
--   3. select count(*) from information_schema.columns
--       where table_schema='public' and table_name='path_student_profiles'
--         and column_name='band';                            -- MUST be 1
--   4. select indexname from pg_indexes
--       where tablename='path_task_events'
--         and indexname='path_task_events_client_id_key';
--      -- MUST return 1 row: the ON CONFLICT below infers THIS partial index,
--      -- and without it the exactly-once replay guard silently becomes a
--      -- duplicate-event generator at drain time.
-- POST-APPLY (verify BEFORE recording the version):
--   5. select to_regprocedure(
--        'public.fw_move_task(uuid,text,text,uuid,uuid,timestamptz,uuid,text)');
--      -- non-null
--   6. select proname, prosecdef from pg_proc where proname='move_path_task';
--      -- still exactly 1 row, prosecdef true — proof this file left it alone
--   7. select has_function_privilege('anon',   '<sig>', 'execute'),
--             has_function_privilege('authenticated', '<sig>', 'execute');
--      -- both false
--   8. Only then: insert the version into supabase_migrations.schema_migrations.
--
-- ROLLBACK: `drop function public.fw_move_task(...)`. Nothing depends on it in
-- the database; the FW check-in action stops working and the Path is unaffected.

-- ═════════════════════════════════════════════════════════════ fw_move_task ══
-- The FW check-in executor: checkmark / not-yet / undo, atomic, author-stamped,
-- cohort-stamped, exactly-once.
--
-- ── Race safety is STRUCTURAL, and the structure is the WHERE clause ─────────
-- The per-action LEGAL-FROM SET IS THE UPDATE'S WHERE PREDICATE. That identity —
-- not a preceding read, not an advisory lock — is what makes `move_path_task`
-- race-safe, and plan Decision 2 requires FW to preserve it. Two guides tapping
-- the same row serialize in the storage engine: the first UPDATE moves it, the
-- second matches zero rows and is classified truthfully instead of overwriting.
-- `app/path/lib/__tests__/fw-move-task-parity.test.ts` parses this file and
-- asserts the guard is INSIDE the UPDATE (and that each arm's state list equals
-- FW_ACTION_LEGAL_FROM in app/path/lib/fw-rules.ts), because the repo's test
-- setup is node-only and cannot run true concurrency.
--
-- The SELECT … FOR UPDATE above the UPDATE is NOT a substitute for that guard —
-- it is there because the event row needs a truthful `from_state`, which an
-- UPDATE cannot return (RETURNING yields new values, not old). Taking the row
-- lock while reading it means the value we stamp on the event is the value the
-- UPDATE actually saw. The WHERE predicate then stays as the authoritative guard,
-- and is what the zero-row classification hangs off.
--
-- ── The semantics, all from plan Decision 2 ─────────────────────────────────
--   checkmark → verified, legal from every state EXCEPT `verified`.
--               Onto `verified` it is a FULL no-op with NO EVENT — bell safety:
--               the board rings First Dollar off a fresh event, so a mis-tap on
--               a finished task must not manufacture one.
--   not_yet   → not_yet, legal from every state except `verified` and its own
--               target. Onto `not_yet` a FRESH tap appends a RE-ATTEMPT EVENT
--               with no state change (repeat struggle is the blocker signal
--               FW-D4 exists to capture); a REPLAYED client_id stays a no-op.
--               From `verified` it is REFUSED — undo first, deliberately.
--   undo      → locked, legal ONLY from the two decision states. From `locked`
--               it is a no-op; from a Path work state it is refused rather than
--               silently resetting a real position.
--
-- ── Author stamping (Decision 2 + Decision 9's data source) ─────────────────
-- BOTH decisions stamp `verified_by`/`verified_role`; undo clears them. This is
-- wider than the Path, where only `verify` records an author — and it is
-- load-bearing rather than symmetry for its own sake: Unit 8's same-actor undo
-- guard decides whether a replayed offline undo may apply by reading the author
-- of the decision it reverts, and a cross-actor correction rejects to staff. With
-- no author on `not_yet` rows that guard would be unevaluable for exactly half
-- the decisions it must judge.
--
-- ── What this function deliberately does NOT do ─────────────────────────────
-- No unlock-next. No path_maybe_open_review. No path_reviews write. No
-- path_notification_events enqueue. FW activity can therefore never advance a
-- Path journey, open a review, or send a family an email — asserted by absence
-- in the parity test, because "we didn't call it" is only an invariant if
-- something checks.
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
  -- The HARDCODED target map. The RPC receives an ACTION NAME and maps it here;
  -- it never accepts a caller-supplied target, so a stale or tampered caller
  -- cannot smuggle a forged state in. Mirrored by FW_ACTION_TARGETS in
  -- app/path/lib/fw-rules.ts and pinned against it by the parity test.
  v_to := case p_action
    when 'checkmark' then 'verified'
    when 'not_yet'   then 'not_yet'
    when 'undo'      then 'locked'
    else null
  end;
  if v_to is null then
    raise exception 'unknown fw action: %', p_action;
  end if;

  -- Capture time, clamped against the SERVER clock. The device clock is
  -- untrusted input and an iPad that sat in a bag all summer can present a
  -- 1970 or a future value; the TS half (clampFwCapturedAt) also floors it at
  -- 2025-01-01, and this is the boundary backstop.
  v_captured := least(coalesce(p_captured_at, now()), now());

  -- Read the row AND take its lock, so the from_state we stamp on the event is
  -- the state the UPDATE below actually sees, and so the zero-row branch can
  -- classify against a value nothing can move under it (Decision 2's "re-read in
  -- the same transaction to classify alreadyDone vs refused truthfully" — the
  -- read is here, before the write, holding the lock, which is strictly stronger
  -- than re-reading after).
  select p.state, p.verified_by into v_from, v_author
    from public.path_task_progress p
    where p.student_id = p_student_id and p.task_id = p_task_id
    for update;

  if v_from is null then
    -- No progress row: a provisioning gap. Reported, never invented — this RPC
    -- only ever UPDATEs (the Path's no-upsert contract), and Unit 4's
    -- leg-verified quick-create exists so a guide is never handed a tree that
    -- cannot accept taps. This is the net under it.
    return query select 'missing'::text, null::text, null::uuid;
    return;
  end if;

  -- The ONE thing this function re-asserts that its caller already checked
  -- (`move_path_task`'s posture: defend the audit trail under a bypass). Decision
  -- 3 makes the cohort stamp verified client context — always carried, never
  -- inferred, never trusted — and a forged stamp is not a failed write but a
  -- PERMANENT lie in an append-only log: it would move a Hamptons tap into
  -- Boston's weekend numbers, or write FW events into a Path cohort's rollup.
  -- Both halves are checked at once because both are the same falsehood.
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

  -- EXACTLY-ONCE (FW-D10, Unit 1's client_id column + partial unique index). The
  -- offline queue mints a client_id per (student, task, tap); a replayed drain
  -- carries the same value. Checked HERE, under the row lock, so a sequential
  -- replay is classified truthfully as `replayed` rather than reported as
  -- `already_done` (a distinction the board's freshness gate and the guide's copy
  -- both depend on). The ON CONFLICT on the insert below is the racing backstop,
  -- not the mechanism.
  if p_client_id is not null and exists (
    select 1 from public.path_task_events e where e.client_id = p_client_id
  ) then
    return query select 'replayed'::text, v_from, v_author;
    return;
  end if;

  -- The band a checkmark freezes onto the row. FW stores band on the PROFILE (no
  -- children row to derive it from), and it is snapshotted at the DECISION rather
  -- than at materialization — FW materializes all-locked with no band, precisely
  -- so the snapshot records the band the work was actually judged at.
  if p_action = 'checkmark' then
    select sp.band into v_band
      from public.path_student_profiles sp where sp.id = p_student_id;
  end if;

  update public.path_task_progress p
  set
    state = v_to,
    -- BOTH decisions stamp the author; undo clears it. Unit 8's same-actor undo
    -- guard reads this column for `verified` AND `not_yet` rows alike.
    verified_by = case when p_action in ('checkmark', 'not_yet') then p_actor else null end,
    verified_role = case when p_action in ('checkmark', 'not_yet') then 'adult' else null end,
    -- Frozen once: a re-checkmark after an undo keeps the original band rather
    -- than re-reading a profile whose band a guide may have corrected since.
    snapshot_band = case
      when p_action = 'checkmark' then coalesce(p.snapshot_band, v_band)
      else p.snapshot_band
    end,
    -- Cleared on undo: the row is back to `locked`, which is not a decision, and
    -- a lingering decided_at would make an undone task read as decided to every
    -- reader that gates on it.
    decided_at = case when p_action = 'undo' then null else now() end,
    updated_at = now()
  where p.student_id = p_student_id
    and p.task_id = p_task_id
    -- ⬇⬇ THE STATE GUARD. This CASE is the per-action legal-from set, and it
    -- lives INSIDE the UPDATE on purpose — see the header. Do not hoist it into
    -- an `if` above the statement; that converts a compare-and-swap into a
    -- check-then-act and reintroduces the lost update it exists to prevent.
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
    on conflict (client_id) where client_id is not null do nothing;

    v_outcome := 'applied';
    v_state_out := v_to;
    v_author_out := case when p_action in ('checkmark', 'not_yet') then p_actor else null end;

  elsif p_action = 'not_yet' and v_from = 'not_yet' then
    -- The RE-ATTEMPT arm. The row is deliberately NOT touched — not its state,
    -- not its author, not its decided_at: the DECISION is unchanged, so its
    -- author is unchanged, and only an EVENT is appended. (Re-stamping the author
    -- here would silently transfer undo rights to whoever tapped last, breaking
    -- Unit 8's same-actor guard for the guide who actually made the call.)
    -- from_state = to_state = 'not_yet' is how the board recognizes a re-attempt.
    insert into public.path_task_events
      (student_id, task_id, transition, from_state, to_state, actor, actor_role,
       cohort_id, captured_at, action_id, client_id)
    values
      (p_student_id, p_task_id, p_action, v_from, v_to, p_actor, 'adult',
       p_cohort_id, v_captured, p_action_id, p_client_id)
    on conflict (client_id) where client_id is not null do nothing;

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

-- Service-role only, exactly like move_path_task: the authorization verdict is
-- the pure resolver's job (resolveFwActor), reached through a server action, and
-- there is no anon/authenticated path to a cascade-free write executor.
revoke all on function public.fw_move_task(uuid, text, text, uuid, uuid, timestamptz, uuid, text) from public;
revoke all on function public.fw_move_task(uuid, text, text, uuid, uuid, timestamptz, uuid, text) from anon, authenticated;
grant execute on function public.fw_move_task(uuid, text, text, uuid, uuid, timestamptz, uuid, text) to service_role;
