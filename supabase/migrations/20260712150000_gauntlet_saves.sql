-- GTM-2: Gauntlet account saves + public leaderboard.
-- Free-account progress sync (lead capture / cross-device) and an anon-readable
-- top-20 leaderboard that exposes only self-chosen kid-safe handles — never names.
-- Apply with: supabase db push (DB password note: see E5 — stored password stale).

create table public.gauntlet_saves (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- self-chosen player handle (kid-safe; no real names required or requested)
  handle text not null default '',
  band text not null default 'g34',
  trial_best integer not null default 0,
  xp numeric not null default 0,
  -- full game save (facts, medals, streaks, …) — shape owned by the client
  save jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.gauntlet_saves enable row level security;

create policy "own save: select" on public.gauntlet_saves
  for select using (auth.uid() = user_id);
create policy "own save: insert" on public.gauntlet_saves
  for insert with check (auth.uid() = user_id);
create policy "own save: update" on public.gauntlet_saves
  for update using (auth.uid() = user_id);

-- Public leaderboard: top trial scores, optionally filtered by band.
-- SECURITY DEFINER so anon can read ONLY the projected columns via this function
-- (the table itself stays locked to owners).
create or replace function public.gauntlet_leaderboard(band_in text default null)
returns table (handle text, band text, trial_best integer)
language sql
security definer
set search_path = public
stable
as $$
  select
    case when handle = '' then 'RAIDER' else handle end,
    band,
    trial_best
  from public.gauntlet_saves
  where trial_best > 0
    and (band_in is null or band = band_in)
  order by trial_best desc, updated_at asc
  limit 20;
$$;

grant execute on function public.gauntlet_leaderboard(text) to anon, authenticated;
