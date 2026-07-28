-- fw: window-edit attribution columns (ops/guide redesign plan, Unit 4).
--
-- A weekend's start/end/time zone become editable after creation
-- (docs/plans/2026-07-28-002-feat-fw-ops-guide-redesign-plan.md). Attribution
-- follows the established PER-ROW pattern (path_cohorts.created_by,
-- path_fw_board_tokens.revoked_by) rather than path_fw_ops_audit: that table's
-- subject_user_id is NOT NULL (a window edit has no user subject) and its
-- charter is deliberately limited to the liability actions. A wrong window
-- "named nobody to ask" is exactly the gap these two columns close.
--
-- Nullable by design: rows created before this migration, and rows never
-- edited, carry null. The columns answer "who last moved this window, when" --
-- they are not an edit history.
--
-- PRE-APPLY verify:
--   select column_name from information_schema.columns
--     where table_name = 'path_cohorts' and column_name like 'window_edited%';
--   -- expect: zero rows
--
-- POST-APPLY verify:
--   select column_name, is_nullable from information_schema.columns
--     where table_name = 'path_cohorts' and column_name like 'window_edited%';
--   -- expect: window_edited_at (YES), window_edited_by (YES)
--
-- Rollback: alter table public.path_cohorts
--   drop column if exists window_edited_at, drop column if exists window_edited_by;
-- (Safe: no reader is deployed before the columns exist.)

alter table public.path_cohorts
  add column if not exists window_edited_at timestamptz;
alter table public.path_cohorts
  add column if not exists window_edited_by uuid references auth.users (id) on delete restrict;
