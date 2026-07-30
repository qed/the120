-- Fair daily quickfire board: one official attempt per UTC day and grade bracket.
-- The attempt is reserved when Start is pressed, so leaving or refreshing still
-- consumes it. The app API recomputes answers and timing before completing it.

create table if not exists public.gauntlet_daily_sprints (
  user_id uuid not null references auth.users(id) on delete cascade,
  sprint_date date not null,
  band text not null check (band in ('g34', 'g56', 'g78', 'g910', 'g11', 'g12')),
  attempt_id uuid not null default gen_random_uuid(),
  status text not null default 'started' check (status in ('started', 'completed')),
  handle text not null check (handle ~ '^[A-Z0-9-]{1,12}$'),
  correct integer not null default 0 check (correct between 0 and 20),
  wrong integer not null default 0 check (wrong between 0 and 20),
  elapsed_ms integer not null default 60000 check (elapsed_ms between 0 and 60000),
  score integer not null default -60000,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, sprint_date, band),
  unique (attempt_id)
);

create index if not exists gauntlet_daily_sprints_board_idx
  on public.gauntlet_daily_sprints (sprint_date, band, score desc, elapsed_ms asc)
  where status = 'completed';

alter table public.gauntlet_daily_sprints enable row level security;

drop policy if exists "daily sprint owners can read own" on public.gauntlet_daily_sprints;
create policy "daily sprint owners can read own"
  on public.gauntlet_daily_sprints for select
  using (auth.uid() = user_id);

revoke all on public.gauntlet_daily_sprints from anon, authenticated;
grant select on public.gauntlet_daily_sprints to authenticated;
