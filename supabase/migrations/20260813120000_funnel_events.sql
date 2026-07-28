-- First Profit funnel — Unit 16 (plan 2026-07-27-002; R56–R58): the event
-- stream. Answers the question the whole build exists to answer: which
-- entry surface converts, C1 → C2 → C3, from one table.
--
-- Lane B holds the migration lock (re-read immediately before authoring).
-- Apply via the Management API playbook.
--
-- Design (R56): every event carries the full segmentation tuple
-- DENORMALIZED (entry_source, band, group) so the ads question needs no
-- joins, and NO PII — ids only. That is also what lets a retention purge
-- delete child rows without destroying measurement. RLS enabled with zero
-- policies is correct: the ONLY writer and reader is server code on the
-- service role (events are telemetry, never user-readable).

create table if not exists public.funnel_events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  family_id uuid,
  parent_id uuid,
  child_id uuid,
  entry_source text,
  band text,
  group_slug text,
  -- ids/enums/counts only — the no-PII rule is enforced in code and
  -- asserted over the whole emitted set by test, not by CHECK (jsonb
  -- content constraints age badly).
  properties jsonb not null default '{}',
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'funnel_events_name_check') then
    alter table public.funnel_events
      add constraint funnel_events_name_check
      check (name in (
        'lp_view', 'start_view', 'explainer_start', 'c1_captured',
        'child_added', 'quiz_start', 'door_confirmed', 'project_created',
        'reveal_viewed', 'faq_opened', 'application_started', 'c2_applied',
        'c3_deposit', 'student_account_created', 'c4_tuition',
        'project_regenerated', 'project_switched', 'share_card_created'
      ));
  end if;
end $$;

create index if not exists funnel_events_name_created_idx
  on public.funnel_events (name, created_at);
create index if not exists funnel_events_child_idx
  on public.funnel_events (child_id);
create index if not exists funnel_events_family_idx
  on public.funnel_events (family_id);

alter table public.funnel_events enable row level security;
