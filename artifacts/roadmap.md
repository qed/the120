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
- **Accounts:** Stripe ✅ (test mode, live product pending S10) · Supabase ✅ (live, schema deployed, email confirmations ON since 2026-07-13) · booking link ✅ (cal.com/peter.k/the120) · the120.school ✅ (live on Vercel, Namecheap-registered, Vercel nameservers) · mailbox ✅ (peter@ + ethan@ live 2026-07-13, admissions@ alias + default From) · Resend ✅ (domain verified; API key rotated 2026-07-13).
- **Contact email is admissions@the120.school** (live 2026-07-12; alias on the peter@the120.school Workspace user, in the existing Hatch/theknetwork.org org — no new subscription). Footer + booking fallback swapped from the interim gmail.
- **Stripe account (2026-07-12, E2):** The 120 charges on the **Hatch Coding CDN** account with statement descriptor **"THE120"** — no dedicated account. Revisit only if The 120 becomes its own legal entity (the Stripe account must belong to the entity actually charging).
- **Gauntlet positioning (2026-07-12, E4):** the Gauntlet is a **public lead magnet, permanently** (Summer Tournament per the GTM plan). Never paywall the core game — a $250 school-seat deposit will never be bought to unlock a math game, so gating kills distribution without creating revenue. Free account saves progress + joins the leaderboard (= lead capture); deposit-holders get **additive** member perks only. Supersedes the original post-deposit lock-in framing; M2 reframed accordingly.

## 📬 Ethan Items from July 11 — tracking checklist

From Ethan's 2026-07-11 message. Each item resolves into a canonical roadmap item where one exists; an item is only done when its row below is ✅. Remaining: **E3** (Resend) and the balance of **S10** (live keys → verification charge).

**E1 · Booking link (Ethan Q1)** = **T2** — ✅ **Done 2026-07-12.** Cal.com event **"The 120 — Intro Call"** at `cal.com/peter.k/the120`: 20 min, Cal Video, 2h minimum notice, 10-min buffer after, max 3/day, synced to Google Calendar. `NEXT_PUBLIC_BOOKING_URL` set in Vercel (all environments), production redeployed, **verified live**: every Book-a-call button now opens the scheduler. Availability = Cal.com defaults; tune windows in Cal.com → Availability if wanted.

**E2 · Stripe account question (Ethan Q2)** — ✅ **Decided 2026-07-12:** Hatch Coding CDN account + **"THE120"** statement descriptor (see Decisions). Remaining go-live work continues as **S10** steps 1b–4 (descriptor, live keys, live product/webhook, real charge + refund round-trip). Until S10 completes, all deposits stay test-mode.

**E3 · Resend account + welcome email + deposit nurture (Ethan Q3)** — 🟡 **Infrastructure + welcome email done 2026-07-12; nurture sequences remain.**
✅ Resend account live (peter@the120.school, team "the120"); the120.school **verified** as sending domain (DKIM `resend._domainkey` + `send` subdomain MX/SPF in Vercel DNS — scoped so Google mail is untouched); `RESEND_API_KEY` in Vercel (Production + Preview, sensitive). ✅ **Welcome email #1 shipped**: `app/api/welcome/route.ts` (bearer-auth like checkout, idempotent via `welcome_sent_at` user metadata) + fire-and-forget trigger on signup in `AccountModal`; sends from "The 120 <hello@the120.school>", reply-to admissions@; copy = GTM T+0 ("the dossier is the application") with dashboard + booking CTAs.
✅ Template test-sent to pkuperman@gmail.com via Resend API 2026-07-12 (id `42b610c6…`) for copy/rendering review. ✅ Ethan notification drafted and handed to Peter to send.
✅ (b) done 2026-07-13: **production E2E of the welcome email** — scripted signup (Resend test address `delivered@resend.dev`) → `/api/welcome` returned `ok:true`, second call returned `already:true` (idempotency), Resend log shows `last_event: delivered`; QA auth user deleted, seat count unaffected.
Remaining: (a) T+2d/T+5d/T+9d account-created sequence + deposit-paid sequence (needs scheduled sends — cron ticket = GTM-1). ✅ API key rotated 2026-07-13 (was shared in chat during setup); new key in Vercel — confirm Supabase SMTP (Auth → SMTP) also carries the new key before deleting the old one in Resend.

**E4 · Gauntlet framing clarification (Ethan Q4)** — ✅ **Decided 2026-07-12:** public lead magnet + member perks (see Decisions). M2 reframed below; GTM plan's Summer Tournament proceeds as written.

**E5 · `supabase db push` — attribution columns (Ethan a)** — ✅ **Done 2026-07-12.** `heard_about` / `referral_code` columns + referral-code index live on `parents`; migration recorded in `schema_migrations`. ⚠️ Applied via the Supabase **Management API** because the stored DB password (`~\.the120-supabase-db-password.txt`) **fails auth — it's stale or was saved wrong**. Reset the DB password in the Supabase dashboard next time direct `db push` is needed, then update/delete that file (T6 already says: move to a password manager).

