-- The Path T1 Unit 8 — progress schema + the atomic transition RPC.
--
-- Makes the Unit 7 state machine atomic, audited, and safe under concurrency
-- (Decision 5). Three tables and one security-definer RPC, modeled on
-- public.move_candidate():
--   * path_task_progress   — the 6-state machine, ONE row per (student, task).
--   * path_reviews         — criterion/phase review attempts (R6 audit; a second
--                            review must never overwrite the first).
--   * path_task_events     — append-only R6 record: no path advances without an
--                            adult verification record (actor + role + time).
--   * move_path_task()     — the compare-and-swap transition executor.
--
-- Apply via the Management API — `supabase db push` is dead here (no DB
-- password). See docs/solutions/integration-issues/supabase-cli-stale-db-
-- password-management-api-workaround-2026-07-13.md. After applying: verify with
-- to_regclass (the 3 tables) and to_regprocedure (the 2 functions), THEN record
-- this version in supabase_migrations.schema_migrations. A committed migration is
-- not an applied migration.
--
-- Depends on Unit 5 (path_student_profiles) and Unit 4's DDL (path_unit_tasks).
-- Verify to_regclass('public.path_student_profiles') and
-- to_regclass('public.path_unit_tasks') are non-null before applying (the FKs
-- below reference them); this file also adds two unique indexes to
-- path_unit_tasks that the RPC's next-task lookup and the composite FK rely on.
-- The transition→target map is encoded THREE ways — the SQL CASE in
-- move_path_task, TASK_TRANSITION_TARGETS in app/path/lib/progress-core.ts, and
-- the Unit 7 table's `to` fields; a vitest test parses this CASE and pins it
-- against the TS map, so edit all three together.
--
-- Rollout phase: SCHEMA + RPC. Creates empty tables and the functions; seeds
-- nothing. Initial progress rows are written by Unit 6 provisioning (all tasks
-- 'locked', the first task of criterion 1.1 'available'); this RPC only
-- TRANSITIONS existing rows (never a full-row upsert — the trigger-coercion-
-- poisons-EXCLUDED trap). Idempotent DDL throughout (create if not exists /
-- create or replace) — re-applying is a no-op.
--
-- Delete posture: every FK is ON DELETE RESTRICT (Unit 5's Path-graph posture) —
-- a delete that would strip progress, a review, or an audit record out from under
-- an active Founder File must fail loudly, never cascade. In particular the
-- path_task_events.actor RESTRICT means an adult who ever verified cannot be
-- deleted while their verification records exist — that is R6's teeth, not a bug.
--
-- Decision 1: every table is RLS-enabled with ZERO policies — service-role only.
-- move_path_task() is SECURITY DEFINER and granted to service_role alone.

-- ─────────────────────────────── path_unit_tasks hardening (Unit 4 table) ──
-- Two invariants Unit 8 leans on that Unit 4 did not enforce. Both are trivially
-- true of the current seed (task_id is the PK; seq is derived from array
-- position) — these make them structural so a future seed/hotfix cannot break
-- the review-open aggregate or the next-task unlock silently:
--   * (program_version_id, task_id, criterion_id) unique — lets path_task_progress
--     FK on all three, so a progress row's criterion_id can never disagree with
--     the task's true criterion (a miscount would open/never-open the wrong review).
--   * (program_version_id, criterion_id, seq) unique — the RPC's `seq = v_seq + 1`
--     next-task lookup would silently pick one of two duplicate-seq rows.
create unique index if not exists path_unit_tasks_pv_task_criterion
  on public.path_unit_tasks (program_version_id, task_id, criterion_id);
create unique index if not exists path_unit_tasks_pv_criterion_seq
  on public.path_unit_tasks (program_version_id, criterion_id, seq);

-- ─────────────────────────────────────────────────────── path_task_progress ──
-- ONE row per (student, task). `unique (student_id, task_id)` is the single most
-- corrupting omission the plan names: without it, two progress rows for one
-- student-task pair would fork the CAS, band snapshot, evidence FKs, and reviews
-- into a split permanent record no later constraint could merge.
create table if not exists public.path_task_progress (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.path_student_profiles (id) on delete restrict,
  -- denormalized from the student's pinned profile so the composite FK below can
  -- anchor the task to path_unit_tasks WITHIN the pinned version — progress can
  -- never reference a task from the wrong version. The RPC/provisioning set these
  -- server-side; they are never client-supplied.
  program_version_id text not null,
  criterion_id text not null,
  task_id text not null,
  state text not null default 'locked'
    check (state in ('locked', 'available', 'in_progress', 'submitted', 'not_yet', 'verified')),
  -- band frozen at first `available` (Unit 7's snapshot rule); null until then.
  snapshot_band text check (snapshot_band in ('g3_5', 'g6_8', 'g9_12')),
  -- the verifier (auth.users) — §9.5 revoke compares the actor against this.
  verified_by uuid references auth.users (id) on delete restrict,
  verified_role text check (verified_role in ('student', 'adult', 'system')),
  -- R30 / D6 instrumentation. review_opened_at gates withdraw legality.
  review_opened_at timestamptz,
  -- Two submit timestamps (R30 / Unit 11): the SERVER's receive time (what R30
  -- instruments off — a parent's responsiveness, not a child's connectivity),
  -- and the CLIENT's skew-clamped capture time that Unit 11's offline queue
  -- supplies. Reserving both names now avoids a rename on a live column later.
  submit_received_at timestamptz,
  submitted_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, task_id),
  -- Three-column FK: the criterion_id is pinned to the task's TRUE criterion in
  -- path_unit_tasks, so a mismatched denormalized copy is a hard insert error,
  -- not a silent aggregate-count corruption.
  foreign key (program_version_id, task_id, criterion_id)
    references public.path_unit_tasks (program_version_id, task_id, criterion_id) on delete restrict
);

