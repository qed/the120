-- Staff Front Door, Unit 6 (second file): the residue beacon's durable store.
--
-- Apply via the Management API (see the sibling 20260806120000 file's header
-- for the playbook pointer and the lock note). APPLY IMMEDIATELY.
--
-- ⚠️ A SECOND FILE, not a widening of 20260806120000, on purpose: that one is
-- the plan's Unit 6 (SCHEMA ONLY, two columns, reviewed against R19/R20), and
-- this one is Peter's 2026-07-27 decision to give the Unit 5 beacon a real
-- table in the same lock window. Different requirement, different rollback,
-- different reviewers' questions — bundling them would make "roll back the
-- beacon table" mean "lose the archive columns".
--
-- Rollout phase: schema + one write path. Unit 5 shipped the beacon as a
-- `[fw/residue]` log line because Lane A did not hold the migration lock; this
-- table is what "a place to read it" was always meant to be. The Server Action
-- (`sendFwResidueBeacon`) starts inserting here in the same PR; the log line
-- REMAINS (grep-ability during an incident is worth one duplicate line).
--
-- Idempotent — `create table if not exists`, `create index if not exists`.
--
-- PRE-APPLY:
--   1. select to_regclass('public.path_fw_residue_reports');   -- null
-- POST-APPLY (verify BEFORE recording the version):
--   2. same;                                                   -- not null
--   3. select count(*) from information_schema.columns
--        where table_schema='public'
--          and table_name='path_fw_residue_reports';           -- 9
--   4. select relrowsecurity from pg_class
--        where oid = 'public.path_fw_residue_reports'::regclass; -- t
--   5. Only then: record the version.
--
-- ROLLBACK: `drop table` loses only telemetry rows; the beacon degrades back
-- to Unit 5's log line (the write path treats an insert failure as non-fatal).
--
-- ── Shape, and the two deliberate non-FKs ────────────────────────────────────
--
--   session_user_id     WHO SENT the report — authenticated server-side from
--                       the live session. FK, cascade: these are telemetry
--                       rows, and deleting an account must not be blocked by
--                       its old device reports (contrast `archived_by`, where
--                       restrict protects live attribution).
--   claimed_actor_user_id  WHO THE DEVICE SAYS the outcome happened under —
--                       untrusted client data, uuid-validated in zod. NO FK,
--                       deliberately: the value of this column is that it may
--                       DISAGREE with reality (a handover raced the POST; an
--                       old bundle claimed an account since deleted). An FK
--                       would refuse exactly the rows worth reading.
--   device_id           A random, client-persisted browser identity. NO FK —
--                       nothing to reference; it exists only in this table and
--                       the device's own localStorage.
--   queue_remaining     Captures still on the device, or NULL when the clear
--                       THREW and the count is genuinely unknown. NULL is not
--                       zero (the sentinel rule: 0 would read as "nothing left
--                       behind" on precisely the failure where nothing is
--                       known).
--
-- RLS enabled with NO policies, matching every FW table: reads and writes go
-- through the service-role client only. The anon/authenticated roles cannot
-- touch it.
--
-- The index serves the one query this table exists for — "which devices are
-- holding un-landed work?" = latest report per device — without a scan.

create table if not exists public.path_fw_residue_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  schema_version integer not null,
  outcome text not null check (outcome in ('queue_preserved', 'clear_failed')),
  queue_remaining integer check (queue_remaining >= 0),
  session_user_id uuid not null references auth.users (id) on delete cascade,
  claimed_actor_user_id uuid not null,
  device_id uuid not null,
  application text not null check (application in ('fw', 'crm', 'staff'))
);

alter table public.path_fw_residue_reports enable row level security;

create index if not exists path_fw_residue_reports_device_recency_idx
  on public.path_fw_residue_reports (device_id, created_at desc);
