# Roadmap — the120.school

Working plan for the site. Peter is PM; two developers execute tickets via AI coding sessions.
Horizons: **Phase 1** (recruitment push) → **Phase 2** (accounts + deposits fully live) → **Phase 3**.

**Live:** jointhe120.vercel.app (Vercel project `the120`, helix3 team, auto-deploys on push to `main` of `qed/the120`; the jointhe120 alias carries forward automatically on each production deploy — no manual step).

---

## 📌 Decisions made (build intelligence — do not re-litigate)

- **Five groups** (Athletes, Founders, Makers, Scholars/GT, Givers), $3,000 Membership + $15,000 Full Academic Core. Single-network version preserved in git history (`master` pre-merge).
- **$250 deposit, per child, refundable**, paid by Stripe Checkout **inside the dashboard** after account creation and dossier — not a standalone payment link.
- **Seat-count truth progression:** Stage 1 (now) — hand-maintained truthful constant: **7 committed families → 113 of 120 seats remain**. Stage 2 — counter reads from real paid deposits in Supabase. Never show fabricated numbers.
- **Recruitment push target** from 2026-07-09. Let's get and test all supabase, stripe checkout, account creation and dossier creation working so that we can push for recruitment asap.
- **Accounts that exist:** Stripe ✅. Supabase, booking link, the120.school domain, mailbox — all still to create.
- **Positioning (2026-07-09):** The 120 is a general "join a society" product — 120 kids, five groups; GT is just one. GT pages are de-emphasized sub-pages; general information and proof content lives on/from the home page. **One 120 nav + footer, common to all pages — no GT-variant chrome.** Parent testimonials go front and center from home via a `/parents` stories page.

## 🔴 Decisions made, need to code them in to the app

- [ ] **Deposit refund terms**: Refundable until September 30, 2026 → goes into checkout copy, receipt email, and the terms page (T7, S3, S7).
- [ ] **Household income brackets**: Delete this part of the account signup flow (T5).
- [ ] **Pricing story**: $3,000/yr to join (Membership benefits), upgradeable to $15,000/yr Full Academic Core. All HST-exempt — **every pricing view must say so** (T10; /tuition fine print + FAQ already do, home TuitionTeaser and /gt GtTuition don't yet).

## 🔍 Claims inventory — vetting complete 2026-07-09

All 12 claims vetted by Peter; verdicts applied in code the same day (see ✅ Done). Still open:

| Claim | Status |
|-------|--------|
| Alpha Toronto parent testimonials (`artifacts/AlphaTestimonials.md` — Ian Logan, Gordon McKay, Peter Kuperman) | Vetted-real; **integration pending** (T9) — placement + publish-permission questions with Peter |
| Dashboard workshop catalog | Real catalog found: **47 workshops, 9 advisors** in `artifacts/The 120 Design Handoff/design_handoff_the120/design_files/gt-workshops.json` (Andreea Musat, Anjelina Belakovskaia, Craig Lundberg, David Zook, Melissa Muir, Norberto Troncoso, Ruchi Shukla, Sarah Langdon, Yash Mehta). Import → T8 |
| Network stats (3x, 1400+ SAT, 91%, AP 5s) | Confirmed GT/Scholars-pages-only (they already render only on /gt via ProductPillars/Testimonials) — keep there, never on general pages |

---

## 🚀 Phase 1

**T1 · Fix the dead "Book a call" buttons** *(dev — highest conversion impact)*
All six CTAs (`Nav` ×2, `CtaBand`, /tuition, group pages) link to `#call`, an anchor that exists on no page — the primary CTA silently does nothing. Point every one at the real booking link (env var `NEXT_PUBLIC_BOOKING_URL`), opening in a new tab.
*Acceptance: clicking "Book a call" anywhere opens the scheduling page. Blocked by T2.*

**T2 · Create the booking link** *(Owner: Peter — external, ~30 min)*
One Cal.com or Calendly event, 20–30 min intro call. Drop the URL in Vercel env vars + this file.

**T3 · Truthful seat counter** *(dev — trust-critical)*
Set `SEATS_REMAINING = 113` (7 committed of 120) in `app/lib/site.ts`. Delete "Seat counts shown on this site are real and maintained" from `app/components/Faq.tsx` until Stage 2 makes it true. Add a code comment: hand-maintained until wired to deposits (S4).
*Acceptance: every seat figure on the site derives from the one constant and matches reality.*

**T4 · Claims round 1** *(dev)* — ✅ **Done 2026-07-09.** Applied all vetted verdicts: GT-partner line removed from footer; campus mentions removed (KeyDates footnote + FAQ entry); "PhD-level" → "Bi-weekly 30 min 1:1 with a strong Academic Advisor" (4 locations); 13+ → 51+ campuses (2 locations); intensive dates moved forward one week (Nov 7–8 2026, Jan 30–31, Apr 3–4, Jun 12–13 2027); GT Toronto removed from main nav (still reachable via Scholars card + footer).

**T5 · Remove income brackets from signup** *(dev, ~30 min)*
Delete the household-income step from `app/components/account/AccountModal.tsx` (field, validation, INCOME_BRACKETS constant) and from the parent data model.

**T8 · Import the real workshop catalog** *(dev)*
Replace the 8 mocked workshops in `app/dashboard/data.ts` with the real 47-workshop / 9-advisor catalog from `artifacts/The 120 Design Handoff/design_handoff_the120/design_files/gt-workshops.json` (includes bios, tracks, grade ranges, formats, poster/headshot asset paths). The DossierEditor workshop picker needs grouping (by track or advisor) to stay usable at 47 items.
*Acceptance: dashboard shows only real workshops and real advisors; picker is navigable.*

**T9 · /parents stories page — testimonials front and center** *(dev; ⚠️ publish permission from Ian Logan + Gordon McKay still unconfirmed — Owner: Peter)*
Build a dedicated `/parents` stories page with the deep Toronto parent testimonials from `artifacts/AlphaTestimonials.md`, linked and referenced prominently from the home page. Per positioning: general proof content lives on/from home, not buried on GT sub-pages.

**T11 · De-emphasize GT to a plain sub-page** *(dev)*
Per positioning (The 120 = one society, five groups; GT is just one): audit /gt for general content that belongs at the top level (testimonials, network proof) and slim /gt down to Scholars-specific info. GT nav variant already removed — one 120 nav + footer on every page. GT-only footnote/stats stay on /gt per claims verdict.

**T10 · HST-exempt on every pricing view** *(dev, ~20 min)*
Add the HST-exempt mention to home `TuitionTeaser` and /gt `GtTuition` (already present in /tuition fine print + FAQ). Copy angle: "$3,000/yr to join, upgrade to $15,000/yr for the Full Academic Core — HST-exempt."

**T6 · Create the Supabase project** *(Owner: Peter — external, ~30 min)*
Enable email auth (password + magic link). Add to Vercel env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-only). Unblocks all of S1–S4.

