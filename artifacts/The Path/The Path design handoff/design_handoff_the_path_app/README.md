# Handoff: The Path — the full app (Student, Parent, Guide + celebrations, docs, states)

## Overview
The Path is the progress engine for The 120's entrepreneurship curriculum: **5 phases → 25 criteria → 125 unit tasks**, all done in the real world and verified by a real adult. This package is the **complete first-pass visual + interaction design** for the app across every role and surface:

- **Student**, in two skins — **Trail** (illustrated journey, kid register, default G3–5) and **HQ** (founder dashboard, founder register, default G6–12). The skin toggle changes pixels and words, never mechanics.
- **Parent** — the always-grounded verifier: real-time review queue, split verify / Not-Yet review, multi-sibling family dashboard.
- **Guide** (cohort) — cohort board + the phase-review countersign.
- **Celebrations** — the four tiers (task → criterion → phase → the whole Path).
- **AI documents** — Criterion Recap, Phase Chronicle, Founder Portfolio.
- **States & systems** — the full task state machine, the Not-Yet moment, review ceremonies, math gate, notification routing.
- **Onboarding** — family setup → band → default skin.

Every Student and Parent surface ships in **two responsive layouts**: a **phone** layout and a **desktop app-shell** layout that reflows to remain usable on a mobile browser.

## About the design files
The files in this bundle are **design references created in HTML** — an interactive prototype demonstrating the intended look and behavior. They are **not production code to copy directly.** The task is to **recreate these designs in the target codebase's environment** using its established patterns.

The reference app the design system was reverse-engineered from is **Vite + React + TypeScript + Tailwind** — if you're building there, mirror that. If starting fresh, React + TS is the natural choice given the component library below. The prototype itself is authored as a single "Design Component" HTML file that composes the bound **The Path Design System** (a compiled component bundle + CSS tokens). In production you would implement the real React components (contracts listed under **Design System** below) and the data/engine from the briefs.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, motion, copy, and interactions are all specified (they come from the bound design system's tokens — exact values under **Design Tokens**). Recreate pixel-close using the codebase's libraries. Where the brief calls for commissioned Trail world/character art, the prototype uses an on-brand **CSS/SVG schematic** as a placeholder (see Caveats at the end).

## How the prototype is organized (so you can navigate it)
Open `The Path.dc.html`. A left **prototype navigator** (dark rail — this is scaffolding, NOT part of the product) switches between every surface. Product chrome is what's *inside* the stage:

- Student & Parent scenes render inside a **View** toggle: **Phone** (device bezel) or **Desktop** (in-app sidebar + sticky top bar). Default is Phone.
- Student scenes also carry the **Trail / HQ skin toggle** (top-right). Toggling swaps to the paired surface in the other skin (e.g. Territory Map ↔ Dashboard) — nothing earned is lost (design rule D4).
- Guide, Celebrations, AI documents, and States are desktop-native surfaces.

Two personas seed the data throughout: **Maya Okafor** (Grade 4, Trail, mid-Phase 01 SELL, criterion 1.2) and **Dev Sharma** (Grade 10, HQ, closing Phase 04 GROW, criterion 4.5). Parent persona: the **Okafor family** (Maya + brother Theo, G7). Guide persona: **Ms. Adeyemi's** 24-student Saturday cohort.

---

## Design System (rebuild these components)
The prototype loads a compiled bundle that exposes these React components on a namespace. Rebuild them as first-class components in your codebase; their prop contracts:

| Component | Purpose | Key props |
|---|---|---|
| `Icon` | Lucide glyph set, 2px stroke, inlined SVG (no CDN) | `name`, `size=20`, `strokeWidth=2`, `title` |
| `Button` | Shared action; HQ crisp / Trail round | `skin='hq'\|'trail'`, `variant='primary'\|'secondary'\|'ghost'\|'accent'`, `size='sm'\|'md'\|'lg'`, `phase`, `icon` |
| `SkinToggle` | Student Trail↔HQ control | `value`, `onChange(skin)` |
| `StatusChip` | Six task states as a pill (Not Yet = amber, never red) | `state`, `label?` |
| `ProgressMeter` | `n / 125 verified` credential bar, fills phase-by-phase | `value`, `total=125`, `perPhase`, `label='verified'` |
| `Crest` | Criterion badge (25); Trail full-color, HQ monochrome | `phase`, `criterion` ("1.3"), `skin`, `size=72`, `locked` |
| `Seal` | Phase mark (5); Trail wax, HQ monochrome + date | `phase`, `skin`, `size=96`, `sealed`, `date`, `animate` |
| `HQTaskCard` | Founder's task spec sheet | `task{id,title,body,doneWhen,bandVariant,state,phase,liveMoment,reviewNote,verifierComment}`, `now`, `onOpen` |
| `TrailStep` | One illustrated step (mist / glowing / satchel-shimmer / wax-stamp) | `index`, `state`, `phase`, `label`, `onClick` |
| `PhaseRow` | One HQ ledger row (5 criterion segments + status) | `phase`, `criteriaCleared`, `tasksVerified`, `tasksTotal`, `status='locked'\|'active'\|'review'\|'sealed'`, `sealedDate`, `reviewer` |
| `ReviewPanel` | Parent split verify view (evidence vs Done-when + band bar) | `taskId`, `title`, `doneWhen`, `bandVariant`, `phase`, `evidence[]`, `reviewer`, `onVerify`, `onNotYet` |
| `WisdomCard` | Trail Almanac card (collectible, favoritable) | `entry{text,attribution,original?}`, `favorited`, `onFavorite` |
| `MarginNote` | HQ Almanac pull-quote (same content, quiet finish) | `entry` |
| `PhaseSealCelebration` | Tier-3 sealed moment (both skins) | `phase`, `skin`, `stats[]`, `montage[]`, `onCelebrate`, `onContinue` |

`TaskState` = `locked | available | in_progress | submitted | not_yet | verified`. `PhaseKey` = `sell | build | validate | grow | scale`.

---

## Screens / Views

Copy is exact — use it verbatim. Layouts assume the phone frame ≈ 390×812; the desktop shell is a sidebar (236px) + sticky top bar + centered content column (max ≈ 840px).

### 1. The Loop (hero, demo)
Two phones side by side, **wired live**, showing the core loop at the task scale.
- **Maya (Trail)**: header (logo, "Maya's Trail · Grade 4 · The Market Town", Trail pill) → `ProgressMeter` (8 → 9 stamped) → "Landmark 1.2 · Make a real sale" with five `TrailStep`s → the current-step card for **1.2.4 Ask until one yes** with the Done-when line and state-driven body.
- **Dad (Parent)**: header ("Review · Okafor family · Dad", green *real-time* dot) → state-driven body (quiet queue → new submission → `ReviewPanel` → Verified / Not-Yet confirmation).
- A **connector** between them shows real-time status; a caption strip shows **1 · Submit › 2 · Verify › 3 · Celebrate** with the active stage highlighted.

### 2. Onboarding (phone / desktop)
4-step flow with progress dots + Back/Continue footer:
1. Welcome — logo, "Welcome to The Path", the five phase dots (Sell·Build·Validate·Grow·Scale), "Set up your family".
2. Add a founder — name field ("Maya Okafor") + three band cards (**Grades 3–5 → default Trail**, **6–8 → HQ**, **9–12 → HQ**) with the co-pilot/support/verify-only descriptions.
3. Starting skin — Trail vs HQ choice cards with mini previews; note "The skin toggle affects only Maya's view. You always see the grounded review interface."
4. Ready — "Maya is ready", the rule "Maya can never mark her own work done — a real adult always verifies", "Enter Maya's Path".

