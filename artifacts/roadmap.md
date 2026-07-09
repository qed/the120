# Roadmap — the120.school

Working plan for the site. Peter is PM; two developers execute tickets via AI coding sessions. Done items should be moved to the bottom.
Horizons: **Phase 1** (recruitment push) → **Phase 2** (accounts + deposits fully live) → **Phase 3**.
Status markers: 🔴 not started · 🟡 in progress / partially done · ⛔ blocked on someone · ✅ done (bottom section).

**Live:** jointhe120.vercel.app (Vercel project `the120`, helix3 team, auto-deploys on push to `main` of `qed/the120`; the jointhe120 alias carries forward automatically on each production deploy — no manual step).

---

## 📌 Decisions made (build intelligence — do not re-litigate)

- **Five groups** (Athletes, Founders, Makers, Scholars/GT, Givers), $3,000 Membership + $15,000 Full Academic Core. Single-network version preserved in git history (`master` pre-merge).
- **$250 deposit, per child, refundable until September 30, 2026**, paid by Stripe Checkout **inside the dashboard** after account creation and dossier — not a standalone payment link.
- **Seat-count truth progression:** Stage 1 (now) — hand-maintained truthful constant: **7 committed families → 113 of 120 seats remain**. Stage 2 — counter reads from real paid deposits in Supabase. Never show fabricated numbers.
- **Recruitment push target** from 2026-07-09. Get and test Supabase, Stripe Checkout, account creation, and dossier creation working so we can push for recruitment asap.
- **Positioning (2026-07-09):** The 120 is a general "join a society" product — 120 kids, five groups; GT is just one. GT pages are de-emphasized sub-pages; general information and proof content lives on/from the home page. **One 120 nav + footer, common to all pages — no GT-variant chrome.** Parent testimonials go front and center from home via a `/parents` stories page.
- **Accounts:** Stripe ✅ (test mode configured) · Supabase ✅ (created) · booking link, the120.school domain, mailbox — still to create.

## 🔴 Decisions made, still need coding

- [ ] **Deposit refund terms** (Sept 30, 2026) → checkout copy, receipt email, terms page (lands with S3 + S7).
- [ ] **Pricing story**: $3,000/yr to join, upgradeable to $15,000/yr Full Academic Core, all HST-exempt — **every pricing view must say so** (T10).

---

## 🚀 Phase 1 — open work

**T1 · Fix the dead "Book a call" buttons** *(dev — highest conversion impact)* — ⛔ **Blocked by T2.**
All six CTAs (`Nav` ×2, `CtaBand`, /tuition, group pages) link to `#call`, an anchor that exists on no page — the primary CTA silently does nothing. Point every one at the real booking link (env var `NEXT_PUBLIC_BOOKING_URL`), opening in a new tab.
*Acceptance: clicking "Book a call" anywhere opens the scheduling page.*

**T2 · Create the booking link** *(Owner: Peter — external, ~30 min)* — 🔴 **Not started.**
One Cal.com or Calendly event, 20–30 min intro call. Drop the URL in Vercel env vars + this file. Unblocks T1.

**T3 · Truthful seat counter** *(dev — trust-critical, ~20 min)* — 🔴 **Not started.**
Set `SEATS_REMAINING = 113` (7 committed of 120) in `app/lib/site.ts`. Delete "Seat counts shown on this site are real and maintained" from `app/components/Faq.tsx` until Stage 2 makes it true. Add a code comment: hand-maintained until wired to deposits (S4).
*Acceptance: every seat figure on the site derives from the one constant and matches reality.*

**T9 · /parents stories page — testimonials front and center** *(dev)* — 🔴 **Ready to build — publish permission from Ian Logan + Gordon McKay confirmed.**
Build a dedicated `/parents` stories page with the deep Toronto parent testimonials from `artifacts/AlphaTestimonials.md`, linked and referenced prominently from the home page. Per positioning: general proof content lives on/from home, not buried on GT sub-pages.

**T10 · HST-exempt on every pricing view** *(dev, ~20 min)* — 🔴 **Not started.**
Add the HST-exempt mention to home `TuitionTeaser` and /gt `GtTuition` (already present in /tuition fine print + FAQ). Copy angle: "$3,000/yr to join, upgrade to $15,000/yr for the Full Academic Core — HST-exempt."

