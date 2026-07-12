# Roadmap — the120.school

Working plan for the site. Peter is PM; two developers execute tickets via AI coding sessions. Done items should be moved to the bottom.
Horizons: **Phase 1** (recruitment push) → **Phase 2** (accounts + deposits fully live) → **Phase 3**.
Status markers: 🔴 not started · 🟡 in progress / partially done · ⛔ blocked on someone · ✅ done (bottom section).

**Live:** jointhe120.vercel.app (Vercel project `the120`, helix3 team, auto-deploys on push to `main` of `qed/the120`; the jointhe120 alias carries forward automatically on each production deploy — no manual step).

---

## 📌 Decisions made (build intelligence — do not re-litigate)

- **Five groups** (Athletes, Founders, Makers, Scholars/GT, Givers), $3,000 Membership + $15,000 Full Academic Core, all HST-exempt. Single-network version preserved in git history (`master` pre-merge).
- **$250 deposit, per child, refundable until September 30, 2026**, paid by Stripe Checkout **inside the dashboard** after account creation and dossier — not a standalone payment link.
- **Seat-count truth:** live everywhere — `120 − 7 founding commitments − paid deposits` from Supabase (60s cache, truthful constant as fallback). Never show fabricated numbers.
- **Positioning (2026-07-09):** The 120 is a general "join a society" product — 120 kids, five groups; GT is just one. GT pages are de-emphasized sub-pages; proof content lives on/from the home page. One 120 nav + footer on all pages. Parent testimonials front and center from home via `/parents`.
- **Accounts:** Stripe ✅ (test mode, live product pending S10) · Supabase ✅ (live, schema deployed) · booking link ✅ (cal.com/peter.k/the120) · the120.school ✅ (live on Vercel, Namecheap-registered, Vercel nameservers) · mailbox 🟡 (Google Workspace verification TXT served; MX + admissions@ next) · Resend — still to create.
- **Interim contact email** is pkuperman@gmail.com (footer + Book-a-call fallback) until admissions@the120.school exists (S6).
- **Stripe account (2026-07-12, E2):** The 120 charges on the **Hatch Coding CDN** account with statement descriptor **"THE120"** — no dedicated account. Revisit only if The 120 becomes its own legal entity (the Stripe account must belong to the entity actually charging).
- **Gauntlet positioning (2026-07-12, E4):** the Gauntlet is a **public lead magnet, permanently** (Summer Tournament per the GTM plan). Never paywall the core game — a $250 school-seat deposit will never be bought to unlock a math game, so gating kills distribution without creating revenue. Free account saves progress + joins the leaderboard (= lead capture); deposit-holders get **additive** member perks only. Supersedes the original post-deposit lock-in framing; M2 reframed accordingly.

## 📬 Ethan Items from July 11 — tracking checklist

From Ethan's 2026-07-11 message. Each item resolves into a canonical roadmap item where one exists; an item is only done when its row below is ✅. Remaining: **E3** (Resend) and the balance of **S10** (live keys → verification charge).

**E1 · Booking link (Ethan Q1)** = **T2** — ✅ **Done 2026-07-12.** Cal.com event **"The 120 — Intro Call"** at `cal.com/peter.k/the120`: 20 min, Cal Video, 2h minimum notice, 10-min buffer after, max 3/day, synced to Google Calendar. `NEXT_PUBLIC_BOOKING_URL` set in Vercel (all environments), production redeployed, **verified live**: every Book-a-call button now opens the scheduler. Availability = Cal.com defaults; tune windows in Cal.com → Availability if wanted.

**E2 · Stripe account question (Ethan Q2)** — ✅ **Decided 2026-07-12:** Hatch Coding CDN account + **"THE120"** statement descriptor (see Decisions). Remaining go-live work continues as **S10** steps 1b–4 (descriptor, live keys, live product/webhook, real charge + refund round-trip). Until S10 completes, all deposits stay test-mode.

**E3 · Resend account + welcome email + deposit nurture (Ethan Q3)** — 🔴 New; promoted from Phase 3 with the provider decision made: **Resend**. Owner: Peter creates the account (external); dev wires templates + triggers. Scope per GTM §2/§5: welcome email #1 (the W1 asset), account-created sequence (T+0 welcome → T+2d dossier nudge → T+5d founder story → T+9d book-the-call), deposit-paid sequence (Founding-120 welcome → intensive #1 details → referral note). Production sending domain wants the120.school (S6) — account, templates, and test sends can proceed now on Resend's sandbox domain. **Definition of done includes telling Ethan the account exists** (he asked to be notified).

