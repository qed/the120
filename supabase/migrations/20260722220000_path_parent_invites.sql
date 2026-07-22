-- The Path T1 Unit 15 — second-parent invites (R4 permits two parents).
--
-- One row per outstanding invite: parent A invites a co-parent by email; the
-- emailed link carries a single-use token whose SHA-256 hex lands in
-- token_hash (the raw token is never stored — a DB read must not be a valid
-- credential). Acceptance stamps accepted_at/accepted_by and writes the
-- parent/family grant; validity (expiry, single-use, email match) is decided
-- by the pure inviteVerdict in app/path/lib/onboarding-rules.ts.
--
-- Apply via the Management API — `supabase db push` is dead here (no DB
-- password). See docs/solutions/integration-issues/supabase-cli-stale-db-
-- password-management-api-workaround-2026-07-13.md. Precheck:
-- to_regclass('public.path_families') must be non-null (Unit 5 applied).
-- After applying: verify with to_regclass('public.path_parent_invites'),
-- THEN record this version in supabase_migrations.schema_migrations.
--
-- Rollout phase: SCHEMA ONLY. Idempotent (create table if not exists).
--
-- Delete posture: RESTRICT throughout, per the Path graph rule (Unit 5) — an
-- invite row is an audit fact about who was let into a family; deleting a
-- family or an auth user must not silently erase it.

create table if not exists public.path_parent_invites (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.path_families (id) on delete restrict,
  -- the invited address, normalized lowercase at write; acceptance requires a
  -- session (or a fresh account) on exactly this address.
  email text not null,
  -- sha256 hex of the emailed token; unique so a token resolves at most one row.
  token_hash text not null unique,
  invited_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete restrict
);

-- The dashboard lists a family's pending invites; acceptance looks up by
-- token_hash (covered by its unique index above).
create index if not exists path_parent_invites_family_id_idx
  on public.path_parent_invites (family_id);

-- Decision 1: RLS enabled, ZERO policies — service-role only, like every Path
-- table. The accept flow runs through a guarded Server Action, never PostgREST.
alter table public.path_parent_invites enable row level security;