**T11 · De-emphasize GT to a plain sub-page** *(dev)* — 🟡 **Partially done** (GT nav variant + main-nav link removed 2026-07-09).
Remaining: audit /gt for general content that belongs at the top level (testimonials, network proof) and slim /gt down to Scholars-specific info. GT-only footnote/stats stay on /gt per claims verdict. Overlaps with T9. For now, keep all current GT info at /gt but create Scholars specific pages and content at /scholars

---

## 🏗 Phase 2 — accounts, deposits, admin

**S1 · Supabase auth replaces localStorage accounts** *(dev)* — 🔴 **Not started; unblocked** (T6 done).
The join modal creates real Supabase users (email/password + magic link). Modal fields (CASL consent etc.) persist to a `parents` table. Session-aware Nav ("Sign in" → account state).

**S2 · Dossier persistence** *(dev)* — 🔴 **Not started; after S1.**
Migrate the dashboard store from localStorage to Supabase: `parents → children → subject_picks / workshop_selections / project_pitch → dossier(status)` — the shape already modeled in `app/dashboard/data.ts`. Photo uploads to Supabase storage.

**S3 · Deposit inside the dashboard** *(dev — the centrepiece)* — 🔴 **Not started; after S1/S2 + T7 keys.**
"Reserve your child's seat — $250" in each child's dossier once submitted: creates a Stripe Checkout session tied to parent + child, webhook records the paid deposit (`deposits` table), child status advances, receipt email confirms refund terms (Sept 30, 2026). Refund path documented for admins.
*Acceptance: a parent can go account → dossier → pay $250 → see "seat reserved" — and Stripe + Supabase agree.*

**S10 · Stripe go-live: account decision + live mode** *(Owner: Peter + dev)* — 🔴 **Not started; required before accepting real deposits (after S3 works end to end in test mode).**
Everything Stripe today is **test mode** on the **Hatch Coding CDN** account (`acct_103s7v25N9cbf3wU`). To go live:
  1. **Account decision (Peter)**: dedicated Stripe account for The 120 (cleanest — separate books, own branding) **or** stay on Hatch Coding CDN with a custom statement descriptor (e.g. "THE120") so parents' card statements don't read "Hatch Coding". If switching accounts: recreate product/price there (~5 min) and update `STRIPE_DEPOSIT_PRICE_ID` + keys.
  2. **Live keys**: put `pk_live_…` / `sk_live_…` into Vercel **production env only** (keep test keys on preview/development so preview deploys can never charge real cards).
  3. **Live product + price + webhook**: recreate the deposit product in live mode; create the production webhook endpoint and set live `STRIPE_WEBHOOK_SECRET`.
  4. **Verification**: one real $250 charge + refund round-trip before announcing to parents; confirm statement descriptor, receipt email, and refund copy (Sept 30, 2026 terms).

**S4 · Seat counter reads real deposits (Stage 2)** *(dev)* — 🔴 **Not started; after S3.**
`SEATS_REMAINING` becomes `120 − 7 founding commitments − paid deposits` from Supabase (ISR/revalidated). Restore the "real and maintained" FAQ line once true.

**S5 · Admin review queue with payment visibility** *(dev)* — 🔴 **Not started; after S2/S3.**
Admin-only view: dossier queue, status changes, notes, and who has paid/refunded (Stripe customer link per family).

**S6 · Domain + mailbox** *(Owner: Peter — external)* — 🔴 **Not started.**
Register the120.school → point at the Vercel project (also permanently fixes the unclaimable `jointhe120` subdomain problem); defensive domains per brief (the120.ca, 120.school); set up admissions@the120.school (footer + flows already reference it). Pair with custom SMTP for Supabase auth emails (default is rate-limited ~2/hr).

**S7 · Content overhaul round 2** *(dev + Peter)* — 🔴 **Not started.**
Remaining site-map pages: How It Works, The Full Program, Our Advisors, Intensives — plus a written deposit/refund terms page linked from checkout.

