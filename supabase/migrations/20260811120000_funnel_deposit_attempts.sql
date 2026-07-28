-- First Profit funnel — Unit 14 (plan 2026-07-27-002; R50, R51a, R52b):
-- deposit attempts and the family goal.
--
-- Lane B holds the migration lock (re-read immediately before authoring).
-- Apply via the Management API playbook.
--
-- 1. `deposit_attempts`: one row per checkout attempt, created BEFORE the
--    Stripe call. It carries two duties:
--    - R52b: the Stripe idempotency key derives from this row's id
--      (`deposit-attempt:{id}`) — a persisted key, not `deposit:{childId}`,
--      which Stripe prunes at 24h and would block a legitimate retry.
--    - R51a: the refund-policy acceptance record (version, hash, accepted
--      timestamp, IP) — "here is what they were shown", the shape card
--      issuers accept as dispute evidence.
--    RLS enabled with ZERO policies is CORRECT here (the U10 lesson's
--    honest inverse): both writer and reader are the API routes using the
--    service role; no user-session path touches this table.
--
-- 2. `children.family_goal` (R50): the editable goal from Next Steps'
--    second swipe. Parent-writable through the existing children policy.

create table if not exists public.deposit_attempts (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.parents (id) on delete cascade,
  child_id uuid not null references public.children (id) on delete cascade,
  stripe_session_id text,
  policy_version text not null,
  policy_hash text not null,
  accepted_ip text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists deposit_attempts_child_id_idx
  on public.deposit_attempts (child_id);

alter table public.deposit_attempts enable row level security;

alter table public.children
  add column if not exists family_goal text not null default '';
