---
date: 2026-07-29
status: audit-complete
title: "First Profit fidelity audit — live flow vs. design handoff (reconnect Unit 9, R8)"
authority: "artifacts/First Profit/First Profit application process design handoff/design_handoff_first_profit/README.md"
---

# First Profit fidelity audit (Unit 9)

## Method note (adaptation)

The plan's stated method (browser screenshots of the live flow, phone + desktop) was adapted:
authenticated screens (everything past capture) cannot be reached headlessly without seeding
production data, so those were audited **code-vs-spec** — implemented JSX/classes/copy/behavior
compared against the handoff README (the spec index), the reference screenshots read as images,
and the `First Profit.dc.html` structure the README summarizes. Public screens were audited the
same way rather than sinking time into a dev-server capture; the reference screenshots
(`02-application`, `05-application`, `02-trail-maya`, `07-trail-maya`) were read as images to
anchor the comparisons. Per-item method is marked: `code-vs-spec` | `screenshot-compared` |
`needs-Peter-visual`.

Decision evidence accepted (per the plan): reviewed code comments citing R-rules, the R-rules in
`docs/brainstorms/2026-07-27-first-profit-funnel-requirements.md` (R19–R64) and
`docs/brainstorms/2026-07-28-funnel-wrap-decisions-requirements.md` (W-rules), docs/solutions,
and PR history (`git log` — funnel U1–U17 PRs #70–#92, wrap PRs #99–#117, reconnect #119 + U5–U8
commits). Ambiguous items carry **ESCALATE: Peter** with both readings.

**Hard checks run:** no em dashes / "complete" not "sealed" / "Not Yet" never "failed" / mono
uppercase idiom (results under Cross-cutting), and the README progress-percentage table diffed
against `capture-rules.ts` `PROGRESS_STEPS` + `miniapp-rules.ts` `miniAppProgress` explicitly.

Legend: **M** matches · **D-drift** deviation classified drift (fix in Unit 10) ·
**D-dec** deviation classified decision (waive, cite evidence) · **ESC** escalate · **NB** not built.

---

## Phase A — Public marketing surfaces (application register)

| # | Screen | Register | Checked | Verdict | Method |
|---|--------|----------|---------|---------|--------|
| 1a | Landing skeleton `/first-profit` + `/groups/[slug]` (`LandingPage.tsx`) | application | R20 section order: nav card, hero+gradient, seats line, proof strip, What-is-120, red band, footer | **M** (order intact, six instances share one template per R19) | code-vs-spec + screenshot-compared |
| 1b | Landing hero gradient + text lightbox | application | gradient stops, lightbox card (rgba .55, r14, blur 2px, pad 16/18) | **deviation** — see bullets | code-vs-spec |
| 1c | Landing proof strip | application | copy + card treatment | **deviation** — see bullets | code-vs-spec |
| 1d | Landing CTA band | application | headline copy, CTA | **deviation** — see bullets | code-vs-spec |
| 1e | Landing headline/subhead/seats | application | R22 line 2, per-group subheads, live seats | **M** / **D-dec** | code-vs-spec |
| 1f | Nav CTA (`StartCta.tsx`) | application | label, destination, attribution | **D-dec** | code-vs-spec |
| 1g | Landing hero photography | application | `fp-hero` slot | **NB (decision)** | code-vs-spec |

Detail bullets:

- **1b — layout, D-drift.** Spec: gradient `rgba(19,20,22)` .30 → .06 → .10 → .82 **plus** a
  text lightbox card (`rgba(19,20,22,.55)`, 14px radius, backdrop-blur 2px, padding 16/18)
  around the seats line/headline/subhead/CTA. Live (`LandingPage.tsx:87-113`): gradient
  .18/0/.02/.82 and **no lightbox card** — text sits directly on the gradient. The code comment
  even names "the text lightbox" (R23) but only the seats *line* shipped. No decision evidence
  for dropping the box. Category: layout (+ minor token on the gradient stops).
