-- The Path T1 Unit 5 — identity schema (role grants, families, cohorts, students).
--
-- The account model, linked to the existing CRM roster. public.children stays
-- authoritative for name and grade (R31); band is DERIVED from grade, never
-- stored here twice. Authorization is NOT expressed in RLS — every Path table is
-- RLS-enabled with ZERO policies (Decision 1, matching Unit 4 and
-- public.gauntlet_tournament_entries); the pure resolvePathAccess verdict
-- (app/path/lib/access-rules.ts), running inside a service-role guard, is what
-- stands between a caller and another family's Founder File.
--
-- Apply via the Management API — `supabase db push` is dead here (no DB
-- password). See docs/solutions/integration-issues/supabase-cli-stale-db-
-- password-management-api-workaround-2026-07-13.md. After applying: verify each
-- object with to_regclass, THEN record this version in
-- supabase_migrations.schema_migrations. A committed migration is not an applied
-- migration.
--
-- Depends on Unit 4's DDL half (path_program_versions) — the program_version_id
-- FK below references it. Verify to_regclass('public.path_program_versions') is
-- non-null before applying.
--
-- Rollout phase: SCHEMA ONLY. Creates empty tables; no rows are seeded here.
-- Idempotent throughout (create table if not exists) — re-applying is a no-op.
--
-- Delete posture: every FK is ON DELETE RESTRICT, deliberately AGAINST the
-- repo's house CASCADE idiom (auth.users → parents → children). A delete that
-- would strip a student's account, roster row, or pinned content out from under
-- an active Founder File must FAIL LOUDLY, never silently cascade. In particular
-- path_student_profiles.child_id → public.children is RESTRICT, so a CRM parent
-- deletion (which cascades to children) is blocked while a Path profile links
-- that child — the block propagating up is the intended safety, not a bug.
-- RESTRICT holds throughout the Path graph (Units 8, 10, 12).

-- Families: the Path-owned grouping a parent and their students share. Kept
-- separate from public.families (a CRM lead concept with tombstones/merges);
-- Unit 15 backfills the linkage for already-enrolled families.
create table if not exists public.path_families (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- Cohorts: the group a Guide reads across (~24 families, R5). A student's
-- cohort_id may be null (not yet assigned) — resolvePathAccess treats a null as
-- matching no Guide, so an unassigned student is invisible to Guides rather than
-- visible to all of them.
create table if not exists public.path_cohorts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  created_at timestamptz not null default now()
);

-- Student profiles: one per Path student account, linking the sign-in account
-- (auth.users), the authoritative roster row (public.children), the pinned
-- program version (D27, immutable after provisioning), the family, and the
-- cohort. NOT the home of name/grade/band — those come from public.children.
create table if not exists public.path_student_profiles (
  id uuid primary key default gen_random_uuid(),
  -- the student's own sign-in account (Unit 6 provisions it). RESTRICT: deleting
  -- the account must fail while a profile (and its evidence) exists.
  user_id uuid not null unique references auth.users (id) on delete restrict,
  -- the authoritative roster row (R31). RESTRICT protects the Founder File from
  -- a cascading CRM delete.
  child_id uuid not null unique references public.children (id) on delete restrict,
  -- pinned at provisioning, immutable thereafter (D27). NOT NULL so a content
  -- revision can never silently rewrite an active student's remaining tasks.
  program_version_id text not null
    references public.path_program_versions (id) on delete restrict,
  family_id uuid not null references public.path_families (id) on delete restrict,
  -- nullable: a student not yet placed in a cohort (see resolvePathAccess).
  cohort_id uuid references public.path_cohorts (id) on delete restrict,
  created_at timestamptz not null default now()
);

-- family_id / cohort_id have no unique constraint, so they need explicit indexes
-- for the "students in this family/cohort" reads. child_id does NOT: its `unique`
-- constraint above already builds an equivalent btree index (used by the FK
-- RESTRICT check on public.children deletes too), so a separate index would just
-- be a duplicate maintained on every write.
create index if not exists path_student_profiles_family_id_idx
  on public.path_student_profiles (family_id);
create index if not exists path_student_profiles_cohort_id_idx
  on public.path_student_profiles (cohort_id);

-- Role grants (Decision 2): a human holds grants, not a role column, so one
-- person can be a `parent` scoped to a family AND a `guide` scoped to a cohort
-- at once (which D24 requires forbidding self-countersign for). scope_id is
-- POLYMORPHIC against scope_type (a family id, a cohort id, or a student
-- profile id), so it carries no FK — resolvePathAccess compares ids, never
-- dereferences them, and a grant to a since-deleted scope simply stops matching.
--
-- A student is provisioned TWO grants (Unit 6): ('student','student',<profile>)
-- for self-identity and ('student','family',<family>) for membership — the pair
-- is what lets a sibling see position without seeing evidence.
create table if not exists public.path_role_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete restrict,
  role text not null check (role in ('student', 'parent', 'guide')),
  scope_type text not null check (scope_type in ('student', 'family', 'cohort')),
  scope_id uuid not null,
  created_at timestamptz not null default now(),
  -- the same grant is never stored twice; the seed/provisioning upserts on this.
  unique (user_id, role, scope_type, scope_id)
);

-- The hot path: resolvePathAccess loads a caller's grants by user_id.
create index if not exists path_role_grants_user_id_idx
  on public.path_role_grants (user_id);

-- Decision 1: RLS enabled, ZERO policies — service-role only. Provisioning
-- (Unit 6, service role) writes these; requirePathUser (service role) reads
-- them. There is no anon/authenticated path. Note: student provisioning inserts
-- into auth.users + these tables, never into public.parents, so it does not trip
-- the on_parent_created trigger.
alter table public.path_families enable row level security;
alter table public.path_cohorts enable row level security;
alter table public.path_student_profiles enable row level security;
alter table public.path_role_grants enable row level security;
