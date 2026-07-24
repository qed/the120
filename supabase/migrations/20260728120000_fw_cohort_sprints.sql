-- First Profit — Weekend Cohort Sprints, Unit 1: the whole FW schema, one file.
--
-- Founders Weekend runs INSIDE the Path app: the same 125-task content, the same
-- events table, a different write path (Unit 3's fw_move_task) and a different
-- kind of student — a guide-provisioned, password-less, dormant account with no
-- CRM roster row behind it. This migration is everything that must exist in the
-- database before any of that can be built.
--
-- Apply via the Management API — `supabase db push` is dead here (no DB
-- password). See docs/solutions/integration-issues/supabase-cli-stale-db-
-- password-management-api-workaround-2026-07-13.md. Precheck deps:
-- to_regclass('public.path_student_profiles'), ('public.path_cohorts'),
-- ('public.path_task_events') all non-null. After applying: verify each new
-- object with to_regclass, THEN record this version in
-- supabase_migrations.schema_migrations. A committed migration is not an applied
-- migration.
--
-- APPLY IMMEDIATELY. An earlier revision of this header held the apply for a
-- ~Jul 28 Chicago-rehearsal checkpoint; that rehearsal was cancelled
-- (2026-07-23) and the hold is retired. Applied to production 2026-07-23. Any
-- schema revision from here is a NEW migration file, never an edit to this one —
-- which is the posture an applied migration always had; the hold only ever
-- deferred the moment that became true.
--
-- Rollout phase: SCHEMA ONLY. Creates empty tables, widens existing ones; seeds
-- nothing and backfills nothing (docs/solutions/workflow-issues/split-phase-
-- migrations-pre-deploy-schema-post-deploy-purge-separate-files-rerun-…).
-- Idempotent throughout (add column if not exists / create if not exists /
-- pg_constraint-guarded constraint adds) — re-applying is a no-op.
--
-- Delete posture: every new FK is ON DELETE RESTRICT, holding the Path graph's
-- posture (Unit 5's rationale: a delete that would strip a student's account,
-- record, or membership out from under a live Founder File must FAIL LOUDLY).
-- Deletion of an FW student is an ANONYMIZE-IN-PLACE action (plan Decision 10),
-- never a row delete — which is exactly why RESTRICT everywhere is affordable.
--
-- Decision 1 (Path-wide): every table is RLS-enabled with ZERO policies —
-- service-role only. Authorization is the pure resolver's job, not RLS's.
--
-- ─────────────────────────────────────────────── LOCKING POSTURE (accepted) ──
-- Two groups of statements below touch LIVE tables and take blocking locks. The
-- trade-off is accepted rather than engineered around, and here is why:
--
--   * The four ADD CONSTRAINT … CHECK statements are written WITHOUT `NOT
--     VALID`, so each validates every existing row under ACCESS EXCLUSIVE.
--     All four pass trivially — band/identity check against brand-new all-NULL
--     columns, kind against the just-applied 'path' default, window against
--     brand-new all-NULL columns — so the cost is scan duration, not a risk of
--     rejection. The NOT VALID + VALIDATE CONSTRAINT split would halve the lock
--     at the cost of doubling the statements; at the Path's current table size
--     (days old) that is not worth the complexity. RE-EVALUATE IF path_student_
--     profiles EXCEEDS ~100k ROWS.
--   * The three path_task_events indexes are built WITHOUT `CONCURRENTLY`,
--     which blocks writes to that table for the build. CONCURRENTLY is not
--     merely unused here — it is INCOMPATIBLE with this repo's apply path: the
--     Management API playbook submits the whole file as one query, Postgres runs
--     that as one implicit transaction, and CREATE INDEX CONCURRENTLY cannot run
--     inside a transaction block. Using it would mean splitting the apply into
--     separate non-transactional calls and giving up all-or-nothing rollback.
--
-- PRE-APPLY (run before submitting, in the same Management API session):
--   1. select to_regclass('public.path_student_profiles'),
--             to_regclass('public.path_cohorts'),
--             to_regclass('public.path_task_events');        -- all non-null
--   2. select count(*) from public.path_student_profiles where child_id is null;
--      -- MUST be 0. This is the one assumption behind "the CHECKs pass
--      -- trivially"; a non-zero count means the identity CHECK will ABORT the
--      -- apply, and the rows must be understood first.
--   3. select count(*) from public.path_student_profiles;
--      select count(*) from public.path_task_events;
--      -- bounds the scan/lock durations above. If path_task_events is large,
--      -- apply outside an active Path session window.
-- POST-APPLY (verify BEFORE recording the version):
--   4. to_regclass on all four new tables — non-null.
--   5. select conname, convalidated from pg_constraint where conname in
--      ('path_student_profiles_band_check','path_student_profiles_identity_present',
--       'path_cohorts_kind_check','path_cohorts_window_ordered');  -- 4 rows, all valid
--   6. select relname, relrowsecurity from pg_class where relname in
--      ('path_cohort_members','path_fw_board_tokens','path_fw_replay_rejects',
--       'path_fw_released_aliases');                          -- all true
--   7. select count(*) from pg_policies where tablename in (those four);  -- 0
--   8. Smoke: load a Path parent dashboard and a student task view — exercises
--      the now-nullable child_id against real (still non-null) rows.
--   9. Only then: insert the version into supabase_migrations.schema_migrations.
--
-- ROLLBACK: six of the seven groups drop cleanly (the four new tables are empty;
-- the added columns/constraints/indexes are droppable). The exception is
-- `child_id DROP NOT NULL`, which is reversible ONLY while every row still has a
-- child — i.e. only until the first FW student is provisioned by Unit 2/3. That
-- is a go/no-go checkpoint before those units deploy, not before this applies.
--
-- Seven DDL groups, in dependency order:
--   1. path_student_profiles  — the FW student shape (no child, own name+band)
--   2. path_task_events       — cohort stamp, capture time, action/idempotency
--   3. path_cohort_members    — many-weekends membership
--   4. path_cohorts           — kind flag + the event window
--   5. path_fw_board_tokens   — the projected board's tokened door
--   6. path_fw_replay_rejects — offline replays that could not be applied
--   7. path_fw_released_aliases — the freed-address ledger (Decision 10)

-- ═══════════════════════════════════════════ 1. path_student_profiles (FW shape) ──
-- A Path student IS a public.children row (name and grade authoritative there,
-- band DERIVED from grade). An FW student has no roster row at all: the guide
-- types a name and picks a band at the check-in table. So the profile grows a
-- second, self-contained identity shape, and child_id becomes optional.
--
-- What deliberately does NOT change: family_id and program_version_id stay NOT
-- NULL. FW provisioning mints a private single-student path_families row per FW
-- student rather than loosening a column every Path read assumes — an FW student
-- has no family YET, and a synthetic one is invisible (no parent grant points at
-- it) where a null would have to be narrowed at ~12 Path call sites. It also
-- gives a future FW→Path conversion a family row to merge INTO rather than a
-- null to fill.
alter table public.path_student_profiles alter column child_id drop not null;

-- The FW identity: typed by a guide, owned by this row (no children join).
-- band is stored here — NOT derived — because there is no grade to derive from.
alter table public.path_student_profiles add column if not exists first_name text;
alter table public.path_student_profiles add column if not exists last_name text;
alter table public.path_student_profiles add column if not exists band text;

-- Decision 13: the walk-in consent attestation is PERSISTED, not just a form
-- gate. Quick-create writes it at the table; the importer writes it when the
-- PROPOSED-3 notice sequence completes. A profile with a null attestation is a
-- profile no adult has confirmed saw the program notice.
alter table public.path_student_profiles add column if not exists notice_attested_at timestamptz;
alter table public.path_student_profiles
  add column if not exists notice_attested_by uuid references auth.users (id) on delete restrict;

-- The normalized name the PROPOSED-1 matcher looks a student up by. Stored as a
-- COLUMN, not an expression index, for the reason provision-rules.ts states about
-- names generally: ONE normalization for both sides of every comparison. The full
-- rule (NFKC → ASCII-fold → collapse → lowercase) is not expressible as an
-- immutable SQL function, so a lower(first_name) index would silently disagree
-- with the TS matcher on any accented name. fw-provision-rules.ts computes this
-- on write; the matcher compares against the same function's output.
--
-- Ships regardless of the PROPOSED-1 decision (plan Decision 17): if PROPOSED-1
-- is rejected the column is written and unread — harmless, and it keeps the
-- deletion ledger's same-name reasoning (Decision 10) available either way.
alter table public.path_student_profiles add column if not exists normalized_name text;

do $$
begin
  -- band is the FW-side mirror of path_task_progress.snapshot_band's CHECK; the
  -- two must list the same three bands or a materialized row could carry a band
  -- the profile cannot hold.
  if not exists (select 1 from pg_constraint where conname = 'path_student_profiles_band_check') then
    alter table public.path_student_profiles
      add constraint path_student_profiles_band_check
      check (band is null or band in ('g3_5', 'g6_8', 'g9_12'));
  end if;

  -- Decision 7 — the SUPERSET identity CHECK, permitting three shapes and
  -- refusing the fourth:
  --   Path row      child_id set, no name/band        → legal
  --   FW row        name + band set, no child         → legal
  --   converted row BOTH set (children authoritative
  --                 for name going forward)           → legal
  --   empty row     neither                           → ILLEGAL
  -- Written as a superset rather than a strict XOR precisely so FW→Path
  -- conversion stays a DATA operation and never needs another migration.
  if not exists (select 1 from pg_constraint where conname = 'path_student_profiles_identity_present') then
    alter table public.path_student_profiles
      add constraint path_student_profiles_identity_present
      check (
        child_id is not null
        or (first_name is not null and last_name is not null and band is not null)
      );
  end if;
end
$$;

-- Partial: only FW/converted rows carry a normalized name, so the index stays
-- the size of the FW roster rather than the whole Path population.
create index if not exists path_student_profiles_normalized_name_idx
  on public.path_student_profiles (normalized_name)
  where normalized_name is not null;

-- ═══════════════════════════════════════════════════ 2. path_task_events (FW columns) ──
-- FW and the Path SHARE this table — one event log, two write paths (plan
-- Decision 1). These four columns are what an FW event needs and a Path event
-- does not; all are nullable, so every existing Path write is untouched.
--
-- `at` remains the INSERT time (the server's clock, defaulted). captured_at is
-- the CAPTURE time — the moment the guide's finger hit the glass, which during
-- an outage can be twenty minutes earlier. The board's celebration freshness
-- gate (Decision 5) is exactly `at - captured_at <= 60s`; keeping them separate
-- columns from day one is the idempotent-reconciler learning applied
-- (docs/solutions/best-practices/idempotent-reconciler-replaying-one-way-flags-
-- needs-temporal-scope-2026-07-22.md). Null captured_at = "no distinct capture
-- time recorded", i.e. an online Path write, and readers fall back to `at`.
alter table public.path_task_events
  add column if not exists cohort_id uuid references public.path_cohorts (id) on delete restrict;
alter table public.path_task_events add column if not exists captured_at timestamptz;

-- action_id GROUPS a batch: one guide tap on three selected students writes
-- three events sharing one action_id, which is how the board rings ONE First
-- Dollar bell for a batched 1.2.4 instead of three (FW-D16).
alter table public.path_task_events add column if not exists action_id uuid;

-- client_id is the EXACTLY-ONCE key, per (student, task, tap). The offline queue
-- mints it at capture; a replayed drain carries the same value and the partial
-- unique index below turns the second insert into a no-op rather than a second
-- event. Resolves the plan's "Deferred to Implementation" idempotency-shape
-- question in favour of two columns + a partial unique index (over a dedupe
-- side-table): the write path is a single INSERT … ON CONFLICT DO NOTHING inside
-- the RPC's transaction, with no second table to keep consistent under the same
-- race the RPC already serializes.
alter table public.path_task_events add column if not exists client_id text;

create unique index if not exists path_task_events_client_id_key
  on public.path_task_events (client_id)
  where client_id is not null;

-- The board's read model scans a cohort's recent events every 3–5 s.
create index if not exists path_task_events_cohort_at_idx
  on public.path_task_events (cohort_id, at desc)
  where cohort_id is not null;

-- Celebration grouping reads a whole action at once.
create index if not exists path_task_events_action_id_idx
  on public.path_task_events (action_id)
  where action_id is not null;

-- ═══════════════════════════════════════════════════════ 3. path_cohort_members ──
-- Membership is MANY-TO-MANY and additive: a student who does Boston in August
-- and Hamptons in September holds two rows and one account. This is what makes
-- the returner's resume affordance (their record arrives filled) and Decision
-- 16's split possible — the grid is lifetime, the weekend's numbers are
-- cohort-stamped.
--
-- path_student_profiles.cohort_id (Unit 5) is the PATH's single-cohort column
-- and stays null for FW students; the two do not interact.
create table if not exists public.path_cohort_members (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.path_student_profiles (id) on delete restrict,
  cohort_id uuid not null references public.path_cohorts (id) on delete restrict,
  joined_at timestamptz not null default now(),
  -- A student joins a cohort once. The cohort-stamp verification (Decision 3)
  -- reads this as an authoritative set, so a duplicate would be a silent
  -- double-count in every cohort rollup.
  unique (student_id, cohort_id)
);

-- The roster read: "everyone in this cohort", run on every guide session start
-- and every board poll.
create index if not exists path_cohort_members_cohort_idx
  on public.path_cohort_members (cohort_id);

-- ═══════════════════════════════════════════════════════════════ 4. path_cohorts ──
-- `kind` is the fork in every FW authorization decision: the admin→guide bridge
-- (Unit 2) resolves a staff session to a guide ONLY in an fw cohort, and a board
-- token is mintable ONLY for an fw cohort (gap G18). Defaulted to 'path' so
-- every existing cohort keeps its meaning without a backfill.
alter table public.path_cohorts add column if not exists kind text not null default 'path';

-- Decision 4 (gap G4): the event window lives HERE, as the single source of
-- truth. Board-token expiry is derived from ends_at (+6 h grace), not typed
-- separately, so a re-minted token can never outlive its weekend. timestamptz:
-- five cities, three time zones — the ops form (Unit 5) is explicitly
-- timezone-aware and a test pins the conversion.
-- Nullable because Path cohorts have no event window.
alter table public.path_cohorts add column if not exists starts_at timestamptz;
alter table public.path_cohorts add column if not exists ends_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'path_cohorts_kind_check') then
    alter table public.path_cohorts
      add constraint path_cohorts_kind_check check (kind in ('path', 'fw'));
  end if;

  -- A backwards window would make every derived expiry nonsense (a token that
  -- expired before it was minted). Cheap to enforce, impossible to spot in ops.
  if not exists (select 1 from pg_constraint where conname = 'path_cohorts_window_ordered') then
    alter table public.path_cohorts
      add constraint path_cohorts_window_ordered
      check (starts_at is null or ends_at is null or ends_at > starts_at);
  end if;
end
$$;

-- ══════════════════════════════════════════════════════ 5. path_fw_board_tokens ──
-- The projected board's only door. Same discipline as the Unit 12 parent invite
-- (app/path/lib/actions/invite.ts): 256 bits of entropy, HASH-ONLY at rest, so a
-- database read can never reconstruct a live URL. The raw token is shown to
-- staff exactly once at mint.
create table if not exists public.path_fw_board_tokens (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references public.path_cohorts (id) on delete restrict,
  -- SHA-256 hex of the raw base64url token. Unique so a hash lookup is a single
  -- index probe (and a collision is a hard error, not a shared board).
  token_hash text not null unique,
  -- Derived at mint from the cohort's ends_at + 6 h grace (Decision 4) — stored
  -- rather than recomputed so a later ends_at edit cannot silently extend or
  -- kill a board mid-event.
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

-- Decision 4: ONE active token per cohort. Enforced structurally, not by the
-- mint action's discipline — a re-mint must revoke the prior row in the same
-- transaction or fail. (Ops consequence, on the checklist: a mid-event re-mint
-- kills the projector until the new URL is entered.)
create unique index if not exists path_fw_board_tokens_one_active_per_cohort
  on public.path_fw_board_tokens (cohort_id)
  where revoked_at is null;

-- ═══════════════════════════════════════════════════ 6. path_fw_replay_rejects ──
-- Decision 9 / gap G11: an offline check-in that could NOT be applied at drain
-- (re-auth failure, lost CAS, the same-actor undo guard refusing a cross-actor
-- correction) is recorded HERE — server-side, staff-visible — never only as a
-- tombstone on a guide's device that may itself have been revoked.
--
-- The resolved/dismissed state is the point: a reject list with no way to close
-- a row is a list nobody reads twice.
create table if not exists public.path_fw_replay_rejects (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.path_student_profiles (id) on delete restrict,
  task_id text not null,
  -- Nullable: "the entry's cohort could not be resolved" is itself one of the
  -- rejection reasons, and a reject must always be recordable — a FK failure at
  -- drain time would destroy the very record that explains the loss.
  cohort_id uuid references public.path_cohorts (id) on delete restrict,
  -- The guide whose device captured it. NOT NULL — the queue entry always
  -- carries an actor, and a reject nobody can be asked about is not actionable.
  actor uuid not null references auth.users (id) on delete restrict,
  action text not null check (action in ('checkmark', 'not_yet', 'undo')),
  -- A short machine reason (e.g. 'cross_actor_undo', 'reauth_failed'); the ops
  -- surface renders copy from it.
  reason text not null,
  -- Carried through so a resolved reject can be traced back to the queue entry.
  client_id text,
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete restrict
);

-- The ops surface's default view: this cohort's still-open rejects, newest first.
create index if not exists path_fw_replay_rejects_open_idx
  on public.path_fw_replay_rejects (cohort_id, created_at desc)
  where resolved_at is null;

-- ════════════════════════════════════════════════ 7. path_fw_released_aliases ──
-- Decision 10 — the freed-address ledger, and the reason deletion can be
-- anonymize-in-place without a lie.
--
-- FW addresses are NAME-DERIVED (maya.chen.fw@the120.school), and FW-D2 makes
-- that address a future contact channel. When a student is anonymized, their
-- address is renamed away and the local part it vacated is recorded here
-- FOREVER. The email builder's collision probe checks this ledger alongside live
-- accounts, so the next Maya Chen gets maya.chen2 — never the freed address that
-- somebody, somewhere, may still be holding for the first Maya.
create table if not exists public.path_fw_released_aliases (
  -- The local part WITHOUT the .fw suffix or domain (e.g. 'maya.chen'), which is
  -- exactly the unit the collision suffixer increments. PK: released once, ever.
  local_part text primary key,
  released_profile_id uuid not null references public.path_student_profiles (id) on delete restrict,
  released_at timestamptz not null default now()
);

-- ══════════════════════════════════════════════════════════════════════ RLS ──
-- Decision 1: enabled, ZERO policies. Every read and write above goes through a
-- service-role client behind a pure authorization verdict; there is no
-- anon/authenticated path to any of these tables, including the board's token
-- route (which reads through the service role after validating the hash).
alter table public.path_cohort_members enable row level security;
alter table public.path_fw_board_tokens enable row level security;
alter table public.path_fw_replay_rejects enable row level security;
alter table public.path_fw_released_aliases enable row level security;