-- The sibling read the review-open re-derivation runs on every verify.
create index if not exists path_task_progress_student_criterion_idx
  on public.path_task_progress (student_id, criterion_id);

-- ────────────────────────────────────────────────────────────── path_reviews ──
-- One row per review ATTEMPT. `attempt` starts at 1 and increments on each
-- re-open after a return; `unique (student_id, scope, scope_id, attempt)` means a
-- second review can never overwrite the first — the audit trail R6 exists to keep
-- is preserved. `cleared` is a T2 outcome (the crest ceremony); T1 only produces
-- `review_underway` and (via Unit 12) `returned`.
create table if not exists public.path_reviews (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.path_student_profiles (id) on delete restrict,
  scope text not null check (scope in ('criterion', 'phase')),
  scope_id text not null,                      -- '1.1' (criterion) or '01' (phase)
  attempt int not null check (attempt >= 1),
  state text not null check (state in ('review_underway', 'cleared', 'returned')),
  -- NOT NULL: every review has an opener (R6's actor-and-time guarantee); the
  -- opening verify always supplies one.
  opened_by uuid not null references auth.users (id) on delete restrict,
  opened_at timestamptz not null default now(),
  decided_by uuid references auth.users (id) on delete restrict,
  decided_at timestamptz,
  note text,
  unique (student_id, scope, scope_id, attempt)
);

create index if not exists path_reviews_student_scope_idx
  on public.path_reviews (student_id, scope, scope_id);

-- ──────────────────────────────────────────────────────────── path_task_events ──
-- Append-only R6 record: every transition writes one row (actor, role, from→to,
-- time). This is the "adult verification record" the tiering test requires, and
-- the source Unit 16 renders history from. Never UPDATEd — reversals append.
create table if not exists public.path_task_events (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.path_student_profiles (id) on delete restrict,
  task_id text not null,
  transition text not null,
  from_state text not null,
  to_state text not null,
  -- null for a `system` actor (the automatic unlock); a real uuid otherwise.
  actor uuid references auth.users (id) on delete restrict,
  actor_role text not null check (actor_role in ('student', 'adult', 'system')),
  note text,
  at timestamptz not null default now()
);

create index if not exists path_task_events_student_task_idx
  on public.path_task_events (student_id, task_id);

-- Decision 1: RLS on, zero policies. service-role only.
alter table public.path_task_progress enable row level security;
alter table public.path_reviews enable row level security;
alter table public.path_task_events enable row level security;

-- ──────────────────────────────────────────────────── path_maybe_open_review ──
-- Open the criterion review when — and only when — every task in the criterion
-- (per the student's PINNED version, not merely the rows that exist) is verified.
-- Serialized by a per-(student, criterion) advisory xact lock so two concurrent
-- verifies of the LAST two tasks cannot each read a stale "not all verified yet"
-- and both skip the open (the aggregate lost-update the Unit 7 review flagged).
-- Idempotent: an already-open review short-circuits; the unique constraint makes
-- a racing double-open reject rather than duplicate.
create or replace function public.path_maybe_open_review(
  p_student_id uuid,
  p_criterion_id text,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version text;
  v_total int;
  v_verified int;
  v_next_attempt int;
begin
  -- Serialize review-opens for this criterion (deadlock-free, unlike row locks).
  perform pg_advisory_xact_lock(hashtext(p_student_id::text), hashtext(p_criterion_id));

  select program_version_id into v_version
    from public.path_student_profiles where id = p_student_id;
  if v_version is null then
    return;
  end if;

  -- The criterion's TRUE task count comes from the pinned content, so a criterion
  -- whose progress rows are only partly materialized cannot wrongly read as done.
  select count(*) into v_total
    from public.path_unit_tasks
    where program_version_id = v_version and criterion_id = p_criterion_id;

  select count(*) into v_verified
    from public.path_task_progress
    where student_id = p_student_id
      and program_version_id = v_version
      and criterion_id = p_criterion_id
      and state = 'verified';

  if v_total = 0 or v_verified <> v_total then
    return;
  end if;

  -- An open review already stands → nothing to do (idempotent re-run).
  if exists (
    select 1 from public.path_reviews
    where student_id = p_student_id and scope = 'criterion' and scope_id = p_criterion_id
      and state = 'review_underway'
  ) then
    return;
  end if;

  select coalesce(max(attempt), 0) + 1 into v_next_attempt
    from public.path_reviews
    where student_id = p_student_id and scope = 'criterion' and scope_id = p_criterion_id;

  insert into public.path_reviews (student_id, scope, scope_id, attempt, state, opened_by)
  values (p_student_id, 'criterion', p_criterion_id, v_next_attempt, 'review_underway', p_actor)
  on conflict (student_id, scope, scope_id, attempt) do nothing;

  -- D6: withdraw is illegal once the review is open. All tasks are verified here,
  -- so this future-proofs the withdraw gate for the ceremony rather than changing
  -- T1 behaviour.
  update public.path_task_progress
    set review_opened_at = coalesce(review_opened_at, now()), updated_at = now()
    where student_id = p_student_id and criterion_id = p_criterion_id;
end;
$$;

revoke all on function public.path_maybe_open_review(uuid, text, uuid) from public;
revoke all on function public.path_maybe_open_review(uuid, text, uuid) from anon, authenticated;
grant execute on function public.path_maybe_open_review(uuid, text, uuid) to service_role;

-- ─────────────────────────────────────────────────────────────── move_path_task ──
-- The atomic transition executor. Compare-and-swap: the from-state is the
-- optimistic guard (first write wins); the target state is HARDCODED from the
-- transition name so a stale/tampered caller cannot smuggle a forged target in.
-- Returns the CURRENT row whether we won or lost, plus `wrote` (did OUR CAS write
-- it?), so the caller interprets the echo three ways (progress-core.ts) and tells
-- the loser of a concurrent verify who won, not an error.
--
-- The full transition LEGALITY (predecessor, display-block, note, D6, R6 clamp)
-- is decided by the pure engine (app/path/lib/path-rules.ts) in the calling
-- action BEFORE this runs. This RPC re-asserts only what defends the audit trail
-- under a bypass: the from-state CAS, and — for revoke — that the acting adult is
-- the ORIGINAL verifier (§9.5), as defense-in-depth.
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
    -- verify records the verifier; revoke CLEARS it (the task is no longer
    -- verified, so a stale attribution must not linger on the not_yet row); other
    -- transitions leave it untouched.
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
    -- unlock freezes the band if not already set (Unit 7's first-`available` rule).
    snapshot_band = case
      when p_transition = 'unlock' then coalesce(p.snapshot_band, p_band)
      else p.snapshot_band
    end,
    -- submit stamps the SERVER receive time (R30) and the CLIENT skew-clamped time
    -- (Unit 11), keeping both distinct.
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
      -- Cascade (Decision 5, atomic in this transaction): the just-verified
      -- task's coordinates, then unlock the immediate next task if it is locked,
      -- then open the criterion review if every task is now verified.
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
        -- alias + qualify: the RETURNS TABLE out-columns (state, verified_by, …)
        -- shadow the table columns, so the WHERE/COALESCE must be qualified.
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
      -- The revoked task's criterion is no longer fully verified, so any OPEN
      -- review of it is moot. Mark it `returned` (matching the Unit 7 engine's
      -- `nextCriterionState` → returned) so that (a) the aggregate is honest and
      -- (b) re-completing the criterion opens a FRESH attempt — path_maybe_open_
      -- review skips a still-open review, so without this a re-verify could never
      -- open attempt 2.
      update public.path_reviews r
        set state = 'returned', decided_by = p_actor, decided_at = now()
        from public.path_task_progress p
        where p.student_id = p_student_id and p.task_id = p_task_id
          and r.student_id = p_student_id and r.scope = 'criterion'
          and r.scope_id = p.criterion_id and r.state = 'review_underway';
    end if;
  end if;

  -- Echo the current row (won or lost). Empty result = the progress row does not
  -- exist (a provisioning gap); the caller treats an empty echo as an anomaly.
  return query
    select v_wrote, p.state, p.verified_by, p.decided_at
    from public.path_task_progress p
    where p.student_id = p_student_id and p.task_id = p_task_id;
end;
$$;

revoke all on function public.move_path_task(uuid, text, text, text, uuid, text, text, timestamptz, text) from public;
revoke all on function public.move_path_task(uuid, text, text, text, uuid, text, text, timestamptz, text) from anon, authenticated;
grant execute on function public.move_path_task(uuid, text, text, text, uuid, text, text, timestamptz, text) to service_role;
