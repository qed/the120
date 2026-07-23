-- The Path T1 Unit 12 — durable notification + the review ceremony.
--
-- Two tables, one column, one trigger, one RPC:
--   * path_notification_events — the R27 in-app store (the under-13 student's
--     guaranteed channel). Rows carry KIND + PARAMS, never rendered copy (the
--     skin register resolves at read time, Unit 16). INSERT-plus-supersede-flag
--     only: a reversal appends its own event and stamps superseded_at on the
--     celebration it reverses — content is never UPDATEd in place.
--   * path_notification_sends — the parents email channel (Decision 8).
--     `sent_at` is the atomic claim STAMP: claim = conditional UPDATE … WHERE
--     sent_at IS NULL (row cardinality is the verdict), failure = CAS-guarded
--     unclaim on the exact stamp this invocation wrote. The stamp value is
--     JS-minted and opaque (never SQL now() — the CAS equality must round-trip
--     the app's own string). Rows carry PII (addresses, names in params) and sit
--     inside any future deletion scope.
--   * path_families.review_nudge_hours — the family-set reviewer stall
--     threshold (default 72h).
--   * path_parent_cap trigger — the DB-level backstop for the 2-parent seat cap
--     (Unit 15 carry-forward: acceptance is compensation-based; this is the real
--     serialization under concurrency).
--   * return_path_criterion() — the criterion-review "returned" ceremony
--     (§9.3). ATTEMPT-BASED decide on the open review row — not a simple CAS on
--     a task row — flipping the named tasks back to not_yet atomically.
--
-- Apply via the Management API — `supabase db push` is dead here (no DB
-- password). See docs/solutions/integration-issues/supabase-cli-stale-db-
-- password-management-api-workaround-2026-07-13.md. Precheck deps:
-- to_regclass('public.path_student_profiles'), ('public.path_task_progress'),
-- ('public.path_reviews'), ('public.path_families'), ('public.path_role_grants')
-- all non-null. After applying: verify with to_regclass (2 tables) and
-- to_regprocedure (the RPC + trigger fn), THEN record this version in
-- supabase_migrations.schema_migrations. A committed migration is not an
-- applied migration.
--
-- Rollout phase: SCHEMA + RPC + trigger. Seeds nothing. Idempotent throughout —
-- re-applying is a no-op.
--
-- Delete posture: every FK is ON DELETE RESTRICT (the Path-graph posture; the
-- plan names these tables explicitly — "RESTRICT or SET NULL, never CASCADE").
-- Decision 1: RLS enabled, ZERO policies — service-role only.

-- ───────────────────────────────────────────────── path_notification_events ──
-- Kind CHECK mirrors NOTIFICATION_EVENT_KINDS in app/path/lib/notify/
-- notify-rules.ts — a vitest parity test parses this file, edit both together.
create table if not exists public.path_notification_events (
  id uuid primary key default gen_random_uuid(),
  -- Semantic identity (task_event:{id} / review:{id}:opened / …): the
  -- idempotent-replay key — inline enqueue and the cron's reconcile pass both
  -- INSERT … ON CONFLICT DO NOTHING against it.
  dedupe_key text not null unique,
  student_id uuid not null references public.path_student_profiles (id) on delete restrict,
  kind text not null
    check (kind in ('verified', 'not_yet', 'review_underway', 'reopened', 'criterion_returned', 'phase_returned')),
  -- The subject: a task-scope kind carries task_id, a criterion/phase-scope
  -- kind carries scope_id. Nullable by design; params repeats them for renders.
  task_id text,
  scope_id text,
  params jsonb not null default '{}'::jsonb,
  -- The supersede FLAG — the only column a later write may touch, and only
  -- null → non-null. Unit 16 renders superseded events past-tense.
  superseded_at timestamptz,
  -- Unit 16 stamps this when the student sees the moment (celebration replay).
  seen_at timestamptz,
  created_at timestamptz not null default now()
);

-- Unit 16's read: a student's feed, newest first.
create index if not exists path_notification_events_student_created_idx
  on public.path_notification_events (student_id, created_at desc);

-- The supersede scan reads a student's LIVE events only.
create index if not exists path_notification_events_student_live_idx
  on public.path_notification_events (student_id)
  where superseded_at is null;

-- ───────────────────────────────────────────────── path_notification_sends ──
-- Kind CHECK mirrors SEND_KINDS in notify-rules.ts (same parity test).
create table if not exists public.path_notification_sends (
  id uuid primary key default gen_random_uuid(),
  -- {source}:parent:{userId} — "exactly one pending notification per parent"
  -- IS this unique constraint.
  dedupe_key text not null unique,
  student_id uuid not null references public.path_student_profiles (id) on delete restrict,
  recipient_user_id uuid not null references auth.users (id) on delete restrict,
  -- Snapshotted at enqueue: the address this notification was actually written
  -- for (PII — inside any future deletion scope).
  email text not null,
  kind text not null
    check (kind in ('submitted', 'stall_nudge')),
  params jsonb not null default '{}'::jsonb,
  -- THE claim stamp. NULL = pending. Set optimistically by the atomic claim
  -- (UPDATE … WHERE sent_at IS NULL), cleared by the CAS-guarded unclaim on
  -- failure. Non-null = sent (or an in-flight claim for the seconds of the
  -- attempt). Value is minted in JS — never DEFAULT now(), never touched by SQL.
  sent_at timestamptz,
  attempts int not null default 0,
  last_error text,
  last_attempt_at timestamptz,
  created_at timestamptz not null default now()
);

-- The cron's drain: pending rows, oldest first.
create index if not exists path_notification_sends_pending_idx
  on public.path_notification_sends (created_at)
  where sent_at is null;

-- The reconcile window scan on the event spine (path_task_events has only a
-- (student_id, task_id) index; the cron queries by time).
create index if not exists path_task_events_at_idx
  on public.path_task_events (at);

-- ──────────────────────────────────────── path_families.review_nudge_hours ──
-- The family-set stall threshold (R30's "nothing responds to a parent sitting
-- on a queue" — now something does). No UI in T1; staff-adjustable per family.
alter table public.path_families
  add column if not exists review_nudge_hours int not null default 72
  check (review_nudge_hours > 0);

-- ───────────────────────────────────────────────── parent-cap DB backstop ──
-- Unit 15 carry-forward: the 2-parent seat cap was compensation-enforced only
-- (post-write verify + self-delete). This trigger is the real serialization:
-- the count runs under a per-family advisory xact lock, so two concurrent
-- acceptances cannot both read 1 and both insert. It RAISES (unlike the
-- coerce-not-raise guards on client-writable CRM tables) because
-- path_role_grants is service-role-only — a violation here is our own code
-- racing, and the acceptance flow already treats an insert error as a refusal.
create or replace function public.path_parent_cap_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.role = 'parent' and NEW.scope_type = 'family' then
    -- An exact-duplicate grant is NOT a new seat: BEFORE INSERT fires ahead of
    -- ON CONFLICT DO NOTHING, so without this exemption every idempotent
    -- re-upsert (invite re-accept, seed re-runs) would raise at the cap
    -- instead of no-opping. The unique constraint still resolves the row.
    if exists (
      select 1 from public.path_role_grants
      where user_id = NEW.user_id and role = NEW.role
        and scope_type = NEW.scope_type and scope_id = NEW.scope_id
    ) then
      return NEW;
    end if;
    perform pg_advisory_xact_lock(hashtext('path_parent_cap'), hashtext(NEW.scope_id::text));
    if (
      select count(*)
      from public.path_role_grants
      where role = 'parent' and scope_type = 'family' and scope_id = NEW.scope_id
    ) >= 2 then
      raise exception 'path_parent_cap: family % already holds two parent seats', NEW.scope_id
        using errcode = '23514'; -- check_violation, so PostgREST reports it as a constraint error
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists path_parent_cap on public.path_role_grants;
create trigger path_parent_cap
  before insert on public.path_role_grants
  for each row execute function public.path_parent_cap_guard();

-- ───────────────────────────────────────────────────── return_path_criterion ──
-- The §9.3 criterion-review "returned" outcome. ATTEMPT-BASED, not a simple
-- CAS: the decide targets the exact (student, criterion, attempt) row the
-- reviewer was looking at, and only while it is still review_underway — a
-- concurrent co-parent's return of the same attempt loses cleanly and is shown
-- the winner (the echo below). Serialized with path_maybe_open_review's
-- advisory lock so a decide can never interleave with an open: at most one
-- review_underway row per criterion can ever exist (the Unit 8 carry-forward's
-- maybeSingle invariant holds through this path).
--
-- Task flips mirror `revoke`: verified → not_yet, verifier attribution cleared
-- (the task is no longer verified; a stale attribution must not linger), one
-- append-only audit event per task (transition 'criterion_return', so
-- decisionFromEvents can surface the return note on the task). Tasks in the
-- list that are not currently verified are skipped — the engine validates
-- membership before this runs; the state predicate is defense in depth.
-- review_opened_at is left untouched (matching revoke): the attempt cycle is
-- still in progress, so evidence-lock semantics hold.
--
-- The pure legality (note required, non-empty membership-checked list, adult
-- actor) is decided by the engine (path-rules evaluateTransition) in the
-- calling action BEFORE this runs; the raises below are defense in depth only.
create or replace function public.return_path_criterion(
  p_student_id uuid,
  p_criterion_id text,
  p_attempt int,
  p_returned_task_ids text[],
  p_actor uuid,
  p_note text
)
returns table (decided boolean, review_id uuid, review_state text, review_attempt int, review_decided_by uuid, review_decided_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_review_id uuid;
  v_task text;
begin
  if p_note is null or btrim(p_note) = '' then
    raise exception 'return_path_criterion: a note is required';
  end if;
  if p_returned_task_ids is null or array_length(p_returned_task_ids, 1) is null then
    raise exception 'return_path_criterion: the returned task list is empty';
  end if;

  -- The same lock path_maybe_open_review takes — opens and decides serialize.
  perform pg_advisory_xact_lock(hashtext(p_student_id::text), hashtext(p_criterion_id));

  update public.path_reviews r
    set state = 'returned', decided_by = p_actor, decided_at = now(), note = p_note
    where r.student_id = p_student_id
      and r.scope = 'criterion'
      and r.scope_id = p_criterion_id
      and r.attempt = p_attempt
      and r.state = 'review_underway'
    returning r.id into v_review_id;

  if v_review_id is not null then
    foreach v_task in array p_returned_task_ids loop
      update public.path_task_progress p
        set state = 'not_yet',
            verified_by = null,
            verified_role = null,
            decided_at = now(),
            updated_at = now()
        where p.student_id = p_student_id
          and p.task_id = v_task
          and p.state = 'verified';
      if found then
        insert into public.path_task_events
          (student_id, task_id, transition, from_state, to_state, actor, actor_role, note)
        values
          (p_student_id, v_task, 'criterion_return', 'verified', 'not_yet', p_actor, 'adult', p_note);
      end if;
    end loop;
  end if;

  -- Echo the criterion's CURRENT latest attempt whether we decided or not —
  -- the caller interprets (applied / superseded / stale attempt / not found)
  -- and tells a losing co-parent who decided and when, never an error.
  return query
    select (v_review_id is not null) as decided,
           r.id, r.state, r.attempt, r.decided_by, r.decided_at
    from public.path_reviews r
    where r.student_id = p_student_id
      and r.scope = 'criterion'
      and r.scope_id = p_criterion_id
    order by r.attempt desc
    limit 1;
end;
$$;

revoke all on function public.return_path_criterion(uuid, text, int, text[], uuid, text) from public;
revoke all on function public.return_path_criterion(uuid, text, int, text[], uuid, text) from anon, authenticated;
grant execute on function public.return_path_criterion(uuid, text, int, text[], uuid, text) to service_role;

-- Decision 1: RLS on, zero policies — service-role only.
alter table public.path_notification_events enable row level security;
alter table public.path_notification_sends enable row level security;
