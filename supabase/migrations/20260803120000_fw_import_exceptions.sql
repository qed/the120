-- First Profit — Weekend Cohort Sprints, Unit 7: the bulk importer's exception
-- table.
--
-- The CSV importer provisions accounts + memberships + locked progress for a
-- weekend's roster. Most rows mint or (for a returner) link cleanly, but a row
-- whose name matches MORE THAN ONE existing student, or matches one at a
-- different band, cannot be resolved by a machine without risking a duplicate
-- account (burning a permanent name-derived address, FW-D2) or merging two
-- children who share a name. Those rows are PARKED here, nothing minted, and
-- staff resolve them before event doors (gap G7) through the existing Unit 5b
-- match-resolution surface. This is the one table Unit 7 adds; accounts,
-- memberships, and progress all reuse Unit 1's tables.
--
-- Apply via the Management API — `supabase db push` is dead here (no DB
-- password). See docs/solutions/integration-issues/supabase-cli-stale-db-
-- password-management-api-workaround-2026-07-13.md.
--
-- APPLY IMMEDIATELY. Chicago cancelled (2026-07-23), no migration holds. A
-- schema revision after apply is a NEW migration, not an edit to this file.
--
-- Rollout phase: SCHEMA ONLY (one CREATE TABLE + three indexes + RLS enable).
-- Seeds/backfills nothing. Idempotent throughout (create if not exists /
-- pg_constraint-guarded RLS). Built WITHOUT `CONCURRENTLY` on the indexes, which
-- is INCOMPATIBLE with this repo's apply path (the Management API submits the
-- file as one implicit transaction; CREATE INDEX CONCURRENTLY cannot run inside a
-- transaction block). The table is created empty, so the index builds are instant.
--
-- Delete posture: both FKs (cohort, resolver) are ON DELETE RESTRICT, holding the
-- FW graph's posture — a delete that would strip the cohort an exception names
-- must FAIL LOUDLY. (This is also why a cohort with import exceptions, like one
-- with audit rows, cannot be casually deleted — the pre-event checklist resolves
-- them first.)
--
-- Decision 1 (Path-wide): RLS-enabled with ZERO policies — service-role only.
--
-- PRE-APPLY (run before submitting, in the same Management API session):
--   1. select to_regclass('public.path_cohorts');            -- non-null
--   2. select to_regclass('public.path_fw_import_exceptions'); -- null (new)
-- POST-APPLY (verify BEFORE recording the version):
--   3. select to_regclass('public.path_fw_import_exceptions'); -- non-null
--   4. select relrowsecurity from pg_class
--        where relname = 'path_fw_import_exceptions';           -- true
--   5. select count(*) from pg_policies
--        where tablename = 'path_fw_import_exceptions';         -- 0
--   6. select indexname from pg_indexes where schemaname = 'public'
--        and indexname in (
--          'path_fw_import_exceptions_pending_name_idx',
--          'path_fw_import_exceptions_cohort_open_idx',
--          'path_fw_import_exceptions_one_pending_per_name_idx');  -- 3 rows
--   7. select indexdef from pg_indexes
--        where indexname='path_fw_import_exceptions_one_pending_per_name_idx';
--      -- confirm UNIQUE, on (cohort_id, normalized_name), WHERE state='pending'.
--   8. Only then: insert the version into supabase_migrations.schema_migrations.
--
-- ROLLBACK: drop table if exists public.path_fw_import_exceptions; (empty table,
-- no dependents until Unit 7's importer runs).

create table if not exists public.path_fw_import_exceptions (
  id uuid primary key default gen_random_uuid(),
  -- The cohort the import targeted — the scope the exception is resolved within,
  -- and what a forged id from another weekend is checked against.
  cohort_id uuid not null references public.path_cohorts (id) on delete restrict,
  -- Student-shaped fields, exactly as typed in the CSV row that could not be
  -- resolved. band mirrors path_student_profiles' three-band CHECK so a resolved
  -- exception can hand these straight to quick-create.
  first_name text not null,
  last_name text not null,
  band text not null check (band in ('g3_5', 'g6_8', 'g9_12')),
  -- The fwMatchKey for (first_name, last_name) — the SAME normalized key
  -- path_student_profiles.normalized_name carries, so the widened match lookup
  -- (loadFwMatchCandidates) finds a pending exception by one indexed probe.
  normalized_name text not null,
  -- A short machine reason (e.g. 'ambiguous_match'); the ops surface renders copy.
  reason text not null,
  -- pending → open; resolved → staff linked/created the student; dismissed →
  -- staff judged it noise. Only 'pending' rows constrain a re-import or a
  -- quick-create.
  state text not null default 'pending' check (state in ('pending', 'resolved', 'dismissed')),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete restrict
);

-- The G7 lookup: "is there a pending exception of THIS name?", run by every
-- quick-create and every re-import. Partial on state so it stays the size of the
-- OPEN exceptions, not every exception ever raised.
create index if not exists path_fw_import_exceptions_pending_name_idx
  on public.path_fw_import_exceptions (normalized_name)
  where state = 'pending';

-- The ops surface's default view: this cohort's still-open exceptions.
create index if not exists path_fw_import_exceptions_cohort_open_idx
  on public.path_fw_import_exceptions (cohort_id)
  where state = 'pending';

-- ONE pending exception per name per cohort. The importer's park is idempotent —
-- a re-import of the same ambiguous row must not stack a second exception — and
-- the writer treats the resulting unique violation as success. Partial on
-- 'pending' so a name can be re-flagged after an earlier one was resolved.
create unique index if not exists path_fw_import_exceptions_one_pending_per_name_idx
  on public.path_fw_import_exceptions (cohort_id, normalized_name)
  where state = 'pending';

-- Decision 1: RLS enabled, ZERO policies — service-role only.
alter table public.path_fw_import_exceptions enable row level security;
