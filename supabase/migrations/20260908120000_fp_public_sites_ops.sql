-- First Profit public sites — Unit 2 operational grants + audit action
-- (first-profit repo plan docs/plans/2026-08-03-002-feat-real-public-site-plan.md,
-- Unit 2). Two small pieces the claim/publish endpoints and the operator
-- lock action need:
--
--   1. service_role EXECUTE on fp_public_site_content(jsonb). The 20260907
--      migration revoked EXECUTE from PUBLIC (and anon/authenticated) on the
--      shared extraction function; that also stripped the default grant
--      service_role rode in on, so the Unit 2 claim backfill / publish
--      re-sync — which call it via PostgREST RPC with the service key to keep
--      ONE source of truth for the doc→projection mapping — would 42501.
--      Grant it back to service_role explicitly. anon/authenticated stay
--      revoked (it is not a public surface).
--
--   2. 'fp-site-lock' in the crm_audit_log action allowlist. The operator
--      lock/unlock of a child's public site (app/crm/lib/actions/fp-site.ts +
--      scripts/fp-site-lock.ts, both driving app/fp/lib/fp-site-ops-core.ts)
--      is a distinct, safety-critical staff action and gets its OWN audit
--      action per the one-entry-per-staff-action rule on AUDIT_ACTIONS
--      (app/crm/lib/constants.ts) — updated in the SAME change, parity pinned
--      by app/crm/__tests__/audit-actions-parity.test.ts (which parses this
--      file; the last re-add wins).
--
-- ⚠ VERSION — AUTHORED, NOT YET APPLIED. Depends on 20260907120000
--   fp_public_sites (the function it grants on) — apply strictly after it.
--   The TRUE next-free slot MUST be reconfirmed against the LIVE ledger
--   immediately before applying; if the live top is not 20260907120000,
--   RENAME this file to the real next-free 12:00:00 slot before applying.
--   Apply via the Management API playbook (docs/solutions/integration-issues/
--   supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md).
--   Do NOT write schema_migrations by hand.
--
-- Rollout phase: PRE-DEPLOY — the grant and the constraint must both be live
-- before the Unit 2 endpoints/actions ship. Idempotent: re-granting is a
-- no-op; the CHECK re-add re-lists ALL existing values verbatim, so
-- re-applying yields the same end state.

-- ------------------------------------------------- 1. extraction fn grant
grant execute on function public.fp_public_site_content(jsonb) to service_role;

-- ------------------------------------------------- 2. audit action allowlist
alter table public.crm_audit_log
  drop constraint crm_audit_log_action_check,
  add constraint crm_audit_log_action_check check (action in (
    'family-add', 'stamp-call', 'clear-stamp', 'set-override', 'reopen',
    'note-add', 'contact-update', 'consent-revoke', 'merge', 'review-move',
    'group-assign', 'signal-toggle', 'concern-update', 'heat-override',
    'library-send', 'gtm-edit', 'drill-down', 'offer-email', 'referral-asked',
    'welcome-email', 'path-recovery', 'fp-site-lock'
  ));