- **1c — copy+layout, ESC (see Escalations E1).** Spec: strip headline "No simulations. No
  pretend points." + three **white cards** (Real customers / Real money / Verified by real
  adults). Live: three mono strings `REAL CUSTOMERS, REAL REVENUE / MENTORS WHO HAVE DONE IT /
  DEMO DAYS ON A REAL STAGE`, no headline, no cards. The strings carry an "(R20)" comment and
  shipped through the U5 landing PR review, but R20 fixes only the *skeleton*, not this copy,
  and the handoff says all copy is final.
- **1d — copy, D-drift.** Spec band: "The application is the first day of the business. *Start
  it now.*" Live: "Ten minutes from now, this is *their* business." No citation. (Structure —
  red band, one forward CTA — is R26-decision and matches.)
- **1e — M / D-dec.** `LANDING_HEADLINE_LINE_2 = "We'll show you how right now."` matches R22
  exactly. Per-group subheads differ from the handoff's single subhead — **decision** (R19:
  "only the hero image, headline line 1, and subhead vary"; `site.ts` cites unified brief §3.2).
  `WHAT_IS_THE_120` differs in wording from the prototype paragraph but is pinned by identity in
  tests per R21 — **decision**. Seats line via `seatsDisplay` — **decision** (R23: hardcoded
  "113" is scaffolding; zero seats reads as waitlist).
- **1f — D-dec.** Spec nav CTA "Learn More" (mono red). Live "Start Here →" red pill routing to
  `/start` — decision (R24/R26 rewire; `cta-source.ts` `FUNNEL_CTA_LABEL`; `StartCta.tsx`
  comments R10/R11/R13; pinned by `cta-reroute.test.ts`).
- **1g — NB (decision).** Hero art is an external content dependency; slot ships blue
  (`LandingPage.tsx` comment; plan scope: "landing hero art out of scope").

## Phase B — Explainer + capture (`/start`, `StartFlow.tsx`)

| # | Screen | Register | Checked | Verdict | Method |
|---|--------|----------|---------|---------|--------|
| 2a | Explainer swipes (3) | application | eyebrow, titles, CTA labels, dots, % | **deviation** — see bullets | code-vs-spec + screenshot-compared |
| 2b | Capture form | application | fields, CTA, disabled state, reassurance line, consent | **deviation** — see bullets | code-vs-spec |
| 2c | Progress % (explainer 5/8/11, capture 15) | application | `PROGRESS_STEPS` vs README table | **M** (exact) | code-vs-spec |
| 2d | Back between swipes (net-new) | application | R5 reconnect, Unit 6 | **D-dec** (named decision; treatment consistent with mini-app Back idiom) | code-vs-spec |

Detail bullets:

- **2a — copy, D-drift (eyebrow).** Spec **and R29** both fix the eyebrow as always
  "HOW IT WORKS". Live renders "STEP ONE / STEP TWO / STEP THREE" (`StartFlow.tsx:23-39`). This
  contradicts the R-rule itself, so it is unambiguous drift.
- **2a — copy, D-drift (titles/bodies/CTAs).** Spec titles: "Your child designs a real
  business." / "You'll see exactly where it leads." / "This is the application."; CTAs
  "Continue" then "Start Building". Live: rewritten headlines (same three ideas, per R29's
  paraphrase) and CTAs "Next →" / "Start Here →". Handoff copy is final; no citation for the
  rewrite.
- **2a — layout, D-drift (dots + nav card).** Spec: red progress dots (26px active pill) on the
  swipes, inside the floating white nav card carrying brand + bar + %. Live: a bare 4px linear
  bar with a mono `{pct}% · Application` caption, no dots, no nav card. See systemic item X1.
- **2b — copy, D-drift.** Spec capture CTA "Next Step" with disabled `#d8d5cf`; spec includes a
  school-application reassurance line. Live: CTA "Start Here →" (again), disabled = opacity-60
  on red (token), reassurance line replaced by "Where should we send it?" / "So you can pick
  this up on any device…". Categories: copy + token.
