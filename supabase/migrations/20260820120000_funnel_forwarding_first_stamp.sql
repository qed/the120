-- Funnel wrap Unit 7, review follow-up (adversarial): the flip-flop hole
-- in the W14 backstop.
--
-- ⚠ VERSION: verified against the LIVE ledger immediately before authoring
--   (2026-07-29): top was 20260819120000 funnel_forwarding_stamp.
--
-- Every fresh forwarding request stamps a new forwarding_requested_at and
-- clears forwarding_alerted_at — correct per cycle, but a parent whose
-- account email changes more often than the 7-day bound resets the clock
-- every time and the ops page never fires, precisely for the families
-- whose email situation is least stable. This column records the FIRST
-- request ever for the child and is never cleared; the sweep pages when
-- either the current cycle or this total age crosses its bound.

alter table public.funnel_student_provisioning
  add column if not exists forwarding_first_requested_at timestamptz;
