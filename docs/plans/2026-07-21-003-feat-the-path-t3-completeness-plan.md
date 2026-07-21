---
title: "feat: The Path T3 — completeness"
type: feat
status: active
date: 2026-07-21
origin: docs/brainstorms/2026-07-21-the-path-app-requirements.md
tier: T3
previous: docs/plans/2026-07-21-002-feat-the-path-t2-the-year-plan.md
---

# feat: The Path T3 — completeness

**Plan 3 of 3.** [T1](2026-07-21-001-feat-the-path-t1-core-loop-plan.md) → [T2](2026-07-21-002-feat-the-path-t2-the-year-plan.md) → **T3**.

## Prerequisite

**T2 must be complete before starting this plan** — with the exception of T2 Units 7 and 8 (the AI layer), which are blocked on the children's-data compliance gate. T3 Unit 3 (Phase Chronicle) and Unit 4 (Founder Portfolio) inherit that same block, since they are the same capability at larger scope.

Carried forward: the full state machine including phase reviews and countersign, both skins with a working toggle, celebrations through Tier 3, push and install, export, and wisdom at the Phase 01 floor.

## Overview

T3 is what The Path owes people who get all the way through it, plus the surfaces that serve the cohort context rather than the home-study one. Nothing here is needed for a family to complete criterion 1.1, or a phase, or most of a year — but the product is not finished without it, and the last unit of it is the moment the whole thing was built for.

By the tiering test: first student contact with these is months to a year out. That is why they are last, not why they are optional.

## Requirements Trace

- **R25** — Guide surfaces: the cohort board and the phase-review countersign UI. Bulk tooling remains explicitly out of scope per **D20**.
- Inherited: **Tier 4 celebration** (brief §5.1), **Phase Chronicle and Founder Portfolio** (§12 capabilities 3 and 4), **Field Guides, the math gate, and Demo Session cadence** (§15). **Event scheduling** is not a numbered requirement in the origin document — it derives from the `PathEvent` entity in the brief's §10 data model, which T1 inherits as a whole. T3 builds the surfaces for it. Noted so it is not mistaken for scope invented here.
- Decisions carried in: **D24** (no self-countersign; co-Guide routing), **D25** (Guide sees cohort evidence at any time), **D20** (no bulk tooling).

## Scope Boundaries

- **No Guide bulk tooling** — no multi-student review queues, no stall detection, no cohort-level reporting. Reverted to the brief's original position per D20: those argue they are easy, not that they are needed. Revisit when a Guide is demonstrably drowning, with observed load as the evidence.
- No cross-student comparison of any kind, in any Guide or family surface. The cohort board shows position and status; it is not a leaderboard and must not be orderable by progress.
- No public sharing, no social layer, no external showcase.
- No AI that verifies, grades, or gates — unchanged.

## Context & Research

T1 and T2 context applies unchanged. Additional considerations specific to this tier:

- **The Guide's read scope is settled** (D25): roster, position, and review status for their cohort always, and evidence for their cohort students at any time. `resolvePathAccess` from T1 Unit 5 already encodes this; T3 builds the surfaces on top rather than widening the model.
- **D24's conflict rule already exists in the T2 engine.** T3 Unit 2 renders it: when a Guide's own child is in their own cohort, the UI must explain the routing rather than silently hiding the countersign button.
- **The math gate has a decided boundary** from T1 planning: it gates at **submit**, never at open, so opening the next task cannot trivially defeat it. T1 Unit 7 exposed a `gateStatus` hook precisely so this is additive.
- **Nothing at zero is designed.** Every one of the 18 handoff surfaces is seeded with a mid-program persona. Day one for a Grade 4 on Trail is `0 / 125`, twenty-five locked crest silhouettes, five locked seals, an empty satchel, and an empty Almanac — a screen of grey, the opposite of what the brief promises. T1 should have caught the core empty states; **anything still rendering a mid-program component with empty props needs fixing here** before the product is called done.
- **The Founder Portfolio is the completion credential.** Its structure determines whether a year of work reads as a credential or as a data dump, and it is the one document a family shows other people.

## Key Technical Decisions

