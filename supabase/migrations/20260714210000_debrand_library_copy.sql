-- De-brand outbound copy (2026-07 rebrand, PR #7 follow-up). The library
-- seed rows staff paste into emails still named the retired network brands
-- (TimeBack / Alpha Anywhere / GT Anywhere), diverging from the rebranded
-- site. Updates the LIVE rows in place — the applied seed migration
-- (20260713170000_crm_library.sql) stays untouched as history. Rows are
-- keyed by title (uuids are generated at seed time); the touch trigger
-- maintains updated_at. Titles are matched by LIKE prefix, not equality:
-- the live rows carry plain ASCII hyphens where the seed file has em-dashes
-- (the original seed application flattened them), so exact-match on the
-- seed file's text misses. The replacement title uses a hyphen to match
-- the live rows' convention. Also rewrites the week-3 GTM checklist item that
-- directed staff to write branded social posts.
-- Apply via the Supabase Management API (no DB password on disk — playbook:
-- docs/solutions/integration-issues/
--   supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md)
-- and record this version in supabase_migrations.schema_migrations.

update public.library_items set
  body = 'The Full Academic Core is $15,000 CAD a year: everything in Membership, plus 5 hours a week of AI-adaptive, mastery-based academics — the complete academic core — for 1 to 3 subjects of your choice, and a bi-weekly 30-minute 1:1 with an expert Academic Advisor. It supports Ontario homeschool registration. It''s offered on your call — most families start with Membership.'
where title = 'THE FULL ACADEMIC CORE, EXPLAINED';

update public.library_items set
  title = 'PLATFORM RESULTS - TORONTO FAMILIES',
  body = 'Real Toronto numbers from the learning platform behind The 120''s academics. In a little over 5 weeks, one Grade 4 Toronto kid went from Grade 3 to Grade 5 in Math, Grade 3 to Grade 8 in Vocabulary, and Grade 4 to Middle School in Science. His Grade 7 brother placed into Grade 10 Math. Shared with permission — the full stories are at the120.school/parents, in the parents'' own words.'
where title like 'TIMEBACK RESULTS%';

update public.library_items set
  body = 'The 120 isn''t a school — it''s a selective network and Ontario learning centre. Members keep their school; the weekly rhythm is designed to sit alongside it, with math acceleration through Math Academy. For homeschooling families, the Full Academic Core tier provides a complete, AI-adaptive academic core and supports Ontario homeschool registration.'
where title = 'HOW THIS FITS ONTARIO SCHOOL (OR HOMESCHOOL)';

update public.library_items set
  body = 'Three Toronto families on the learning platform behind The 120''s academics — in their own words: live progress visibility, kids asking for extra work, and week-by-week placement jumps. The strongest proof page we have: https://the120.school/parents'
where title like '/PARENTS%PARENT STORIES';

-- Week-3 GTM checklist: de-brand the task text, preserving each item's
-- done/done_by/done_at state and array order.
update public.gtm_weeks
set actions = (
  select jsonb_agg(
    case when elem->>'id' = 'w3-a1'
      then jsonb_set(elem, '{text}', to_jsonb('Value-first posts (founder''s platform-results story from /parents — real data, real kids) in Ontario gifted/enrichment parent Facebook groups and ABC Ontario chapters; offer the explainer PDF on request'::text))
      else elem
    end
    order by ord
  )
  from jsonb_array_elements(actions) with ordinality as t(elem, ord)
)
where week = 3;
