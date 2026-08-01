-- First Profit Slice B (Unit 1): the parent-signup anchor + the verifiable
-- parental-consent record. Plan: first-profit repo docs/plans/
-- 2026-08-01-001-feat-slice-b-signup-provisioning-plan.md.
--
-- ⚠ VERSION: verified against the LIVE ledger immediately before authoring
--   (2026-08-01): top of supabase_migrations.schema_migrations was
--   20260828120000 fp_ledger_grant_and_profile_touch, so 20260829120000 is
--   free. Apply via the Management API playbook.
--
-- RLS POSTURE — BOTH tables are SERVICE-ROLE ONLY: RLS enabled, ZERO policies,
-- all grants revoked from anon/authenticated. This is the locked requirement
-- from the Slice B Unit 0 parent-principal RLS audit: a client-writable or
-- client-readable parental-consent record is a compliance failure, and the
-- signup-token/attempt state must never be visible to the anon key shipped in
-- every SPA bundle. The cross-origin signup routes touch these ONLY through the
-- service-role client; verdicts return to the SPA in JSON, never via PostgREST.
-- Precedent: funnel_resume_tokens (20260805150000) and funnel_released_aliases
-- (20260817120000) — both RLS-on/zero-policies, pinned by a pg_policies count.
--
-- FK posture — ON DELETE SET NULL (NOT the FP game tables' RESTRICT): a consent
-- record is compliance EVIDENCE that must survive deletion of the child/parent
-- it references (an R28 erasure request deletes it EXPLICITLY, in order; a
-- routine account delete must not be BLOCKED by a consent FK, and must not
-- silently destroy the evidence either). SET NULL unlinks and preserves.
--
-- Idempotent throughout (create ... if not exists); additive-only.

-- ---------------------------------------------------- fp_signup_attempts
-- The multi-step signup anchor: one row per signup attempt. Holds the hashed
-- single-use email-verification token, the attempt state (for idempotent/
-- resumable signup, R10), and the is_test flag (server-determined, R16/guarded
-- test families). parent_id/child_id are filled as the flow progresses.
create table if not exists public.fp_signup_attempts (
  id uuid primary key default gen_random_uuid(),
  parent_email text not null,
  -- set once the parent auth account is created (SET NULL so an account delete
  -- doesn't block/destroy the attempt audit).
  parent_id uuid references auth.users (id) on delete set null,
  child_id uuid references public.children (id) on delete set null,
  state text not null default 'started'
    check (state in ('started', 'verified', 'child_created', 'complete', 'abandoned')),
  -- sha256 hex of the single-use verification token; only the hash is stored.
  verification_token_hash text unique,
  verification_expires_at timestamptz,
  verified_at timestamptz,
  -- server-determined ONLY (an out-of-band test-family allowlist); never client
  -- input. Affects CRM/GTM visibility only, never gates consent/verification.
  is_test boolean not null default false,
  ip text not null default '',
  ua text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fp_signup_attempts_parent_email_idx
  on public.fp_signup_attempts (parent_email);
create index if not exists fp_signup_attempts_parent_id_idx
  on public.fp_signup_attempts (parent_id);

-- --------------------------------------------------- fp_parental_consent
-- The first-class verifiable-parental-consent record (net-new; decoupled from
-- the Stripe refund-policy consent it currently piggy-backs on). Bound to the
-- signup attempt so a consent captured before the child row exists can be
-- matched to the child at mint time, and cannot be re-attached to a different
-- child. Fixed columns + an extensible `evidence` jsonb so a legal-driven field
-- change does not force re-collection (additive-only can't cheaply revise a
-- populated regulated table).
create table if not exists public.fp_parental_consent (
  id uuid primary key default gen_random_uuid(),
  -- the binding: consent belongs to this attempt; child-mint verifies the match.
  signup_attempt_id uuid references public.fp_signup_attempts (id) on delete set null,
  parent_id uuid references auth.users (id) on delete set null,
  child_id uuid references public.children (id) on delete set null,
  -- OWN version namespace, independent of the Stripe refund-policy registry, so
  -- a refund-policy bump can never perturb a parental-consent verdict.
  policy_namespace text not null default 'fp_parental_consent',
  policy_version text not null,
  policy_hash text not null,
  -- a snapshot of exactly what the parent rendered (bind-to-rendered-version).
  rendered_text text not null,
  method text not null,
  -- COPPA under-13 vs 13-16 + GDPR-K need age + jurisdiction captured at consent
  -- time; can't be retrofitted without re-contacting parents.
  child_age_band text
    check (child_age_band is null or child_age_band in ('under_13', '13_to_15', '16_plus')),
  child_dob date,
  jurisdiction text not null default '',
  -- name/email snapshot of the verified parent at consent time.
  parent_identity jsonb not null default '{}'::jsonb,
  ip text not null default '',
  ua text not null default '',
  -- extensible legal-evidence blob (payment txn id later, method-specific proof,
  -- future required fields) so the fixed schema needn't churn.
  evidence jsonb not null default '{}'::jsonb,
  accepted_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists fp_parental_consent_attempt_idx
  on public.fp_parental_consent (signup_attempt_id);
create index if not exists fp_parental_consent_child_idx
  on public.fp_parental_consent (child_id);
create index if not exists fp_parental_consent_parent_idx
  on public.fp_parental_consent (parent_id);

-- ------------------------------------------------------------- RLS: lock down
-- Service-role only. RLS enabled, ZERO policies, all grants revoked from the
-- client roles. Nothing the SPA does reaches these through PostgREST.
alter table public.fp_signup_attempts enable row level security;
alter table public.fp_parental_consent enable row level security;

revoke all on public.fp_signup_attempts from anon, authenticated;
revoke all on public.fp_parental_consent from anon, authenticated;
