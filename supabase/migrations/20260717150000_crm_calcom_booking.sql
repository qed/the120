-- Cal.com booking webhook + implied-consent expiry (plan 2026-07-17-002,
-- Phase 3 foundation — Units 7 & 8). Apply at the START of Phase 3, BEFORE the
-- Unit 8 gate change and the Unit 7 webhook deploy, via the Management API
-- playbook (docs/solutions/integration-issues/
-- supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md), and
-- record this version in supabase_migrations.schema_migrations.

-- 1. call_booked provenance (Unit 7, R15/R16). A manual stampCall leaves
--    call_booked_uid NULL, so a Cal.com BOOKING_CANCELLED (which clears only
--    when its uid matches the stored uid) can never wipe a manually-set stamp.
--    call_booked_event_at holds the winning event's createdAt for the
--    out-of-order guard (apply an event only if createdAt >= stored value;
--    NULL means "no prior webhook stamp — proceed").
alter table public.families
  add column if not exists call_booked_uid text,
  add column if not exists call_booked_event_at timestamptz;

-- 2. CASL implied-consent expiry (Unit 8, R14). NULL = no expiry (express /
--    existing consent — backward-compatible: every current row stays eligible).
--    A booking-sourced lead gets now()+6mo; the nurture send-gate stops at
--    expiry (consent_given && !revoked && (expires is null || now < expires)).
alter table public.families
  add column if not exists consent_expires_at timestamptz;

-- 3. Webhook idempotency (Unit 7, R16). Cal.com sends no delivery id, so the
--    handler synthesizes event_key = sha256(triggerEvent + ':' + uid + ':' +
--    createdAt) and records it here; a duplicate delivery hits the PK and is a
--    no-op. Service-role only (RLS on, zero policies — the staff-table
--    convention; supabaseAdmin bypasses RLS). A TTL purge (~7-14 days) is a
--    follow-up, since Cal.com retries within a bounded window.
create table if not exists public.processed_webhook_events (
  event_key text primary key,
  created_at timestamptz not null default now()
);
alter table public.processed_webhook_events enable row level security;
