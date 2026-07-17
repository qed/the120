-- Gauntlet Summer Tournament — mastery-based scoring (B1 integrity + B6 ranking).
--
-- Scoring model (2026-07-17, post-review): the tournament ranks entrants by a
-- DIFFICULTY-WEIGHTED MASTERY score — the sum of band weights over the distinct
-- facts a player has *mastered* during the tournament window. Mastery events are
-- server-validated (see app/api/gauntlet/tournament/mastery/route.ts) and logged
-- here as an append-only audit trail; the client never writes this table.
--
-- Three parts:
--   1. One confirmed entry per identity (P0 security fix) — a user cannot rank in
--      more than one prize (age) band.
--   2. gauntlet_tournament_events — the server-written mastery-event audit log.
--      A fact scores ONCE per user (unique(user_id, fact_key)) which also makes
--      the POST naturally idempotent: a retried/replayed batch re-inserts the same
--      rows, all conflict, no double-credit. The window is intrinsic to the query
--      (created_at), so the Aug-3 board reset is free and pre-window (soft-launch)
--      mastery is naturally excluded.
--   3. gauntlet_tournament_leaderboard(prize_band, window) — prize-band-aware RPC,
--      handles-only projection, mirroring gauntlet_leaderboard's SECURITY DEFINER
--      shape.
--
-- Apply via the Supabase Management API playbook (the stored DB password is stale):
--   docs/solutions/integration-issues/supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md
-- Then record this version in supabase_migrations.schema_migrations and verify with
-- row-count SELECTs. Guest-degradation convention: every reader tolerates the table
-- being absent pre-apply.

-- 1. One confirmed tournament entry per identity (P0 — a single account must not
--    rank/win across multiple prize bands). Partial unique index: only confirmed,
--    linked entries are constrained; unconfirmed/guest rows are unaffected.
create unique index if not exists gauntlet_entries_one_confirmed_per_user
  on public.gauntlet_tournament_entries (user_id)
  where confirmed_at is not null and user_id is not null;

-- 2. Append-only mastery-event audit log. RLS on with NO policies => service-role
--    only (the server route writes with supabaseAdmin; the browser can never write).
create table if not exists public.gauntlet_tournament_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  batch_id   uuid not null,               -- client batch id, for audit grouping (not a uniqueness key)
  fact_key   text not null,               -- the mastered fact, e.g. 'mul:7×8'
  band       text not null,               -- content band the fact was mastered in (g34..g912)
  weight     integer not null,            -- band mastery weight credited (bandMasteryWeight)
  created_at timestamptz not null default now(),
  -- First-master-once + idempotency in one constraint: a given fact credits a user
  -- exactly once, so replaying a batch is inert.
  constraint gauntlet_events_fact_once unique (user_id, fact_key)
);

alter table public.gauntlet_tournament_events enable row level security;
-- (no policies on purpose — service-role writes only, like gauntlet_tournament_entries)

create index if not exists gauntlet_events_user_created
  on public.gauntlet_tournament_events (user_id, created_at);

-- 3. Prize-band-aware mastery leaderboard. Score = sum of band weights over the
--    user's distinct mastered facts within [window_start, window_end), joined to
--    confirmed + consented entries, grouped by prize_band. Handles only — never
--    emails/names. Window bounds are passed by the caller (the app derives them
--    from app/lib/tournament.ts), so the Aug-3 reset needs no data mutation.
create or replace function public.gauntlet_tournament_leaderboard(
  prize_band_in text        default null,
  window_start  timestamptz default null,
  window_end    timestamptz default null
)
returns table (handle text, prize_band text, mastery_score bigint, facts integer)
language sql
security definer
set search_path = public
stable
as $$
  select
    case when e.handle = '' then 'RAIDER' else e.handle end as handle,
    e.prize_band,
    coalesce(sum(ev.weight), 0)::bigint as mastery_score,
    count(ev.fact_key)::integer         as facts
  from public.gauntlet_tournament_entries e
  join public.gauntlet_tournament_events ev on ev.user_id = e.user_id
  where e.confirmed_at is not null
    and e.consent_given
    and e.user_id is not null
    and (prize_band_in is null or e.prize_band = prize_band_in)
    and (window_start  is null or ev.created_at >= window_start)
    and (window_end    is null or ev.created_at <  window_end)
  group by e.handle, e.prize_band
  order by mastery_score desc, e.handle asc
  limit 20;
$$;

grant execute on function public.gauntlet_tournament_leaderboard(text, timestamptz, timestamptz)
  to anon, authenticated;