1. **The cohort board is deliberately not sortable by progress.** The brief forbids cross-student comparison "ever", and a table of 24 students ordered by `n/125` is a leaderboard whatever it is called. Sort by name or by attention-needed status only. This is a product constraint expressed in code, and it should be commented as such so a future contributor does not "improve" it.

2. **Tier 4 and the Founder Portfolio ship together.** The completion moment is the document being handed over; splitting them produces a celebration with nothing behind it.

3. **The math gate is a family-level setting, off by default, gating at submit.** In-flight tasks and reviews finish. Copy is matter-of-fact, never punitive. **Silence is not "behind"** — a parent who simply stops attesting persists the last attestation for a 14-day grace window then gets nudged, because a pause must always be a deliberate adult act rather than a consequence of a busy fortnight.

4. **Field Guides never gate anything.** Marking a book read plus a one-line takeaway files to the Founder File and nothing else. And because they are the only unverified content in a file whose whole claim is verification, they must be **visually and structurally distinguished** in the Founder File and the Portfolio, or R6's claim gets muddied in the one place it is being presented as proof.

## Open Questions

### Resolved During Planning

- **Guide sortability** — Decision 1.
- **Math gate silence** — persists the last attestation for 14 days, then nudges (Decision 3).
- **Field Guide provenance** — visually distinguished as unverified (Decision 4).

### Deferred to Implementation

- Whether the cohort board needs pagination at 24 students (probably not) or at a larger future cohort.
- Portfolio layout specifics — best decided against a real completed Founder File, which by definition will not exist until someone finishes.

### Blocked

- ⚠️ **Units 3 and 4 inherit T2's AI-vendor block.** Do not send children's images to any model API until the compliance gate in T1 is answered.

### Still Open Beyond This Plan

- Whether Tier 4 ships a physical artifact from The 120 (a printed portfolio, a wax-sealed letter). The brief recommends yes; it has no engineering dependency beyond a fulfilment trigger, which Unit 4 should expose.
- Commissioned Trail illustration and the 25 bespoke crests. The swappable art references from T1 Unit 10 and T2 Unit 5 mean this remains a content swap, not a rebuild.

## Implementation Units

Seven units. Units 1–2 are independent of 3–7.

- [ ] **Unit 1: Guide cohort board**

**Goal:** A Guide can see where their 24 students are, and where attention is needed.

**Requirements:** R25, D25.

