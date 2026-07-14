-- Dossier intake polish & approval gate (plan 2026-07-14-002, Unit 9a):
-- purge stored test scores (R3 — the field is fully retired).
--
-- Purge-in-place: the column and its default ('') stay, so any straggler
-- client can't error; code stopped reading/writing test_scores in the same
-- release. A column drop is a possible follow-up once a SECOND clean count
-- confirms no stale tab re-uploaded values.
--
-- APPLY POST-DEPLOY ONLY (rollout step 3): a pre-deploy live session still
-- runs the old bundle whose childToRow round-trips test_scores on autosave
-- and would resurrect the purged values. Deploys do NOT reload open tabs —
-- re-run this UPDATE and the verification 24–48h after deploy:
--   select count(*) from public.children where test_scores <> '';  -- expect 0
--
-- Safe on fresh environments (no-op on empty data). Apply via the
-- Management API playbook (docs/solutions/integration-issues/
-- supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md).

update public.children set test_scores = '' where test_scores <> '';
