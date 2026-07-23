-- First Profit — Weekend Cohort Sprints, Unit 2: guide credential invites.
--
-- Unit 1's migration (20260728120000_fw_cohort_sprints.sql) carried seven DDL
-- groups and a pre/post-apply checklist enumerating exactly which objects to
-- verify. This table is Unit 2's, and it ships as its OWN file rather than an
-- eighth group in that one: the Unit 1 file is merged and reviewed against a
-- fixed object list, and the repo's split-phase migration practice
-- (docs/solutions/workflow-issues/split-phase-migrations-…) is one file per
-- landing. A separate file is also correct whether or not Unit 1 has been
-- applied yet — this table depends on NOTHING from it.
--
-- Apply via the Management API — `supabase db push` is dead here (no DB
-- password). See docs/solutions/integration-issues/supabase-cli-stale-db-
-- password-management-api-workaround-2026-07-13.md.
--
-- ⚠️ TIMING: applies with (or after) Unit 1's migration, which is itself HELD
-- until after the ~Jul 28 Chicago-rehearsal checkpoint. Nothing here is urgent
-- ahead of that — no guide can be provisioned before the FW cohorts exist.
--
-- Rollout phase: SCHEMA ONLY. Creates one empty table; seeds and backfills
-- nothing. Idempotent (create if not exists) — re-applying is a no-op.
--
-- PRE-APPLY:
--   1. select to_regclass('public.path_fw_guide_invites');  -- null (not yet)
-- POST-APPLY (verify BEFORE recording the version):
--   2. select to_regclass('public.path_fw_guide_invites');  -- non-null
--   3. select relname, relrowsecurity from pg_class
--        where relname = 'path_fw_guide_invites';           -- true
--   4. select count(*) from pg_policies
--        where tablename = 'path_fw_guide_invites';         -- 0
--   5. Only then: insert the version into
--      supabase_migrations.schema_migrations.
--
-- ROLLBACK: drops cleanly (the table is empty until the first guide is
-- provisioned, and dropping it only invalidates unclaimed links).
--
-- ── What this table is, and what it deliberately is not ──────────────────────
--
-- Decision 12: a guide's credential is issued by STAFF, per event, as a tokened
-- link — never by an email-based password reset. That is not a stylistic
-- preference. FW student addresses are name-derived and guessable on a
-- deliverable domain, and the repo's two password-reset forms call Supabase
-- from the BROWSER with the public anon key, where no server-side guard can
-- reach them (docs/solutions/security-issues/guard-function-with-no-callers-is-
-- not-a-mechanism-…-2026-07-23.md). The guide door therefore has NO "forgot
-- password" flow at all: Friday-morning recovery is a staff re-issue, which
-- rotates the hash below and re-opens the claim.
--
-- Threat posture, inherited wholesale from public.path_parent_invites
-- (app/path/lib/actions/invite.ts): 256 bits of entropy, SHA-256 HEX ONLY at
-- rest so a database read can never reconstruct a live link, single-use via a
-- CAS claim, per-IP rate limiting on the claim action, and a TTL (14 days —
-- FW_GUIDE_INVITE_TTL_MS, its own constant, not the parent invite's 7).
--
-- Delete posture: ON DELETE RESTRICT throughout, holding the Path graph's
-- posture (Unit 1's rationale). Deleting a guide's auth account while an invite
-- row points at it must FAIL LOUDLY — the row is the audit trail for who was
-- credentialed for a weekend.
create table if not exists public.path_fw_guide_invites (
  id uuid primary key default gen_random_uuid(),
  -- The guide account this invite credentials. ONE row per account (unique):
  -- a re-issue ROTATES this row rather than accumulating parallel live tokens,
  -- which is what makes "kills the old hash" true rather than aspirational.
  -- The account is created dormant (no password) and stays unusable until a
  -- claim sets one.
  user_id uuid not null unique references auth.users (id) on delete restrict,
  -- The address the link was mailed to, denormalized so the ops "all guides
  -- claimed" view and the resend action never need an Admin API round-trip per
  -- row. auth.users stays authoritative for the account's actual address.
  email text not null,
  -- SHA-256 hex of the raw base64url token. Unique so a hash lookup is one index
  -- probe (and a collision is a hard error, not a shared credential).
  token_hash text not null unique,
  expires_at timestamptz not null,
  -- Null = outstanding. Set by the claim's CAS; RESET TO NULL by a staff
  -- re-issue, which is the sanctioned recovery path for a guide who forgot the
  -- password they set (Decision 12). A claimed invite whose token was rotated is
  -- therefore indistinguishable from a fresh one — by design.
  claimed_at timestamptz,
  -- Stamped on every issue AND re-issue, so the ops surface can say "link sent
  -- 9 days ago, not claimed" without inferring it from expires_at minus a TTL
  -- constant that may change.
  issued_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

-- The ops surface's default view: who has an outstanding link, oldest first
-- (the pre-event checklist reads exactly this).
create index if not exists path_fw_guide_invites_open_idx
  on public.path_fw_guide_invites (issued_at)
  where claimed_at is null;

-- Decision 1 (Path-wide): RLS enabled, ZERO policies — service-role only. The
-- claim action is unauthenticated by design (the token IS the credential) and
-- reads this table through the service-role client after hashing the token;
-- there is no anon/authenticated path to it.
alter table public.path_fw_guide_invites enable row level security;