**E4 · Gauntlet framing clarification (Ethan Q4)** — ✅ **Decided 2026-07-12:** public lead magnet + member perks (see Decisions). M2 reframed below; GTM plan's Summer Tournament proceeds as written.

**E5 · `supabase db push` — attribution columns (Ethan a)** — ✅ **Done 2026-07-12.** `heard_about` / `referral_code` columns + referral-code index live on `parents`; migration recorded in `schema_migrations`. ⚠️ Applied via the Supabase **Management API** because the stored DB password (`~\.the120-supabase-db-password.txt`) **fails auth — it's stale or was saved wrong**. Reset the DB password in the Supabase dashboard next time direct `db push` is needed, then update/delete that file (T6 already says: move to a password manager).

**E6 · QA deposit cleanup (Ethan b)** — ✅ **Done 2026-07-12.** Refunded `pi_3Trf6v25N9cbf3wU0La9AOI9` ($250 test-mode, refund `re_3Trf6v25N9cbf3wU0MwbR3Zq`); the production **charge.refunded webhook flipped the deposit to `refunded` within seconds** (another live-readiness proof for S10); QA auth user deleted → cascade removed parent/child/deposit rows (fake dossier gone from queue); verified live: **"113 OF 120 SEATS REMAIN"** on the home page, `seats_claimed() = 0`.

**Ethan's updates, acknowledged (no action):** funnel E2E-verified in production ✅ (Done 2026-07-10) · Gauntlet visual polish + iteration design done ✅ (M3) · GTM plan + 8-week sprint in repo ✅ (`artifacts/gtm-8-week-sprint.md`) · both GTM-W1 dev tickets shipped ✅ (attribution field + share card) · Gauntlet content nearly in production — full Starter Twelve shipped, 16 of the 28 ranked picks live (tracked in G3 ✅ / G2).

---

## 🚀 Phase 1 — ✅ COMPLETE (2026-07-12)

T2 (booking link) was the last open item — shipped as E1. All Phase 1 work done.

---

## 🏗 Phase 2 — open work

**S5 · Admin review queue with payment visibility** *(dev)* — 🔴 **Not started; now unblocked** (S2/S3 shipped).
Admin-only view: dossier queue, status changes, notes, and who has paid/refunded (Stripe customer link per family).

**S6 · Domain + mailbox + email** *(Owner: Peter — external; dev supports)* — 🟡 **Domain live; mailbox in progress.**
✅ Done 2026-07-12: the120.school registered (Namecheap) → nameservers `ns1/ns2.vercel-dns.com` → added to the Vercel project → **https://the120.school serves the site** (SSL auto-issued, seat counter + booking link verified). Google Workspace **site-verification TXT record added in Vercel DNS and confirmed resolving** — Workspace domain verification unblocked.
Remaining: (a) finish Google Workspace signup → add **MX records** in Vercel DNS (modern Workspace uses the single `smtp.google.com` MX) → create admissions@the120.school; (b) swap interim pkuperman@gmail.com in `Footer` + `BOOKING_URL` fallback; (c) custom SMTP for Supabase auth emails + **re-enable email confirmations** (`supabase/config.toml` → `enable_confirmations = true`, `supabase config push`) — signups are currently auto-confirmed because the default sender is rate-limited ~2/hr; (d) decide canonical domain (redirect jointhe120.vercel.app → the120.school) + update share-card URL — small dev ticket; (e) defensive domains (the120.ca, 120.school) if desired — both were still available 2026-07-12.

**S7 · Content overhaul round 2** *(dev + Peter)* — 🔴 **Not started.**
Remaining site-map pages: How It Works, The Full Program, Our Advisors, Intensives — plus a written deposit/refund terms page linked from checkout (terms currently live only in checkout copy + receipt).

**S8 · Visual/asset debt** *(dev + Peter)* — 🔴 **Not started.**
Licensed photography (hero is a 2165px extraction, soft on retina; four group-page background slots are blue; Tin Can product imagery). Mission video. Restyle dashboard + join modal to the handoff identity. Dashboard "group" picker (data model + UI). Move dossier photos from data-URL column to a Supabase storage bucket.

**S9 · Tin Can partnership confirmation** *(Owner: Peter — external)* — 🔴 **Not started.**
Logo/co-marketing rights before the brand appears beyond the legal line.

