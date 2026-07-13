-- GTM W1: explicit kid count per family — every family is worth 1+ potential
-- signups, and warm convos / calls booked are counted kid-weighted on the
-- Sprint tab. Staff-editable in the pipeline drawer; display and weighting
-- use max(kid_count, observed kids) so truth (dossiers / lead-kid entries)
-- can push the number up but never down.
-- Apply via the Management API playbook (docs/solutions/integration-issues/
-- supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md).

alter table public.families
  add column kid_count integer not null default 1;

alter table public.families
  add constraint families_kid_count_range check (kid_count between 1 and 12);
