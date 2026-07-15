-- Offer email stamp + audit allowlist extension (plan 2026-07-15-001, Unit 1).
-- Applied PRE-DEPLOY: the sendOfferEmail action depends on the stamp column
-- and the extended crm_audit_log action allowlist the moment it deploys.
-- Apply via the Management API playbook (docs/solutions/integration-issues/
-- supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md)
-- and record this version in supabase_migrations.schema_migrations.

-- 1. Per-child offer-sent stamp (atomic claim-then-send home). Lives on
--    child_reviews (staff-only RLS, service-role writes, cascades with the
--    child), so no server-owned coerce trigger is needed -- unlike the
--    children.submission_notified_at precedent, parents can never write here.
alter table public.child_reviews
  add column if not exists offer_email_sent_at timestamptz;

-- 2. Extend the audit action allowlist with 'offer-email'. One ALTER TABLE
--    statement carrying both clauses: atomic by construction, so the
--    immutable audit table never has a window where an unvalidated action
--    string could land (such a row could never be corrected or removed).
--    Constraint name verified against the live DB 2026-07-15.
alter table public.crm_audit_log
  drop constraint crm_audit_log_action_check,
  add constraint crm_audit_log_action_check check (action in (
    'family-add', 'stamp-call', 'clear-stamp', 'set-override', 'reopen',
    'note-add', 'contact-update', 'consent-revoke', 'merge', 'review-move',
    'group-assign', 'signal-toggle', 'concern-update', 'heat-override',
    'library-send', 'gtm-edit', 'drill-down', 'offer-email'
  ));
