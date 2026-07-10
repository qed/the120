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
- **Accounts:** Stripe ✅ (test mode, live product pending S10) · Supabase ✅ (live, schema deployed) · booking link, the120.school domain, mailbox — still to create.
- **Interim contact email** is pkuperman@gmail.com (footer + Book-a-call fallback) until admissions@the120.school exists (S6).

## 🚀 Phase 1 — open work

**T2 · Create the booking link** *(Owner: Peter — external, ~30 min)* — 🔴 **Not started; last open Phase 1 item.**
One Cal.com or Calendly event, 20–30 min intro call. Set `NEXT_PUBLIC_BOOKING_URL` in Vercel (all environments) and redeploy — every Book-a-call button switches from the email fallback to the scheduler automatically (T1 code shipped).

---

## 🏗 Phase 2 — open work

**S5 · Admin review queue with payment visibility** *(dev)* — 🔴 **Not started; now unblocked** (S2/S3 shipped).
Admin-only view: dossier queue, status changes, notes, and who has paid/refunded (Stripe customer link per family).

**S6 · Domain + mailbox + email** *(Owner: Peter — external)* — 🔴 **Not started.**
Register the120.school → point at the Vercel project (also permanently fixes the unclaimable `jointhe120` subdomain); defensive domains (the120.ca, 120.school); set up admissions@the120.school, then swap the interim pkuperman@gmail.com contact in `Footer` and `BOOKING_URL` fallback. Custom SMTP for Supabase auth emails + **re-enable email confirmations** (`supabase/config.toml` → `enable_confirmations = true`, `supabase config push`) — signups are currently auto-confirmed because the default sender is rate-limited ~2/hr.

**S7 · Content overhaul round 2** *(dev + Peter)* — 🔴 **Not started.**
Remaining site-map pages: How It Works, The Full Program, Our Advisors, Intensives — plus a written deposit/refund terms page linked from checkout (terms currently live only in checkout copy + receipt).

**S8 · Visual/asset debt** *(dev + Peter)* — 🔴 **Not started.**
Licensed photography (hero is a 2165px extraction, soft on retina; four group-page background slots are blue; Tin Can product imagery). Mission video. Restyle dashboard + join modal to the handoff identity. Dashboard "group" picker (data model + UI). Move dossier photos from data-URL column to a Supabase storage bucket.

**S9 · Tin Can partnership confirmation** *(Owner: Peter — external)* — 🔴 **Not started.**
Logo/co-marketing rights before the brand appears beyond the legal line.

**S10 · Stripe go-live: account decision + live mode** *(Owner: Peter + dev)* — 🔴 **Not started; required before accepting real deposits.**
Everything Stripe is **test mode** on the **Hatch Coding CDN** account (`acct_103s7v25N9cbf3wU`). To go live:
  1. **Account decision (Peter)**: dedicated Stripe account for The 120 **or** custom statement descriptor (e.g. "THE120") on Hatch Coding CDN. If switching: recreate product/price/webhook, update env.
  2. **Live keys**: `pk_live_…` / `sk_live_…` into Vercel **production only** (test keys stay on preview/dev so previews can never charge real cards).
  3. **Live product + price + webhook** (test webhook `we_1TrOfg25N9cbf3wUesMLOl9y` targets production URL with test events today).
  4. **Verification**: one real $250 charge + refund round-trip; confirm statement descriptor, receipt email, refund copy.

---

## 🎮 MathRaiders (FastMath game)

**M1 · Playable v1** *(dev)* — ✅ **Shipped** (`/raiders`, in main nav).
Boss-battle FastMath: correct answers do damage (speed + streak multipliers), wrong answers cost player HP; 2-minute raids, 4 bosses with generated arenas + sprites (Nano Banana Pro, `scripts/gen-sprites.mjs`), XP + local save. Topics: ×, ÷, +, − plus GCD, LCM, common denominator, and triangle congruence (rendered figures, multiple choice). Fully open demo for now, per direction.

**M2 · Deposit gating + account saves** *(dev)* — 🔴 Not started.
When product wants it: full topic set / Mastery Trials behind a paid deposit (deposits table already live), progress saved to the family's Supabase account instead of localStorage.

**M3 · Game depth** *(dev)* — 🔴 Not started.
Sound effects/music toggle, Mastery Trials mode (timed accuracy gauntlet), multiplayer raid rooms, more bosses/arenas, difficulty scaling by grade.

## 🧊 Phase 3 / Later

- CASL-consented nurture email flow (needs an email provider decision — Resend, Customer.io).
- Self-host the two Google fonts (build currently fetches them at build time).
- Ongoing GT workshop-catalog sync (keep `data.ts` current as GT's catalog evolves).
- Admin tooling depth: bulk status changes, assessment scheduling, waitlist management once 120 fills.
- Slim /gt further to Scholars-specific content as top-level pages absorb general material (S7).
- Build out deeper pages for the four non-Scholars groups.
- Password reset flow (needs working email → after S6).
- Lint cleanup: pre-existing errors (TimeBackSimulator, account modal reset effect, dashboard store) + exclude `artifacts/` from ESLint.

---

## ✅ Done

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