**T7 · Stripe deposit product** *(Owner: Peter + dev — external, ~1 hr)*
In the existing Stripe account: $250 CAD product/price for "The 120 — Refundable Seat Deposit," refund terms in the statement descriptor/receipt copy (needs the refund-terms decision). Add `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` to Vercel env. Test-mode checkout verified end to end before live keys.

---

## 🏗 Phase 2 — accounts, deposits, admin

**S1 · Supabase auth replaces localStorage accounts** *(dev)*
The join modal creates real Supabase users (email/password + magic link). Existing modal fields (income bracket, CASL consent) persist to a `parents` table. Session-aware Nav ("Sign in" → account state).

**S2 · Dossier persistence** *(dev)*
Migrate the dashboard store from localStorage to Supabase: `parents → children → subject_picks / workshop_selections / project_pitch → dossier(status)` — the shape already modeled in `app/dashboard/data.ts`. Photo uploads to Supabase storage.

**S3 · Deposit inside the dashboard** *(dev — the centrepiece)*
"Reserve your child's seat — $250" in each child's dossier once submitted: creates a Stripe Checkout session tied to parent + child, webhook records the paid deposit (`deposits` table), child status advances, receipt email confirms refund terms. Refund path documented for admins.
*Acceptance: a parent can go account → dossier → pay $250 → see "seat reserved" — and Stripe + Supabase agree.*

**S4 · Seat counter reads real deposits (Stage 2)** *(dev, after S3)*
`SEATS_REMAINING` becomes `120 − 7 founding commitments − paid deposits` from Supabase (ISR/revalidated). Restore the "real and maintained" FAQ line once true.

**S5 · Admin review queue with payment visibility** *(dev)*
Admin-only view: dossier queue, status changes, notes, and who has paid/refunded (Stripe customer link per family).

**S6 · Domain + mailbox** *(Owner: Peter — external)*
Register the120.school → point at the Vercel project (fixes the unclaimable `jointhe120` subdomain problem for good); defensive domains per brief (the120.ca, 120.school); set up admissions@the120.school (footer + flows already reference it).

**S7 · Content overhaul round 2** *(dev + Peter)*
Remaining site-map pages: How It Works, The Full Program, Our Advisors, Intensives — plus a written deposit/refund terms page linked from checkout.

**S8 · Visual/asset debt** *(dev + Peter)*
Licensed photography (hero is a 2165px extraction, soft on retina; four group-page background slots are blue placeholders; Tin Can product imagery). Mission video for the hero. Restyle dashboard + join modal to the handoff identity. Dashboard "group" picker (data model + UI).

**S9 · Tin Can partnership confirmation** *(Owner: Peter — external)*
Logo/co-marketing rights before the brand appears beyond the legal line — gates claims #4.

---

## 🧊 Later

- CASL-consented nurture email flow (needs an email provider decision — Resend, Customer.io).
- Self-host the two Google fonts (build currently fetches them at build time).
- Ongoing GT workshop-catalog sync (keep `data.ts` current as GT's catalog evolves after the T8 import).
- Admin tooling depth: bulk status changes, assessment scheduling, waitlist management once 120 fills.
- Dedicated campus page when the Toronto venue/campus story firms up.
- Build out pages for the 4 groups that don't have lots of details (everything except Scholars).

## ✅ Done

- Homepage per brief v4; five-groups direction integrated (home, four group pages, serif/blue identity, /gt, /tuition, /faq).
- Join flow: account modal with CASL express consent + income brackets (local state).
- Parent dashboard + dossier builder (localStorage V1): children, subjects, workshop catalog, project pitch, completeness meter, status stepper, submit-for-review, printable dossier.
- Responsive + interaction polish pass.
- **Vercel ↔ this repo**: project `the120` (helix3) connected to `qed/the120`, production branch `main`; jointhe120.vercel.app alias auto-carries on deploys. Package renamed `the120`.
- Full content audit (2026-07-09) → Claims Inventory above; all 12 claims vetted by Peter and verdicts applied in code same day (T4).
- GT Toronto removed from the main nav (reachable via Scholars group card + footer); GT nav variant removed — one 120 nav on every page. Advisor copy finalized: "Bi-weekly 30 min 1:1 with an expert Academic Advisor."
