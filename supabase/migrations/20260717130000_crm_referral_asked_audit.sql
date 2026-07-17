-- Referral-asked audit action (plan 2026-07-17-002, Unit 1 / Phase 1).
-- Applied PRE-DEPLOY: the markReferralAsked action (R1) writes a
-- crm_audit_log row with action 'referral-asked' the moment it deploys, so the
-- allowlist must accept it first. Apply via the Management API playbook
-- (docs/solutions/integration-issues/
-- supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md)
-- and record this version in supabase_migrations.schema_migrations.

-- Extend the audit action allowlist with 'referral-asked'. One ALTER TABLE
-- statement carrying both clauses: atomic by construction, so the immutable
-- audit table never has a window where an unvalidated action string could land.
-- Re-lists all existing values verbatim (constraint name verified against the
-- live DB by the 20260715090000_offer_email_stamp migration).
alter table public.crm_audit_log
  drop constraint crm_audit_log_action_check,
  add constraint crm_audit_log_action_check check (action in (
    'family-add', 'stamp-call', 'clear-stamp', 'set-override', 'reopen',
    'note-add', 'contact-update', 'consent-revoke', 'merge', 'review-move',
    'group-assign', 'signal-toggle', 'concern-update', 'heat-override',
    'library-send', 'gtm-edit', 'drill-down', 'offer-email', 'referral-asked'
  ));
