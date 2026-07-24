-- First Profit — Weekend Cohort Sprints, Unit 5b: the anonymize audit action.
--
-- Apply via the Management API — `supabase db push` is dead here (no DB
-- password). See docs/solutions/integration-issues/supabase-cli-stale-db-
-- password-management-api-workaround-2026-07-13.md.
--
-- APPLY IMMEDIATELY. The Chicago rehearsal was cancelled (2026-07-23) and the
-- repo-wide migration hold is retired: every migration applies to production as
-- soon as it is authored. A schema revision after apply is a NEW migration, not
-- an edit to this file.
--
-- Rollout phase: SCHEMA ONLY. Widens ONE existing CHECK constraint on an
-- EXISTING, NON-EMPTY table (Unit 5 already writes guide-grant audit rows).
-- Seeds and backfills nothing. Idempotent — re-applying is a no-op.
--
-- ── The one schema change Unit 5b needs ─────────────────────────────────────
--
-- Deletion of an FW student is anonymize-in-place (plan Decision 10), and it is
-- the SECOND of the two liability actions the plan's Scope Boundaries name (the
-- first, guide-grant changes, shipped in Unit 5). Its audit row carries an action
-- string the current CHECK does not permit, so the insert would fail at runtime
-- as a SILENT AUDIT GAP — the exact drift docs/solutions/best-practices/crm-audit-
-- action-allowlist-db-check-constraint-drifts-from-ts-enum-2026-07-15.md
-- documents. This migration is the DB half; FW_OPS_AUDIT_ACTIONS in
-- fw-ops-rules.ts is the TS half; fw-ops-migration-parity.test.ts pins them
-- together by set-equality, so adding one without the other is a red test.
--
-- WHY A SUPERSET DROP-AND-RE-ADD, exactly like 20260715090000_offer_email_stamp
-- extended crm_audit_log for a later unit: the new allowlist is a strict superset
-- of the old one, so every existing row (all 'guide_grant_added' /
-- 'guide_grant_revoked') validates trivially against the re-added constraint —
-- the ADD CONSTRAINT's validation scan cannot reject a row already in the table.
-- One `alter table` carrying both the DROP and the ADD is atomic, so the
-- immutable audit table never has a window where an unvalidated action could land
-- (and a wrong row there could never be corrected — the before-update/-delete
-- triggers forbid it).
--
-- NO NEW SUBJECT COLUMN. Unit 5's migration comment anticipated the anonymize
-- action "adds its own subject column", but that was speculative: an FW student
-- HAS an auth account (`path_student_profiles.user_id` → `auth.users.id`), which
-- is exactly what `path_fw_ops_audit.subject_user_id` already references. The
-- anonymized student's user_id is the subject; no distinct column is needed, and
-- adding a nullable one nothing populates would be a column that permits a hole
-- an audit row must not have.
--
-- ── ROLLBACK — read before touching. The window in which this "reverts cleanly"
-- CLOSED THE MOMENT Unit 5b's code deployed. `anonymizeFwStudent` writes a
-- 'student_anonymized' row on every deletion, and that code ships in the same
-- commit as this file, so by the time anyone reads this the table may hold real
-- anonymization records. Narrowing the CHECK back to the two old values would
-- make the constraint REJECT its own existing rows on the next validation and is
-- not a safe revert. The honest rollback is to roll back the DEPLOY, not the
-- schema: a wider allowlist with no writer is inert (compare the same note in
-- 20260801120000).
--
-- PRE-APPLY (run before submitting, same Management API session):
--   1. select conname, pg_get_constraintdef(oid) from pg_constraint
--        where conrelid = 'public.path_fw_ops_audit'::regclass and contype='c';
--      -- RECONFIRM the constraint's live name is path_fw_ops_audit_action_check
--      -- and its current allowlist is exactly ('guide_grant_added',
--      -- 'guide_grant_revoked'). If the name differs (a prior partial apply, a
--      -- hand-run fix), adjust the identifier below before applying.
--   2. select count(*) from public.path_fw_ops_audit
--        where action not in ('guide_grant_added','guide_grant_revoked');   -- 0
-- POST-APPLY (verify BEFORE recording the version):
--   3. select pg_get_constraintdef(oid) from pg_constraint
--        where conrelid = 'public.path_fw_ops_audit'::regclass
--          and conname = 'path_fw_ops_audit_action_check';
--      -- must now read exactly ('guide_grant_added', 'guide_grant_revoked',
--      -- 'student_anonymized'), matching FW_OPS_AUDIT_ACTIONS.
--   4. select tgname from pg_trigger
--        where tgrelid = 'public.path_fw_ops_audit'::regclass
--          and not tgisinternal;                                   -- still 2 (untouched)
--   5. Only then: insert the version into
--      supabase_migrations.schema_migrations.

do $$
begin
  -- Idempotent: extend only if the live CHECK does not already permit the
  -- anonymize action. A re-apply after success is a no-op; a first apply drops
  -- the two-value CHECK and re-adds it as the three-value superset atomically.
  --
  -- The DROP names the constraint literally. If that name is wrong (the pre-apply
  -- reconfirm above is exactly for this), the DROP fails LOUDLY at apply rather
  -- than silently leaving the old CHECK in place — which is the correct failure
  -- mode for a liability-relevant constraint.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.path_fw_ops_audit'::regclass
      and conname = 'path_fw_ops_audit_action_check'
      and pg_get_constraintdef(oid) ilike '%student_anonymized%'
  ) then
    alter table public.path_fw_ops_audit
      drop constraint path_fw_ops_audit_action_check,
      add constraint path_fw_ops_audit_action_check check (
        action in ('guide_grant_added', 'guide_grant_revoked', 'student_anonymized')
      );
  end if;
end
$$;
