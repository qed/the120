-- Funnel wrap Unit 7 (W14): forwarding bookkeeping on the provisioning claim.
--
-- ⚠ VERSION: verified against the LIVE ledger immediately before authoring
--   (2026-07-29): top was 20260818120000 funnel_provisioning_fencing, so
--   20260819120000 is free.
--
-- Three columns, all server-side only (the narrow column grant to
-- `authenticated` is untouched — family sessions still see exactly
-- child_id/state/forwarding_state/email):
--
--   forwarding_target       — the parent email the verification was sent
--                             to. Needed because the target is re-read at
--                             CALL time on every drive (W14): if the
--                             parent's account email has changed, a new
--                             request must go to the NEW address, while a
--                             matching pending target must NOT re-send.
--   forwarding_requested_at — when the verification mail went out; the
--                             N-day unverified ops-alert bound reads it.
--   forwarding_alerted_at   — the one-shot stamp for that alert (its own
--                             column: the stale-claim sweep's
--                             ops_alerted_at is cleared on every landing
--                             write, which would re-arm this alert too).
--
-- All statements idempotent; additive-only. Apply via the Management API
-- playbook and read the ledger row back.

alter table public.funnel_student_provisioning
  add column if not exists forwarding_target text;

alter table public.funnel_student_provisioning
  add column if not exists forwarding_requested_at timestamptz;

alter table public.funnel_student_provisioning
  add column if not exists forwarding_alerted_at timestamptz;
