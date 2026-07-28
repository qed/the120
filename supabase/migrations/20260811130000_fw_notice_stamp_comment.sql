-- fw: correct the notice_attested_* column comments (ops/guide redesign, Unit 10).
--
-- Documentation-only DDL, zero data change. The 2026-07-28 decision (Peter)
-- removed the quick-create attestation checkbox: the program notice is covered
-- by online registration (website -> application -> staff review -> acceptance),
-- and quick-create is the backup entry path. The columns are now stamped
-- SILENTLY with the submitting guide on every quick-create insert -- a
-- provenance marker ("created via quick-create by X"), no longer a consent
-- attestation. The original comment in 20260728120000_fw_cohort_sprints.sql
-- ("a profile no adult has confirmed saw the program notice") would otherwise
-- misdirect a future compliance question.
--
-- The null/non-null split still discriminates quick-create rows from imported
-- rows (the importer stamps null on purpose), which the unfinished-student
-- banner (20260808130000_fw_intended_cohort.sql) depends on.
--
-- POST-APPLY verify:
--   select col_description('public.path_student_profiles'::regclass,
--     (select attnum from pg_attribute
--       where attrelid = 'public.path_student_profiles'::regclass
--         and attname = 'notice_attested_by'));
--   -- expect: the provenance wording below
--
-- Rollback: re-run with the previous wording (comments carry no data).

comment on column public.path_student_profiles.notice_attested_at is
  'Provenance stamp: when this profile was created via guide quick-create. Since 2026-07-28 this is stamped silently (no attestation checkbox); the program notice is covered by online registration. Null means the row arrived via import or another path.';
comment on column public.path_student_profiles.notice_attested_by is
  'Provenance stamp: the guide whose quick-create submission created this profile. No longer a consent attestation (2026-07-28 decision). Non-null remains the quick-create discriminator the unfinished-student banner reads.';