**S8 · Visual/asset debt** *(dev + Peter)* — 🔴 **Not started.**
Licensed photography (hero is a 2165px extraction, soft on retina; four group-page background slots are blue placeholders; Tin Can product imagery). Mission video for the hero. Restyle dashboard + join modal to the handoff identity. Dashboard "group" picker (data model + UI).

**S9 · Tin Can partnership confirmation** *(Owner: Peter — external)* — 🔴 **Not started.**
Logo/co-marketing rights before the brand appears beyond the legal line.

---

## 🧊 Phase 3 / Later

- CASL-consented nurture email flow (needs an email provider decision — Resend, Customer.io).
- Self-host the two Google fonts (build currently fetches them at build time).
- Ongoing GT workshop-catalog sync (keep `data.ts` current as GT's catalog evolves after the T8 import).
- Admin tooling depth: bulk status changes, assessment scheduling, waitlist management once 120 fills.
- Dedicated campus page when the Toronto venue/campus story firms up.
- Build out pages for the 4 groups that don't have lots of details (everything except Scholars).
- Lint cleanup: 6 pre-existing errors (TimeBackSimulator, account modal reset effect, dashboard store) + exclude `artifacts/` from ESLint.

---

## ✅ Done

- [x] **Household income brackets** → removed from signup (T5, done).
**Tickets (2026-07-09):**
- **T7 · Stripe deposit product (test mode)** — product `prod_Ur6AwdjOT1R4FB` + price `price_1TrNyj25N9cbf3wUf1Hm125C` ($250.00 CAD) on account `acct_103s7v25N9cbf3wU`; Vercel env has `STRIPE_DEPOSIT_PRICE_ID`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, and `STRIPE_SECRET_KEY` (permanent dashboard key, sensitive on production/preview) across all environments; `.env.local` refreshed. Stripe CLI installed + authenticated (its own key expires ~2026-10-07 — re-run `stripe login` then; doesn't affect the app). `STRIPE_WEBHOOK_SECRET` lands with S3's webhook endpoint; going live is S10.
- **T4 · Claims round 1** — all 12 vetted claims applied: GT-partner line removed from footer; campus mentions removed (KeyDates footnote + FAQ entry); advisor claim now "Bi-weekly 30 min 1:1 with an expert Academic Advisor" (4 locations); 13+ → 51+ campuses (2 locations); intensive dates moved forward one week (Nov 7–8 2026, Jan 30–31, Apr 3–4, Jun 12–13 2027).
- **T5 · Remove income brackets from signup** (`790101d`) — household-income step deleted from the account modal: field, validation, and constant.
- **T6 · Supabase project created** — project `the120` (ref `deolvqnyvhhnavsifgxz`, us-east-1), ACTIVE_HEALTHY. All three keys in Vercel env for production/preview/development (service-role key sensitive); `.env.local` pulled locally (gitignored). Email/password + magic-link auth on by default. DB password saved to `~\.the120-supabase-db-password.txt` on Peter's machine — **move to a password manager and delete the file**. Unblocks S1–S4.
- **T8 · Real workshop catalog imported** (`47c98cc`) — `app/dashboard/data.ts` carries the real catalog from the design handoff's `gt-workshops.json`: **42 workshops** (5 dropped as K–2-only; The 120 is grades 3–8) across 3 tracks + `ADVISORS` export with all 9 real advisors and bios. DossierEditor picker groups by collapsible track sections. Stale localStorage picks degrade gracefully.

**Earlier:**
- Homepage per brief v4; five-groups direction integrated (home, four group pages, serif/blue identity, /gt, /tuition, /faq).
- Join flow: account modal with CASL express consent (local state).
- Parent dashboard + dossier builder (localStorage V1): children, subjects, workshop catalog, project pitch, completeness meter, status stepper, submit-for-review, printable dossier.
- Responsive + interaction polish pass.
- **Vercel ↔ this repo**: project `the120` (helix3) connected to `qed/the120`, production branch `main`; jointhe120.vercel.app alias auto-carries on deploys. Package renamed `the120`.
- Full content audit (2026-07-09) → all 12 claims vetted by Peter, verdicts applied same day (T4).
- GT Toronto removed from the main nav (reachable via Scholars group card + footer); GT nav variant removed — one 120 nav on every page.
