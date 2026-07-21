---
date: 2026-07-21
topic: the-path-app-design-brief
status: draft for review
source-of-truth: artifacts/the-path-home-study-curriculum-brief.md (the 125 unit tasks); artifacts/Design & Marketing/2026-27 Page Handoff/design_handoff_2026-27_program_page/program-data.js (pathSteps — the 25 pass criteria)
audience: Claude Design (first pass — visual system, screens, both skins), then Claude Code CLI (build)
---

# The Path — App Design Brief

**One app. Two skins. 125 real things done in the real world, verified by a real adult, celebrated like they matter.**

The Path is the progress engine for The 120's entrepreneurship curriculum: five phases (Sell → Build → Validate → Grow → Scale), 25 pass criteria, 125 unit tasks. The app does not contain the curriculum's work — the work happens at booths, on doorsteps, in board meetings, and on stage. The app is where the journey is *seen*: where a student tracks the steps of each task, files the evidence that proves it happened, gets it verified by an adult, collects wisdom along the way, and gets celebrated — in proportion to what was actually achieved — when a criterion or a phase falls.

The Path is its own app with its own feel. It is not The Gauntlet (The 120's fast-math game) and should not borrow its boss-battle register. Eventually both live as tiles on a shared 120 dashboard; The Path must stand alone until then.

## Decisions Log

These decisions were made with Peter on 2026-07-21 and are binding for this version of the brief. Downstream tools (Claude Design, Claude Code) should treat them as settled, not as options.

| # | Decision |
|---|---|
| D1 | One app serves both contexts: home-study families and the Saturday cohort. The verifier is a **role** (parent at home, parent + Guide in cohort), not a hardcoded person. |
| D2 | Hybrid presentation: **mechanics are constant, skin and copy register switch**. Two skins — **Trail** (full illustrated journey game) and **HQ** (grounded founder dashboard). A toggle, defaulted by age band, lets any student use either. Both skins are fully specified in this brief. |
| D3 | The skin toggle affects **only the student's view**. Parents and Guides always see the grounded review/dashboard interface. |
| D4 | Everything earned carries across the toggle: same badge, same progress, two renderings. Flipping the toggle at any age loses nothing. |
| D5 | Third-party verification is **always required, for every band**. A student never self-marks a task complete. |
| D6 | Cohort flow: parents verify weekday tasks; the **Guide countersigns** phase completions. |
| D7 | After the last task of a criterion or phase is verified, a formal **Review** runs before completion is granted. The student is told "your review is underway." Reviews carry report-card gravity; the celebration fires when the review clears. |
| D8 | Evidence storage: **native in-app storage by default, links allowed for big files**. |
| D9 | The **AI layer is a v1 feature**: when criteria and phases clear review, the app builds summary documents of the student's journey as part of the win. |
| D10 | Wisdom: a **mix** of real quotes from real founders/investors and original lines in The 120's voice; **contextual** (keyed to where the student is on The Path) with a light ambient layer; **collectible** into the student's Founder File. |
| D11 | This document is **one brief with a vision front half and a build-spec back half**, in markdown, handed to Claude Design first and then Claude Code CLI. |
| D12 | Notifications: real-time and weekly digest both exist; **real-time is the default** — kids will want a parent to look and check off right away. |
| D13 | The curriculum brief's open items (reading tracks, math gate, kid-voice register, Demo Session cadence) are **folded into this brief** where relevant. |
| D14 | **Multi-sibling family accounts from day one.** |

---

# PART ONE — VISION & EXPERIENCE

## 1. What The Path Is

A student opens The Path and sees exactly one thing clearly: **where they are, and what the next step is.** Behind that simplicity sits the full structure — 5 phases, each holding 5 criteria, each criterion holding 4–6 sequential unit tasks, every task ending in a binary *Done when* line that a real adult answers yes or no.

The app's job, in order of importance:

1. **Show the next step** and the steps behind it — the student should never wonder what to do next.
2. **Hold the evidence standard** — every task states what evidence proves it, and captures that evidence into the digital Founder File.
3. **Route verification to the right adult** — parent or Guide — fast, so momentum survives.
4. **Celebrate in proportion** — small for a task, meaningful for a criterion, big for a phase, enormous for The Path itself.
5. **Teach in the margins** — contextual doses of entrepreneurial and financial wisdom, collected as the student goes.
6. **Remember everything** — so that at every criterion and phase completion, the AI layer can hand the student a document that says: *look what you did.*

## 2. Design Principles

**The game is the real business; the app keeps score.** Nothing in the app is a simulation. Every point of progress maps to something that happened in the world — a stranger said yes, money changed hands, a product went live. The app must never invent progress the world didn't produce. This is why there is no XP economy, no daily-login rewards, no inflationary points: the only score that exists is verified tasks (out of 125), criteria (out of 25), and phases (out of 5). Those numbers are the credential, identical across ages — a Grade 3 completion means the same as a Grade 12 completion.

**No partial credit, warmly delivered.** The curriculum's rule — "if you're debating whether it's done, the answer is no" — is the app's rule. But the app's *tone* for an unverified task is never failure. The state is called **Not Yet**, and every Not Yet carries a reviewer note pointing at the *Done when* line. The task isn't failed; it isn't done *yet*.

**Verification is sacred and slightly ceremonial.** The moment an adult verifies a task should feel like a stamp, not a checkbox. Criterion and phase reviews are deliberately weightier — a report card being written, not a form being filled.

**Delight scales down in age and up in achievement.** An 8-year-old on the Trail gets full storybook delight for every step. A 16-year-old in HQ gets restraint — until a phase clears, when the app is allowed to be enormous for everyone.

**Mastery pace, no calendar shame.** The Path is paced by mastery, not weeks. The app never compares students to each other (no cross-student leaderboards, ever) and never punishes slow weeks. Momentum nudges exist but are tied to the family's own chosen rhythm, not an absolute clock.

**The adult is a verifier, never a doer.** Parent and Guide interfaces are built for checking evidence against a line of text and answering yes/no — not for editing the student's work. The interface should make rescuing harder than verifying.

## 3. The Core Loop

The loop runs at three nested scales.

**Task loop (hours to days).**
1. The student opens the current task. They see: the task title and body, the *Done when* line, their band's variant, and the evidence this task requires.
2. They go do the thing — in the world, not the app.
3. They capture evidence (photo, video, log, link, document) into the task — from a phone, in the moment, wherever the work happened.
4. Optionally, they run the **Readiness Check** — the AI reads the evidence against the *Done when* line and tells them whether anything looks missing. It never blocks and never verifies; it just reduces avoidable Not Yets.
5. They submit. The verifier gets a real-time notification.
6. The verifier opens the review screen: evidence on one side, the *Done when* line on the other. They tap **Verified** or **Not Yet** (Not Yet requires a short note).
7. Verified → stamp moment, progress advances, the next task unlocks, and — where the context map says so — a wisdom card appears.

**Criterion loop (weeks).** When the last task of a criterion is verified, the criterion enters **Review Underway**. The student is told, in their skin's register, that something important is happening. The verifier conducts the Criterion Review (Section 9 of Part Two): a guided pass over all the criterion's evidence with a single question — does this body of work honestly clear the published pass criterion? On clearing: the criterion's **Crest** is awarded, the AI builds the **Criterion Recap**, and the medium celebration fires.

**Phase loop (months).** When the fifth criterion of a phase clears, the phase enters **Review Underway** — the report-card moment. At home, the parent conducts it; in the cohort, the parent conducts it and the **Guide countersigns**. On clearing: the phase **Seal** is awarded, the AI builds the **Phase Chronicle**, the big celebration fires, and the app does one unusual thing — it prompts a real-world celebration ("Phase 01 is sealed. This deserves a dinner."). The next phase's gate opens.

Completing Phase 05 completes The Path: the AI assembles the full **Founder Portfolio** from the entire Founder File, and the app's largest moment plays.

## 4. The Two Skins

One engine, two renderings. The skin changes pixels and words — never mechanics, never the bar, never what's stored. Proposed names (Peter may rename): **Trail** and **HQ**.

**Defaults by band, freely changeable:** Grades 3–5 default to Trail; Grades 6–8 and 9–12 default to HQ. The toggle lives in the student's settings and can be flipped at any time, by the student, with no data consequences (D4). A 7-year-old who wants to feel grown-up flips to HQ; a 13-year-old who loves the map keeps the Trail. Parents can see which skin is active but the choice is the student's.

### 4.1 Trail — the journey game

**The metaphor.** The Path is a literal illustrated overland journey through five territories, traveled bottom-to-top or left-to-right: **Sell** (a market town — stalls, doorsteps, handshakes), **Build** (a workshop quarter — scaffolds, machines, glowing screens), **Validate** (an observatory and testing fields — telescopes, weather vanes, experiment tents), **Grow** (farmland and a growing high street — ledgers, delivery routes), **Scale** (a summit city — bridges, aqueducts, systems humming without their maker). Each territory contains five **landmarks** (the criteria); each landmark is reached by a short trail of 4–6 **steps** (the unit tasks). The student's avatar — a simple, customizable founder character — stands on the current step.

**Key renderings.**
- A step not yet available is mist. The current step glows. A verified step gets a wax-stamp footprint.
- Submitting evidence = placing a satchel on the step. While the verifier reviews, the satchel has a gentle "being inspected" shimmer.
- A criterion **Crest** is an illustrated heraldic badge unique to that criterion (25 distinct crests — e.g., 1.3's crest is built around three graceful "no" marks turned into a banner). Crests mount on the landmark and in the student's satchel.
- A phase **Seal** is a large wax seal on an illustrated gate between territories. Phase Review Underway renders as the gatekeeper examining the student's satchel — visibly, importantly.
- **Stage Moments** — the criteria that end on a live audience (2.5 demo, 3.4 solo presentation, 4.5 board meeting, 5.5 showcase) — render as special landmark types: a stage, a courtroom-like boardroom, a lit amphitheater. These are the Trail's "boss" landmarks, but the register is theatrical, not combative.
- Wisdom arrives as **Wisdom Cards** — illustrated collectible cards that flutter down at contextual moments and file themselves into the satchel's card book.
- The Founder File renders as the **satchel**: open it and every piece of evidence is a labeled item on shelves, organized by territory and landmark.

**Trail copy register** (the `pathStepsKid` voice — same tasks, kid words): direct address, short sentences, verbs first, real respect. Never babyish, never sarcastic. Examples in Section 5.3.

### 4.2 HQ — the founder dashboard

**The metaphor.** The student runs a real company, and this is its headquarters screen — the clean, confident dashboard a young founder would proudly open in front of an adult. Closer to Linear/Notion/Stripe in sensibility than to any game: generous whitespace, one accent color per phase, numbers treated with respect.

**Key renderings.**
- Home is a **progress ledger**: The Path as five phase rows, each showing criteria as five segments, with a single prominent "Now" card for the current task. A subtle overall meter: `37 / 125 verified`.
- The current task view is a spec sheet: task body, *Done when* line highlighted, band variant, evidence checklist, submit button. Evidence review status shows as a quiet status chip: `Submitted — awaiting review`, `In review`, `Verified`, `Not yet (see note)`.
- Crests render as clean monochrome **achievement marks** in a trophy wall grid; Seals as five larger marks with completion dates — same artwork lineage as Trail's crests (one design system, two finishes), so nothing feels lost when toggling.
- Reviews Underway render as a formal banner: `Phase 01 · SELL — review in progress. Reviewer: Dad. Countersign: Guide (pending).`
- Wisdom arrives as **margin notes** — typographically beautiful pull-quotes that slide in contextually — and collects into the **Almanac** (Section 6).
- The Founder File renders as a real document vault: filterable by phase/criterion/type, every item showing its task ID, date, and verification stamp.

**HQ copy register:** the curriculum brief's own voice — plain, confident, no cheerleading, quiet warmth. A founder being spoken to as a founder.

### 4.3 One system, two renderings — the mapping table

| Mechanic (constant) | Trail rendering | HQ rendering |
|---|---|---|
| Phase | Territory | Phase row / section |
| Criterion | Landmark | Criterion card |
| Unit task | Step on the trail | Task spec card |
| Task verified | Wax-stamp footprint + chime | Status chip flips to Verified |
| Evidence submitted | Satchel on the step, shimmering | `Awaiting review` chip |
| Not Yet | Gentle "not yet" flag + note | `Not yet` chip + reviewer note |
| Criterion complete | Crest mounted on landmark, confetti | Achievement mark added, recap delivered |
| Phase review underway | Gatekeeper inspects the satchel | Formal review banner |
| Phase complete | Wax seal, gate opens, next territory revealed | Phase row closes with seal mark; chronicle delivered |
| Wisdom | Collectible illustrated card → card book | Margin note → Almanac |
| Founder File | The satchel | Document vault |
| Stage Moments | Lit stage / boardroom landmarks | Flagged as `Live moment` tasks |
| Overall progress | Distance traveled on the map | `n / 125` meter |

## 5. Celebration Design

Celebration is the emotional core of the app and must be engineered as carefully as verification. The rule: **intensity is proportional to the reality of the achievement**, and the biggest moments belong to both skins equally.

### 5.1 The four tiers

**Tier 1 — Task verified (125 times).** Two to four seconds. Trail: the stamp thumps down, the avatar takes a step, a short chime. HQ: the chip flips, the meter ticks, a single satisfying motion. Never a modal, never interrupts flow. If the verification came with a verifier comment ("The pitch video was fantastic"), it displays here — adult words are the best reward in the system.

**Tier 2 — Criterion cleared (25 times).** Fifteen to thirty seconds, skippable. The Crest is revealed (full-screen), the criterion's headline stat is shown in real numbers ("25 outreach attempts. 9 conversations. 2 yeses."), and the **Criterion Recap** (Section 11) arrives in the Founder File. Trail adds confetti and the landmark lighting up on the map; HQ adds a restrained but unmistakable achievement panel. A **share card** — a clean image of the crest + stat — is generated for the family (and only the family; nothing is public, Section 12).

**Tier 3 — Phase sealed (5 times).** The big one. A full-screen sequence both skins share in structure: (1) the review clearing — the Seal pressed / the countersignature landing; (2) a montage of the phase's own evidence — actual photos and clips from the Founder File, which the app has been quietly collecting all along; (3) the numbers that phase produced; (4) the **Phase Chronicle** delivered; (5) the gate to the next phase opening. Then the real-world prompt: the app suggests the family celebrate offline, and offers to schedule it. Trail plays this cinematic and orchestral; HQ plays it like the closing of a funding round — but neither skin is allowed to underplay it.

**Tier 4 — The Path complete (once).** Reserved, maximal, and partly physical. The full journey replays as a map flythrough (Trail) or an annual-report reveal (HQ) built from a year of real evidence. The **Founder Portfolio** is assembled and delivered. The app generates a printable certificate and — recommendation — triggers a real-world artifact from The 120 (a physical seal, a letter). The final page of the curriculum ("What I can do now that I couldn't do a year ago") is written by the student *in the app* as the last act, and closes the portfolio.

### 5.2 The Not Yet moment

Anti-celebration design matters as much. A Not Yet must land as information, not judgment: the reviewer's note is shown next to the *Done when* line, the task returns to in-progress (never to locked), and the copy in both registers carries the curriculum's line: *not done — yet.* No red, no error iconography, no streak broken. Trail: the gatekeeper hands the satchel back with a kind note. HQ: a neutral amber chip and the note.

### 5.3 Copy register examples (same moments, both voices)

| Moment | Trail (kid register) | HQ (founder register) |
|---|---|---|
| Task available | "New step! Time to write your one-liner: what are you selling, and why will someone love it?" | "Next: 1.1.1 — Pick the product and the one-liner." |
| Evidence submitted | "Your satchel's in! Dad is taking a look." | "1.1.3 submitted. Awaiting review — Dad notified." |
| Verified | "Stamped! Two more steps to the landmark." | "1.1.3 verified. 2 tasks remaining in criterion 1.1." |
| Not Yet | "Not yet — and that's okay. The video needs three clean runs in a row. Go get 'em." | "Not yet. Reviewer note: needs three consecutive clean runs. Resubmit when ready." |
| Criterion review underway | "Big moment — Mum is looking at EVERYTHING you did for this landmark. Fingers crossed…" | "Criterion 1.2 review underway. All five tasks and evidence under review." |
| Phase review underway | "The gatekeeper has your satchel. Your whole SELL journey is being reviewed. This is a big deal." | "Phase 01 · SELL — review in progress. Reviewer: Mum. Guide countersign pending." |
| Phase sealed | "THE GATE IS OPEN. You finished SELL. You sold real things to real people. Go celebrate — you earned it." | "Phase 01 sealed. Real sales, real money, real no's. The Build phase is open." |
| Wisdom card | "A wisdom card! Sara Blakely's dad asked her every week: 'What did you fail at?' Your no's are your answer. Keep it in your book." | "'Price is what you pay. Value is what you get.' — Warren Buffett. Saved to your Almanac." |

Every task in the content database carries both registers (Section 10) — the standard text from the curriculum brief, and a kid-register text following the program page's `pathStepsKid` pattern. This resolves the curriculum brief's open item on a kid-voice edition: it ships as the Trail register.

## 6. The Wisdom System — "The Almanac"

Small doses of entrepreneurial and financial wisdom, sprinkled where they mean something, collected forever.

**Content.** A curated deck of 150–250 **wisdom entries**, each tagged to the criteria and tasks where it lands hardest. Two source types, mixed (D10): **real quotes** with real attribution (founders, investors, operators — vetted for age-appropriateness and accuracy), and **120 originals** — lines written in The 120's voice that teach what famous quotes rarely do cleanly: unit economics, margin, compounding, the funnel, why the pass bar is set before the test. Every entry carries both copy registers; a 3–5 rendering may simplify wording but never the idea.

**Delivery — contextual first (D10).** The primary trigger is position on The Path: rejection wisdom during the No Log (1.3), pricing wisdom entering the pricing experiment (3.2), delegation wisdom at 5.2, "systems over hustle" at 5.3. Rules: at most one contextual card per task; the card arrives *after* a meaningful moment (task verified, criterion opened), never as a gate before work; a small ambient pool surfaces occasionally on the home screen for variety. Wisdom never interrupts evidence capture or review.

**Collection (D10).** Every encountered entry files automatically into the student's **Almanac** (Trail: the card book in the satchel) — a commonplace book that belongs to the Founder File and exports with it. Students can favorite entries and add a one-line note ("this happened to me at the market").

**The quote-back.** The AI recaps close the loop: when a criterion clears, the Recap may cite an Almanac entry against the student's own evidence — *"In week 2 you collected 'price is what you pay, value is what you get.' Then your two customer groups proved it: the market strangers paid $8 without blinking."* This is the feature's whole point: wisdom stops being decoration and becomes curriculum.

## 7. People and Their Journeys

### 7.1 The Student (age 8–17)

Owns their Path, their Founder File, their Almanac, their skin choice. Sees: current task, full map/ledger, evidence tools, collections, celebration history. Cannot: verify anything, edit evidence after verification, see siblings' evidence (progress yes — Section 7.2 — evidence no).

### 7.2 The Parent

Always sees the grounded interface (D3), whatever their child sees. The parent app is built around the **Review Queue**: submissions land in real time (D12), each opening to a split view — evidence against the *Done when* line, with the band variant shown so the parent holds the right bar. One tap Verified; Not Yet requires the note. Beyond the queue: a per-child progress view, the multi-sibling family dashboard (each child's phase/criterion position at a glance — D14), Demo Session scheduling, and settings (notifications, math gate, storage). The parent interface enforces role discipline gently: it shows *what to check*, never offers tools to fix the work. Siblings see each other's map position and public wins (crests, seals) — celebration is a family sport — but never each other's evidence.

### 7.3 The Guide (cohort context)

A Guide sees a **cohort dashboard**: every student's position on The Path, review statuses, and phase-review countersign requests. Weekday task verification stays with parents (D6); the Guide's formal power is the **countersign** on phase reviews — the report card's second signature — plus visibility to intervene with coaching where a student is stalled. Guide notifications default to a daily digest (configurable) rather than real-time, to keep a 24-student cohort livable. Home-study families simply have no Guide linked; the countersign line doesn't render.

### 7.4 A day in the life (home-study, Grade 4, Trail)

Saturday morning. Maya's on task 1.2.4 — *Ask until one yes.* At the neighbors' door, with Dad beside her, she makes the ask. A yes! Back home, Dad's phone has already buzzed: Maya photographed the toonie and the sale log into the satchel from the doorstep. Dad opens the review — the *Done when* line says *money from a non-family customer is in hand and the sale is logged* — checks the log has who/what/amount/date, and stamps it. Maya's tablet thumps the wax stamp; her avatar steps forward; a wisdom card flutters down. One step remains to the landmark, and she already knows exactly what it is: deliver, thank, and log.

### 7.5 A day in the life (cohort, Grade 10, HQ)

Dev is closing criterion 4.5. The board meeting ran Thursday; the video, board pack, and memo are all in the vault. His mother verifies 4.5.5 Friday night — that was the criterion's last task, so 4.5 flips to review underway, and because it's also the phase's last criterion, Phase 04 queues behind it. His mum works through the criterion review Saturday, then the phase review — the app walks her through each criterion's evidence with the published pass criteria as the checklist. She signs. The banner updates: `Countersign: pending — Guide notified.` Sunday evening the Guide, who watched the board-meeting video from the cohort dashboard, countersigns. Dev's phone goes off: Phase 04 · GROW — sealed. The montage is his own P&L screenshots, the booth photos, eleven sales. The Chronicle lands in his vault. The app asks when the family wants to celebrate, and one more thing renders quietly at the bottom: *Phase 05 · SCALE is open.*

---

# PART TWO — BUILD SPEC

*For Claude Design: Part Two constrains the screens you design — read it for structure, states, and roles. For Claude Code: this is the implementation contract. Where Part Two and Part One conflict, Part Two wins on behavior, Part One wins on tone.*

## 8. Platform & Architecture Posture

**Recommendation: a mobile-first responsive web app (PWA).** Evidence capture is the make-or-break interaction and it happens in the field — booths, doorsteps, living-room stages — so the student and parent experiences must be excellent on phones, including direct camera/video capture into a task. Review works on phone; the AI documents read best on tablet/desktop. Installable PWA gets home-screen presence and push notifications without app-store friction for v1; nothing in this brief precludes native wrappers later. Offline capture (queue evidence locally, sync later) is strongly recommended for v1 given field use — flagged as an open question only for scope, not desirability (Section 16).

**Content vs. engine.** The 125 tasks are *content*, not code. They load from a versioned content package generated from the curriculum brief markdown and `program-data.js` (pathSteps for standard copy, `pathStepsKid` pattern for the Trail register). The engine must not hardcode structure: criteria hold **4–6 tasks** (Build has 26 tasks, Validate 24 — the totals are 25/26/24/25/25 = 125), and future program years may revise content without schema change (hence `ProgramVersion`).

## 9. The Progress Engine — States & Rules

### 9.1 Task state machine

```
locked → available → in_progress → submitted → verified
                          ↑            ↓
                          └──── not_yet┘        (loops until verified)
```

- `locked`: predecessor task in the criterion not yet verified. Tasks within a criterion are strictly sequential.
- `available`: visible in full (body, done-when, band variant, evidence spec). Opening it or adding evidence moves it to `in_progress`.
- `submitted`: student has attached evidence and pressed submit. Evidence locks for editing while under review (student may withdraw to add more before the review is opened).
- `not_yet`: verifier declined; requires `reviewNote`. Returns to `in_progress` with all evidence intact.
- `verified`: verifier confirmed against the done-when line. Records `verifiedBy`, `verifiedAt`, optional `verifierComment`. Evidence becomes immutable (append-only: later additions allowed, deletions not).

### 9.2 Concurrency rules (mirror the curriculum exactly)

- Tasks within a criterion: sequential.
- Criteria within a phase: **parallel** — a student may have open tasks in several criteria of the current phase at once.
- Phases: strictly sequential; Phase N+1's criteria stay `locked` until Phase N's review clears.

### 9.3 Criterion Review

Trigger: the criterion's last task reaches `verified`. The criterion enters `review_underway`; the student is notified in-register (D7). The reviewer (parent in both contexts) gets a guided flow: each task's evidence in sequence, the published pass criterion text at top, and one final question — *does this body of work honestly clear the bar?* Outcomes: `cleared` (crest awarded, Tier 2 celebration, Criterion Recap generated) or `returned` (one or more tasks flipped back to `not_yet` with notes — the honest remedy when a review exposes a soft verification). Target review turnaround is fast — this is a same-evening ceremony, not a bureaucratic gate.

### 9.4 Phase Review

Trigger: the phase's fifth criterion clears. State `review_underway` with report-card weight — the student is explicitly told this is a formal review (D7). The reviewer walks all five criteria (summary view, drill-down available), attests the phase, and signs. **Cohort accounts require a Guide countersign** (D6): the Guide receives the request with full read access to the phase's evidence; the phase does not seal until both signatures land. Home-study accounts seal on the parent's signature alone. Outcomes: `sealed` (Tier 3 celebration, Phase Chronicle, next phase unlocks) or `returned` (named criteria reopen). The Path completes when Phase 05 seals (Tier 4, Founder Portfolio).

### 9.5 Verification integrity

Every verification/signature records actor, timestamp, and role. Verifications can be revoked only by the verifier who made them (with a required note), only until the enclosing criterion review clears — after that, corrections go through the review's `returned` path. This keeps the audit trail honest without making the system feel litigious.

## 10. Data Model

Sketch, not migration files. Names indicative.

```
Family            id, name, settings{mathGate, notificationDefaults, storagePlan}
User              id, familyId?, role: student|parent|guide, name, email?
StudentProfile    userId, band: g3_5|g6_8|g9_12, skin: trail|hq (default from band),
                  cohortId?, guideId?, avatarConfig, startedAt
Cohort            id, name, guideIds[], year

ProgramVersion    id, year, label
Phase             id, programVersionId, seq 1..5, key: sell|build|validate|grow|scale,
                  title, epigraph, accentColor
Criterion         id, phaseId, seq 1..5, passCriterionText, passCriterionKidText,
                  headlineStatSpec, crestAssetRef, isStageMoment: bool
UnitTask          id ("1.1.1"), criterionId, seq, title, body, doneWhen,
                  copyRegisters{standard, kid}, bandVariants{g3_5?, g6_8?, g9_12?},
                  evidenceSpec{requiredTypes[], minCount, notes},
                  wisdomContextTags[], safetyFlags[]

TaskProgress      studentId, taskId, state (§9.1), verifiedBy?, verifiedAt?,
                  verifierComment?, notYetHistory[{note, by, at}]
EvidenceItem      id, taskProgressId, type: photo|video|audio|document|link|logTable|text,
                  storageRef | url, thumbnailRef?, caption, capturedAt, uploadedBy,
                  immutable: bool (set on verify)
Review            id, scope: criterion|phase, scopeId, studentId,
                  state: underway|cleared|returned, reviewerId, openedAt, decidedAt,
                  countersign{required: bool, guideId?, signedAt?}, note?
Award             studentId, kind: crest|seal|path_complete, refId, awardedAt

WisdomEntry       id, text, kidText?, source{kind: real|original, attribution?},
                  contextTags[], phaseAffinity[]
AlmanacEntry      studentId, wisdomEntryId, encounteredAt, contextTaskId,
                  favorited: bool, studentNote?

GeneratedDoc      id, studentId, kind: criterion_recap|phase_chronicle|founder_portfolio,
                  scopeId, contentRef, generatedAt, regeneratedBy?
PathEvent         id, studentId, kind: family_demo_session|board_meeting|capstone_showcase|celebration,
                  scheduledFor, attendees?, linkedTaskIds[], notes
Notification      userId, kind, payload, channel: push|email|digest, sentAt, readAt
```

Notes: `bandVariants` are optional per task (absent = identical across bands, per the curriculum). `headlineStatSpec` tells the recap generator which numbers to surface (e.g., 1.5 → the three funnel numbers). `isStageMoment` marks 2.5 / 3.4 / 4.5 / 5.5 for special rendering and for `PathEvent` linkage. `safetyFlags` carry the curriculum's non-negotiables (parent-present, approval-gate) so the UI can surface them on the task card.

## 11. Evidence Pipeline & the Digital Founder File

**Capture.** From a task, the student (or parent, for younger bands) captures: camera photo/video, audio, file upload, link, free text, or a **log table** — a first-class structured type for the curriculum's many trackers (the 25-attempt tracker, the No Log, the sales ledger, the P&L) with templates shipped per task so the tracker the curriculum describes is one tap away. Every item is stamped with task ID, capture time, and uploader.

**Storage (D8).** Native storage is the default: media uploads to app storage, videos transcoded for in-app playback (review must never require leaving the app). **Links are the sanctioned path for big files** — a long Demo Session video can live in the family's drive, pasted as a link with an auto-fetched thumbnail and a required one-line description. The UI nudges native for anything reviewable in under two minutes. Link rot is handled honestly: links are checked periodically; a dead link on verified evidence flags quietly to the family rather than un-verifying anything.

**The Founder File is the product's soul.** Everything — evidence, recaps, chronicles, the Almanac, awards — lives in one browsable, filterable file per student (satchel/vault per skin). One-click **full export** (organized folders + a manifest) is a launch requirement: the family owns this record, and the curriculum's physical-binder families need the bridge. By the end of Phase 05, the Founder File *is* the completion portfolio.

**Privacy & safety (non-negotiable, all bands).**
- Under-13 accounts are parent-owned; the student operates a child profile under it. 13–17 accounts have full parent visibility.
- Nothing in the app is ever public. Evidence is visible only to: the student, the family's parents, and (cohort) the linked Guide. Share cards render for in-family sharing; any external sharing is a deliberate parent export, not an app feature.
- Siblings see each other's progress and awards, never evidence (D14, §7.2).
- Media is encrypted at rest; deleting a student account deletes the Founder File after export prompt (retention policy to be confirmed with counsel — open question).
- The curriculum's publishing safety rules (no face/full name/school/address without parent sign-off) apply to the *business's* external content; the app reinforces them by flagging tasks with `safetyFlags` and surfacing the rule on the relevant task cards (3.5, 2.3).

## 12. The AI Layer (v1, per D9)

Four capabilities, one hard rule.

**The hard rule: AI never verifies, never grades, never gates.** Every AI output is assistive or celebratory. The yes/no on a task belongs to an adult human; the review belongs to an adult human. No AI output may change a task or review state.

1. **Readiness Check (assistive).** Student-invoked before submitting: the model reads the evidence set against the task's *Done when* line and evidence spec, and returns either "looks complete" or a short list of what seems missing ("the done-when line asks for three consecutive runs — this video shows two"). Advisory only; the student can always submit anyway.
2. **Criterion Recap (celebratory, on review clearing).** A 1–2 page document in the student's register: what the criterion asked, what the student actually did (drawn from the evidence — names, numbers, dates), the headline stat, a quoted moment from the evidence itself, and the Almanac quote-back (§6). Delivered in the Tier 2 celebration; filed to the Founder File.
3. **Phase Chronicle (celebratory, on sealing).** A longer document — the story of the phase across all five criteria, written from the Founder File: the arc, the setbacks (Not Yets and no's are part of the story, told with pride), the numbers, the wisdom that proved true, and a closing section in the student's own materials (their belief ledger, their board memo). The report-card gravitas of the phase review deserves a document worthy of a frame.
4. **Founder Portfolio (once).** The Path-complete document: the whole year, every crest, the real totals (sales, customers, no's, revenue), a curated evidence gallery, and the student's final page as its closing words. Structured to double as the completion credential.

Generation notes: docs are generated from verified evidence only; parents can regenerate once per doc if a generation misfires; generated docs are clearly marked as AI-written summaries *of* the student's work, never presented as the student's own writing.

## 13. Notifications (D12)

Real-time is the default because the loop depends on it: a kid walking home from their first sale wants the stamp *tonight*.

| Event | Student | Parent (verifier) | Guide (cohort) |
|---|---|---|---|
| Evidence submitted | — | **Push, real-time (default)** | — |
| Verified / Not Yet | Push, real-time | — | — |
| Criterion/phase review opened | Push ("review underway") | Push | Phase: countersign request |
| Review cleared / sealed | Push (celebration entry) | Push | Digest |
| Weekly digest | Optional | **On by default** (summary of the week's progress across all children) | **Daily/weekly digest default** |
| Stalled nudge (no activity in family-chosen rhythm) | Gentle, in-register | In digest only | In digest |

All channels configurable per user; the weekly digest for parents doubles as the multi-sibling family summary. Stalled nudges follow §2's no-shame rule — they reference the family's own declared weekly rhythm (the curriculum's "two or three working blocks per week"), never an absolute pace.

## 14. Accounts, Roles & Permissions

- **Family account** (D14): one subscription, N children, ≥1 parent. Each child has an independent Path, Founder File, skin, and band. The parent dashboard is family-wide.
- **Roles:** `student` (do, capture, submit, collect — never verify), `parent` (verify tasks, conduct reviews, manage settings, schedule events, export), `guide` (cohort visibility, countersign phase reviews, coach notes visible to parents).
- **Context is per-student, not per-family:** one sibling may be in the cohort (guideId set → countersigns required) while another is home-study.
- **Band changes** (a birthday, a re-assessment) change the default skin and future tasks' displayed variants; verified history is never re-judged.
- **Skin toggle:** student-controlled, instant, logged (so design can learn what ages actually choose).

## 15. Folded-In Curriculum Open Items (D13)

- **Reading tracks → "Field Guides."** The program's one-book-per-phase-per-band tracks render as an optional shelf on each phase (Trail: a small library wagon at the territory's entrance; HQ: a reading card on the phase row). Marking a book read + one-line takeaway files to the Founder File. Non-blocking: never gates any task, criterion, or phase. Content package carries the book list per phase per band.
- **Math gate.** Shipped as a **family-level setting, off by default** for home-study. When on: the parent attests weekly that math is on track; if attested behind, *new* task submissions pause (in-flight tasks and reviews finish) until a clearing attestation. Cohort accounts may later drive this from Gauntlet data — the engine exposes a `gateStatus` hook so that integration is additive, not structural. Copy is matter-of-fact, never punitive: "Business is paused while math catches up — that's the deal."
- **Kid-voice edition.** Resolved: it ships as the Trail copy register, mandatory for all 125 tasks in the content package (§5.3).
- **Demo Session cadence.** `PathEvent` supports scheduling Family Demo Sessions on any rhythm; the scheduler offers the 1st/3rd-Saturday pattern as a one-tap preset for families who want calendar parity with the cohort.

## 16. Non-Goals (v1) and Open Questions

**Explicit non-goals:** no cross-student leaderboards or comparisons of any kind; no public profiles, feeds, or social layer; no payment processing (the curriculum's money is real-world money); no chat between students; no Gauntlet mechanics or shared currency with the Emporium (a future dashboard-level decision); no AI that verifies, grades, or gates.

**Open questions for Peter:**
1. Trail's illustration identity — commission an original world/character style, and does the avatar become 120 IP that appears elsewhere?
2. Storage economics — native video at family scale has real cost; cap per family with link-overflow, or price a storage tier?
3. Media retention after program completion / account closure — needs a real policy (and possibly counsel) before launch.
4. Offline capture in v1 scope (recommended in §8) — confirm.
5. Do Guides need bulk tools (multi-student review queues, cohort analytics) in v1, or is the countersign + dashboard enough for year one?
6. Should the Tier 4 completion include a physical artifact from The 120 (printed portfolio, wax-sealed letter)? Recommendation: yes.
7. Wisdom deck authorship — who curates/writes the 150–250 entries, and what's the vetting bar for real-quote accuracy?

## 17. Handoff Notes

**To Claude Design (first):** Deliver the visual system for both skins from §4 (they share one design DNA — the crest/seal artwork lineage must survive the toggle, per D4), the parent Review Queue and review ceremonies from §7.2/§9.3–9.4, and the four celebration tiers from §5 — design Tier 3 first; it is the emotional benchmark the rest of the app scales down from. The mapping table (§4.3) is your checklist: every mechanic needs both renderings. Copy registers per §5.3.

**To Claude Code CLI (second):** Part Two is the contract. Build order suggestion: content package + progress engine (§8–9) → evidence pipeline (§11) → verification & review flows with notifications (§9, §13) → celebrations → AI layer (§12) → wisdom (§6) → Field Guides/math gate (§15). The 125 tasks ingest from `artifacts/the-path-home-study-curriculum-brief.md`; the 25 pass criteria and kid register pattern from `program-data.js` (`pathSteps` / `pathStepsKid`). Validate ingestion against the totals: 25/26/24/25/25 tasks per phase, 125 total, 25 criteria, 5 phases.

**The one-sentence test for every future decision:** does this make a real thing a child did in the real world more visible, more verified, or more celebrated? If not, it doesn't belong in The Path.

