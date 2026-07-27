-- First Profit funnel — Unit 3: resume tokens and the DB-backed rate limiter
-- (plan 2026-07-27-002, R6, R7, R7a–R7d, R8).
--
-- Lane B holds the migration lock (supabase/MIGRATION-LOCK.md). Apply via the
-- Management API playbook (docs/solutions/integration-issues/
-- supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md).
--
-- BOTH tables land here deliberately: R7d's limiter cannot be the in-memory
-- store (documented TOCTOU + FIFO eviction clears lockouts, and serverless
-- instances share no memory), and U6's capture endpoint reuses the same
-- store — shipping the tokens without the limiter would hand U6 a second
-- production migration for a unit that is supposed to be application code.
--
-- Every statement is idempotent; additive only.

-- ───────────────────────────────── resume tokens (R6, R7)
-- One row per outstanding resume link. The raw token is NEVER stored — a DB
-- read must not be a usable credential (R7): token_hash is the sha256 hex.
-- Single-use is enforced by the redeem CAS (update … where token_hash = $1
-- and redeemed_at is null), not by application probes.
--
-- ON DELETE CASCADE, unlike path_parent_invites' RESTRICT: an invite is an
-- audit fact about who was admitted to a family; a resume token is an
-- ephemeral credential that is meaningless once its account is gone.
create table if not exists public.funnel_resume_tokens (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references auth.users (id) on delete cascade,
  -- the normalized address the mail went to; redemption re-derives nothing
  -- from the URL (R7b), and the resend affordance on an expired landing needs
  -- the address without asking for it (asking would be an enumeration form).
  email text not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  redeemed_at timestamptz
);

create index if not exists funnel_resume_tokens_parent_id_idx
  on public.funnel_resume_tokens (parent_id);

-- RLS on, ZERO policies (Decision 11): service-role only. The redeem flow
-- runs through a Server Action; the anon key — which ships in every client
-- bundle — must not be able to see even the existence of a token row.
alter table public.funnel_resume_tokens enable row level security;

-- ───────────────────────────────── rate-limit events (R7d)
-- A generic DB-backed sliding-window store: one row per counted attempt,
-- keyed by (bucket, key_hash). The KEY IS HASHED — it is `${ip}` or
-- `${ip}:${email}`, which is PII; equality is all the limiter needs, so the
-- table stores sha256 hex and the retention purge (U17) never has to treat
-- this table as personal data.
--
-- The race-safe discipline is INSERT-THEN-COUNT, in the application: record
-- the attempt first, then count the window INCLUDING your own row. Two
-- concurrent racers each see the other's committed row and both fail closed
-- at the boundary — never both pass (the documented TOCTOU is
-- count-then-insert). An infra failure releases its own row (a DB outage is
-- not a real attempt).
create table if not exists public.funnel_rate_events (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  key_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists funnel_rate_events_probe_idx
  on public.funnel_rate_events (bucket, key_hash, created_at);

alter table public.funnel_rate_events enable row level security;

comment on table public.funnel_resume_tokens is
  'Funnel resume links (R7): sha256-at-rest, single-use via redeem CAS, short TTL. Service-role only.';
comment on table public.funnel_rate_events is
  'DB-backed sliding-window rate limiter (R7d). key_hash = sha256 of ip / ip:email. Insert-then-count.';
