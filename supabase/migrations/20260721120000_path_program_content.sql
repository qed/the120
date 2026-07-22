-- The Path T1 Unit 4 — program content skeleton (DDL half).
--
-- Referential integrity for phases, criteria, and tasks WITHOUT curriculum prose
-- in SQL (Decision 7). These four tables hold only structural identity — stable
-- slug ids, sequence, version, and the parent FK. Every title, body, Done-when
-- line, and band variant lives in the generated TS module
-- (app/path/content/generated/program-2026-27.ts) and is seeded by NOTHING into
-- these tables. That is what structurally avoids the recorded em-dash seed-drift
-- incident (docs/solutions/database-issues/silent-zero-row-update-em-dash-hyphen-
-- title-drift-crm-library-2026-07-14.md).
--
-- Apply via the Management API — `supabase db push` is dead here (no DB
-- password). See docs/solutions/integration-issues/supabase-cli-stale-db-
-- password-management-api-workaround-2026-07-13.md. After applying: verify each
-- table with to_regclass, THEN insert this file's version into
-- supabase_migrations.schema_migrations. A committed migration is not an applied
-- migration.
--
-- Rollout phase: PRE-SEED SCHEMA. This file creates empty tables only; the seed
-- (scripts/seed-path-content.ts) runs after, and depends on these tables
-- existing. Idempotent throughout — re-applying is a no-op.
--
-- Immutability contract (D27): content rows are immutable per version. A
-- curriculum revision inserts new rows under a NEW program_version_id; it never
-- updates or deletes rows a pinned student references. This is the DB-side
-- companion to Unit 3's keep-old-generated-modules rule.
--
-- Delete posture: every FK is ON DELETE RESTRICT, deliberately AGAINST the
-- repo's house CASCADE idiom (auth.users → parents → children). A student's
-- pinned version and its content must never be cascaded away — a delete that
-- would strip content out from under an active student must fail loudly. RESTRICT
-- holds throughout the Path graph (Units 5, 8, 10, 12).

-- The version registry. `is_current` designates the version new students pin to
-- at provisioning (Unit 6). Prose (the human label) stays in the TS manifest.
create table if not exists public.path_program_versions (
  id text primary key,                       -- stable slug, e.g. '2026-27'
  is_current boolean not null default false,
  created_at timestamptz not null default now()
);

-- At most one version may be current at a time. A partial unique index on the
-- TRUE rows enforces it: a second `is_current = true` insert is rejected, so
-- flipping the pin target is a deliberate two-step, never an accident.
create unique index if not exists path_program_versions_one_current
  on public.path_program_versions (is_current)
  where is_current;

-- Phases: five per version, '01'..'05', with the phase-key slug (SELL/BUILD/…).
create table if not exists public.path_phases (
  program_version_id text not null
    references public.path_program_versions (id) on delete restrict,
  num text not null,                         -- '01'..'05'
  phase_key text not null,                   -- 'SELL' | 'BUILD' | 'VALIDATE' | 'GROW' | 'SCALE'
  seq int not null,                          -- global ordinal within the version (1..5)
  primary key (program_version_id, num)
);

-- Criteria: the pass criteria, keyed by their 'phase.criterion' slug ('1.1').
create table if not exists public.path_criteria (
  program_version_id text not null,
  criterion_id text not null,                -- '1.1'
  phase_num text not null,
  seq int not null,                          -- 1-based WITHIN the phase; not globally unique
  primary key (program_version_id, criterion_id),
  foreign key (program_version_id, phase_num)
    references public.path_phases (program_version_id, num) on delete restrict
);

-- Unit tasks: 125 per version, keyed by their 'phase.criterion.task' slug
-- ('1.1.1'). This is the FK anchor Unit 8's path_task_progress and Unit 10's
-- evidence will reference. The composite FK ties a task to a criterion WITHIN a
-- version, so progress can never reference a task from the wrong version.
create table if not exists public.path_unit_tasks (
  program_version_id text not null,
  task_id text not null,                     -- '1.1.1'
  criterion_id text not null,
  seq int not null,                          -- 1-based WITHIN the criterion; not globally unique
  primary key (program_version_id, task_id),
  foreign key (program_version_id, criterion_id)
    references public.path_criteria (program_version_id, criterion_id) on delete restrict
);

-- Decision 1: every Path table gets RLS ENABLED with ZERO policies — service-role
-- only, matching public.gauntlet_tournament_entries. There is no anon/authenticated
-- read or write path. The app reads curriculum content from the pinned TS module
-- (getProgram), never from these tables at request time; only the service-role
-- seed writes them and only service-role provisioning reads is_current.
alter table public.path_program_versions enable row level security;
alter table public.path_phases enable row level security;
alter table public.path_criteria enable row level security;
alter table public.path_unit_tasks enable row level security;
