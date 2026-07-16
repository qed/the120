-- GPF-5: Summer Tournament entry table (the gate).
-- Parent-email lead capture layered on the free game (E4: no sign-in to play).
-- Double opt-in: an entry is `pending` until the parent clicks the confirm link
-- (confirmed_at stamped). PIPEDA-minimal: handle, prize band, parent email, and
-- attribution only — no names, no IP, nothing else.
--
-- RLS is ON with NO policies → the table is service-role only. All writes go
-- through /api/gauntlet/tournament/* using the service-role client, exactly like
-- ambassador_codes. The app degrades gracefully when this table is absent
-- (dormant until applied via the Management API playbook — see the Turn-On
-- Checklist in artifacts/roadmap.md).

create table if not exists public.gauntlet_tournament_entries (
  id uuid primary key default gen_random_uuid(),
  -- self-chosen kid-safe handle (never a real name — B2 word-filter is Ethan's)
  handle text not null,
  -- confirmed prize band: 'b36' (3–6) | 'b78' (7–8) | 'b912' (9–12)
  prize_band text not null check (prize_band in ('b36', 'b78', 'b912')),
  parent_email text not null,
  -- CASL express consent — must be true to enter; stamped when given
  consent_given boolean not null default true,
  consent_at timestamptz not null default now(),
  -- double opt-in: opaque token in the confirm link; confirmed_at stamped on click
  confirm_token text not null,
  confirmed_at timestamptz,
  -- attribution (brief item 7): ambassador code (AMB-FIRSTNAME) + free-text source
  referral_code text,
  heard_about text,
  -- optional link to a signed-in player (null for pure guests)
  user_id uuid references auth.users (id) on delete set null,
  -- GPF-10: weekly standings-email idempotency gate (null = never sent)
  last_standings_at timestamptz,
  -- abuse control: throttle confirmation-email resends per entry (null = never sent)
  last_email_at timestamptz,
  created_at timestamptz not null default now()
);

-- One entry per handle for the tournament; re-entry upserts (resets confirmation).
create unique index if not exists gauntlet_tournament_entries_handle_key
  on public.gauntlet_tournament_entries (lower(handle));

-- Fast lookups for the standings email / founding leaderboard.
create index if not exists gauntlet_tournament_entries_band_idx
  on public.gauntlet_tournament_entries (prize_band);
create index if not exists gauntlet_tournament_entries_confirmed_idx
  on public.gauntlet_tournament_entries (confirmed_at)
  where confirmed_at is not null;

alter table public.gauntlet_tournament_entries enable row level security;
-- No policies: anon/authenticated cannot read or write. Service role bypasses RLS.