**E6 · QA deposit cleanup (Ethan b)** — ✅ **Done 2026-07-12.** Refunded `pi_3Trf6v25N9cbf3wU0La9AOI9` ($250 test-mode, refund `re_3Trf6v25N9cbf3wU0MwbR3Zq`); the production **charge.refunded webhook flipped the deposit to `refunded` within seconds** (another live-readiness proof for S10); QA auth user deleted → cascade removed parent/child/deposit rows (fake dossier gone from queue); verified live: **"113 OF 120 SEATS REMAIN"** on the home page, `seats_claimed() = 0`.

**Ethan's updates, acknowledged (no action):** funnel E2E-verified in production ✅ (Done 2026-07-10) · Gauntlet visual polish + iteration design done ✅ (M3) · GTM plan + 8-week sprint in repo ✅ (`artifacts/gtm-8-week-sprint.md`) · both GTM-W1 dev tickets shipped ✅ (attribution field + share card) · Gauntlet content nearly in production — full Starter Twelve shipped, 16 of the 28 ranked picks live (tracked in G3 ✅ / G2).

---

## 🚀 Phase 1 — ✅ COMPLETE (2026-07-12)

T2 (booking link) was the last open item — shipped as E1. All Phase 1 work done.

---

## 🏗 Phase 2 — open work

