-- The Path T1 Unit 6 — D26 staff-mediated recovery audit action.
--
-- Adds 'path-recovery' to the crm_audit_log action allowlist. The
-- recoverPathStudentAccess staff action (app/crm/lib/actions/path-recovery.ts)
-- writes this value; the DB CHECK and app/crm/lib/constants.ts AUDIT_ACTIONS
-- are updated in the SAME change — the drift class documented in
-- docs/solutions/best-practices/crm-audit-action-allowlist-db-check-constraint-
-- drifts-from-ts-enum-2026-07-15.md, now permanently pinned by
-- app/crm/__tests__/audit-actions-parity.test.ts (which parses this file).
--
-- Apply via the Management API playbook (supabase db push is dead here — no DB
-- password; token in Windows Credential Manager `Supabase CLI:supabase`).
-- Verify the new constraint via pg_get_constraintdef BEFORE recording this
-- version in supabase_migrations.schema_migrations.
--
-- Rollout phase: PRE-DEPLOY — the constraint must accept 'path-recovery'
-- before the action ships. One ALTER carrying both clauses (atomic by
-- construction, so the immutable audit table never has a window without a
-- valid CHECK). Re-lists ALL existing values verbatim from AUDIT_ACTIONS;
-- re-applying yields the same end state.

alter table public.crm_audit_log
  drop constraint crm_audit_log_action_check,
  add constraint crm_audit_log_action_check check (action in (
    'family-add', 'stamp-call', 'clear-stamp', 'set-override', 'reopen',
    'note-add', 'contact-update', 'consent-revoke', 'merge', 'review-move',
    'group-assign', 'signal-toggle', 'concern-update', 'heat-override',
    'library-send', 'gtm-edit', 'drill-down', 'offer-email', 'referral-asked',
    'welcome-email', 'path-recovery'
  ));
