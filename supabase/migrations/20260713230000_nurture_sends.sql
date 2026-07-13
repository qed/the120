-- GTM-1: nurture email sent-log.
-- One row per (family, sequence, step) — the idempotency backbone of the
-- daily cron at /api/cron/nurture. The unique constraint is the guarantee:
-- even if two cron runs race, a step can only ever be recorded (and therefore
-- only ever legitimately sent) once per family.
-- Apply via the Management API (see docs/solutions/integration-issues/
-- supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md).

create table public.nurture_sends (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  sequence text not null,
  step text not null,
  email text not null,
  sent_at timestamptz not null default now(),
  unique (family_id, sequence, step)
);

create index nurture_sends_family_idx on public.nurture_sends (family_id);

alter table public.nurture_sends enable row level security;

-- Staff can read the log (CRM timeline / debugging); all writes go through
-- the service-role cron route, which bypasses RLS. No anon/authenticated
-- write path exists.
create policy "nurture_sends: staff read" on public.nurture_sends
  for select using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and public.is_active_staff()
  );
