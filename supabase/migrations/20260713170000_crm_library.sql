-- The 120 CRM — content library + send log (plan Unit 7; brief §9).
-- library_items: the answer library (faq / talking / data / asset), one+
-- seed per §7 concern, written from real site copy (/tuition, /faq,
-- /parents, home). library_sends: the CASL paper trail — one row per send,
-- written ONLY after Resend accepts (Decision 10) or via the explicit
-- "mark as sent elsewhere" path (same consent gate — CASL covers texts).
-- Apply via the Supabase Management API (stored DB password stale — roadmap
-- E5 note) and record this version in schema_migrations.

-- ──────────────────────────────────────────────────────────────── tables ──

create table public.library_items (
  id uuid primary key default gen_random_uuid(),
  -- enum truth lives in constants/library-rules; this CHECK is one of the
  -- tiny stable sets kept in the DB (crm_core convention)
  type text not null check (type in ('faq', 'talking', 'data', 'asset')),
  title text not null,
  body text not null,
  -- concern slug from constants.ts CONCERNS; NULL = general-purpose item
  concern text,
  -- asset items link to a real page/PDF; NULL for prose items (and for the
  -- explainer one-pager until the PDF ships — link-to-come)
  url text,
  -- suggestion ranking inputs (engine: helpfulness*2 + send_count)
  helpfulness_score int not null default 0 check (helpfulness_score >= 0),
  send_count int not null default 0 check (send_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index library_items_concern_idx on public.library_items (concern);

create trigger library_items_touch_updated_at
  before update on public.library_items
  for each row execute function public.crm_touch_updated_at();

create table public.library_sends (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.library_items (id),
  family_id uuid not null references public.families (id) on delete cascade,
  staff_id uuid not null,
  -- 'email' = sent via Resend from admissions@; 'other' = staff marked it
  -- sent elsewhere (text/WhatsApp) — both consent-gated
  channel text not null check (channel in ('email', 'other')),
  -- the subject actually sent (email channel); NULL for 'other'
  subject text,
  sent_at timestamptz not null default now()
);

create index library_sends_family_id_idx on public.library_sends (family_id);
create index library_sends_item_id_idx on public.library_sends (item_id);

-- ──────────────────────────────────────────────────────────────────── RLS ──
-- crm_core pattern: JWT admin role AND is_active_staff(). Items are fully
-- staff-editable (helpfulness thumbs, future authoring). Sends are a paper
-- trail: staff sessions may read + insert only — the single legitimate
-- UPDATE (merge moving loser→survivor rows) runs via the service role
-- inside the guarded merge action, which bypasses RLS.

alter table public.library_items enable row level security;
alter table public.library_sends enable row level security;

create policy "library_items: active staff" on public.library_items
  for all
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' and public.is_active_staff())
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' and public.is_active_staff());

create policy "library_sends: staff read" on public.library_sends
  for select
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' and public.is_active_staff());

create policy "library_sends: staff insert" on public.library_sends
  for insert
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' and public.is_active_staff());

-- ────────────────────────────────────────────────────────────────── seeds ──
-- ≥1 item per §7 concern (10 concerns), written from REAL site copy:
-- /tuition (tiers, HST-exempt, fine print), /faq (refunds, time commitment,
-- admissions, Tin Can, socialization, logistics, Ontario fit), /parents
-- (TimeBack results), home ThreeThings (Tin Can Address Book). Bodies may
-- carry a {first_name} token — composePrefill personalizes it.
-- Alphahub 007 seeds-in-migration pattern.

insert into public.library_items (type, title, body, concern, url) values

  ('faq', 'WHAT $3,000 ACTUALLY BUYS',
   'Membership is $3,000 CAD a year — the core product. That includes the Tin Can device + service and The 120 Address Book, one year-long project with real mentorship, math acceleration through Math Academy, all four Toronto intensives, and virtual cohorts + community events. No add-ons, no surprises: prices are in CAD and HST-exempt education services.',
   'price-value', null),

  ('faq', 'THE FULL ACADEMIC CORE, EXPLAINED',
   'The Full Academic Core is $15,000 CAD a year: everything in Membership, plus 5 hours a week of TimeBack — the complete academic core — for 1 to 3 subjects of your choice, a bi-weekly 30-minute 1:1 with an expert Academic Advisor, and academics through Alpha Anywhere or GT Anywhere depending on your group. It supports Ontario homeschool registration. It''s offered on your call — most families start with Membership.',
   'full-core-cost', null),

  ('faq', 'DEPOSIT + REFUND TERMS',
   'The seat deposit is $250 and it''s fully refundable until September 30, 2026. Tuition itself applies only after your child qualifies: dossier review, then the qualifying assessment. No payment until a seat is offered — and if the 120 is full, you join the waitlist for the next assessment window. The network stays 120.',
   'refund-terms', null),

  ('faq', 'THE WEEKLY TIME COMMITMENT',
   'Membership is 3–5 hours a week, alongside any school — public gifted stream, private, or homeschool. Your child doesn''t leave their current school. The four intensive weekends in Toronto are optional but strongly encouraged; we recommend at least one per year — it''s where Tin Can friendships become real ones.',
   'time-commitment', null),

  ('talking', 'SCREENS: THE TIN CAN IS THE ANSWER',
   'The 120 is built around less screen time, not more. Every member gets a Tin Can — a screen-free Wi-Fi landline for kids: voice only, no apps, no feeds. Only parent-approved contacts can call, and it ships with The 120 Address Book — a bat phone to 119 kids building interesting lives, across all five groups. Device and service are included in membership.',
   'screen-time', null),

  ('faq', 'WILL MY KID ACTUALLY MAKE FRIENDS?',
   'They arrive already knowing people — their cohort has been talking on Tin Cans and meeting virtually all quarter before any intensive. Team activities are designed for belonging, not performance; shy kids tend to leave the weekend loudest. And the Address Book means the whole network is one call away, all year.',
   'socialization', null),

  ('data', 'TIMEBACK RESULTS — TORONTO FAMILIES',
   'Real Toronto numbers from TimeBack — the learning platform behind The 120''s academics. In a little over 5 weeks, one Grade 4 Toronto kid went from Grade 3 to Grade 5 in Math, Grade 3 to Grade 8 in Vocabulary, and Grade 4 to Middle School in Science. His Grade 7 brother placed into Grade 10 Math. Shared with permission — the full stories are at the120.school/parents, in the parents'' own words.',
   'curriculum-fit', null),

  ('faq', 'HOW THIS FITS ONTARIO SCHOOL (OR HOMESCHOOL)',
   'The 120 isn''t a school — it''s a selective network and Ontario learning centre. Members keep their school; the weekly rhythm is designed to sit alongside it, with math acceleration through Math Academy. For homeschooling families, the Full Academic Core tier provides a complete academic core with TimeBack and supports Ontario homeschool registration.',
   'curriculum-fit', null),

  ('faq', 'HOW ADMISSIONS ACTUALLY WORKS',
   'You build your child''s dossier in the dashboard — their group, their interests, a project pitch in their own words, and any scores you want to share — then submit it for review. If it''s a fit, you''re invited to a call with our team. Each of the five groups qualifies its members its own way, and seats are roughly balanced across ages 8–17, so a strong 8-year-old candidate isn''t competing with 17-year-old applicants.',
   'selectivity-anxiety', null),

  ('talking', 'THREE ANSWERS FOR THE SKEPTICAL SPOUSE',
   'Lead with the three facts that usually land: 1) It''s alongside school, not instead of it — 3–5 hours a week, and the kid keeps their school. 2) There''s no financial cliff — the deposit is $250, fully refundable until September 30, and no tuition applies until a seat is actually offered. 3) The math: $3,000 CAD, HST-exempt, includes the Tin Can device and service, real mentorship on a year-long project, Math Academy, and all four Toronto intensives. Then offer the 20-minute call — and invite both parents to join it.',
   'spouse-buy-in', null),

  ('faq', 'OUTSIDE TORONTO / GETTING THERE',
   'The weekly rhythm is virtual, so anywhere in Ontario works. The four intensive weekends are in Toronto — a drive, not a flight, for most Ontario families — and they''re optional but strongly encouraged. Farther afield? Book a call and we''ll talk it through.',
   'logistics', null),

  ('asset', '/TUITION — THE FULL PRICING PAGE',
   'The tuition page in full: both tiers side by side — $3,000 Membership and the $15,000 Full Academic Core — with the fine print on HST exemption, admission-first payment, and the 120-seat cap. Send it when a family wants the numbers in writing: https://the120.school/tuition',
   'price-value', '/tuition'),

  ('asset', '/PARENTS — TORONTO PARENT STORIES',
   'Three Toronto families on TimeBack and Alpha — the learning platform behind The 120''s academics — in their own words: live progress visibility, kids asking for extra work, and week-by-week placement jumps. The strongest proof page we have: https://the120.school/parents',
   'curriculum-fit', '/parents'),

  ('asset', '/GAUNTLET — LET THE KID TRY IT',
   'The Gauntlet is our public challenge game — a low-stakes way for a kid to try The 120''s flavour of thinking before any assessment. Send it to families nervous about selectivity: it turns "is my kid good enough" into "my kid had fun with hard problems": https://the120.school/gauntlet',
   'selectivity-anxiety', '/gauntlet'),

  ('asset', 'EXPLAINER ONE-PAGER (PDF)',
   'The one-page explainer — what The 120 is, the five groups, pricing, and the Fall 2026 timeline, in a single printable page. LINK TO COME: the PDF is still being produced; until it ships, send the tuition and FAQ pages instead.',
   null, null);
