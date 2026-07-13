-- The 120 CRM — GTM sprint tables (plan Unit 6; brief §8).
-- gtm_weekly_targets: cumulative funnel targets per sprint week, transcribed
-- from artifacts/gtm-8-week-sprint.md §1 (funnel math) + §2 (week-by-week).
-- gtm_weeks: one row per week W1–W8 — phase, dates label, primary push,
-- checkable actions (jsonb), and non-funnel target chips (jsonb).
-- Apply via the Supabase Management API (stored DB password stale — roadmap
-- E5 note) and record this version in schema_migrations.

-- ──────────────────────────────────────────────────────────────── tables ──

create table public.gtm_weekly_targets (
  week int primary key check (week between 1 and 8),
  -- CUMULATIVE targets as of each week's end (sprint §2 "Targets" column)
  interested int not null check (interested >= 0),
  accounts int not null check (accounts >= 0),
  dossiers_submitted int not null check (dossiers_submitted >= 0),
  calls_booked int not null check (calls_booked >= 0),
  calls_held int not null check (calls_held >= 0),
  deposits int not null check (deposits >= 0),
  updated_at timestamptz not null default now()
);

create table public.gtm_weeks (
  week int primary key check (week between 1 and 8),
  phase text not null,           -- ARM | SEED | SURGE | LAND (phase # derives from week)
  label text not null,           -- e.g. 'JUL 13–19'
  primary_push text not null,    -- sprint §2 "Primary push", verbatim
  -- array of {id, text, done, done_by, done_at} — the week's concrete
  -- actions; the week's asset ships as an action flagged {kind:'asset'}
  actions jsonb not null default '[]',
  -- array of {key, label, target, manual, count}: manual=true chips get ±
  -- steppers (count is the hand-kept tally); manual=false chips name a
  -- funnel field in `key` and compute from truth (count ignored)
  non_funnel_targets jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

create trigger gtm_weekly_targets_touch_updated_at
  before update on public.gtm_weekly_targets
  for each row execute function public.crm_touch_updated_at();

create trigger gtm_weeks_touch_updated_at
  before update on public.gtm_weeks
  for each row execute function public.crm_touch_updated_at();

-- ──────────────────────────────────────────────────────────────────── RLS ──
-- Same pattern as crm_core: JWT admin role AND is_active_staff(). Both
-- tables are staff-writable (targets are re-forecastable in place; week
-- checklists persist check state).

alter table public.gtm_weekly_targets enable row level security;
alter table public.gtm_weeks enable row level security;

create policy "gtm_weekly_targets: active staff" on public.gtm_weekly_targets
  for all
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' and public.is_active_staff())
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' and public.is_active_staff());

create policy "gtm_weeks: active staff" on public.gtm_weeks
  for all
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' and public.is_active_staff())
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' and public.is_active_staff());

-- ────────────────────────────────────────────────── seeds: weekly targets ──
-- Transcription notes (sprint §1 + §2):
--   interested        — §2 states cumulative: W2 40, W3 70, W4 105, W5 140,
--                       W6 170, W7 190, W8 200. W1 states no interested
--                       target (only "25 warm convos, 10 calls booked");
--                       derived as 20 = half of W2's 40 (linear within
--                       Phase 1). The warm-25 lives as a manual chip below.
--   accounts          — §1 states only the Sep-1 endpoint (55% of
--                       interested = 110); weekly values derived at that
--                       ratio: round(0.55 × interested target).
--   dossiers_submitted— §1 endpoint only (70% of started = 77); derived
--                       round(0.70 × accounts target).
--   calls_booked      — §2 states cumulative: W1 10, W2 20, W3 30, W4 40,
--                       W5 55, W6 70, W7 85; W8 = §1's 90.
--   calls_held        — §1 endpoint only (80% of booked = 72); derived
--                       round(0.80 × calls_booked target).
--   deposits          — §2 states cumulative: W4 "first 15", W5 22, W6 32,
--                       W7 45, W8 48 (the §1 hard goal; 55 is the stretch
--                       marker on the thermometer, not the target). W1–W3
--                       are 0: the sprint states no deposit target before
--                       W4 (Stripe goes live during W1; the Gauntlet-public
--                       week is the first deposits milestone).

insert into public.gtm_weekly_targets
  (week, interested, accounts, dossiers_submitted, calls_booked, calls_held, deposits)
values
  (1,  20, 11,  8, 10,  8,  0),
  (2,  40, 22, 15, 20, 16,  0),
  (3,  70, 39, 27, 30, 24,  0),
  (4, 105, 58, 41, 40, 32, 15),
  (5, 140, 77, 54, 55, 44, 22),
  (6, 170, 94, 66, 70, 56, 32),
  (7, 190, 105, 74, 85, 68, 45),
  (8, 200, 110, 77, 90, 72, 48);

-- ──────────────────────────────────────────────────── seeds: week cards ──
-- Faithful transcription of sprint §2: primary pushes verbatim, concrete
-- actions split into checkable items, the week's asset as the final action
-- flagged kind:'asset'. Manual chips carry the non-funnel countables the
-- sprint names (warm convos, ambassadors, coffees, info sessions, September
-- pre-booked calls); manual:false chips echo the week's stated funnel
-- targets and compute from truth.

insert into public.gtm_weeks (week, phase, label, primary_push, actions, non_funnel_targets) values

(1, 'ARM', 'JUL 13–19', 'Machine online + warm 25', $j$[
  {"id":"w1-a1","text":"Create Cal.com booking link (T2, 30 min) and set NEXT_PUBLIC_BOOKING_URL","done":false,"done_by":null,"done_at":null},
  {"id":"w1-a2","text":"Kick S10 Stripe go-live: account decision + live keys + one real charge/refund test","done":false,"done_by":null,"done_at":null},
  {"id":"w1-a3","text":"Pick email provider (Resend for transactional + simple broadcasts; Customer.io if budget allows) and wire welcome email","done":false,"done_by":null,"done_at":null},
  {"id":"w1-a4","text":"Dev ticket: 'How did you hear about us? / referral code' field on account creation","done":false,"done_by":null,"done_at":null},
  {"id":"w1-a5","text":"Personally message 25 warmest contacts (UTS circles, the 7 founding families, /parents story families) — personal notes, not blasts","done":false,"done_by":null,"done_at":null},
  {"id":"w1-asset","kind":"asset","text":"One-page explainer PDF (five groups, $3,000, refundable $250, Oct 31 intensive) + welcome email #1","done":false,"done_by":null,"done_at":null}
]$j$, $j$[
  {"key":"warm-convos","label":"WARM CONVOS","target":25,"manual":true,"count":0},
  {"key":"calls_booked","label":"CALLS BOOKED","target":10,"manual":false,"count":0}
]$j$),

(2, 'ARM', 'JUL 20–26', 'Recruit the ambassadors', $j$[
  {"id":"w2-a1","text":"Recruit 12–15 F1/F2 (grade 7/8) ambassadors through the founder's kids' network and friends-of-friends","done":false,"done_by":null,"done_at":null},
  {"id":"w2-a2","text":"One 45-min virtual kickoff with kids + a parent each","done":false,"done_by":null,"done_at":null},
  {"id":"w2-a3","text":"Issue referral codes","done":false,"done_by":null,"done_at":null},
  {"id":"w2-a4","text":"Soft-launch the Gauntlet Summer Tournament to ambassadors only — seed the leaderboard","done":false,"done_by":null,"done_at":null},
  {"id":"w2-a5","text":"Ask each of W1's warm families for two introductions","done":false,"done_by":null,"done_at":null},
  {"id":"w2-asset","kind":"asset","text":"Ambassador kit: 1-page 'what you do', referral code card, 3 shareable Gauntlet images, parent consent note","done":false,"done_by":null,"done_at":null}
]$j$, $j$[
  {"key":"ambassadors","label":"AMBASSADORS","target":12,"manual":true,"count":0},
  {"key":"interested","label":"INTERESTED","target":40,"manual":false,"count":0},
  {"key":"calls_booked","label":"CALLS BOOKED","target":20,"manual":false,"count":0}
]$j$),

(3, 'SEED', 'JUL 27–AUG 2', 'Gifted-parent communities', $j$[
  {"id":"w3-a1","text":"Value-first posts (founder's TimeBack story from /parents — real data, real kids) in Ontario gifted/enrichment parent Facebook groups and ABC Ontario chapters; offer the explainer PDF on request","done":false,"done_by":null,"done_at":null},
  {"id":"w3-a2","text":"Never post links cold into groups that ban promo — answer questions, DM the PDF","done":false,"done_by":null,"done_at":null},
  {"id":"w3-a3","text":"3 '120 coffees' with connector parents (school-council chairs, camp directors)","done":false,"done_by":null,"done_at":null},
  {"id":"w3-asset","kind":"asset","text":"/parents story post (300-word founder narrative, no hype, link at end) + 5 canned answers to common objections","done":false,"done_by":null,"done_at":null}
]$j$, $j$[
  {"key":"coffees","label":"120 COFFEES","target":3,"manual":true,"count":0},
  {"key":"interested","label":"INTERESTED","target":70,"manual":false,"count":0},
  {"key":"calls_booked","label":"CALLS BOOKED","target":30,"manual":false,"count":0}
]$j$),

(4, 'SEED', 'AUG 3–9', 'The Gauntlet goes public', $j$[
  {"id":"w4-a1","text":"Open the Gauntlet Summer Tournament to everyone: 3-week leaderboard sprint, grade bands 3–4 / 5–6 / 7–8, weekly 'boss week' themes","done":false,"done_by":null,"done_at":null},
  {"id":"w4-a2","text":"Winners earn a named spot on a permanent Founding Leaderboard + first-demo slot at the October intensive","done":false,"done_by":null,"done_at":null},
  {"id":"w4-a3","text":"Ambassadors challenge classmates; parents share scores","done":false,"done_by":null,"done_at":null},
  {"id":"w4-a4","text":"Landing: /gauntlet with a parent-facing banner → join flow","done":false,"done_by":null,"done_at":null},
  {"id":"w4-a5","text":"Dev ticket: shareable score card image","done":false,"done_by":null,"done_at":null},
  {"id":"w4-asset","kind":"asset","text":"Gauntlet share card (auto-generated score image) + tournament rules page + weekly leaderboard email","done":false,"done_by":null,"done_at":null}
]$j$, $j$[
  {"key":"interested","label":"INTERESTED","target":105,"manual":false,"count":0},
  {"key":"calls_booked","label":"CALLS BOOKED","target":40,"manual":false,"count":0},
  {"key":"deposits","label":"DEPOSITS","target":15,"manual":false,"count":0}
]$j$),

(5, 'SURGE', 'AUG 10–16', 'Five-group verticals', $j$[
  {"id":"w5-a1","text":"Scholars → CEMC/Waterloo contest + Math Kangaroo parent communities and math-circle coaches","done":false,"done_by":null,"done_at":null},
  {"id":"w5-a2","text":"Athletes → rep/AAA team parent reps (GTHL, rep soccer, competitive swim)","done":false,"done_by":null,"done_at":null},
  {"id":"w5-a3","text":"Makers → arts-program parent lists (RCM, youth film/maker camps)","done":false,"done_by":null,"done_at":null},
  {"id":"w5-a4","text":"Founders → kid-entrepreneur fairs and DECA-adjacent parents","done":false,"done_by":null,"done_at":null},
  {"id":"w5-a5","text":"Givers → youth-volunteering orgs and faith/community groups","done":false,"done_by":null,"done_at":null},
  {"id":"w5-a6","text":"Ask coaches/organizers to forward, don't blast their lists (CASL: forwarding by the organizer is their consent relationship, not ours)","done":false,"done_by":null,"done_at":null},
  {"id":"w5-asset","kind":"asset","text":"Five one-page group sheets (same skeleton, one hero line each — e.g. 'Train seriously, compete seriously, and think like a pro')","done":false,"done_by":null,"done_at":null}
]$j$, $j$[
  {"key":"interested","label":"INTERESTED","target":140,"manual":false,"count":0},
  {"key":"calls_booked","label":"CALLS BOOKED","target":55,"manual":false,"count":0},
  {"key":"deposits","label":"DEPOSITS","target":22,"manual":false,"count":0}
]$j$),

(6, 'SURGE', 'AUG 17–23', 'Info sessions week', $j$[
  {"id":"w6-a1","text":"Two 45-min virtual info sessions (Tue eve, Sat morning): 15 min founder story → 15 min the year in detail (project → quarterlies → Oct 31 demo) → 15 min Q&A; end on refundable-deposit offer","done":false,"done_by":null,"done_at":null},
  {"id":"w6-a2","text":"One in-person Toronto meetup (park/rec-room, kids play the Gauntlet live on a projector, parents talk)","done":false,"done_by":null,"done_at":null},
  {"id":"w6-a3","text":"Every RSVP = consented lead; every attendee gets a next-day recap + booking link","done":false,"done_by":null,"done_at":null},
  {"id":"w6-asset","kind":"asset","text":"Info-session deck (10 slides) + RSVP page + recap email","done":false,"done_by":null,"done_at":null}
]$j$, $j$[
  {"key":"info-sessions","label":"INFO SESSIONS","target":2,"manual":true,"count":0},
  {"key":"interested","label":"INTERESTED","target":170,"manual":false,"count":0},
  {"key":"calls_booked","label":"CALLS BOOKED","target":70,"manual":false,"count":0},
  {"key":"deposits","label":"DEPOSITS","target":32,"manual":false,"count":0}
]$j$),

(7, 'LAND', 'AUG 24–30', 'Deposit push', $j$[
  {"id":"w7-a1","text":"Back-to-school moment: 'before the school year swallows you, reserve the seat — $250, fully refundable until Sept 30'","done":false,"done_by":null,"done_at":null},
  {"id":"w7-a2","text":"3-email sequence to all non-depositors (consented list only)","done":false,"done_by":null,"done_at":null},
  {"id":"w7-a3","text":"Personally call every submitted-dossier family without a deposit","done":false,"done_by":null,"done_at":null},
  {"id":"w7-a4","text":"Publish live seat count in emails (it's truthful — use it)","done":false,"done_by":null,"done_at":null},
  {"id":"w7-a5","text":"Founding-member cutoff: families deposited by Sept 1 are named the Founding 120 at the October intensive","done":false,"done_by":null,"done_at":null},
  {"id":"w7-asset","kind":"asset","text":"Deposit-push sequence (3 emails) + written deposit/refund terms page (roadmap S7 item — required before pushing hard)","done":false,"done_by":null,"done_at":null}
]$j$, $j$[
  {"key":"interested","label":"INTERESTED","target":190,"manual":false,"count":0},
  {"key":"calls_booked","label":"CALLS BOOKED","target":85,"manual":false,"count":0},
  {"key":"deposits","label":"DEPOSITS","target":45,"manual":false,"count":0}
]$j$),

(8, 'LAND', 'AUG 31–SEP 4', 'September landing', $j$[
  {"id":"w8-a1","text":"Nurture automation verified end-to-end","done":false,"done_by":null,"done_at":null},
  {"id":"w8-a2","text":"Ambassador back-to-school kits delivered","done":false,"done_by":null,"done_at":null},
  {"id":"w8-a3","text":"Waitlist copy ready","done":false,"done_by":null,"done_at":null},
  {"id":"w8-a4","text":"Founder's calendar opened to 12 call slots/week","done":false,"done_by":null,"done_at":null},
  {"id":"w8-a5","text":"Weekly-metrics dashboard reviewed (this screen — the sprint asked for 'even a spreadsheet')","done":false,"done_by":null,"done_at":null},
  {"id":"w8-a6","text":"Send 'the year begins' email: intensive #1 dates, what happens next","done":false,"done_by":null,"done_at":null},
  {"id":"w8-asset","kind":"asset","text":"'The Year Ahead' email + waitlist page copy","done":false,"done_by":null,"done_at":null}
]$j$, $j$[
  {"key":"sept-calls","label":"SEPT CALLS PRE-BOOKED","target":20,"manual":true,"count":0},
  {"key":"interested","label":"INTERESTED","target":200,"manual":false,"count":0},
  {"key":"deposits","label":"DEPOSITS","target":48,"manual":false,"count":0}
]$j$);
