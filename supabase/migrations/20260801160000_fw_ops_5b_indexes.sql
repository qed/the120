-- First Profit — Weekend Cohort Sprints, Unit 5b: two supporting indexes
-- surfaced by the Unit 5b code review.
--
-- Apply via the Management API — `supabase db push` is dead here (no DB
-- password). See docs/solutions/integration-issues/supabase-cli-stale-db-
-- password-management-api-workaround-2026-07-13.md.
--
-- APPLY IMMEDIATELY. Chicago cancelled (2026-07-23), no migration holds. A
-- schema revision after apply is a NEW migration, not an edit to this file.
--
-- Rollout phase: SCHEMA ONLY (two CREATE INDEX). Seeds/backfills nothing.
-- Idempotent (`if not exists`). Both indexes are built WITHOUT `CONCURRENTLY`,
-- which is INCOMPATIBLE with this repo's apply path (the Management API submits
-- the file as one implicit transaction; CREATE INDEX CONCURRENTLY cannot run in a
-- transaction block). Both target tables are tiny — path_fw_replay_rejects is
-- empty until Unit 8's drain writes to it, and path_fw_ops_audit holds only the
-- handful of guide-grant + anonymize rows to date — so the brief ACCESS EXCLUSIVE
-- lock the non-concurrent build takes is instant.
--
-- ── 1. path_fw_ops_audit — one anonymize per subject (concurrency correctness) ──
--
-- The anonymize audit write is the second of the plan's two liability actions.
-- Two staff anonymizing the SAME student concurrently both pass the "not yet
-- anonymized" check before either finishes, share the idempotent
-- alias/tombstone/rename writes, and — without this — would each insert an
-- immutable `student_anonymized` row for ONE real event (the audit table's
-- triggers forbid deleting the duplicate). This partial UNIQUE index makes a
-- second row impossible at the database, and `ensureAnonymizeAudit` treats the
-- resulting unique violation as success (the row already exists). Partial on the
-- action so it constrains ONLY the anonymize action — guide-grant rows (many per
-- subject over time) are untouched.
--
-- PRECONDITION (reconfirm in the pre-apply query below): at most one
-- `student_anonymized` row per subject_user_id today, or the index build aborts.
--
-- ── 2. path_fw_replay_rejects — student-scoped open-reject lookups (perf) ──
--
-- `listFwOpsStudents` (every ops-page load) and `countOpenRejectsForStudent`
-- (every anonymize) filter open rejects by `student_id` with NO cohort_id — the
-- orphan-reject warning is deliberately cross-cohort. The only existing index
-- (`path_fw_replay_rejects_open_idx`) leads with `cohort_id`, so a student-scoped
-- query cannot seek it and would scan every open reject program-wide. This
-- partial index (mirroring that one's `where resolved_at is null`) serves the
-- student-scoped reads directly. Same posture as Unit 5's
-- 20260801140000_fw_grant_scope_idx (first scope-not-user filter → its own index).
--
-- PRE-APPLY (same Management API session):
--   1. select subject_user_id, count(*) from public.path_fw_ops_audit
--        where action='student_anonymized' group by 1 having count(*) > 1;
--      -- MUST be 0 rows, or the unique index build aborts (understand the
--      -- duplicates first — they would be a pre-index concurrency artifact).
--   2. select to_regclass('public.path_fw_ops_audit'),
--             to_regclass('public.path_fw_replay_rejects');   -- both non-null
-- POST-APPLY (verify BEFORE recording the version):
--   3. select indexname from pg_indexes where schemaname='public'
--        and indexname in ('path_fw_ops_audit_one_anonymize_idx',
--                          'path_fw_replay_rejects_student_open_idx');  -- 2 rows
--   4. select indexdef from pg_indexes
--        where indexname='path_fw_ops_audit_one_anonymize_idx';
--      -- confirm UNIQUE, on (subject_user_id), WHERE action='student_anonymized'.
--   5. Only then: insert the version into
--      supabase_migrations.schema_migrations.
--
-- ROLLBACK: both indexes drop cleanly (`drop index if exists …`). Dropping the
-- unique index re-opens the concurrent-double-audit window but loses no data;
-- the app-level probe-then-insert still makes a duplicate unlikely.

create unique index if not exists path_fw_ops_audit_one_anonymize_idx
  on public.path_fw_ops_audit (subject_user_id)
  where action = 'student_anonymized';

create index if not exists path_fw_replay_rejects_student_open_idx
  on public.path_fw_replay_rejects (student_id)
  where resolved_at is null;
