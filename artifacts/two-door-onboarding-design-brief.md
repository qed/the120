---
title: "Two-Door Onboarding — Design Brief (First Profit × The 120)"
date: 2026-08-11
status: Approved direction (Peter, 2026-08-11 Q&A) · all open questions resolved same day (§12) — ready for /ce:plan per phase
repos: [first-profit, 120-The120]
audience: Claude Design (flows, dashboards, co-branding), then Claude Code CLI (build)
supersedes: see §10 — parts of new-user-flow-v3 (2026-08-05), fp-login-account-creation (2026-08-02)
---

# Two-Door Onboarding — Design Brief

**One account system. Two branded front doors. Each parent sees exactly the product they came for.**

The model is TimeBack × Math Academy. TimeBack (Alpha School's academic manager) uses Math Academy as its core math tool: a TimeBack student account generates a Math Academy account, while Math Academy also sells directly from its own site. Here, **The 120 is TimeBack** — the network for motivated kids doing multiple things (business building, competitions, advanced math) — and **First Profit is Math Academy**: standalone business-building software that takes a kid through 125 unit tasks to their first $10,000 in profit.

Both products share one database and one backend (The 120's Supabase project, already the system of record). Signing up at either door creates a parent account that technically works at both. But **the customer never has to understand that**: the First Profit parent buys First Profit and lives inside First Profit; The 120 parent buys the package and lives inside The 120. The shared account surfaces visually, not verbally — and pays off the day a First Profit family upgrades.

---

## 1. Decisions Log (Peter, 2026-08-11)

| # | Decision | Ruling |
|---|---|---|
| D1 | One front door or two? | **Two full front doors.** firstprofit.school gets its own complete signup and parent dashboard; the120.school keeps its own. Same backend, two skins. Supersedes v3's "The120 = the one front door" (§10). |
| D2 | Signup posture | **First Profit is instant self-serve. The 120 is selective** — the differentiator between the two doors. The 120's selectivity is rebuilt from the v2 history: application, staff review, interview, acceptance, deposit. Cohort 1 is Toronto. |
| D3 | Where the v3 kid-first flow lives | **v3 (add kid → AI comic cover → story questions → instant account) moves to firstprofit.school** and becomes First Profit's signup. the120.school/start becomes the selective application funnel. Clicking around the FP website keeps you in the FP website. |
| D4 | Shared flow components | The early funnel steps — add parent, add kid, add another kid — **run the same user flow on both sites**, writing to the same tables and populating both dashboards. Divergence points are mapped explicitly in §5. |
| D5 | FP parent's awareness of The 120 | **Visual, not verbal.** The FP parent dashboard carries branding showing First Profit as **a member of The 120 network** — logos and visuals, not explanatory copy. Active upsell only **after engagement** (the kid is visibly into it, e.g., first sale). The FP dashboard also carries a quiet link that opens the parent's 120 dashboard in a new tab. |
| D6 | Upgrade path | An engaged FP family that takes the upsell enters **The 120's application, pre-filled** — parent/kid data and the kid's FP track record come along as evidence. Same acceptance bar as anyone else. |
| D7 | Kid identity | **One kid identity across everything**: `firstname.lastname@firstprofit.school`, with an alias `firstname.lastname@the120.school`. Either form logs the kid in — to First Profit, The Gauntlet, and The 120. Instrument which alias kids actually use. When Math Academy launches (deal in place for provisioning), the same address will drive MA accounts. |
| D8 | Kid email reality | **Usernames only for now.** Both address forms are login identifiers with alias equivalence in the auth layer. Real Google Workspace mailboxes remain the separate, already-scoped future piece. |
| D9 | The Gauntlet | **120 package only.** FP-only kids never see it until their family upgrades. |
| D10 | Math Academy | **Out of scope for v1** of this brief. The dashboard reserves the slot; provisioning (via the MA deal) is its own future piece. |
| D11 | Payments | **FP: free trial → subscription at $3,000/year.** Parent-facing copy stays terms-neutral until pricing ships — beta testers get in and get excited before a price appears. **The 120: deposit → tuition at $4,500/year**, per the v2 funnel ($250 refundable deposit at offer, then tuition). Two Stripe products, one customer record. |
| D12 | Parent dashboard v1 modules | Both brands, same four modules, skinned per brand: **kid progress, credentials & password reset, add another kid, billing & plan.** |
| D13 | The 120 application driver | **The parent drives the 120 application** (school-application frame, per the Foundry brief's A1/A2). The FP dashboard never shows 120 application status — it only offers the new-tab link to the 120 dashboard, where that status lives. |
| D14 | FP audience | **Worldwide, ages 5–18** (v3's existing age validation stands). No geography enforcement anywhere in the FP flow; geography is collected at payment. The 120 stays Toronto cohort 1, with a geography question up front and a waitlist for non-Toronto families (§4.1). *(Amended 2026-08-11 from "North America, 8–16".)* |
| D15 | Existing families | 100% of current parents become **dual-purpose accounts** (both FP and 120 parents — which is every parent's technical state anyway). All current kids are **FP-active immediately**. **Abe Goldlist is Offered/deposit-paid** on The 120 ladder. Every other kid is **pre-application** for The 120. |
| D16 | Deliverable & sequencing | This brief lives as markdown in `/artifacts` of **both repos**. Build order: **FP door first**, then the 120 selective door, then the upsell bridge. |

---

## 2. The Shape

```
                    FIRST PROFIT DOOR                          THE 120 DOOR
                    firstprofit.school                         the120.school
                    (instant · self-serve · worldwide · 5–18)  (selective · Toronto cohort 1)

                    Landing → Start
                         │                                     Marketing site → Start Here
                    1. Parent step ──────── SHARED FLOW ────── 1. Parent step
                       name/email/password/consent                (same screens, same tables)
                       + inline 6-digit verify
                         │                                          │
                    2. Add kid (name, age) ─ SHARED FLOW ────── 2. Add kid
                         │                                          │
                    3. AI comic cover                          3. Business-build mini-app
                    4. Story questions (p.1)                      (doors → template → quiz →
                    5. Account ready:                              AI-shaped project)
                       kid credentials shown                        │
                         │                                     4. APPLICATION (per kid)
                         ├─→ kid into FP, signed in               basics → group → academics →
                         │   (new tab, one-time token)             project → review → SUBMIT
                         └─→ FP PARENT DASHBOARD                    │
                             "member of The 120 network"       5. Staff review · interview/call
                             [free trial, terms-neutral]            │
                                     │                         6. OFFERED → offer email →
                              (kid engages,                       $250 deposit reserves seat
                               e.g., first sale)                    │   → kid FP-active + Gauntlet
                                     │                              │   + cohort + (MA later)
                              UPSELL: apply to                 7. Tuition → 120 PARENT DASHBOARD
                              The 120, pre-filled ───────────→     full package view
                              with FP track record

              ONE DATABASE UNDER BOTH: parents · children · one kid identity
              (…@firstprofit.school ≡ …@the120.school) · per-product status · one CRM
```

Three rules make it coherent:

1. **Each site is a closed world.** Clicking around firstprofit.school keeps you in First Profit; clicking around the120.school keeps you in The 120. No mid-funnel handoffs between brands. The only sanctioned crossing is the FP dashboard's quiet new-tab link to the 120 dashboard (D5) and the post-engagement upsell (D6).
2. **The account layer is shared; the product layer is gated.** Any parent signup, at either door, creates the same rows. What differs is per-child, per-product **status** (§4): FP access is instant everywhere; the 120 package (Gauntlet, cohort, Math Academy later) unlocks only through the selective ladder.
3. **Instant vs. selective is the brand difference, on purpose.** First Profit converts like software: try it now, pay later. The 120 converts like a competitive school: apply, interview, get offered, reserve the seat. A family can hold both relationships at once, per kid.

---

## 3. Door A — First Profit (instant)

### 3.1 The flow

The shipped **v3 kid-first flow re-homes to firstprofit.school** essentially unchanged (its requirements doc remains authoritative for step-level behavior — R1–R14, R18):

1. **Parent step** — full name, email, password, consent (child account, photo → AI vendor, stored answers/cover); inline 6-digit email verification in the same sitting.
2. **Add kid** — full name + age. Age validation stays **5–18**, exactly as v3 shipped it (D14). Geography: worldwide, nothing asked and nothing enforced — geography is collected later, at payment (D14).
3. **Cover** — real AI comic cover, kid as hero of their own graphic novel; no-photo path stays a designed experience.
4. **Page 1** — the 6 story questions, optional.
5. **Account ready** — kid credentials shown: `firstname.lastname@firstprofit.school` + memorable password. "Keep building" opens the game in a new tab, auto-signed-in; original tab lands on the **FP parent dashboard**.

Free-trial messaging stays exactly v3-R13 terms-neutral: "free to start," no length, no price (D11).

### 3.2 The FP parent dashboard (new surface, firstprofit.school)

The four v1 modules (D12), in First Profit's visual language:

- **Kid progress** — per kid: cover art, current phase/criteria, unit tasks done, timestamps (the Watchtower data, parent-scoped).
- **Credentials & reset** — kid's username with copy-to-clipboard, parent-triggered password reset (existing no-auth-mail pattern).
- **Add another kid** — re-enters the kid flow at step 2 under the same parent.
- **Billing & plan** — trial state now; subscription management when pricing exists.

Plus two First-Profit-specific elements:

- **The network mark (D5).** A visual lockup presenting First Profit as *a member of The 120 network* — logo-based, not copy-based. Recommended treatment: a footer or header band with The 120 mark and a row of product marks (First Profit lit, The Gauntlet and math dimmed/locked). This teaches "my FP account is a 120 account" through repetition, without a paragraph ever explaining it.
- **The quiet crossing (D5, D13).** A low-key link ("The 120 dashboard ↗", mono register) that opens the120.school dashboard in a new tab — same session, no re-login. This is where any 120 status for their kids actually lives; the FP dashboard itself never renders 120 application state.

### 3.3 The upsell (after engagement)

Trigger on kid engagement, not parent tenure — first sale is the canonical moment (alternatives to A/B later: criteria 1.2 complete, N consecutive active days). The upsell introduces The 120 by name for the first time *in words*, standing on the visual familiarity the network mark has been building. CTA → The 120's application, **pre-filled** (§6). Cap the frequency; one dismissal quiets it for weeks. Never before the engagement trigger — a week-one FP parent should experience pure First Profit.

---

## 4. Door B — The 120 (selective)

### 4.1 The flow

the120.school/start becomes the application funnel, rebuilt from the v2/Foundry history (the unified-funnel brief's marketing routing — Start Here spine, group landing pages, `?src` attribution — still applies and now feeds this):

1. **Explainer** — 3 swipes, school-application register: your kid designs a real business; you'll see where it leads; this is the application.
2. **Parent step — SHARED** with Door A (same screens/components, same writes): name, email, password, consent, inline verify — **plus, on this door only, a geography question up front**. (v2's capture-only C1 upgrades to full account creation, matching the shared component.) **Non-Toronto families exit here to a waitlist**: with full name, email, and geography captured, they're waitlisted for a future cohort — kept on file, CRM-visible, re-engageable — rather than continuing into a flow for a cohort they can't join. (The FP door remains open to them worldwide.)
3. **Add kid — SHARED** with Door A. Toronto cohort 1 framing on this door; seats line from `site.ts`.
4. **Business-build mini-app (per kid)** — five doors (group pick, pre-selected via `?g=` carry) → starter template or own idea → guided quiz → AI-shaped project. This work is real: it seeds the kid's First Profit game and the application both.
5. **Application (per kid)** — the unified-flow steps: basics → group → academics → project → review → **submit**. Parent-driven (D13), with the designed hand-back moments when the kid contributes.
6. **Review, then interview** — the family submits; staff review the application in the CRM (dossier pipeline); families that pass review get an email inviting them to schedule a call. Interview follows review, never precedes it (D2 — all four historical selectivity elements kept: application, review+accept, interview, deposit).
7. **Offered** — offer email (existing transactional machinery) → parent dashboard unlocks **Reserve seat · $250** (refundable, deadline from `site.ts`) → deposit paid.
8. **Tuition** — the final gate; the full package, per the existing checkout.

**When does the kid get product access on this door?** **Confirmed (Peter, 2026-08-11, Q1): First Profit access is instant on this door too**, provisioned the moment the kid is added, exactly as at Door A. The selectivity gates the *package* — Gauntlet, cohort membership, Math Academy later — which unlock at **offer + deposit**. This keeps the Foundry insight ("families convert when the kid has already started") and means the kid's application-time business work happens in the real game. One access rule for First Profit, everywhere.

### 4.2 The 120 parent dashboard

The same four modules (D12) in The 120's register, plus the package view:

- **Per-kid ladder chip** — pre-application → applied → in review → interviewed → offered → deposit paid → enrolled (labels from the v2 status constants; "application," never "dossier," parent-facing).
- **Kid progress** — FP progress (same data as Door A's module) *and* Gauntlet/cohort once unlocked.
- **Product tiles** — First Profit (active), The Gauntlet (locked until deposit), Math Academy (reserved slot, D10), the cohort/community.
- **Credentials & reset, add another kid, billing** — billing here means deposit state + tuition, not subscription.

---

## 5. Shared components and the divergence map

Peter's directive: the early funnel is one flow on both sites; the brief must say exactly where they diverge and what happens in each. This table is that contract — build the shared steps once (shared components against the shared API), skin per brand.

| Step / surface | First Profit door | The 120 door | Shared? |
|---|---|---|---|
| Marketing site | FP landing (real-public-site work) | the120.school (unified-funnel brief) | Separate |
| Parent step (name, email, password, consent, inline 6-digit verify) | Identical | Identical | **SHARED** — same components, same `signup-core`, same tables |
| Add kid (full name + age) | Ages 8–16 | Ages per cohort policy; Toronto framing | **SHARED** component; validation + framing props differ |
| Consent scope | FP consent text (photo → AI vendor, etc.) | Same, plus application-data language | **SHARED** mechanism, per-door policy version |
| What happens after add-kid | Cover → story → account ready | Business-build mini-app → application | **DIVERGES** — the doors' defining difference |
| Kid provisioning moment | Step 5, instant | Instant on add-kid (recommended, §4.1) | **SHARED** provisioning core; trigger point per door |
| Kid credentials | `firstname.lastname@firstprofit.school` shown | Same identity; the 120 door *may* present the `@the120.school` alias form first (both always work — and usage is the instrumentation D7 wants) | **SHARED** identity, per-door presentation |
| AI comic cover / graphic novel | Core magic moment | Never created at The 120 (Q5) — the mini-app's Reveal is that door's magic moment; the cover and everything graphic-novel generates inside the FP app, on first login | **DIVERGES** |
| Add another kid (from dashboard) | Re-enters FP kid flow | Re-enters 120 kid flow (mini-app + application) | **SHARED** entry pattern, door-local flow |
| Parent dashboard: progress, credentials, add-kid, billing | FP skin | 120 skin + ladder + package tiles | **SHARED** data + module logic, two skins |
| Payment | Subscription (later; terms-neutral now) | $250 deposit → tuition | **DIVERGES** — two Stripe products, one customer |
| Emails | From First Profit identity | From The 120 identity (admissions@ etc.) | **SHARED** infra, two sender identities + registers |
| CRM | `origin: first-profit` | `origin: the120` (+ `?src` detail) | **SHARED** CRM, origin-tagged |

Rule of thumb: **identity, provisioning, data, and CRM are shared; narrative, gating, and payment are per-door.**

---

## 6. The upsell bridge (FP → The 120)

When an engaged FP family clicks through (§3.3), they land in Door B's flow with everything known **pre-filled** (D6):

- Parent account: already exists — no re-signup, straight into the application.
- Kid basics: name, age, grade — pre-filled from the shared rows.
- Business project: **their real FP business substitutes for the mini-app step** — they've done the real version of it. The application renders their actual business (idea, progress, revenue if any) as the project section.
- FP track record: tasks verified, criteria passed, sales/backings ledger — attached to the application as evidence. This is the pre-filled application's superpower: an applicant with a receipts-backed track record.

Same acceptance bar as cold applicants (D6): review, interview, offer, deposit. On acceptance + deposit, the family's dashboard-of-record gains the package (Gauntlet unlocks, cohort membership); their FP experience continues uninterrupted — same kid login, same game, nothing migrates.

Billing rule (Q4): an FP subscriber ($3,000/yr) who enrolls in The 120 ($4,500/yr tuition) never pays for FP twice — they get **prorated credit** if they paid the year up front, a **subscription fee change** if they pay in installments, or a combination, depending on how billing is set up. Exact Stripe mechanics land in the Phase 3 plan; the invariant is the credit, not the mechanism.

---

## 7. What the shared database holds

No new stores; The 120's Supabase project remains the single system of record (fpv2-the120-accounts R29). The two-door model adds *status*, not *silos*:

- **Parent** — one `auth.users` + `parents` row regardless of door. Door of origin is CRM attribution, never identity.
- **Child** — one `children` row per kid; one auth account; `path_student_profiles` / `fp_player_profiles` linkage as built.
- **Kid identity (D7/D8)** — canonical login `firstname.lastname@firstprofit.school` plus equivalent alias `firstname.lastname@the120.school`, resolved in the login route (usernames only; no mailboxes). Collision handling per the existing mint/suffix rules, applied once so both forms always agree. **Log which form each login used** — Peter explicitly wants to see which identity kids prefer.
- **Per-child, per-product status** — the load-bearing addition:
  - `first_profit`: active (+ trial/subscription state later) — instant at both doors.
  - `the120`: the ladder — `pre_application → applied → in_review → interviewed → offered → deposit_paid → enrolled` (reuse/extend the existing applicant-state vocabulary rather than minting a parallel one; the v2 statuses, deposit records, and `canReserveSeat` machinery are the substrate).
  - `gauntlet`: derived — unlocked iff the120 ≥ deposit_paid (D9). Prefer deriving from the ladder over an independent flag; independent grants (comps, scholarships) can come later.
  - `math_academy`: reserved slot, no machinery (D10).
- **Application content** — the dossier/application data (basics, group, academics, project, review) per kid, feeding the CRM pipeline in real time as today.
- **Money** — FP subscription state (future) and 120 deposits/tuition (existing) as two Stripe products against one customer; ledger discipline per fpv2 R19/R23.
- **Onboarding artifacts** — covers, photos, story answers on the kid profile (v3 R18 draft-record rules carry over to the FP door).
- **CRM** — one pipeline, `origin` + `entry_source` tagged, so staff and nurture distinguish an FP self-serve family from a 120 applicant while seeing each as one family.

---

## 8. Communicating this to parents

The principle: **each parent gets one coherent story; the architecture is invisible until it's useful.**

**To the First Profit parent:** "You signed up for First Profit. Your kid is building a real business." Every email from First Profit's identity, product register (kid-energy, factory-floor world). The 120 exists only as (a) the network mark — logos, never a paragraph (D5); (b) the fine print (terms/privacy name the operator, as they must); (c) the quiet dashboard link; (d) the post-engagement upsell, where The 120 is finally introduced in words — as the *bigger arena* their kid has earned a shot at, not as "the company behind this app."

**To The 120 parent:** "You applied to a selective network. The package is: the cohort, First Profit, The Gauntlet, and the numbers side (Math Academy when it lands) — learn to run a business and to run the numbers that keep it healthy." School-application register throughout (Foundry brief). First Profit is presented as *the network's business-building program* — a component of the package, the same way TimeBack presents Math Academy as its math engine. Emails from The 120's identity (admissions@ for the ladder moments).

**The one-account reality:** never marketed, never hidden. If a parent logs into the "other" site, it works, and the dashboard they find makes sense (D15: every parent is technically both). The moment it's ever explained in words is the upsell — "your account already works here" — where the shared account stops being plumbing and becomes the payoff.

**Naming discipline:** parent-facing, the ladder is always "application" (the dossier rename sweep stands). The kid's login is "their First Profit login" at Door A and "their student login" at Door B — one identity, two natural phrasings, both true.

---

## 9. Existing families (migration, D15)

- **All 10 beta parents** → dual-state (which is just... the state): FP dashboard live for them today; 120 dashboard shows their kids as pre-application.
- **All 17 beta kids** → FP-active, as provisioned. No change.
- **Abe Goldlist** → The 120 ladder at **offered / deposit paid** (his deposit is down); his family's 120 dashboard shows the reserved seat and the tuition step; Gauntlet unlocks per D9.
- **Every other kid** → `pre_application` on The 120 ladder. Their parents discover the application through the 120 dashboard or the eventual upsell — no proactive "please apply" blast in v1.
- Waitlisted / mid-application v2 families route per v3-R11 resume logic into whichever door fits their state (their application progress maps onto the Door B ladder).

---

## 10. Superseded decisions (explicit, so no doc silently lies)

| Prior decision | Where | New ruling |
|---|---|---|
| "The120 = front door only; one new-user flow for ALL families at the120.school/start" | new-user-flow-v3 (2026-08-05), Problem Frame & Key Decisions | **Superseded by D1/D3.** Two doors; v3's flow re-homes to firstprofit.school; the120.school/start becomes the selective application funnel. v3's step-level requirements (R1–R14, R18) remain authoritative for the FP door's flow. |
| FP login page's "Create Account" → `the120.school/start?src=fplogin` | fp-login-account-creation (2026-08-02) | **Superseded.** Create Account routes to FP's own signup on firstprofit.school. |
| v3-R16: delete all FP UI surfaces from the120.school | new-user-flow-v3 | **Direction stands** (apps live in their own codebases) — and now extends: FP additionally *gains* its own signup + parent dashboard surfaces. The120 keeps the shared account/provisioning backend. |
| "No parent-facing app surface for FP; parent loop is email only" | fpv2-the120-accounts, Scope Boundaries | **Superseded by D12.** FP gets a full parent dashboard. |
| Unified-funnel D5: "First Profit is the spine" of the120.school; every CTA → /start | the-120-unified-funnel-design-brief (2026-07-23) | **Amended.** The marketing routing (Start Here spine, group landing pages, `?src`/`?g` attribution) stands, but /start now opens the selective application funnel (§4.1), not an FP-branded funnel. |

---

## 11. Phasing (FP door first — D16; half-day chunks per phase at /ce:plan)

**Phase 1 — First Profit door (revenue path, serves beta now).**
v3 flow re-homed to firstprofit.school (signup + provisioning against the existing shared cores/API) · FP parent dashboard, four modules · network-mark lockup · quiet 120-dashboard link · Create-Account retarget · existing-family resume. *Explicitly not yet:* upsell module, any pricing.

**Phase 2 — The 120 selective door (cohort 1 recruitment).**
/start application funnel: explainer → shared parent/add-kid steps → mini-app → application → submit · staff review + interview scheduling on the existing CRM pipeline · offer email → deposit (machinery exists) · 120 parent dashboard with ladder + package tiles · Gauntlet unlock at deposit · Abe's state reflected.

**Phase 3 — The bridge.**
Engagement-triggered upsell in FP dashboard · pre-filled application with FP track record as evidence · acceptance/billing reconciliation rules.

**Later, separately scoped:** FP pricing + subscription (ends terms-neutrality) · Math Academy provisioning (D10) · real Workspace mailboxes on both domains (D8) · alias-usage analysis (D7).

---

## 12. Resolved questions (Peter, 2026-08-11)

All seven open questions from the first draft are resolved and folded into the sections above:

1. **Instant FP at the 120 door — confirmed.** FP provisions the moment the kid is added, at both doors; the ladder gates only the package (§4.1).
2. **Interview comes after staff review.** The family submits → staff review → passing families get an email inviting them to schedule a call (§4.1 step 6). The parent books via the email link; staff never cold-schedule.
3. **No geography enforcement for First Profit — worldwide.** Nothing asked, nothing blocked, anywhere in the FP flow. Geography is collected when payment is collected (D14, §3.1).
4. **Pricing and reconciliation set.** FP subscription: **$3,000/year**. The 120 tuition: **$4,500/year**. An FP subscriber who enrolls in The 120 gets prorated credit (paid up front), a subscription fee change (installments), or a combination, depending on billing setup (D11, §6). Parent-facing FP copy stays terms-neutral until pricing ships.
5. **The graphic novel lives only inside the FP app.** Nothing about the custom cover/graphic novel is created at The 120; the 120 door's kid gets it on first FP login (§5).
6. **Network mark lockup** — Peter explores with Claude Design (§3.2 carries the candidate treatments).
7. **Non-Toronto families at the 120 door: geography question up front, then waitlist.** Once the parent's full name, email, and geography are captured, non-Toronto families go on a waitlist for a future cohort (§4.1 step 2); the FP door stays open to them worldwide.

## Next steps

→ `/ce:plan` Phase 1 in the first-profit repo (with a 120-The120 workstream for the shared cores/API), referencing new-user-flow-v3 for step-level requirements. → Phase 2 plan in 120-The120, mining the v2/unified-application/dossier machinery this brief inventories.
