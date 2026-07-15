-- Fix intensive dates in the GTM weekly checklist (2026-07-15). The Fall
-- Intensive moved to Nov 7–8, 2026 (the +1-week shift already reflected in
-- app/lib/site.ts / the live site since roadmap T4); the gtm_weeks seed
-- (20260713143000_crm_gtm.sql) still named the retired "Oct 31 / October
-- intensive" date in four checklist items. Updates the LIVE rows in place —
-- the applied seed migration stays untouched as history (same convention as
-- 20260714213000_debrand_library_copy.sql). replace() swaps only the date
-- substring, so each item's done/done_by/done_at state and array order are
-- preserved. Idempotent: re-running finds nothing once Nov 7–8 is in place.
-- Apply via the Supabase Management API (no DB password on disk — playbook:
-- docs/solutions/integration-issues/
--   supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md)
-- and record this version in supabase_migrations.schema_migrations.

update public.gtm_weeks
set actions = replace(actions::text, 'Oct 31 intensive', 'Nov 7–8 intensive')::jsonb
where week = 1;

update public.gtm_weeks
set actions = replace(actions::text, 'first-demo slot at the October intensive', 'first-demo slot at the Fall Intensive (Nov 7–8)')::jsonb
where week = 4;

update public.gtm_weeks
set actions = replace(actions::text, 'Oct 31 demo', 'Nov 7–8 demo')::jsonb
where week = 6;

update public.gtm_weeks
set actions = replace(actions::text, 'named the Founding 120 at the October intensive', 'named the Founding 120 at the Fall Intensive (Nov 7–8)')::jsonb
where week = 7;