**S10 · Stripe go-live** *(Owner: Peter + dev)* — 🟡 **Account decision made (E2, 2026-07-12); live-mode work not started. Required before accepting real deposits.**
Everything Stripe is **test mode** on the **Hatch Coding CDN** account (`acct_103s7v25N9cbf3wU`). To go live:
  1. ✅ **Account decision**: stay on Hatch Coding CDN. Remaining 1b: set statement descriptor **"THE120"** (Stripe dashboard → Settings → Public details); confirm it on the step-4 round-trip charge.
  2. **Live keys**: `pk_live_…` / `sk_live_…` into Vercel **production only** (test keys stay on preview/dev so previews can never charge real cards).
  3. **Live product + price + webhook** (test webhook `we_1TrOfg25N9cbf3wUesMLOl9y` targets production URL with test events today).
  4. **Verification**: one real $250 charge + refund round-trip; confirm statement descriptor, receipt email, refund copy.

---

## 🎮 The Gauntlet (FastMath game — formerly MathRaiders)

**M1 · Playable v1** *(dev)* — ✅ **Shipped** (`/gauntlet` — renamed from `/raiders`, redirect in place; in main nav).
Boss-battle FastMath: correct answers do damage (speed + streak multipliers), wrong answers cost player HP; 2-minute raids, 4 bosses with generated arenas + sprites (Nano Banana Pro, `scripts/gen-sprites.mjs`), XP + local save. Topics: ×, ÷, +, − plus GCD, LCM, common denominator, and triangle congruence (rendered figures, multiple choice). Fully open demo for now, per direction.

**M2 · Account saves + member perks** *(dev)* — 🔴 Not started. **Reframed 2026-07-12 (E4): no paywall, ever — core game stays fully public.**
Free account links Gauntlet progress to the family's Supabase account instead of localStorage (= lead capture, cross-device saves, leaderboard identity). Deposit-holders get **additive** perks only: early access to new bosses, G2 pathway depth, cosmetics/leaderboard flair (doubles as the ambassador incentive in the GTM plan). Lock-in comes from saved progress after the deposit, never from gating acquisition.

**M3 · Game depth round 1** *(dev)* — ✅ **Shipped.**
Slash/impact FX + hit flash + boss entrance/death animations; restrained WebAudio cues (hits, crits, misses, final-seconds ticks, fanfares) with mute; adaptive trainer (per-fact speed/accuracy, weak facts re-served ~35%); teach-on-miss (correct answer shown before advancing); post-raid "Train these" report + waste %; grade bands (3–4/5–6/7–8); boss medals (🥉🥈🥇) + sequential boss unlocks; Mastery Trial survival mode (+2s/−4s, waves, personal best); daily raid streak; XP titles + bar; first-run how-to; leave-raid confirm; tab-hidden timer pause; reduced-motion support; congruence problems rotate + vary marks. Multiplayer deliberately skipped (product call).

**M4 · Later game ideas** *(dev)* — 🔴 Not started.
More bosses/arenas; cosmetic unlocks by level; multiplayer raid rooms (if ever).

**G1 · Playtesters + endgame difficulty** *(Owner: founder — humans; dev supports)* — 🔴 Not started.
Recruit 3–5 playtesters who will really dig in, including one hardcore math kid and one decidedly non-math kid who aspires to better grades. Goal: tune the last boss to "bragging rights" hard and the 2nd-to-last to "earn your level-up" hard. Dev support ready: damage/HP/speed-window/penalty are single constants in `app/gauntlet/components/Battle.tsx`; per-boss difficulty modifiers + a fifth "bragging rights" boss can ship within a day of first feedback.

