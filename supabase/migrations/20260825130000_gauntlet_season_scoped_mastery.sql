-- Season-scope tournament mastery so a durable fact can be demonstrated again
-- for a new board. Existing rows are beta/soft-launch history; the live route
-- writes `summer-2026`.

alter table public.gauntlet_tournament_events
  add column if not exists season_id text not null default 'beta';

alter table public.gauntlet_tournament_events
  drop constraint if exists gauntlet_events_fact_once;

create unique index if not exists gauntlet_events_fact_once_per_season
  on public.gauntlet_tournament_events (user_id, season_id, fact_key);

create index if not exists gauntlet_events_season_created
  on public.gauntlet_tournament_events (season_id, created_at);
