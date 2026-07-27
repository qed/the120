-- Staff Front Door, Unit 10: retire the four rehearsal cohorts (R21).
--
-- Apply via the Management API (playbook: docs/solutions/integration-issues/
-- supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md).
-- APPLY IMMEDIATELY. Lane A holds the lock; this is the plan's LAST migration,
-- and the lock transfers back in this same PR.
--
-- A DATA migration, its own file per the split-phase convention
-- (docs/solutions/workflow-issues/split-phase-migrations-*): no schema change, no
-- application code, no parity-test file. Correctness IS the POST-APPLY query.
-- The plan named this file `20260805130000_…`; that timestamp is two Lane-B
-- collisions stale, hence 20260807.
--
-- ── What it does, and the ORDER it does it in
--
-- The four cohorts below are rehearsals — none is a real weekend, and
-- `unit5-verify` sits on Boston's own (cancelled) dates, which is R21's whole
-- point: the hub's first factual claim ("N upcoming weekends") must be true the
-- day it ships.
--
-- REVOKE FIRST, THEN ARCHIVE — the same ordering the application core enforces,
-- kept in SQL for the same reason: a column-only archive over a live token is the
-- invisible-and-harmful state (hidden cohort, live unauthenticated board URL).
-- The plan asserted "board tokens are already all revoked as of 2026-07-27";
-- PRE-APPLY found that claim STALE — `rehearsal-unit9` held a live token, minted
-- by a later rehearsal. The revoke statement below is therefore load-bearing, not
-- ceremonial. `revoked_by` stays NULL, matching `archived_by` below: this
-- migration is the unattributed actor, and the banner/ops copy render both as
-- unrecorded (Unit 9 tested exactly this state).
--
-- `archived_by` stays NULL per `created_by`'s recorded rationale (the plan):
-- attribution names a human, and a migration is not one.
--
-- WHERE-guarded on slug: a fresh environment (no rehearsal rows) is a clean
-- no-op, and a slug that does not exist matches nothing. Re-applying is a no-op
-- both ways (`revoked_at is null` / `archived_at is null` predicates).
--
-- PRE-APPLY:
--   1. select slug, archived_at from path_cohorts where kind='fw'
--        order by created_at;
--      -- exactly: rehearsal-unit4, rehearsal-unit4-second, unit5-verify,
--      --          rehearsal-unit9; all archived_at null
--   2. select count(*) from path_fw_board_tokens t
--        join path_cohorts c on c.id = t.cohort_id
--        where c.slug in ('rehearsal-unit4','rehearsal-unit4-second',
--                         'unit5-verify','rehearsal-unit9')
--          and t.revoked_at is null;                       -- observed: 1 (unit9)
-- POST-APPLY (verify BEFORE recording the version):
--   3. select count(*) from path_cohorts
--        where kind='fw' and archived_at is null;          -- 0
--   4. the query from step 2;                              -- 0
--   5. select count(*) from path_cohorts
--        where archived_by is not null;                    -- 0 (unrecorded, all)
--   6. npm run fw -- cohorts   → empty active set; --json parses.
--   7. Only then: record the version.
--
-- ROLLBACK: `update path_cohorts set archived_at = null where slug in (…)` —
-- visibility only; the revoked tokens stay revoked (R25: revocation is permanent;
-- a rollback that resurrected a board URL would be a new hazard, not a restore).

update public.path_fw_board_tokens t
set revoked_at = now()
from public.path_cohorts c
where c.id = t.cohort_id
  and c.kind = 'fw'
  and c.slug in ('rehearsal-unit4', 'rehearsal-unit4-second', 'unit5-verify', 'rehearsal-unit9')
  and t.revoked_at is null;

update public.path_cohorts
set archived_at = now()
where kind = 'fw'
  and slug in ('rehearsal-unit4', 'rehearsal-unit4-second', 'unit5-verify', 'rehearsal-unit9')
  and archived_at is null;
