-- First Profit — Founders Weekend (review fix, 2026-07-28): scope the roster's
-- unfinished-student banner with `intended_cohort_id`.
--
-- DECISION (Peter, 2026-07-28): the banner is scoped to the cohort where the
-- quick-create was attempted. The membership-less arm of the candidate query was
-- GLOBAL (a half-created profile belongs to no cohort in the data), so a
-- membership-leg failure in Boston surfaced that child's name on EVERY cohort's
-- roster — including a Hamptons guide's, crossing the same cross-cohort privacy
-- line PROPOSED-1 redacts everywhere else. The profile now records which cohort
-- the walk-in was being added to when provisioning began, and the banner's
-- candidate query filters on it.
--
-- Quick-create stamps the column on the profile INSERT itself (provision-core.ts,
-- alongside `notice_attested_by` — the same arm, the same discriminator); the
-- bulk importer and Path provisioning leave it null, so their rows can never
-- reach the banner via this column any more than they could via the attestation.
--
-- Apply via the Management API — `supabase db push` is dead here (no DB
-- password). See docs/solutions/integration-issues/supabase-cli-stale-db-
-- password-management-api-workaround-2026-07-13.md.
--
-- APPLY IMMEDIATELY (no migration holds; Chicago cancelled 2026-07-23).
--
-- Rollout phase: SCHEMA ONLY (one nullable column + one partial index). Seeds
-- and backfills nothing. NO BACKFILL by decision: production has 0 active FW
-- cohorts, so the legacy orphans this cannot stamp do not exist in any state a
-- guide can see; a null-stamped legacy orphan simply never surfaces on the
-- banner again (accepted — the resume path still reaches it via typed-name
-- lookup, which does not read this column).
--
-- Idempotent — `add column if not exists` / `create index if not exists`, so
-- re-applying is a no-op.
--
-- The index is PARTIAL on `child_id is null` because that is the banner
-- candidate query's own filter (child_id null AND notice_attested_by not null
-- AND intended_cohort_id = X): the table grows with the entire Path program,
-- whose rows all carry child_id and a null intended_cohort_id, and none of them
-- can ever be a candidate. Same style as the Unit 7 exceptions' partial index.
--
-- PRE-APPLY (same Management API session):
--   1. select to_regclass('public.path_student_profiles');   -- non-null
--   2. select column_name from information_schema.columns
--        where table_schema='public' and table_name='path_student_profiles'
--          and column_name='intended_cohort_id';             -- MUST be 0 rows
-- POST-APPLY (verify BEFORE recording the version):
--   3. same query as (2);                                    -- 1 row
--   4. select indexdef from pg_indexes
--        where indexname='path_student_profiles_intended_cohort_idx';
--      -- on (intended_cohort_id) WHERE child_id IS NULL
--   5. Only then: insert the version into
--      supabase_migrations.schema_migrations.
--
-- ROLLBACK:
--   drop index if exists public.path_student_profiles_intended_cohort_idx;
--   alter table public.path_student_profiles drop column if exists intended_cohort_id;
-- (safe — nothing else reads the column; the banner's query would need the code
--  rolled back with it).

alter table public.path_student_profiles
  add column if not exists intended_cohort_id uuid references public.path_cohorts (id);

comment on column public.path_student_profiles.intended_cohort_id is
  'cohort a quick-create walk-in was being added to when provisioning began; scopes the unfinished-student banner; null for import/Path-created profiles';

create index if not exists path_student_profiles_intended_cohort_idx
  on public.path_student_profiles (intended_cohort_id)
  where child_id is null;