**S5 · Admin review queue → absorbed into The 120 CRM** *(dev)* — ✅ **Live in production 2026-07-13** (PR #3 merged, deploy verified: /crm 307→login, login 200). All 3 phases (P1 see the truth / P2 run the week / P3 close the loop); 293 tests, 3 migrations applied to production (crm_core, crm_gtm, crm_library), staff seeded (peter@ + ethan@, passwords in gitignored local file — hand Ethan his out-of-band). Plan: `docs/plans/2026-07-13-001-feat-the120-crm-plan.md` (completed). 11-reviewer autofix review done; residual work in `.context/compound-engineering/todos/` (2× p1, 7× p2).
✅ **P0 from review RESOLVED 2026-07-13: email confirmations enabled in production** (`mailer_autoconfirm: false`) — closes the lead-hijack / forged-CASL-consent hole. Signup now: full profile stored in auth metadata → check-your-inbox screen → confirmation link (redirects to /dashboard, `site_url` fixed from 127.0.0.1 → https://the120.school) → dashboard creates the parents row + fires welcome #1 on first signed-in visit. E2E-verified against production (signup w/o session ✓, pre-confirm login rejected ✓, post-confirm login + RLS profile upsert ✓, CRM family synced by trigger w/ consent ✓, test rows cleaned ✓).
Staff-only CRM at `/crm` for peter@ + ethan@ to run the GTM sprint: alphahub Pipeline CRM bones re-skinned to The 120 design system, pipeline **derived from live Supabase truth** (parents/children/deposits/attribution) rather than hand-entered. Absorbs S5's dossier queue + payment visibility and the GTM plan's weekly-metrics dashboard. Full spec: `artifacts/crm-design-brief.md` · visual handoff: `artifacts/120 CRM Design Brief/` · GTM sprint decks: `artifacts/The120-GTM-Sprint*.pptx`. Implementation phased by the operator. Note from the brief: ethan@the120.school has no mailbox yet — his staff account must be password-seeded by script until it exists.

**S6 · Domain + mailbox + email** *(Owner: Peter — external; dev supports)* — ✅ **Complete 2026-07-13** (residuals: MX TTL 6060→3600 next DNS visit; DMARC p=none→quarantine once reports look clean; the120.ca decision — see GTM-7). ethan@the120.school mailbox created 2026-07-13.
✅ Done 2026-07-12: the120.school registered (Namecheap) → nameservers `ns1/ns2.vercel-dns.com` → added to the Vercel project → **https://the120.school serves the site** (SSL auto-issued, seat counter + booking link verified). **Email live the same day**: Workspace verification TXT + `smtp.google.com` MX (priority 1) in Vercel DNS; the120.school added as a **secondary domain on the existing Hatch/theknetwork.org Workspace org** (no new subscription, Gmail activated); user **peter@the120.school** created (by Peter) with alias **admissions@the120.school**; footer + `BOOKING_URL` fallback swapped off the interim gmail.
✅ Also done 2026-07-12 — **full email authentication**: SPF (`v=spf1 include:_spf.google.com ~all`), DKIM (2048-bit, `google._domainkey`, generated in admin console, **Google status: "Authenticating email with DKIM"**), DMARC (`p=none; rua=mailto:admissions@the120.school` — tighten to `p=quarantine` once reports look clean) — all in Vercel DNS, all verified resolving.
✅ (a) done 2026-07-12: Gmail "Send mail as" configured — **admissions@the120.school is the default From address** on peter@the120.school ("The 120 Admissions"), replies default to it. **Email is fully operational end-to-end** (verified: MX/SPF/DKIM/DMARC all resolving publicly, DKIM authenticating in Google, alias receiving + default sending).
✅ (c) done 2026-07-12: **canonical domain live** — jointhe120.vercel.app **308-redirects to the120.school** (host-header redirect in `next.config.ts`, verified in production); share card prints `the120.school/gauntlet`; checkout fallback origin updated.
✅ (b) done 2026-07-13: **Supabase custom SMTP live via Resend** (`smtp.resend.com:465`, user `resend`, sender "The 120 <admissions@the120.school>", min interval 1s). **Delivery-tested end-to-end**: dashboard-triggered invite email sent through the new SMTP path, Resend log shows `delivered` from admissions@; test user cleaned up. Auth emails (password recovery, invites, future confirmations) no longer rate-limited to ~2/hr. ⚠️ **Email confirmations still deliberately OFF** — do NOT re-enable as a pure config flip: the signup flow (`AccountModal`) assumes an immediate session (profile upsert + welcome email fire right after `signUp`) — with confirmations on there's no session until the link is clicked, so that needs its own dev ticket first. (d) defensive domains (the120.ca, 120.school) if desired — both still available 2026-07-12. Housekeeping: MX record TTL is 6060s (typo, harmless) — set to 60/3600 whenever touching DNS next.

**S7 · Content overhaul round 2** *(dev + Peter)* — 🔴 **Not started.**
Remaining site-map pages: How It Works, The Full Program, Our Advisors, Intensives — plus a written deposit/refund terms page linked from checkout (terms currently live only in checkout copy + receipt).

**S8 · Visual/asset debt** *(dev + Peter)* — 🔴 **Not started.**
Licensed photography (hero is a 2165px extraction, soft on retina; four group-page background slots are blue; Tin Can product imagery). Mission video. Restyle dashboard + join modal to the handoff identity. ✅ Dashboard "group" picker + **Academics step** shipped 2026-07-14 as part of the dossier wizard: per-kid group binding (`children.group_slug`) + structured `children.academics` (subject + Catch-Up/Reach-Ahead/Get-Solid plan + goal) via `app/dashboard/wizard/StepAcademics.tsx`, migration `20260714130000_children_group_academics.sql` (CHECK constraints + deposit-time group lock), store persistence + review-queue seeding + tests. Move dossier photos from data-URL column to a Supabase storage bucket.

**S9 · Tin Can partnership confirmation** *(Owner: Peter — external)* — 🔴 **Not started.**
Logo/co-marketing rights before the brand appears beyond the legal line.

**S10 · Stripe go-live** *(Owner: Peter + dev)* — 🟡 **Cutover executed 2026-07-15: live product `prod_UtEKYUFDYaQGoE` / price `price_1TtRrc25N9cbf3wUYydtCmTk` ($250 CAD) / webhook `we_1TtS0J25N9cbf3wUs5AzEWpp` created + CLI-verified; old test webhook disabled; live keys landed in Vercel Production (after a delete-and-recreate env-var fight — see `docs/solutions/integration-issues/stripe-live-mode-cutover-vercel-env-var-silently-stale-2026-07-15.md`); production checkout reaches the live Stripe payment page. ONE step left: the real $250 charge + refund round-trip (confirm descriptor "THE120", receipt, refund copy, webhook flip) — can double as the send-offer-email R10 test on Cedric's dossier. Until that round-trip passes, treat live payments as unverified.**
Everything Stripe is **test mode** on the **Hatch Coding CDN** account (`acct_103s7v25N9cbf3wU`). 2026-07-14 agent audit via Stripe CLI (live-mode restricted key, read-only): statement descriptor **"THE120"** confirmed live via API; live products contain only legacy Hatch/Science Studio items; the only live webhooks are old disabled hatchcoding.com endpoints. Creation of the 120 product/webhook was attempted and blocked — the CLI's stored key is `rk_live_…` without write permissions. To finish:
  1. ✅ **Account decision** (stay on Hatch Coding CDN) + ✅ statement descriptor **"THE120"** (API-verified 2026-07-14); confirm descriptor on the step-4 round-trip charge.
  2. **Live secret key** *(Peter, dashboard-only)*: Stripe dashboard → Developers → API keys → copy `sk_live_…` → Vercel → the120 project → Settings → Environment Variables → set `STRIPE_SECRET_KEY` for **Production only** (test keys stay on preview/dev so previews can never charge real cards). Paste directly in the Vercel UI — never through a PowerShell pipe (BOM pitfall, see docs/solutions). Note: `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is unused by the code (server-side Checkout) — no need to set it.
  3. **Live product + price + webhook**: either *(a)* Peter runs `stripe login` (browser pairing) to refresh the CLI with a full-permission key, then the dev/agent creates them programmatically; or *(b)* dashboard: create product **"The 120 - Refundable Seat Deposit"** (description: "Reserves one seat for one child in The 120 founding cohort (Fall 2026). Fully refundable until September 30, 2026."), one-time price **$250 CAD** → put the `price_…` id in Vercel `STRIPE_DEPOSIT_PRICE_ID` (Production); add webhook endpoint `https://the120.school/api/stripe/webhook` with events `checkout.session.completed` + `charge.refunded` → put the signing secret in Vercel `STRIPE_WEBHOOK_SECRET` (Production). Then **Redeploy** production. (Old test webhook `we_1TrOfg25N9cbf3wUesMLOl9y` targets the production URL with test events — disable it after go-live.)
  4. **Verification**: one real $250 charge + refund round-trip; confirm statement descriptor, receipt email, refund copy, and the webhook flipping the deposit row. Can be combined with the send-offer-email R10 end-to-end test on Cedric's dossier (brainstorm doc above).

**S11 · Dossier approval-gate post-deploy ops** *(dev — agent-runnable)* — 🟡 **Deploy live + purge #1 done 2026-07-14; two follow-ups open.**
Context: PR #5 (feat/dossier-intake-approval-gate, merged 2026-07-14, prod deploy `dpl_C6wBqRSemn6pREP7vxex9HEHkxkg` READY) retired the test-scores field and gated the $250 deposit behind admissions approval (`children.status` = `offered`-or-later). Both migrations are applied to production and recorded in `schema_migrations`: `20260714200000_add_submission_notified_at` (pre-deploy, trigger verified by parent-JWT replay) and `20260714210000_purge_test_scores` (post-deploy 2026-07-14, count verified 0 before/after — no rows held scores).
  1. **🔴 Purge re-run — do ON/AFTER 2026-07-16** (24–48h after the 2026-07-14 deploy): browser tabs opened before the deploy still run the old bundle, whose autosave round-trips `test_scores` and could re-upload a value after purge #1. Via the Management API playbook (`docs/solutions/integration-issues/supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md`, token in Windows Credential Manager `Supabase CLI:supabase`), run:
     `update public.children set test_scores = '' where test_scores <> '';`
     then verify `select count(*) from public.children where test_scores <> '';` → **must be 0**. This second clean count is the gate for any future `test_scores` column drop (optional follow-up, not scheduled). Memory note: `purge-test-scores-pending.md` — update/delete it when this closes.
  2. **🟡 Launch triage (R16)** *(Owner: Peter/admissions)*: families already in `submitted` lost the instant "Reserve seat · $250" button and now see "Application Under Review". Open `/crm/dossiers` (needs-review badge shows the count) and move clear admits to **Offered** — that's what re-unlocks their deposit CTA. Also smoke-check one test family end-to-end when convenient: submit → admissions email arrives → CRM approve → Reserve → Stripe test payment (use `delivered+x@resend.dev` to black-hole the email if preferred).

---

## 📣 GTM build queue (software to execute artifacts/gtm-8-week-sprint.md)

Per PM direction 2026-07-12: the GTM plan's software needs live here as tickets. Already shipped from the plan: attribution + referral field ✅ · share card ✅ · booking link ✅ (E1) · welcome email #1 ✅ (E3). Content assets (explainer PDF, five group one-sheets, ambassador kit, /parents post, canned objection answers) stay with Peter/content — not tracked as dev tickets.

**GTM-1 · Nurture sequences on Vercel Cron** *(dev; E3 remainder)* — 🟡 **Built + deployed 2026-07-13; ⛔ one activation step: Peter adds `CRON_SECRET` to Vercel** (generate any long random string in the password manager, paste in Vercel → Environment Variables → Production, then Redeploy; until then the daily cron gets a loud 503 and nothing sends).
Shipped: daily cron `/api/cron/nurture` (13:05 UTC via `vercel.json`) with three sequences — account-created T+2d dossier nudge / T+5d founder story / T+9d book-the-call (stops on dossier submit or deposit); deposit-paid T+0 Founding-120 welcome / T+3d Fall-Intensive details (dates from `site.ts`) / T+10d referral ask; one-time stalled-dossier nudge (>80% complete, 3+ quiet days). Safety rails: CASL gate mirrors the CRM (consent_given, no revocation, live family), 3-day catch-up window so backlogs are dropped not batched, one email per family per run, 100/run cap, claim-first idempotency on the `nurture_sends` unique constraint (migration applied to production + recorded). Every email: one CTA (GTM §5), CASL footer, HMAC one-click unsubscribe at `/unsubscribe` (GET confirm page → POST revoke, stamps `families.consent_revoked_at` which CRM + nurture both honour). 25 new unit tests (318 total). Remaining beyond ticket scope: dossier-submitted + call-held-no-deposit sequences (GTM §5 rows 2–3) — the engine is data-driven, each is a step-list + copy.

**GTM-2 · Gauntlet account saves + leaderboard** *(dev; = M2 execution)* — ✅ **Live 2026-07-13.** Migration `20260712150000_gauntlet_saves.sql` applied to production via the Management-API route (verified: table + 3 own-row RLS policies + `gauntlet_leaderboard()` RPC callable, recorded in schema_migrations; playbook: `docs/solutions/integration-issues/supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md`). Remaining smoke test: run a Mastery Trial signed-in, set a handle, confirm the board shows it.
Shipped: cloud save sync (union-merge of device + cloud on sign-in detection, focus re-check, 2.5s debounced push), kid-safe self-chosen handle (A–Z/0–9, 12 chars, never a real name), 🏆 leaderboard panel (top-20 Mastery Trial scores, band filter chips, own-row highlight, empty state), guest banner with "Free account" CTA. Everything degrades to guest/localStorage when signed out, env-less, or pre-migration — and the "saved to your account" banner only shows after a cloud write actually succeeds, so it never lies pre-migration.

**GTM-3 · Summer Tournament shell** *(dev)* — 🟡 **Marketing/website layer built dormant 2026-07-16 → see the GPF series below.** The public front door (nav, homepage section w/ states, /gauntlet banner, entry gate + double opt-in, rules page, weekly-theme highlight, standings email, Founding Leaderboard page) all ship behind the `app/lib/tournament.ts` state machine and flip on with one switch. **Still needs before Aug 3 (per 2026-07-17 decisions):** entry↔score account-to-rank wiring (B6) + real Grade 9–12 band & leaderboard (B5) + B1 integrity — now all Aug-3 blockers — plus migration apply + B2 handle filter + `CRON_SECRET`/`STANDINGS_ENABLED`. Full decomposition: `artifacts/gauntlet-public-front-door-stories.md`; brief: `artifacts/public-gauntlet-marketing.md`.

**GTM-4 · Ambassador reporting** *(dev)* — ✅ **Built + activated 2026-07-15.** `ambassador_codes` migration (`20260715120000`) applied to production via the Management API (table live, RLS-locked service-role only, recorded in `schema_migrations`); registering code owners now works, so the W2 just-issued state is ready. **Needed by W2 (Jul 20) — ready.**
New staff page `/crm/ambassadors` (AMBASSADORS tab): per-code **leads / accounts / deposits** tally + totals strip, every number derived from truth (families.referral_code + paid deposits, mapped parent→family exactly like the dashboard's Source & ambassador tally so the two can't disagree). Adds the missing half the dashboard tally lacked — a **registry of issued codes** (`ambassador_codes`: code, owner_name, note): register a code and it lists from day one *before* its first signup (the W2 just-issued state), named to its owner; signup codes with no registry row show as **Unclaimed** with a one-click Claim → prefill. Register/remove are Zod-guarded `supabaseAdmin` server actions (audit via `gtm-edit` + `kind`), RLS-locked table (service-role only). Pure aggregation `computeAmbassadorReport` unit-tested (9 tests). Migration `20260715120000_ambassador_registry.sql`; read tolerated pre-migration (empty registry → codes still show from signups). The registry supersedes the "lightweight registry / SQL snippet" the ticket originally scoped.

**GTM-5 · Lead capture without an account** *(dev)* — 🔴 Not started. **Needed by W3 (Jul 27).**
The funnel counts "interested family" = any CASL-consented email — account, RSVP, or opt-in. Build the opt-in: "Get the one-page explainer" email form (footer + /parents), stores consented contact + timestamp (new `leads` table or Resend Audience), sends the explainer by email. Blocked partially on the explainer PDF (content).

**GTM-6 · Welcome-email production E2E** *(dev + Peter)* — ✅ **Done** — twice over: 2026-07-13 scripted production E2E (see E3 ✅(b)), and again with the confirm-email flow the same day (signup → confirm → first dashboard visit creates profile + fires welcome; test rows cleaned).

**GTM-7 · Domain reachability on filtered networks** *(Owner: **Ethan** — external, ~15 min; reassigned from Peter 2026-07-13, do when convenient)* — 🔴 Not started. **Discovered 2026-07-12.**
At least one Toronto network (Ethan's) DNS-filters `the120.school` to a FortiGuard block IP — newly-registered domains and the `.school` TLD commonly get caught by school/corporate/family filters, i.e. exactly our audience's networks. Actions: (1) submit categorization requests for the120.school at FortiGuard (fortiguard.com/webfilter) — category "Education"; same at Symantec/Broadcom sitereview and Netcraft if ambitious; (2) keep jointhe120.vercel.app reachable as the fallback it already is; (3) recheck in a week from a filtered network. Consider grabbing the120.ca (still available, S6d) — .ca is rarely filtered and useful on printed materials.

## 🎪 The Gauntlet — Public Front Door (GPF series)

The marketing/website layer over the Summer Tournament (brief: `artifacts/public-gauntlet-marketing.md`; stories: `artifacts/gauntlet-public-front-door-stories.md`). Built 2026-07-16 in one PR, **wired dormant** so the surfaces ship now in Tease state. Game-integrity work (score caps, handle word-filter) stays Ethan's B1/B2 — this layer ships the *surfaces*, not the integrity.

**⚠️ Review outcome (2026-07-16):** a full compound-engineering pass (7-persona brainstorm-review → plan → 5-persona plan-review) **refuted the ranking data model** and it was NOT built. Plan + full reasoning: `docs/plans/2026-07-16-001-feat-gauntlet-tournament-hardening-plan.md`. Two findings: (D2) prize bands can't rank on the single band-agnostic, content-unscoped, client-writable `gauntlet_saves.trial_best` — done right this **converges with Ethan's B1**; (D1) "account-to-rank" routes through the full admissions `AccountModal`, not a lightweight identity. ~~**Ranking is deferred to a B1-joined design.**~~ **→ Resolved in a 2026-07-17 brainstorm: Peter chose account-to-rank *through* the full admissions funnel (friction accepted — every entrant is a full lead) AND building real Grade 9–12 content, with B1 elevated to an Aug-3 blocker. See the TURN-ON CHECKLIST D1/D2 below and `gauntlet-roadmap.md` B1/B5/B6.** What DID land 2026-07-16 (independent, review-driven safety fixes): handle-hijack fix + latent `upsert onConflict:"handle"` expression-index bug (explicit select-then-branch; a confirmed entry is never overwritten; email is not accepted as ownership proof), per-parent-email abuse cap + resend throttle, `referral_code` validated against `ambassador_codes`, confirm moved off GET to a POST button (email-scanner prefetch can't false-confirm) with constant-time compare, shared HMAC token util, PIPEDA retention/deletion copy, entry-modal mobile scroll.

**The keystone — `app/lib/tournament.ts`:** one server-side state machine drives every surface (homepage section, /gauntlet banner, in-game Enter CTA + modal, rules page, standings email, founding leaderboard). Phase resolves in priority order: `TOURNAMENT_KILL=1` → **off** (B4 kill switch) → `TOURNAMENT_STATE=tease|live|after` override → **date-derived default** (tease < Aug 3 ≤ live ≤ Aug 23 < after). Evaluated per-request on the server, so it **auto-flips to Live on Aug 3 and to After on Aug 24 with no redeploy**; env vars only override or kill. 11 unit tests cover every branch.

**Status (all built + build-verified 2026-07-16; 446 tests green, `next build` clean):**
- **GPF-1 · Nav pillar** — ✅ `The Gauntlet → /gauntlet` in `app/lib/site.ts` nav. Live on deploy.
- **GPF-2 · Homepage section + states** — ✅ `app/components/GauntletBand.tsx` (after How-It-Works, before testimonials); Tease/Live/After line + CTAs from the state machine; boss+heatmap visual. Live on deploy (Tease). Home is ISR-60s so the line flips within a minute of a phase change.
- **GPF-3 · /gauntlet parent banner** — ✅ `app/gauntlet/components/ParentBanner.tsx`, dismissible, "What is The 120? →". Live on deploy.
- **GPF-4 · Config flags + kill switch** — ✅ the keystone above.
- **GPF-5 · Entry gate (the modal)** — 🟡 built dormant. `TournamentEntryModal` + `POST /api/gauntlet/tournament/enter` (service-role, guest-friendly, double opt-in email) + `GET /api/gauntlet/tournament/confirm`. CTA shows only when Live; API 403s unless Live. **Needs the migration applied** (degrades gracefully until then).
- **GPF-6 · Rules page** — ✅ `/gauntlet/rules`, all facts from the state machine (single source of truth). Live on deploy.
- **GPF-7 · Share loop + referral attribution** — ✅ ambassador-code field on the entry stores `referral_code` (AMB-NAME) for the Friday tally; share card already prints `the120.school/gauntlet`.
- **GPF-8 · Live-state flip** — ✅ automatic (date-derived) or `TOURNAMENT_STATE=live`.
- **GPF-9 · Weekly boss-theme highlight** — ✅ 3 themes in `tournament.ts`; homepage line + banner show the current week when Live.
- **GPF-10 · Weekly standings email** — 🟡 built dormant. `app/api/cron/gauntlet-standings` (daily in `vercel.json`, weekly per entry via `last_standings_at`) + one-click CASL unsubscribe. **Three gates:** `CRON_SECRET` set + phase Live + `STANDINGS_ENABLED=1`. Per-fact standings deepen once B1 score-logging lands.
- **GPF-11 · Founding Leaderboard page** — ✅ `/gauntlet/founding-leaderboard` renders the live public board; the at-close snapshot (D5) freezes it.
- **GPF-12 · Post-close handoff** — 🔴 Aug-24 ops step (not code): the data-driven nurture engine references a kid's tournament run in the back-to-school deposit sequence.

### 🔌 TURN-ON CHECKLIST (flip the tournament on)

⚠️ **A 7-persona document review (2026-07-16) found the flip lights the *surfaces* but does NOT yield a runnable tournament until the blocking gaps below are resolved. Full findings: `artifacts/gauntlet-public-front-door-stories.md`.**

**Blocking — a working tournament cannot exist until these are done:**
1. **D1 · Entry↔score linkage (P0)** — ✅ **DECIDED 2026-07-17: account-to-rank.** Entering drives the existing full `AccountModal` signup (every entrant = a full admissions lead; the account is the lead capture); scores stay account-bound. Build in `gauntlet-roadmap.md` **B6**: wire the missing AccountModal success callback, join `entries.user_id → gauntlet_saves.user_id`. No entries-keyed path. Supersedes the "ranking deferred" note above.
2. **D2 · Prize-band winners (P0)** — ✅ **DECIDED 2026-07-17: build real Grade 9–12.** The Gauntlet is Grade 3–12 Fast Math — ship a `g912` content band (from the authored `gauntletcontent.md` taxonomy) + a 9–12 leaderboard + prize-band-aware RPC (b36/b78/b912). No asterisk, no 7–8 fallback. Build in `gauntlet-roadmap.md` **B5 + B6**. Non-negotiable, Aug-3.
3. **Integrity (Ethan, B1/B2):** score plausibility caps + unique handles + **name/profanity handle filter** (enforces "handles never real names").
4. **Fix the enter-route P0 (handle hijack)** — ✅ **Fixed in the 2026-07-16 hardening commit, verified in code 2026-07-17 (Ethan):** explicit select-then-branch replaces the upsert; a confirmed entry 409s on re-entry ("that handle's taken"), email is not accepted as ownership proof.
5. **Abuse controls** — ✅ **mostly landed 2026-07-16, verified in code 2026-07-17 (Ethan):** per-parent-email entry cap (6) + 60s resend throttle + `referral_code` validated against `ambassador_codes` (unknown → null, never credited). Residual: no per-IP rate limit — an attacker rotating parent emails can still trigger sends; accept for launch or add an IP throttle in the B1/B2 batch.

**Then, to actually flip it on:**
6. **Apply the migration** `supabase/migrations/20260716120000_gauntlet_tournament_entries.sql` via the Management API playbook (`docs/solutions/integration-issues/supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md`, token in `Supabase CLI:supabase`) — *before* enabling standings (the cron 500s on a missing table).
7. **Provision `UNSUBSCRIBE_SECRET`** in Vercel (distinct from `SUPABASE_SERVICE_ROLE_KEY`).
8. **State (redeploy-gated):** the *date* auto-flips to Live on **Aug 3** with no redeploy. Env overrides are NOT instant — `TOURNAMENT_STATE=live` / `TOURNAMENT_KILL=1` take effect only on the next Vercel deploy. Decide D3: mark `app/page.tsx` `force-dynamic` for an instant homepage kill, or accept ~60s ISR lag on the homepage section.
9. **Standings:** set `STANDINGS_ENABLED=1` + confirm `CRON_SECRET` (GTM-1). Note the email carries no real rank until D1 lands — reframe as a nudge or hold.
10. **PII ops:** state a retention/deletion process for entries on the rules page.
11. **Verify:** `/gauntlet` Enter CTA when Live → entry → confirmation email → confirm-link states; rules + founding-leaderboard render.

## 🎮 The Gauntlet (FastMath game — formerly MathRaiders)

**M1 · Playable v1** *(dev)* — ✅ **Shipped** (`/gauntlet` — renamed from `/raiders`, redirect in place; in main nav).
Boss-battle FastMath: correct answers do damage (speed + streak multipliers), wrong answers cost player HP; 2-minute raids, 4 bosses with generated arenas + sprites (Nano Banana Pro, `scripts/gen-sprites.mjs`), XP + local save. Topics: ×, ÷, +, − plus GCD, LCM, common denominator, and triangle congruence (rendered figures, multiple choice). Fully open demo for now, per direction.

**M2 · Account saves + member perks** *(dev)* — 🟡 **Saves half shipped 2026-07-13 (= GTM-2 ✅): cloud saves, handles, leaderboard live.** Member perks remain. **Reframed 2026-07-12 (E4): no paywall, ever — core game stays fully public.**
Deposit-holders get **additive** perks only: early access to new bosses, G2 pathway depth, cosmetics/leaderboard flair (doubles as the ambassador incentive in the GTM plan). Lock-in comes from saved progress after the deposit, never from gating acquisition.

**M3 · Game depth round 1** *(dev)* — ✅ **Shipped.**
Slash/impact FX + hit flash + boss entrance/death animations; restrained WebAudio cues (hits, crits, misses, final-seconds ticks, fanfares) with mute; ~~adaptive trainer (per-fact speed/accuracy, weak facts re-served ~35%)~~ → superseded by M5's mastery model; teach-on-miss (correct answer shown before advancing); post-raid "Train these" report + waste %; grade bands (3–4/5–6/7–8); boss medals (🥉🥈🥇) + sequential boss unlocks; Mastery Trial survival mode (+2s/−4s, waves, personal best); daily raid streak; XP titles + bar; first-run how-to; leave-raid confirm; tab-hidden timer pause; reduced-motion support; congruence problems rotate + vary marks. Multiplayer deliberately skipped (product call).

**M4 · Later game ideas** *(dev)* — 🔴 Not started.
More bosses/arenas; multiplayer raid rooms (if ever). (Cosmetic unlocks moved to M6.)

**M5 · Mastery model v2 + 6×6 fix** *(dev; Peter's spec 2026-07-13)* — ✅ **Shipped 2026-07-13.**
Every topic now has a defined fact set where the parameter space is small enough (multiplication: 15/45/66 facts by band; squares 14; Pythagorean triples 34; 12 of 20 topics have sets — the rest, like place value and powers of ten, stay open-ended generators). Per-fact answer time was already tracked; **mastered = correct in under 3 s, twice in a row** (`fastStreak` in the save; old saves migrate cleanly). Serving: ~85% from the unmastered pool with struggling facts (missed or slow) weighted double, ~15% mastered retention, and a 4-problem no-repeat window. **Mastery Trial now deals the entire fact set** shuffled without replacement ("Testing all N facts · X dealt"), reshuffling after a full pass; the trial is a neutral test (no weighting). UI: topic chips show mastered counts (★ when complete), result screens show "🎯 N new facts mastered", the menu states the mastery rule.
**The 6×6 bug, root-caused:** the old trainer flagged a fact "weak" after a single miss (1-for-1 = 100% miss rate) or one slow answer (lifetime average), then re-served weak facts 35% of the time with no repeat guard — one bad first answer on 6×6 made it ~35–50% of everything served, sometimes back-to-back. Verified fixed by simulation (2,000-serve runs): the same scenario now serves 6×6 at 3–10% and never twice in a row; with 3 facts left unmastered they get ~86% of serves; all 1,163 enumerated fact keys round-trip through the regenerator; a scripted browser run confirmed badges, full trial-deck coverage, and the mastery pill end-to-end.

**M6 · v2 fun & UX backlog** *(dev; feeds from G1 beta feedback)* — 🟡 **In progress; brainstormed 2026-07-13.** → **Day-to-day Gauntlet iteration now lives in `artifacts/gauntlet-roadmap.md`** (per Peter 2026-07-15: Discord for tester signal, that file for triage/changelog, incl. new tournament-readiness items TR-1..5 — score integrity, handle uniqueness, GTM-3 shell, mid-flight ops, weekly standings email). This list stays as the milestone record.
Bar (Peter): UTS students say "this is both fun and helpful for my actual math learning." Prioritized:
1. ✅ Persist topic selection between visits (shipped with M5).
2. ✅ Post-game "N new facts mastered" pill (shipped with M5).
3. First-run setup: pick grade band (and starting skills) before the first raid — defaulting a 7th-grader to Grades 3–4 undersells the game.
4. "My facts" mastery heatmap: the fact set as a grid (multiplication-table layout for ×) colored by mastery/speed — the single biggest "actually helpful for learning" artifact, and shareable with parents.
5. Mobile custom number pad (big tap targets under the problem card) — thumb typing on the stock keyboard is the worst part of mobile play.
6. Boss personality: mid-fight barks/taunts, enrage visual state under 25% HP.
7. Daily quest: "master 5 new facts today" tied to the existing daily streak.
8. Trial end recap: "tested 45/66 facts — 12 still unseen" (coverage visibility).
9. Practice/zen mode: no timer, no HP, pure fact practice (warm-up + anxious kids).
10. Cosmetic unlocks by level (skins/arena palettes) — doubles as M2 member flair + ambassador incentive.
11. Weekly leaderboard view (feeds GTM-3 tournament shell).
Sound stays restrained per direction. Order gets re-cut by G1 beta feedback.

**G1 · Beta testers + endgame difficulty** *(Owner: Ethan recruits, dev supports; re-scoped per Peter 2026-07-13)* — 🟡 **In progress.**
Recruit 3–5 playtesters who'll dig in for fun — UTS students are the bar ("fun AND helpful for my actual math learning"), ideally including one hardcore math kid and one decidedly non-math kid who wants better grades. Loop: they play, suggestions land in M6, ship weekly. Also: tune the last boss to "bragging rights" hard and the 2nd-to-last to "earn your level-up" hard — damage/HP/speed-window/penalty are single constants in `app/gauntlet/components/Battle.tsx`; per-boss difficulty modifiers + a fifth "bragging rights" boss can ship within a day of first feedback.

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

**2026-07-15 — CRM dossier mover + send-offer-email (PR #8, merged + deployed `962a7f6`):**
- Header status pill is now the mover (five-stage ARIA menu; bottom "Move candidate" card removed; Member confirm kept; NEW demote-warning confirm when an offer email is out and unpaid). Group Assignment compacted to two lines. Print button → **Send offer email** (Ctrl+P still prints).
- Offer email: gated by the shared `canReserveSeat` (client + server), confirm-with-rendered-preview, transactional CASL classification with **identification-only footer**, atomic claim-then-send on `child_reviews.offer_email_sent_at` with CAS resends + CAS-guarded unclaim, `offer-email` audit action. Migration `20260715090000` applied pre-deploy via Management API (recorded + verified). 426 unit tests; 12-persona review, 16 findings fixed pre-merge (run artifact in `.context/compound-engineering/ce-review/2026-07-15-…`).
- **R10 E2E status:** parent side ✅ verified live 2026-07-15 (Cedric at OFFERED, "Reserve seat · $250" + refundable-note visible on the dashboard). Staff side ⛔ **pending Peter signing into /crm in Chrome** (agent can then drive: menu move → send → inbox/BCC/audit/sent-state checks). Real-family sends remain gated on S10 (plan R11 process gate). Plan: `docs/plans/2026-07-15-001-feat-dossier-mover-offer-email-plan.md` (Unit 7 open).

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
- **T6 · Supabase project** — `the120` (ref `deolvqnyvhhnavsifgxz`, us-east-1); keys in Vercel all environments; `.env.local` for local dev. ✅ DB password rotated into password manager 2026-07-13; delete the now-stale `~\.the120-supabase-db-password.txt` (Peter). Production SQL/DDL playbook: `docs/solutions/integration-issues/supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md`.
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
