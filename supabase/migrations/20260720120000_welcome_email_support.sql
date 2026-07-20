-- Week-1 Welcome Email support (plan 2026-07-20-001, Unit 1 / Phase 1).
--
-- Applied PRE-DEPLOY: the go-forward welcome triggers (U4 web route, U5
-- addFamily), the resend action (R13), and the backfill (U7) write a
-- crm_audit_log row with action 'welcome-email' and read families.is_test, so
-- both must exist before that code deploys. Apply via the Management API
-- playbook (docs/solutions/integration-issues/
-- supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md) and
-- record this version in supabase_migrations.schema_migrations; verify with a
-- count(*)/introspection SELECT (no API error != rows changed).
--
-- families.welcome_email_at already exists (20260713110000_crm_core.sql) and is
-- the single idempotency stamp — NOT re-added here. No coerce guard on it:
-- families RLS is admin/active-staff only, so a parent REST session cannot write
-- the column at all (plan Open Questions / Deferred; contrast children_notified_guard
-- in 20260714200000, needed only because children is client-writable).

-- 1. Backfill/test-row exclusion flag (R9). Additive + NULL-safe default, so
--    existing rows are is_test=false and any code that ignores the column is
--    unaffected. Tagging specific rows (Kuperman + internal/staff) is a
--    post-deploy data step in U7, not part of this schema migration.
alter table public.families
  add column if not exists is_test boolean not null default false;

-- 2. Extend the audit action allowlist with 'welcome-email' (U5/U7/R13).
--    One ALTER TABLE carrying both clauses — atomic by construction, so the
--    immutable audit table never has a window without a valid CHECK. Re-lists
--    ALL existing values verbatim from app/crm/lib/constants.ts AUDIT_ACTIONS
--    (the authoritative source, which already includes 'referral-asked' from
--    20260717130000 — dropping it would break existing referral-ask audit
--    inserts). Constraint name verified against the live DB by
--    20260715090000_offer_email_stamp.
alter table public.crm_audit_log
  drop constraint crm_audit_log_action_check,
  add constraint crm_audit_log_action_check check (action in (
    'family-add', 'stamp-call', 'clear-stamp', 'set-override', 'reopen',
    'note-add', 'contact-update', 'consent-revoke', 'merge', 'review-move',
    'group-assign', 'signal-toggle', 'concern-update', 'heat-override',
    'library-send', 'gtm-edit', 'drill-down', 'offer-email', 'referral-asked',
    'welcome-email'
  ));