**Dependencies:** T1 Unit 5 (`resolvePathAccess` already encodes the Guide's scope).

**Files:** Create `app/path/(app)/cohort/page.tsx`, `app/path/components/CohortTable.tsx`, `app/path/lib/cohort-rules.ts` (pure). Test: `app/path/lib/__tests__/cohort-rules.test.ts`.

**Approach:**
- Desktop-native surface — this was never the mobile risk.
- Columns: student, band, journey (five-segment phase bar), current criterion, status. Status is a pill (on track / parent review / criterion review / stalled) or a countersign call-to-action.
- **Not sortable by progress** (Decision 1). Comment the constraint in code with a pointer to the brief's rule, so it is not "fixed" later.
- Stall detection here is a *display* status derived from existing timestamps, not the bulk stall-detection tooling D20 excluded — the line is that this reads state the engine already has, and does not build a workflow around it.
- Footer states the access boundary plainly so a Guide knows what families can expect them to see.

**Test scenarios:**
- Happy path: 24 students render with correct phase-bar segments and current criterion.
- Edge case: a student who has not started renders honestly at `0/125`, not as an error or a blank row.
- Edge case: a Guide with students across multiple families sees all of them; a Guide with an empty cohort sees a designed empty state.
- Edge case: stalled status derives from the family's own declared rhythm, never an absolute clock — the no-shame rule.
- Error path: a student outside the cohort never appears, even if a crafted query asks for them.

**Verification:** the board cannot be ordered by progress through any UI affordance.

---

- [ ] **Unit 2: Guide countersign surface**

**Goal:** The second signature, with the conflict rule visible rather than silently hidden.

**Requirements:** R25, D24.

**Dependencies:** Unit 1, T2 Unit 1 (the countersign engine).

**Files:** Create `app/path/(app)/cohort/countersign/[reviewId]/page.tsx`, `app/path/components/CountersignPanel.tsx`. Test: extends `app/path/lib/__tests__/phase-review-rules.test.ts`.

**Approach:**
- Shows signature 1 (parent, attested, dated), the five criteria being attested with their headline stats, and the countersign action.
- **Renders the evidence manifest count and hash from T2 Decision 2** — "attesting to the same 47 items Mum attested to" — so the second signature demonstrably covers the same body of work.
- **Return to parent with a note** is a first-class action beside countersign. A signature that cannot be refused is not a signature.
- **D24 conflict:** where the Guide is also the signing parent, explain the routing — "this review needs a different Guide because you signed it as a parent" — rather than hiding the button and leaving them confused.
- Replaces T2's minimal signed-link page.

**Test scenarios:**
- Happy path: countersigning seals the phase and fires the student's Tier 3.
- Edge case: a manifest hash mismatch blocks the countersign with an explanation.
- Edge case: the conflict case renders the routing explanation, not an empty state.
- Error path: countersigning an already-sealed phase is refused idempotently.
- Error path: a parent-role user reaching this URL is refused.

**Verification:** the D24 conflict path is reachable in a test fixture and renders correctly.

---

- [ ] **Unit 3: Phase Chronicle** ⚠️ *blocked on the T1 AI-vendor gate*

**Goal:** A document worthy of the report-card gravity the phase review carries.

**Requirements:** Brief §12 capability 3.

**Dependencies:** T2 Units 6, 8.

**Files:** Create `app/path/lib/ai/chronicle.ts` (plain), `app/path/lib/ai/chronicle-rules.ts` (pure). Test: `app/path/lib/ai/__tests__/chronicle-rules.test.ts`.

**Approach:**
- The story of the phase across all five criteria, written from the Founder File: the arc, the setbacks — **Not Yets and no's are part of the story, told with pride** — the numbers, the wisdom that proved true, and a closing section drawn from the student's own materials.
- Same guardrails as T2 Unit 8: verified evidence only, clearly marked as an AI summary of the student's work, one regeneration.
- Reuses the frame-sampling and caching architecture; the scope is larger but the shape is identical.

**Test scenarios:**
- Happy path: a Chronicle for Phase 01 cites real events from all five criteria.
- Edge case: a phase containing Not Yets narrates them as part of the arc, not as omissions.
- Error path: generation failure leaves the phase sealed and the celebration intact, with the Chronicle marked pending.

**Verification:** reads truthfully against the underlying evidence for a full completed phase.

---

- [ ] **Unit 4: Founder Portfolio and Tier 4** ⚠️ *blocked on the T1 AI-vendor gate*

**Goal:** The completion credential, and the largest moment in the product. Once per student, ever.

**Requirements:** Brief §5.1 Tier 4, §12 capability 4.

**Dependencies:** Unit 3.

**Files:** Create `app/path/lib/ai/portfolio.ts` (plain), `app/path/lib/ai/portfolio-rules.ts` (pure), `app/path/components/PathCompleteCelebration.tsx`, `app/path/(app)/portfolio/page.tsx`. Test: `app/path/lib/ai/__tests__/portfolio-rules.test.ts`.

**Approach:**
- Ship together (Decision 2). The whole year: every crest, the real totals (sales, customers, no's, revenue), a curated evidence gallery, structured to double as the completion credential.
- **The student writes the final page in the app as the last act** — "what I can do now that I couldn't do a year ago" — and it closes the portfolio. This is the one place the student's own words are the document rather than a summary of it, and it must be visibly theirs.
- Tier 4 replays the journey — map flythrough (Trail) or annual-report reveal (HQ) — built from a year of real evidence.
- Generates a printable certificate and **exposes a fulfilment trigger** for the physical artifact the brief recommends, whether or not that ships.
- **Field Guide entries appear visually distinguished as unverified** (Decision 4). This is the document where R6's claim is on display.

**Test scenarios:**
- Happy path: a completed Path produces a portfolio with all 25 crests and 5 seals and correct real totals.
- Edge case: the student's final page renders as their own writing, typographically distinct from generated sections.
- Edge case: Field Guide entries are distinguishable from verified evidence at a glance.
- Error path: a portfolio requested before Phase 05 seals is refused.
- Error path: generation failure leaves completion intact with the portfolio pending.

**Verification:** a printed portfolio is legible and reads as a credential, not a data dump.

---

- [ ] **Unit 5: Field Guides**

**Goal:** The reading track, filed and never gating.

**Requirements:** Brief §15.

**Dependencies:** T1 Unit 3 (content package carries the book list per phase per band).

**Files:** Create `supabase/migrations/<ts>_path_field_guides.sql`, `app/path/lib/actions/field-guide.ts` (`"use server"`), `app/path/components/FieldGuideShelf.tsx`. Modify `app/path/content/parse-curriculum.ts` (book list ingestion — source is `bookTracks` in the 2026-27 program data). Test: `app/path/lib/__tests__/field-guide-rules.test.ts`.

**Approach:**
- Optional shelf on each phase — a library wagon at the territory entrance (Trail), a reading card on the phase row (HQ).
- Mark read plus a one-line takeaway files to the Founder File.
- **Never gates any task, criterion, or phase.** Verify this by test, not by intent.
- **Visually and structurally distinguished as unverified** wherever it appears (Decision 4).

**Test scenarios:**
- Happy path: marking a book read with a takeaway files an entry to the Founder File.
- Edge case: a phase with no book list for the student's band renders no shelf, not an empty one.
- Error path: no Field Guide state can change any task, criterion, or phase state — assert this against the transition table directly.

**Verification:** the transition table has no edge whose precondition references Field Guide state.

---

- [ ] **Unit 6: Math gate**

**Goal:** Business pauses while math catches up — deliberately, never accidentally.

**Requirements:** Brief §15.

**Dependencies:** T1 Unit 7 (the `gateStatus` hook already exists).

**Files:** Create `supabase/migrations/<ts>_path_math_gate.sql`, `app/path/lib/math-gate-rules.ts` (pure), `app/path/lib/actions/attest-math.ts` (`"use server"`), `app/path/components/MathGateBanner.tsx`. Test: `app/path/lib/__tests__/math-gate-rules.test.ts`.

**Approach:**
- Family-level setting, **off by default** for home-study. When on, the parent attests weekly.
- **Gates at submit, never at open** — otherwise opening the next task moves it to `in_progress` and defeats the gate trivially.
- In-flight tasks and reviews finish; only *new* submissions pause.
- **Silence persists the last attestation for a 14-day grace window, then nudges** (Decision 3). A pause must be a deliberate adult act.
- Show the pause on the next task card, not as a global banner — a permanently-mounted banner reads as punishment.
- Copy is matter-of-fact: "Business is paused while math catches up — that's the deal."
- The `gateStatus` hook is where a future Gauntlet integration would drive this; keep it additive.

**Test scenarios:**
- Happy path: an attested-behind family cannot submit a new task; an attested-on-track family can.
- Edge case: a task already `submitted` when the gate closes completes through verification and its criterion review.
- Edge case: opening a task while gated does not create a submittable in-flight state.
- Edge case: silence at day 13 leaves the last attestation standing; at day 15 it nudges rather than pausing.
- Edge case: a gated student one task short of a crest — confirm the intended behaviour and test it explicitly; this is the case that feels worst.
- Error path: a student attesting their own math is refused.

**Verification:** the gate cannot be defeated by opening tasks.

---

- [ ] **Unit 7: PathEvent scheduling**

**Goal:** Demo Sessions, board meetings, and celebrations get a date.

**Requirements:** The `PathEvent` entity in the brief's §10 data model (inherited by T1), plus §15's Demo Session cadence.

**Dependencies:** T1 Unit 5.

**Files:** Create `supabase/migrations/<ts>_path_events.sql`, `app/path/lib/actions/schedule-event.ts` (`"use server"`), `app/path/components/EventScheduler.tsx`. Test: `app/path/lib/__tests__/event-rules.test.ts`.

**Approach:**
- Supports Family Demo Sessions on any rhythm, with the 1st/3rd-Saturday pattern as a one-tap preset for families wanting calendar parity with the cohort.
- Links to the Stage Moment tasks (2.5, 3.4, 4.5, 5.5) flagged in the content package.
- Feeds the Tier 3 real-world celebration prompt from T2 Unit 6 — "this deserves a dinner" becomes an actual scheduled thing.
- Reminders route through the existing notification transport; no new channel.

**Test scenarios:**
- Happy path: scheduling a Demo Session creates the event and its reminder.
- Edge case: the 1st/3rd-Saturday preset generates correct dates across a month boundary and a year boundary.
- Edge case: an event linked to a Stage Moment task surfaces on that task's card.
- Error path: scheduling in the past is refused.
- Error path: a student scheduling a family event is refused.

**Verification:** a scheduled Demo Session appears on the task card and produces a reminder.

## System-Wide Impact

- **Interaction graph:** the cohort board is the first surface reading across families; the math gate is the first thing that can refuse a submission for a non-state reason; PathEvent is the first scheduled-future entity.
- **Error propagation:** an AI generation failure at Chronicle or Portfolio scope must never affect the seal or the completion — the achievement is the student's, not the document's.
- **State lifecycle risks:** the math gate introduces a refusal path that must not strand an in-flight review; a Guide's cohort membership changing mid-review must not orphan a pending countersign.
- **API surface parity:** none new.
- **Unchanged invariants:** the transition table remains the only source of state truth; Field Guides and the math gate add no edges to it — the gate is a precondition, not a transition; no AI output changes any state.

## Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **AI-vendor compliance gate still open** | Certain until answered | Critical | Units 3 and 4 hard-blocked. Units 1, 2, 5, 6, 7 proceed independently. |
| The cohort board drifts into a leaderboard | Medium | High | Decision 1, enforced by test and by an in-code comment citing the brief's rule. |
| Math gate strands a student one task from a crest | Medium | Medium | Named as an explicit test scenario; decide the behaviour deliberately rather than discovering it. |
| Portfolio design is guessed at before any real completed file exists | High | Medium | Deferred to implementation against a real Founder File; do not over-specify now. |
| Empty states still unfixed from T1 | Medium | Medium | Audit every surface at zero before calling the product done. |

## Documentation / Operational Notes

- The Tier 4 fulfilment trigger needs an operational owner if the physical artifact ships — that is a business process, not a deploy.
- Field Guide book lists come from `bookTracks` in the 2026-27 program data; a new program year needs them re-ingested.
- No new env vars, no new crons beyond what T2 established.

## Next Steps

Implement this plan with `/ce:work docs/plans/2026-07-21-003-feat-the-path-t3-completeness-plan.md`.

**This is the final plan in the chain.** When its units are checked off, The Path is feature-complete against `docs/brainstorms/2026-07-21-the-path-app-requirements.md`.

What remains after that is not in any plan, and should not be started as engineering work:

1. **The children's-data compliance gate** (see T1) — a dedicated research task plus a Canadian privacy lawyer reviewing the consent flow and privacy policy. This blocks real families regardless of how much code is finished.
2. **The paper-to-app migration** for families who ran Phase 01 offline in autumn 2026 (D22).
3. **Commissioned Trail art and the 25 bespoke crests** — a content swap at the references built in T1 and T2, not a rebuild.
4. **Wisdom entries for Phases 02–05** — an authoring track that must stay ahead of the first student reaching each phase.
5. **Media retention policy** and its interaction with the append-only rule.

## Sources & References

- **Origin document:** `docs/brainstorms/2026-07-21-the-path-app-requirements.md`
- **Previous plan:** `docs/plans/2026-07-21-002-feat-the-path-t2-the-year-plan.md`
- **Chain start:** `docs/plans/2026-07-21-001-feat-the-path-t1-core-loop-plan.md`
- Product behaviour: `artifacts/The Path/the-path-app-design-brief.md` §5.1, §10, §12, §15
- Visual contract: `artifacts/The Path/The Path design handoff/design_handoff_the_path_app/README.md`
- Book lists: `bookTracks` in `artifacts/Design & Marketing/2026-27 Page Handoff/design_handoff_2026-27_program_page/program-data.js`