- **2b — D-dec (consent + outcome notices).** The unticked CASL checkbox, its versioned text,
  and the existing/limited/failed notices are net-new vs the handoff — decisions (R30/R30a/F6,
  U6 PR #79).

## Phase C — Add Children (split: `/dashboard` cards + `/start/children`)

| # | Screen | Register | Checked | Verdict | Method |
|---|--------|----------|---------|---------|--------|
| 3a | The split itself | application | funnel add-child lives at `/start/children`, dashboard keeps skeleton | **D-dec** (R28/R31 spine; U7 PR #80) | code-vs-spec |
| 3b | Dashboard hero + seats box | application | "PARENT DASHBOARD"/"Welcome, {name}."/dossier subcopy; `#efece6` seats box, red number, mono caption | **M** (near-verbatim vs screenshot 05) | screenshot-compared |
| 3c | Dashboard top bar | application | brand + progress% + SIGN OUT | **deviation** — see bullets | code-vs-spec + screenshot-compared |
| 3d | + ADD A CHILD pill | application | secondary (white/red-outline) once ≥1 child | **D-drift** (behavior/token: always red, `DashboardApp.tsx:235-240`) | code-vs-spec |
| 3e | Add-form (name + grade → band note) | application | dashed card, grade→band | **M at `/start/children`** (fields, grade select, Trail/HQ band note; dashed-card chrome not used — minor layout note) | code-vs-spec |
| 3f | Funnel child cards (`cardVerdict`) | application | status lines, tone, CTA colors/placement, band note, secondary review link | **M** — status set matches screen-3 exactly (PROJECT NOT STARTED/CREATED, OFFERED A SEAT, SEAT RESERVED, + reconnect additions), red START/CONTINUE, blue reserve, green reserved; copy rules pinned in `funnel-dashboard-cards.test.ts` | code-vs-spec |
| 3g | DOSSIER % row + red bar | application | Meter under card header | **M** (Meter component; 25/63/100 examples are prototype data, live is real completeness) | code-vs-spec |
| 3h | PIPEDA mono footer | application | present | **M** | code-vs-spec |
| 3i | Reserve block (policy inline + checkbox) | application | net-new vs screen 3 | **D-dec** (R50/R51a; label "Reserve seat · $250" vs spec "RESERVE SEAT - $250" — separator only) | code-vs-spec |

- **3c — layout, D-drift.** Spec top bar carries the application progress bar + % (and from the
  wizard on, NAME · SIGN OUT). Live `DashHeader` has brand + name + Sign out but **no progress
  bar anywhere on the dashboard/wizard**. Part of systemic item X1/X2.

## Phase D — The mini-app (`MiniAppShell.tsx`, Trail + HQ skins)

All seven steps render in the child's skin via `SKIN_ROOT_CLASSES` (canvas+ink swap) — the
class-swap architecture is a decision (Decision 10, R62, tailwind-v4 learning in
docs/solutions). The **depth** of the register is the headline finding here — see Escalation E2.

| # | Screen | Skin | Checked | Verdict | Method |
|---|--------|------|---------|---------|--------|
| 4 | Handoff | trail+hq | title/body/CTA copy, logo tile, skin | **deviation** — see bullets | code-vs-spec |
| 5 | Doors | trail+hq | title, 5 cards, numeral chip, kicker, blurb, order, pre-selection | **deviation** — see bullets | code-vs-spec + screenshot-compared |
| 6 | Templates | trail+hq | 2 per group + own-idea textarea, pitch + first-customers line | **M** (R37; copy from brief §8.2 = decision) | code-vs-spec |
| 7 | Quiz | trail+hq | 4 band-phrased Qs, suggestions as placeholders never pre-typed, parent-assist line naming group, CTA "Shape my project →" | **M** (R38; CTA matches spec verbatim) | code-vs-spec |
| 8 | Compose | trail+hq | loading state, project page, controls, regen ×2, gold note, CTA | **deviation** — see bullets | code-vs-spec |
| 9 | First 3 tasks | trail+hq | header, 3 bubbles, step-2 strictness, footer line, CTA | **deviation** — see bullets | code-vs-spec |
| 10 | Reveal | trail+hq (+application close) | climb, states, projection label, stats, close CTA, parent line, FAQ, share card | **deviation** — see bullets | code-vs-spec + screenshot-compared |

Detail bullets:

- **4 — copy+layout, D-drift.** Spec: centered logo tile; "Maya, this part is yours." /
  "Theo, from here it's you." (addresses the **child**); band body + parent line; Path accent
  Button "We're ready" / "I've got it from here". Live (`handoffCopy`): Trail "Hand it to
  {name}." (addresses the **parent**), HQ "{name}, take it from here."; CTAs "I'm ready →" /
  "Let's go →"; no logo tile; red application-register pill. R33 covers "child's skin + names
  the child" (both hold) but not the copy rewrite or the direction flip. Categories: copy
  (direction + strings), layout (logo tile), token (button register — folded into E2).
- **5 — layout+copy, D-drift.** Title "Five doors. Pick yours." matches; DOOR_ORDER +
  numeral/kicker format are decisions (R34, D9 comment in `miniapp-rules.ts`). Drift: spec's
  **arch numeral chip** in phase colour is rendered as plain mono text (no arch/circle chip);
  spec's per-card band-register **blurb** and the screen subhead ("Every founder in The 120
  belongs to one group…") are absent — live shows one hint line under the pre-selected door only
  (that line itself is R35-decision). Group name renders "The athletes" via CSS `capitalize`
  (reads "The Athletes" — fine). Pre-selection/switch friction rules — **M** per R35/R36.
- **8 — layout+copy+behavior, D-drift (with decision islands).** Spec: pulsing-logo loading
  state "Shaping your project…" → a composed project *page* (name editable, description, "The
  offer" + "First customers" **cards**), controls "Change anything / Shape it again ×2 / Start
  over", gold "This project is yours… founders pivot" note, CTA "See your first 3 tasks (out of
  25)". Live: pending-button "Building…" (no loading screen); a **form of labeled textareas**
  rather than a page-with-edit-affordance; "Keep it →" + "Try another version (n left)";
  **no Start over control**; no gold note; no "(out of 25)" CTA. Decisions inside: regen
  limited to 2 server-side, all fields editable, edits recorded, canned fallbacks (R40/R40a —
  the `composeDegraded` line is the fallback's product-state copy), server-side AI call
  (R39/R39a-c). The layout/copy gap and the missing Start over are drift.
- **9 — copy, D-drift (structure is decision).** Three bubbles only, step 2 strictly first
  product + one person paying — **M** per R42. Drift: spec header "YOUR PROJECT" eyebrow +
  project name (same header as compose) vs live "Your first three moves."; spec intro "Every
  founder starts the same way: pitch it, sell it, learn from the no's." vs live rewrite; chips
  "Step n" vs "T1/T2/T3" (mono either way); spec footer "In the app, each step is broken down
  into 4-6 unit tasks. First Profit helps you win." absent; CTA "See where this leads →" vs
  "Show me the year →". Title wordings drifted slightly ("Pitch it in 60 seconds" vs "Pitch a
  product in 60 seconds").
- **10 — mixed.** Decisions (R43/R44/R45, U11 PR #87): climb as bar chart with SELL/BUILD
  complete, VALIDATE partial, GROW/SCALE dashed — **M**; projection labelled everywhere
  (band-worded `PROJECTION_LABEL` replacing the dashed chip) — **D-dec**; the "In SELL you
  learned…" bullets replaced by the stat strip citing only real pass criteria — **D-dec**
  (R43's stat-strip rule); share card parent-only — **D-dec** (R45); close: red "Continue
  Application →" + italic band parent line + 4-row FAQ closed by default + FAQ-open events —
  **M** (R44). Drift: no "YOUR PROJECT" eyebrow / dashed "Months from now · a projection" chip
  header; no wax-seal "complete" checks on SELL/BUILD; no "57 unit tasks complete"-style mono
  captions; VALIDATE fill 45% vs prototype's 20% (cosmetic). FAQ **content** → Escalation E3.

## Phase E — The close (wizard, next steps, checkout, arrival)

| # | Screen | Register | Checked | Verdict | Method |
|---|--------|----------|---------|---------|--------|
| 11a | Dossier wizard shell (`DossierEditor.tsx`) | application | ← ALL CHILDREN, `#efece6` header card (DOSSIER / name / STATUS · x / % bar), stepper colors (blue done-✓, red current, gray todo) | **M** | code-vs-spec |
| 11b | Wizard steps | application | spec BASICS→ACADEMICS→REVIEW with Group+Project pre-done; live 5 steps | **D-dec** (R46: funnel pre-fills group+project, Workshops removed — U12; steps stay visitable) | code-vs-spec |
| 11c | Basics | application | prefill, birth year auto-calc, school | **M** (birth year `2021 − grade` per corrected R47 + docs/solutions entry; child email + "Don't have one" per R48) | code-vs-spec |
| 11d | Academics | application | spec: 2X-4X copy, Fast Math+Math locked, ASK ABOUT THIS toast, plan picker, math note | **D-dec** — live is the subject+plan+goal rebuild, code comments cite R7–R9b (dashboard requirements); the handoff screen predates that rebuild's supersession | code-vs-spec |
| 11e | Review & Submit | application | strikethrough checklist ✓, PREVIEW ghost pill ✓, red SUBMIT at 100% ✓, submitted flip + confirmation copy | **M** (R10 exact copy; R49; review-state link = U13/F5 decision) | code-vs-spec |
| 11f | Wizard progress 80/90/96 in the nav card | application | `wizard_1/2/3` + `submitted` exist in `PROGRESS_STEPS` but nothing renders them | **D-drift** (behavior) — folded into X1/X2 | code-vs-spec |
| 12 | Next steps (`NextStepsFlow.tsx`) | application | 3 swipes, eyebrows, dots, wins card, seat card, CTA | **D-dec with drift edges** — see bullets | code-vs-spec |
| 13 | Checkout | Stripe | replica vs hosted | **D-dec** — Stripe-hosted Checkout, not the replica (R52 "rides the existing Stripe rails"; plan scope excludes checkout internals; policy-echo gate is U14/R51a) | code-vs-spec |
| 14 | Checkout success | application | "Seat held." screen | **D-dec** — no dedicated success screen; `success_url` → `/start/arrival` (wrap U7, PR #115); cancel → dashboard banner; dashboard also renders a paid banner for the legacy path | code-vs-spec |
| 15 | Arrival (`ArrivalFlow.tsx`) | application | acceptance-letter moment | **deviation** — see bullets | code-vs-spec |
| 16 | Dashboard post-signup | Path register | screen-16 re-skin | **NB — not built, planned U11** (register flip + `arrived_at`; sibling-card decision deferred) | code-vs-spec |

Detail bullets:

- **12 — mostly decision.** Swipe copy is **CONFIRMED as written 2026-07-28 (Peter, decision
  batch)** per the `deposit-rules.ts` comment — decision for all three swipes' strings, titles
  included, though they differ from the prototype's. Structure (3 swipes, goal input persisted,
  seat swipe pointing at the dashboard reserve block where the R51a policy text lives) —
  decision (R50/R51/R51a). Drift edges: spec red progress dots + nav card with NAME · SIGN OUT
  (live: mono "Next steps · n of 3", no dots/card — X1); spec wins card (PROJECT/GROUP/DOSSIER/
  PLAN) absent; final CTA "Reserve the seat →" (to `/dashboard`) vs spec "Hold {name}'s seat ·
  $250 →" — routing is decision (policy-at-payment), label is copy drift.
- **15 — layout+copy, part decision part drift.** Superseded by decision: **no credentials at
  arrival** (W16: password-less accounts — kills the spec's YOUR KEYS card with
  `iloveschool` + forced reset); parent-email preview replaced by forwarding status lines
  (W14); provisioning/timeout states are wrap-U7 product states (PR #115). Drift remaining:
  the *acceptance-letter register* — spec stamped logo tile, "Maya, **you're in.**", red
  "Go to my new dashboard →" CTA, Sept 30 calendar note; live kicker "Seat reserved", heading
  "{name}'s 120 address", **border-pill** "← Back to the dashboard", no calendar note, no
  ceremony. W16 changed the credentials, not the moment; R54 ("acceptance-letter moment, not a
  settings screen") still stands and the live screen reads closer to a settings screen.
  Category: layout + copy + token (CTA color). Also em dashes in `ARRIVAL_SCREEN` copy (X3).

## Net-new surfaces (named decisions, audited against their micro-specs)

| Item | Micro-spec source | Verdict | Method |
|------|-------------------|---------|--------|
| Back control (MiniAppShell + StartFlow) | Unit 5 micro-spec comment (`MiniAppShell.tsx:68-94`) | **M vs micro-spec**: "← BACK" mono idiom, one per screen, `stepNeighbour` walk, "← ALL CHILDREN" on handoff, "← TO THE DOORS" consolidation (no doubled affordances), pending-disabled; StartFlow "← Back" mirrors the idiom. Spec is marked *pending Peter's design sign-off* — treatment is **awaiting decision**, implementation matches its own spec. | code-vs-spec |
| Locked state (MiniAppShell) | Unit 7 micro-spec comment (`MiniAppShell.tsx:96-122`) | **M vs micro-spec**: one card, "APPLICATION SUBMITTED" label, exact body copy, admissions@the120.school off-ramp, inputs+mutating CTAs disabled, navigation CTAs live, `{kind:"locked"}` renders the same notice never retry copy; no-em-dash pinned by test. Awaiting Peter sign-off on the visual treatment. | code-vs-spec |
| Confirm dialog (MiniAppShell) | Unit 8 micro-spec comment (`MiniAppShell.tsx:124-155`) | **M vs micro-spec**: fires only via `doorChangeNeedsConfirm` (server-fact compare + composed project), snapshot-render/snapshot-submit, "CHANGE DOORS?" label, names the snapshot's project, "Change door"/"Keep this door" buttons, alertdialog/aria-modal, cancel writes nothing, conflict → refresh copy. Awaiting Peter sign-off on the visual treatment. | code-vs-spec |

## Cross-cutting hard checks

- **X0 — Progress percentages: MATCH, exactly.** README table (explainer 5/8/11/15 → addchild
  20 → handoff 25 → doors 30 → templates 38 → quiz 46 → compose 55 → tasks 62 → reveal 70 →
  wizard 80/90/96 → submitted 100) is byte-identical to `capture-rules.ts` `PROGRESS_STEPS`;
  `miniAppProgress` delegates to it. (R32 also pins it.)
- **X1 — Floating nav progress card: systemic layout D-drift.** The README's interaction rule
  (bar in the floating white nav card — brand chip, red 4px bar on `#eceae5`, `%`, and from the
  wizard on NAME · SIGN OUT) is not built on any screen. `/start`, `/start/children`, and the
  mini-app render a bare in-column bar with a mono caption (track is `bg-line #e4e2dd` /
  `bg-black/10`, not `#eceae5` — token); the dashboard/wizard/next-steps/arrival render **no
  application progress bar at all**. Reference screenshots show the card persisting into the
  Trail/HQ mini-app. No decision evidence. Largest single fidelity gap by surface count.
- **X2 — Wizard/submitted percentages (80/90/96/100) built but unconsumed** — behavior drift,
  subsumed by X1.
- **X3 — Em dashes in rendered copy: systemic, ESCALATE (E4).** The handoff copy rule ("No em
  dashes", applies everywhere) and R63 are enforced by tests only on the newer surfaces
  (cards, locked notice, confirm dialog, reveal/compose modules — all clean). But em dashes
  render today in: `StartFlow.tsx` explainer body + outcome notices, `ChildrenFlow.tsx`
  notices, `miniapp-rules.ts` `handoffCopy` Trail line, `quiz-rules.ts` template pitches and
  question phrasings (copy sourced from brief §8.2 per R37), `arrival-rules.ts` all five copy
  blocks, `child-rules.ts` seats copy, `LandingPage.tsx` `WHAT_IS_THE_120` (test-pinned!),
  `site.ts` subheads and `WAITLIST_LABEL`, page `<title>`s.
- **X4 — "complete" not "sealed": PASS** (`reveal-rules.ts` R63 comment + sweep; no "sealed"
  in funnel copy). **"Not Yet" never "failed": PASS** (refusal copy says "needs another look";
  card tests assert never-"failed"). **Task IDs mono: PASS** (T1–T3 mono chips). **No emoji
  outside DS iconography: PASS** (✓ marks only — the check glyph the prototype itself uses).
- **X5 — Mono uppercase idiom: PASS** — eyebrows/labels/CTAs are IBM Plex Mono uppercase
  tracked throughout; Georgia display via `font-display`… **note:** `--font-display` is Space
  Grotesk; Georgia is `--font-serif`/`.display`. Funnel headings use `font-display` (Space
  Grotesk) where the spec says Georgia display — token/type deviation on `/start`,
  `/start/children`, next-steps, arrival, and the mini-app headings. The marketing landing uses
  `.display` (Georgia) correctly. Classified D-drift (type token) for the application-register
  funnel screens; for the mini-app it folds into E2.
- **X6 — CTA radius:** spec 10px-radius CTAs; live `rounded-full` pills everywhere — **D-dec**
  (the site-wide `ctaClass`/pill idiom predates the funnel and is used consistently; the
  handoff's own dashboard pills are 999-radius).
- **X7 — Desktop layouts (screenshots 12–19, ~960–1180px):** funnel screens are single-column
  `max-w-lg/xl` at all widths. R64 mandates mobile-first; nothing evidences dropping the
  desktop layouts. **D-drift (layout), needs-Peter-visual** for priority.

---

## ESCALATIONS (ambiguous — awaiting decision; no default verdict)

- **E1 — Landing proof strip copy** (`PROOF_POINTS`). Reading A: handoff copy is final and the
  white-cards treatment + "No simulations. No pretend points." should ship → drift, fix in U10.
  Reading B: the strip was deliberately rewritten for the standalone-brand positioning (claims
  like "Verified by real adults" belong to the old TimeBack framing; strings shipped through U5
  PR review with an R20 citation) → decision, waive. **ESCALATE: Peter.**
- **E2 — Mini-app register depth.** Reading A: R62 + the handoff demand the full First Profit
  DS register (Fraunces/Inter/Spline Mono via `--font-path-*`, ported components — Button,
  Crest, Seal, ProgressMeter exist in `app/fp/components/system/` and go unused here — arch
  door chips, wax seals, DS motion) for handoff→reveal; the shipped canvas+ink swap with
  application-register type and red pills is a thin veneer → large drift, its own U10 sub-unit.
  Reading B: the minimal skin swap was the deliberate shape of U8–U11 (Decision 10 comments,
  four PR reviews passed it; red CTA + `font-display` read fine on both canvases) → decision,
  waive; only targeted gaps (door chips, reveal seals) fix. **ESCALATE: Peter.** (Items 4, 5,
  8, 10's skin-fidelity edges and X5's mini-app half all hang on this.)
- **E3 — Reveal FAQ content.** Spec fixes 4 rows including prices ("costs $3,000 membership ·
  $15,000 full core") and "how long until $10K". Live 4 rows avoid all dollar figures
  ("Tuition is on the tuition page…"). Reading A: copy is final, restore the spec rows → drift.
  Reading B: post-rebrand pricing/no-promised-outcomes posture (R41 bans dollar predictions in
  AI copy; the $10K row edges the same promise) made the neutral rows deliberate → decision.
  No citation either way. **ESCALATE: Peter.**
- **E4 — Em-dash rule scope (X3).** Reading A: the copy rule applies everywhere (README +
  R63 verbatim) → sweep every rendered string incl. test-pinned `WHAT_IS_THE_120` and Peter-
  confirmed `NEXT_STEPS` copy (which is em-dash-free, but arrival copy is not) → large U10
  item. Reading B: repo practice scopes the rule to handoff-derived/AI/child-facing copy (the
  tests enforce it exactly there; long-form marketing/parent body copy with em dashes shipped
  through many reviews, some of it Peter-confirmed) → decision, tighten only funnel-proper
  strings. **ESCALATE: Peter** — note fixing this against Reading A would touch strings pinned
  by tests and confirmed copy, so it must not be "fixed" silently.
- **E5 — Arrival ceremony (item 15's drift half).** Reading A: R54's acceptance-letter moment
  survives W16 minus the password — stamped tile, "you're in", red CTA, calendar note should be
  restored around the forwarding copy → drift. Reading B: wrap-U7 deliberately rebuilt arrival
  as the poll-driven address moment and the ceremony was consciously dropped with it →
  decision. PR #115 shows the rebuild but not an explicit ceremony call. **ESCALATE: Peter.**

## SUMMARY

Counts (screen/item entries above, including cross-cutting):
- **matches:** 14 (1a, 1e-partial, 2c, 3b, 3e, 3f, 3g, 3h, 6, 7, 11a, 11c, 11e, X0/X4/X5-pass halves + 3 net-new-vs-micro-spec)
- **deviation → decision (waive with citation):** 13 (1e, 1f, 1g, 2b-consent, 3a, 3i, 10's climb/stats/labels/share, 11b, 11d, 12-core, 13, 14, 15-credentials half, X6)
- **deviation → drift (Unit 10 queue):** 12 distinct items (below)
- **escalations:** 5 (E1–E5)
- **not built:** 1 (screen 16 — planned U11) + hero art (decision)
- **needs-Peter-visual:** X7 desktop layouts (priority call), plus final visual sign-off on the three micro-spec surfaces (Back / locked / confirm) which their specs already reserve for Peter.

### Drift items ordered by effort for Unit 10 (smallest first)

1. **2a-eyebrow** — explainer eyebrow to "HOW IT WORKS" (contradicts R29; one constant). copy
2. **2b-token** — capture disabled state `#d8d5cf`; progress track `#eceae5`. token
3. **9-copy** — tasks screen: header eyebrow + project name, spec intro line, "Step n" chips,
   footer "4-6 unit tasks" line, CTA "See where this leads →". copy
4. **2a/2b-labels** — explainer/capture CTA labels ("Continue"/"Start Building"/"Next Step")
   and swipe titles per spec. copy
5. **12-label** — next-steps final CTA label "Hold {name}'s seat · $250 →". copy
6. **1d** — CTA band headline per spec. copy
7. **4** — handoff copy (child-addressed titles, spec CTAs) + logo tile. copy/layout
8. **3d** — + ADD A CHILD secondary treatment once ≥1 child. token/behavior
9. **1b** — hero text lightbox card + exact gradient stops. layout
10. **5** — doors: arch numeral chip, per-card blurbs, screen subhead. layout/copy
11. **10-header/seals** — reveal eyebrow + projection chip + wax-seal complete checks + unit-task
    captions (scope depends on E2). layout
12. **X5-app-half** — Georgia display headings on application-register funnel screens. token/type
13. **8** — compose loading state, page-vs-form treatment, Start over control, gold note, CTA
    label. layout/behavior/copy
14. **15-ceremony** — arrival acceptance-letter register (pending E5). layout/copy/token
15. **X1** — the floating nav progress card, all screens explainer → submit (incl. wizard
    80/90/96 consumption). layout/behavior — largest
16. **X7** — desktop layouts for the funnel screens. layout — largest, needs-Peter-visual

### What materially surprised

- The progress **numbers** are perfect while the progress **surface** (the floating nav card,
  the thing every reference screenshot leads with) was never built anywhere.
- `app/fp/components/system/` contains ported First Profit DS components (Crest, Seal,
  ProgressMeter, Button) that the mini-app never imports — the E2 decision has its parts
  already in the repo.
- The handoff Trail title addresses the parent while the spec addresses the child — a
  direction flip, not just a wording change.
- Em dashes are enforced-by-test on new copy and pervasive in older shipped copy, including a
  test-pinned landing paragraph — the rule's real scope was never settled (E4).