### 3. Student · Trail — Territory Map
Parchment. Header (Maya's Trail, bell). "Your journey / Five territories." **SELL** territory expanded: a warm gradient header with a market-town SVG motif (awnings + sun), "01 SELL · The Market Town", "You are here" chip, five numbered landmark **pips** (1 done, 2 current/pulsing, 3–5 ahead), and a current-landmark row ("Landmark 1.2 · now — Make a real sale · 3 of 5 steps") with an **Enter** button. BUILD–SCALE render as misted, locked rows ("opens when SELL is sealed").

### 4. Student · Trail — Landmark
Back to map. "The Market Town / Landmark 1.2 · Make a real sale." Five `TrailStep`s (3 verified, 4 available/glowing, 5 locked). Current-step card for 1.2.4 with Done-when + "Open this step". A `WisdomCard` ("A no is not a door closing…"). A locked `Crest` (1.2) with "Clear all five steps and a parent reviews the landmark — then this crest is yours."

### 5. Student · Trail — The Satchel (Founder File)
Tabs: **Evidence** / Cards / Crests. Evidence grouped on "shelves" by landmark (1.1, 1.2); each item = type icon (or photo thumbnail) + label + mono task id + "stamped" + a verified check. Photo items use the evidence images (doorstep, handoff, booth).

### 6. Student · Trail — Card Book (Almanac)
Tabs: Evidence / **Cards**. A stack of `WisdomCard`s (4 entries; first favorited). Tapping the star favorites/unfavorites (live).

### 7. Student · HQ — Dashboard
Warm paper. Header (Dev Sharma · Grade 10 · StudyHall, HQ pill). `ProgressMeter` **98 / 125**. Optional **math-gate paused** banner (amber; shown when the family setting is on). "Now" → `HQTaskCard` for **4.5.4** (Live-moment). "Your Path" → five `PhaseRow`s (SELL/BUILD/VALIDATE sealed with dates, GROW active 23/25, SCALE locked).

### 8. Student · HQ — Current Task (Stage Moment)
Spec sheet for **4.5.4 Present and take the hard questions** — mono id + **Live moment** badge, title, body, highlighted Done-when, band variant (G9–12), a **Safety** note, an evidence checklist (video required / board pack attached), a **Run Readiness Check** button that expands the AI advisory panel, and a "Submit for review — notify Mum" button.

### 9. Student · HQ — Trophy Wall
"Phase seals · 3 of 5" → five `Seal`s (3 sealed + dates, GROW "in review", SCALE locked). "Criterion crests · 19 of 25" → per-phase rows of `Crest`s (earned in phase color, locked as faint silhouettes).

### 10. Student · HQ — Founder File (vault)
Header + **Export** button. Filter chips (All / Sell / Build / Validate / Grow) that **live-filter** the list. Rows: type-icon tile (photo items show a thumbnail), label, mono `id · date`, verified stamp.

### 11. Student · HQ — Almanac
A column of `MarginNote` pull-quotes (same entries the Trail files as cards).

### 12. Parent · Review Queue
Header ("Review · Okafor family · Dad", real-time dot). A confirmation toast after acting. "This week" digest strip. "Waiting for you · 2" → cards (child initial in a phase-colored circle, mono id, child · time, evidence count, `submitted` chip, **Review** button). Tapping Review opens `ReviewPanel` inline with **Verify** / **Not yet — add a note**; deciding returns to the list with the toast. A faint "Verified earlier today" row.

### 13. Parent · Family Dashboard
"Okafor family." Dark **digest** card (6 verified · 2 awaiting you · Demo Session Jul 26). "Your founders · 2" → per-child cards (initial, name, band·skin, `n/125`, phase + criterion, a five-segment criteria bar, "N awaiting your review" + Open). A settings strip (Notifications: Real-time / Math gate: Off / Evidence: Private).

### 14. Guide · Cohort Board (desktop)
Header (Ms. Adeyemi · Saturday Cohort · 24 students · "2 awaiting your countersign"). A table: Student (avatar+name) / Band / **Journey** (five-segment phase bar) / Now (criterion) / Status. Status is a colored pill (On track / Parent review / Criterion review / Stalled) or a **Countersign** button for phase reviews awaiting the Guide. Footer: "You see position and review status — never evidence unless a phase review needs your countersign."

### 15. Guide · Countersign (desktop)
Phase-04 GROW review for Dev. Green header. **Signature 1 · Parent** (Mum attested, dated, green check). "The five criteria you're attesting" (4.1–4.5, each with its headline stat + check). **Signature 2 · Guide — pending** with **Countersign & seal Phase 04**; on sign → "Sealed — both signatures in. Dev's Tier 3 celebration is firing now."

### 16. Celebrations (four tiers)
Tab switcher:
- **Tier 1 · Task** — compact stamp card ("Task verified · 1.2.4", verifier quote, "8 → 9 verified · the meter ticks", "Never a modal, never interrupts flow").
- **Tier 2 · Criterion** — large `Crest` reveal (1.5), three real stats (25 outreach / 9 conversations / 2 yeses), "Criterion Recap written to the Founder File · family share card generated".
- **Tier 3 · Phase** — `PhaseSealCelebration` (the emotional benchmark) with a Trail/HQ skin toggle.
- **Tier 4 · The Path** — grand gold panel: SCALE seal, "A year, sealed five times over", four totals ($412 / 63 customers / 47 no's / 25 crests), "a physical seal & letter from The 120 ships home".

### 17. AI Documents (desktop)
Doc tabs → a "paper" document page. **Criterion Recap** (Maya 1.2), **Phase Chronicle** (Maya, SELL), **Founder Portfolio** (Dev — the completion credential, with an evidence gallery). Framed "Generated from verified evidence only — never a grade, never the student's own writing passed off."

### 18. States & Systems (desktop reference)
- **Task state machine** — the six `StatusChip`s in flow (locked → available → in_progress → submitted → verified) with the `not_yet` loop and the append-only rule.
- **Not Yet** in both skins (Trail gentle flag + kind note / HQ amber chip + reviewer note; "a task is never failed, only not done *yet*").
- **Reviews underway** — criterion + phase banners (phase banner shows the Guide countersign line when cohort-linked, else "seals on the parent's signature alone").
- **Math gate · paused** card, and **Field Guides** shelf.
- **Notifications** table (Event × Student / Parent / Guide) — real-time is the default.

---

## Interactions & Behavior
- **Core loop state machine** (task scale): `available → in_progress → submitted → (reviewing) → verified`, with `not_yet` looping back to `in_progress` (evidence intact). Verify ticks the meter, stamps the step (Trail) / flips the chip (HQ), surfaces the **verifier comment**, and flutters a contextual **WisdomCard**. Not-Yet requires a note and never uses red/error iconography.
- **Skin toggle** — swaps the student surface between Trail and HQ (paired scenes). Affects only the student view.
- **View (device) toggle** — Phone ↔ Desktop for Student & Parent. Desktop = in-app left sidebar (role nav) + sticky top bar + centered content. **Responsive:** implemented with CSS **container queries** — under ~720px the sidebar collapses to a horizontal scrollable rail and the content goes full-width, so the desktop view is usable on a mobile browser.
- **Readiness Check** (HQ task) — student-invoked; reads evidence against the Done-when line and returns "looks complete" or what's missing. **Advisory only — never verifies, blocks, or grades.**
- **Vault filter** — live phase filter on the Founder File.
- **Countersign** — signs → phase seals → triggers the student's Tier-3.
- **Onboarding** — band selection sets the default skin (changeable).
- **Motion** — proportional to achievement; the signature is the wax-stamp thump (spring overshoot). Honor `prefers-reduced-motion`.

## State Management
Prototype-level UI state: `scene`, `device` (phone/desktop), `skin` (per student, paired-scene navigation), loop phase, `readiness`, `vaultFilter`, `countersigned`, onboarding step/band/skin, wisdom/card favorites.

**Production data model** (authoritative — see the app brief §10, reproduced in `briefs/`): `Family, User, StudentProfile, Cohort, ProgramVersion, Phase, Criterion, UnitTask, TaskProgress, EvidenceItem, Review, Award, WisdomEntry, AlmanacEntry, GeneratedDoc, PathEvent, Notification`. The **125 tasks are content, not code** — load from a versioned content package (per-phase totals **25/26/24/25/25 = 125**). Task state rules, concurrency (tasks sequential within a criterion, criteria parallel within a phase, phases strictly sequential), and the criterion/phase review flows are specified in app brief §9.

## Design Tokens
From the bound design system (`_ds/…/tokens/`). Stored as HSL channels so any token can take an alpha via `hsl(var(--x) / a)`.

**Phase spine (constant across skins):** sell `14 78% 54%` · build `217 74% 56%` · validate `265 52% 58%` · grow `150 52% 42%` · scale `41 88% 52%`.
**Verification semantics:** verified `150 52% 40%` · awaiting `217 60% 56%` · not-yet (amber) `36 92% 48%`. **Ceremony:** wax `4 62% 46%` · gold-leaf `41 74% 50%`.
**HQ neutrals (ink on warm paper):** canvas `0 0% 100%` · surface `40 30% 99%` · surface-sunken `40 24% 96%` · border `40 14% 89%` · border-strong `40 10% 80%` · ink `30 12% 12%` · ink-soft `30 8% 34%` · ink-muted `30 6% 52%`.
**Trail neutrals (ink on parchment):** canvas `38 46% 95%` · surface `40 55% 97%` · ink `25 34% 20%` · ink-soft `25 20% 38%` · mist `34 20% 82%`.
**Type:** Fraunces (display/celebration/numerals, tracking -0.02em), Inter (all UI/body), Spline Sans Mono (task ids, tallies, dates, the n/125 meter). Scale 11→48px; eyebrows uppercase, tracking 0.08–0.14em. Weights 400/500/600/700.
**Radius:** 6 (chips) · 8 (buttons) · 12 (cards) · 16 (panels) · 20 (Trail cards/celebration) · full (pills/meters/seals).
**Shadows (warm-tinted, never neutral):** HQ rest `0 1px 2px rgba(30,24,16,.04), 0 1px 3px rgba(30,24,16,.06)`; HQ raised `0 4px 12px …/.06, 0 12px 32px …/.08`; Trail paper-lift `0 2px 0 rgba(120,80,40,.12), 0 8px 24px rgba(120,80,40,.14)`.
**Motion:** durations 140 / 220 / 400 / 700ms; ease-out `cubic-bezier(.22,1,.36,1)`, ease-spring `cubic-bezier(.34,1.56,.64,1)`. Keyframes: stamp-thump, shimmer (under-review), flutter-in (wisdom), slide-in (margin note), wax-press (seal), rise-in, pulse (current step). Full values in `_ds/…/tokens/{colors,typography,layout,motion}.css`.

## Assets
In `assets/` (from the design system):
- `logo.svg` — the five-step mark (one step per phase, recolored to the phase accents). `logo-lockup.svg` — mark + wordmark.
- `evidence/` — four documentary photographs (`booth.jpg`, `doorstep.jpg`, `handoff.jpg`, `product.jpg`) used for evidence thumbnails and the Tier-3 montage. In production these are the student's *own* filed evidence.
- Icons are **Lucide** (2px stroke) via the `Icon` component.
- Fonts load from Google Fonts (Fraunces, Inter, Spline Sans Mono) — the real brand fonts.

## Files
- `The Path.dc.html` — the full interactive prototype (all 18 surfaces, both skins, phone + desktop, wired loop & review). This is the primary reference.
- `assets/` — logo + evidence photography referenced by the design.
- `briefs/the-path-app-design-brief.md` — the product brief: two-skin system, states, celebration tiers, roles, data model (§10), engine rules (§9), AI layer (§12), notifications (§13). **Source of truth for behavior.**
- `briefs/the-path-home-study-curriculum-brief.md` — the 5 phases, 25 criteria, all 125 tasks with band variants and Done-when lines. **Source of truth for content.**
- The bound design system lives in the project at `_ds/the-path-design-system-05a7ecff-cb52-428c-a104-274101333e3a/` (compiled bundle `_ds_bundle.js` + `tokens/*.css` + `base.css` + `components.css`). Rebuild the components listed above from these tokens.

## Caveats
- **Trail world art is a schematic placeholder** built from CSS/SVG. The brief specifies a commissioned illustrated journey game (world + customizable avatar) — final art replaces the map/landmark/motif visuals.
- **Crests are one parametric heraldic template** (color + numeral per criterion), not 25 bespoke illustrations — the brief calls for 25 distinct crests (e.g. 1.3 built from three "no" marks) as a content task.
- Sample names, numbers, and evidence are illustrative personas (Maya, Dev, Okafor family, Ms. Adeyemi's cohort).