**G3 · Starter Twelve** *(dev)* — ✅ **Shipped 2026-07-11.**
All 12 ✦ starter kernels from gauntletcontent.md's ranked picks are live topics with the document's exact params: perfect squares (2–15), perfect cubes (2–6), square roots, evaluate-exponent (exp 2–4, exp-4 capped at base 5), doubling/halving, powers of ten (1–4 place shifts), fraction-of-number, place value, 2-digit × 1-digit, Pythagorean triples (4 named triples + multiples ≤ 50, hyp + missing-leg), solve-proportion (unknown rotates all four positions), exponent product rule (bases {2,3,5,10,x}, answer = n). Per-fact keys follow the doc's scheme (`sq:13` style) so the adaptive trainer covers all of them; unicode-inline rendering (², ³, √, ⁿ) as specified. Menu topics now grouped "Number facts" / "Skills & concepts". With the 4 already-shipped arithmetic picks, **16 of the doc's 28 ranked picks are live**; next actionable band needs the `fraction` / `short-expression` / `two-numbers` answer engines (#7, #21, #23, #25, #26).

**G2 · Pathway system (basics → complex)** *(dev)* — 🔴 Not started; content blocker cleared.
Skill-tree progression: start at foundations, unlock topics by demonstrated mastery (the adaptive fact-tracking from M3 already measures this). Blocker (a) ✅ **complete 2026-07-10**: `artifacts/gauntletcontent.md` shipped — full Pre-Algebra → AP Calc BC taxonomy (346 rated entries, 100 cross-references, kernel registry with in-degree ranking, 28 prioritized top picks incl. the "Starter Twelve" zero-engine-work subset). Blocker (b) resolved: the ninja_maths reference image arrived and adds nothing beyond the written description — design proceeds from the taxonomy alone. Architecture note: current unlock chain (boss gating) generalizes to topic nodes; the fact-tracking store already measures per-kernel mastery.

## 🧊 Phase 3 / Later

- ~~CASL-consented nurture email flow~~ → promoted to **E3** (provider decided 2026-07-12: Resend).
- Self-host the two Google fonts (build currently fetches them at build time).
- Ongoing GT workshop-catalog sync (keep `data.ts` current as GT's catalog evolves).
- Admin tooling depth: bulk status changes, assessment scheduling, waitlist management once 120 fills.
- Slim /gt further to Scholars-specific content as top-level pages absorb general material (S7).
- Build out deeper pages for the four non-Scholars groups.
- Password reset flow (needs working email → after S6).
- Lint cleanup: pre-existing errors (TimeBackSimulator, account modal reset effect, dashboard store) + exclude `artifacts/` from ESLint.

---

## ✅ Done

**2026-07-12 — Ethan items + go-live infrastructure (Phase 1 complete):**
- **E1/T2 · Booking link** — `cal.com/peter.k/the120` (20 min, buffers, 3/day cap, Google Calendar sync); `NEXT_PUBLIC_BOOKING_URL` in Vercel all environments; production redeployed; verified live on the site. **Closes Phase 1.**
- **E2/S10-1 · Stripe descriptor** — live statement descriptor set to **"THE120"** on Hatch Coding CDN (dashboard + API-verified). Note: only other live activity on the account is one `past_due` subscription (last charge Sept 2025) — consider cancelling it.
- **E5 · Attribution columns live** — migration applied (via Management API; stored DB password is stale — see E5 note), `heard_about`/`referral_code` + index on `parents`, history recorded.
- **E6 · QA deposit cleanup** — test refund `re_3Trf6v25N9cbf3wU0MwbR3Zq` → production webhook flipped deposit to `refunded` in seconds → QA auth user cascade-deleted → live counter back to **113**, fake dossier gone.
- **S6 (domain half) · the120.school LIVE** — Namecheap registration, nameservers → Vercel, domain on the project, SSL issued, site + counter + booking link verified at https://the120.school. **Google Workspace verification TXT** added in Vercel DNS and confirmed resolving publicly (Workspace email setup unblocked).
- Decisions recorded: Stripe = Hatch + THE120 descriptor; Gauntlet = public lead magnet + member perks (M2 reframed); email provider = Resend (E3 open).

**2026-07-10 — funnel verified in production + GTM plan:**
- **GTM W1 dev tickets shipped**: (1) *Attribution on signup* — "How did you hear about us?" select + referral code (AMB-NAME) field in the join modal; values stored in auth user metadata immediately, and in `parents.heard_about`/`parents.referral_code` once the included migration is applied (**action: `supabase db push`** — migration `20260710120000_referral_attribution.sql`; the app degrades gracefully until then). (2) *Gauntlet share card* — victory + trial screens now have "📸 Share score": a generated 1080×1080 card (key art, boss, medal, stats, "Can you beat me?" + URL) via the native share sheet on mobile, PNG download on desktop.
- **Production E2E, full funnel** ✅ — scripted browser run against jointhe120.vercel.app: join modal → Supabase signup (auto-confirm) → dashboard → child dossier to 100% (real workshop catalog) → submit for review → "Reserve seat · $250" → Stripe test checkout (4242 card) → redirected back with "✓ Seat deposit received" → child card shows "SEAT RESERVED · $250 DEPOSIT PAID" → **live seat count decremented 113 → 112**. ~~⚠️ Cleanup needed~~ → **done 2026-07-12 as E6** (refunded + rows deleted, counter back to 113).
- **GTM 8-week sprint plan** → `artifacts/gtm-8-week-sprint.md` — Arm/Seed/Surge/Land phases, funnel math to 48–55 deposits by Sept 1, F1/F2 ambassador system (recognition incentives, CASL-safe), five-group vertical outreach, Gauntlet Summer Tournament as the organic engine, September landing definition-of-done, Monday checklist. Flags the same Week-1 blockers as this roadmap: S10 Stripe live, T2 booking link, email provider.
- **Gauntlet question-type UI audit** — all 8 topics verified isolated and rendering correctly (numeric auto-submit ×7; congruence figures + 5-choice); fixed a topic-toggle state race (stale closure on rapid clicks).

**2026-07-09 — the funnel ships (S1–S4 + Phase 1):**
- **S1 · Supabase auth** (`09e3727`) — join modal creates real users (email+password, auto-confirmed until SMTP); parents table with CASL consent; sign-in screen; auth-gated dashboard. Schema migration: parents/children/deposits + RLS (verified: anon reads zero rows) + `seats_claimed()`.
- **S2 · Dossier persistence** (`09e3727`) — dashboard store on Supabase with 700ms debounced saves; localStorage V1 deleted.
- **S3 · Deposit inside the dashboard** (`09e3727`) — "Reserve seat · $250" on submitted dossiers → Stripe Checkout → webhook records deposit (idempotent, service-role only) → "Seat reserved ✓"; refund terms in checkout + receipt; refunds tracked via charge.refunded. **E2E-verified locally**: signup → dossier → checkout → webhook → deposit row → seat count 113→112 → cleanup.
- **S4 · Live seat counts** (`09e3727`) — `120 − 7 − paid deposits` on home, /tuition, /gt, dashboard (60s cache, truthful fallback); FAQ "real and maintained" line restored — now true.
- **T1 · Book-a-call buttons fixed** (`4bd0f0c`) — all six dead `#call` anchors now use `NEXT_PUBLIC_BOOKING_URL` (email fallback until T2), external links open in a new tab.
- **T3 · Truthful seat counter** (`8f11fbd`) — 113 of 120, hand-count replaced same-day by S4's live count.
- **T9 · /parents stories page** (`e92d899`) — full Ian Logan / Gordon McKay / Peter Kuperman stories (permission confirmed), home-page excerpt band, nav + footer links, honest TimeBack/Alpha attribution.
- **T10 · HST-exempt on every pricing view** (`e7d2f93`) — home teaser + /gt tuition now carry it; upgrade framing per pricing story.
- **T11 · /scholars group page** (`a7df611`) — Scholars card routes to /scholars (same layout as other groups) with a deep link to the full GT program at /gt; footer GT link removed, interim contact email pkuperman@gmail.com.
- **Home pillar copy** (`f4bf40a`) — "03 · The Subject" with acceleration copy; project pillar tied to the group.
- **Env hygiene** — found and fixed BOM-corrupted Supabase env values in Vercel (PowerShell stdin piping); all env vars recreated clean. Production Stripe webhook endpoint + secret configured.

**2026-07-09 — earlier:**
- **T7 · Stripe deposit product (test mode)** — product `prod_Ur6AwdjOT1R4FB` + price `price_1TrNyj25N9cbf3wUf1Hm125C` ($250 CAD); publishable/secret/price-ID/webhook-secret in Vercel; CLI authenticated (its key expires ~2026-10-07; app uses the permanent dashboard key).
- **T6 · Supabase project** — `the120` (ref `deolvqnyvhhnavsifgxz`, us-east-1); keys in Vercel all environments; `.env.local` for local dev. DB password in `~\.the120-supabase-db-password.txt` — **move to a password manager and delete**.
- **T4 · Claims round 1** — all 12 vetted claims applied (GT-partner line out, campus mentions out, "expert Academic Advisor" bi-weekly copy, 51+ campuses, intensive dates +1 week).
- **T5 · Income brackets removed from signup** (`790101d`).
- **T8 · Real workshop catalog** (`47c98cc`) — 42 real workshops / 9 real advisors, picker grouped by track.
- GT Toronto removed from main nav; GT nav variant removed — one 120 nav everywhere.

**Earlier:**
- Homepage per brief v4; five-groups direction integrated (home, four group pages, serif/blue identity, /gt, /tuition, /faq).
- Parent dashboard + dossier builder: children, subjects, workshops, project pitch, completeness meter, status stepper, submit-for-review, printable dossier.
- Responsive + interaction polish pass; join flow with CASL express consent.
- **Vercel ↔ this repo**: project `the120` (helix3) connected to `qed/the120`, production branch `main`; jointhe120.vercel.app alias auto-carries on deploys. Package renamed `the120`.
- Full content audit → all 12 claims vetted by Peter, verdicts applied same day.
