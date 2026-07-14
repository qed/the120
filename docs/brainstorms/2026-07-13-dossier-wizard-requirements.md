---
date: 2026-07-13
topic: dossier-wizard-group-aware-flow
---

# Dossier Creation Redesign — Stepped Wizard with Group-Aware Flow

## Problem Frame

The dossier is the application — the GTM funnel's core conversion. Today it's one long form (`app/dashboard/DossierEditor.tsx`): no sense of progress, no explicit save moments, a generic "Academic picks" ask that doesn't fit catch-up families, and no mention of the five groups anywhere in the flow even though "pick your group" is the product's whole positioning. Parents abandon long forms; a stepped wizard with visible progress and per-step saves is a direct conversion play. The redesign also captures two inputs staff currently invent at review time: the kid's group and their academic plan.

Production has **zero families/children rows** (verified 2026-07-13), so schema and semantics can change freely — no legacy dossiers exist.

## Wizard Flow

```
[1 Basics] → [2 Group] → [3 Academics] → [4 Workshops*] → [5 Project & Interests] → [6 Review & Submit]
                                              *Scholars only — all other groups skip it
```

Progress bar across the top; every step has a **Next** button that saves immediately.

## Requirements

**Wizard shell**
- R1. Each dossier section is its own view/step; a progress indicator at the top shows position and step names; steps completed can be revisited (Back / clicking a previous step). On narrow viewports (≤480px) the indicator condenses to "Step 3 of 6 · Academics" — the full step rail appears above that width (375px survival posture).
- R2. The Next button on every step saves that step's data immediately (explicit save on click), with a visible state machine: idle → saving (Next disabled, inline indicator) → success (advance) → error (stay on step, retryable inline error) — the `saving`/`submitError` pattern from `app/components/account/AccountModal.tsx`. The existing debounced autosave stays as a safety net — Next is additive, not a replacement.
- R3. Submission still requires 100% completeness; the final step shows the checklist, preview, and the Submit button (current behavior, relocated). Each incomplete checklist item on the Review step links directly to its owning step.

**Step 2 · Group (new)**
- R4. Right after Basics, the parent picks exactly one of the five groups (Athletes, Founders, Makers, Scholars, Givers — the Scholars group is the GT/gifted-and-talented one; copy, names, and order come from `app/lib/site.ts` `groups`, the authoritative source), presented as selectable cards with name, category, and blurb. The cards form a semantic single-select (radiogroup/aria-checked, keyboard-operable, visible focus ring).
- R5. The pick is **per kid and binding**: it is the kid's group. It seeds the CRM review queue's group assignment, and stays **parent-editable until a deposit is paid for that kid** — every parent change (including post-submission) re-seeds the assignment, newest write wins. After deposit, the pick locks (read-only in the wizard) and the staff-side assignment is the sole truth. Note: parent sessions cannot write the staff-only review table directly (RLS) — the seeding mechanism is a trigger/read-through, decided in planning.
- R6. Group choice is required for completeness; changing group re-derives which steps apply (see R10). A post-submission group change re-opens only the Group and Workshops steps for editing (everything else stays locked); switching away from Scholars clears workshop selections, switching to Scholars prompts for them.
- R16. **No per-group caps** (Peter, 2026-07-13): the 120 seats are a single global pool — a group can never individually fill, so group cards carry no availability states and no waitlist path. Scarcity stays the site's existing global seat counter (which the wizard may show on the step, optional).
- R17. An **undecided-parent path**: the Group step carries a "Not sure? Here's how families choose / book a call" affordance and richer card copy (the group pages' `body` line), so a torn parent isn't stalled by a required binding choice.

**Step 3 · Academics (renamed from "Academic picks")**
- R7. Ask copy: "We help you: Choose a subject (or 2) and a project the next year."
- R8. Per academic entry: pick one subject from **Fast Math, Math, Science, Reading, Writing, Language, Vocabulary**; then pick one of three plans — **Catch-Up, Reach Ahead, Get Solid** — with an optional free-text box "What do you want to accomplish with this Academic Project".
- R9. Below the first entry, an optional **+** button adds one more subject (maximum 2) with the same inputs; the second entry is removable. Test scores stay here as an optional field.
- R9b. The current **"Other subject" free-text input is preserved** alongside the 7 fixed subjects (an entry's subject can be custom text), so subjects outside the list — History, a language, anything — keep an expression path.

**Step 4 · Workshops (Scholars only)**
- R10. The Workshops step appears only when the kid's group is Scholars; all other groups skip straight to Project & Interests.
- R11. Scholars get a GT-style explore experience (modeled on community.gt.school/workshops): filter chips (Track, Grade), a card grid showing title/advisor/track/grades/length/description, tap-to-select (aria-pressed, keyboard-operable) with visible selected count. A filter combination with zero matches shows explanatory copy and a clear-filters action. **No time-slot ranking** — the dossier is express-interest only.

**Step 5 · Project & Interests**
- R12. For non-Scholars groups, the step opens with copy to the effect of: "We will help build projects based on your kid's interests. Enter a topic or interest area and an idea for a 4–8 week (or longer) project, working a few hours a week. We'll put together all the answers from all the parents and build something amazing for you and your cohort." Existing interests + project-idea + portfolio fields remain the inputs (project-idea copy shifts from "year-long" to the 4–8-week framing for non-Scholars).
- R12b. Each non-Scholars group's step shows **2–3 concrete example projects** for that group (drawn from the group pages' copy in `app/lib/site.ts`), so the experience isn't "Scholars get a catalog, everyone else gets a blank box".
- R13. Scholars keep the current project/interests framing (their cohort work is the workshop system).

**Consistency obligations**
- R14. The completeness checklist becomes group-aware: the visible items are Name, Grade, Birth year, Current school, **Group**, Academics (a subject + plan), Interests, Project pitch — plus Workshops **only for Scholars**. There are **three** checklist implementations that must change in lockstep in the same deploy: `app/dashboard/data.ts` `checklist()` (parent UI), `app/lib/nurture/rules.ts` `dossierCompleteness()` (stall nudge), and `app/crm/lib/reviews-rules.ts` `dossierChecklist()`/`dossierCompleteness()` (CRM queue %). The data plumbing changes with them: the new group/academics columns must be added to `NurtureChildRow` + the children select in `app/api/cron/nurture/route.ts`, and to the children select in `app/crm/lib/queries.ts` — a missing column means `undefined` group and silent misclassification, not a crash.
- R15. **Direct cutover, no mirror** (revised in review): the legacy flat subject list is retired as a source of truth — the ~4 call sites (CRM queries/reviews-rules/dossier detail, nurture completeness, dossier preview) read the new Academics entries directly. The CRM dossier detail **renders subject + plan + goal** per entry, so staff actually receive the academic plan the wizard collects.

## Success Criteria

- A parent can complete a dossier start-to-finish through the wizard with progress visible at every moment, and nothing is lost if they leave mid-flow (per-step saves).
- Every submitted dossier arrives in the CRM review queue with a group already attached and an academic plan (subject + Catch-Up/Reach Ahead/Get Solid) staff never had to ask for.
- Non-Scholars parents never see workshops; Scholars parents get the GT-style explore grid.
- The stall-nudge email still fires on the same ">80% complete, 3+ quiet days" semantics after the checklist change.

## Scope Boundaries

- No time-slot ranking or any scheduling collection in workshops (GT's "Rank times" is deliberately not cloned).
- No changes to the review pipeline stages or deposit flow; CRM changes are limited to group-assignment seeding, the dossier detail rendering Academics entries (R15), and the checklist mirrors (R14).
- No migration/backfill work planned — but "zero rows" is a point-in-time fact on a live funnel: **re-verify zero children rows at deploy time as a gate**, and regardless the wizard must handle old-shape drafts gracefully (a draft with no group routes to Step 2; a subject entry without a plan prompts for one on the Academics step).
- Photo stays in Basics (optional); no photo-upload rework.
- No per-group variation beyond what's specified (Workshops visibility, Project & Interests copy, and R12b's example projects).

## Key Decisions

- **Group is per kid, binding, and parent-editable until deposit** (Peter, 2026-07-13, refined in review): the parent's pick IS the group and re-seeds the staff assignment on every change until a deposit is paid; then it locks and staff assignment is sole truth. Chosen over "preference only", "per family", and "lock at submission".
- **GT clone = full explore rebuild — filter chips + flat card grid, no time ranking** (Peter, 2026-07-13, reaffirmed in review over the reuse-the-existing-section alternative; the scope cost was surfaced and accepted): the ranking UI is excluded because GT schedules real sessions; we'd be collecting schedule preferences months early.
- **Direct cutover to Academics entries, no legacy mirror** (Peter, 2026-07-13, review): zero production rows make the cutover cheap now, and the mirror would have hidden the plan/goal from staff forever while adding a permanent sync obligation.
- **Next-button saves are additive** to the debounced autosave — explicit save moments for parent confidence, autosave as the safety net.
- **The Scholars-vs-others asymmetry is acknowledged and softened, not removed** (review): non-Scholars get example projects (R12b) rather than a parallel catalog; the honest state of the product, deliberately.

## Dependencies / Assumptions

- The five groups' copy in `app/lib/site.ts` is current and approved for in-product use.
- Kid-count (shipped 2026-07-13) is unrelated — a kid's dossier count continues to floor the family's kid_count automatically.

## Outstanding Questions

### Resolve Before Planning
(none — the catalog question was resolved 2026-07-14: **The 120 owns the roster as a deliberate fork of GT's offerings**, updated based on The 120 community's interest. A diff against the live community.gt.school/workshops was run and applied: +5 K–2 workshops, audition flags on all Competition workshops, Lawrence Bernstein leading the recreational chess trio. Posture: periodic curation diffs, not a dependency. Note: the 5 new workshops are K–2 — below The 120's ages-8–17 band — kept in the roster per Peter, surfaced or hidden by the Grade filter.)

### Deferred to Planning
- [Affects R5][Technical] The seeding mechanism for group assignment (trigger vs read-through) — constrained by RLS: parent sessions cannot write the staff-only review table, so a client write is off the table.
- [Affects R11][Technical] Grade filter mechanics: catalog grades are display strings ("K–8+", "6–8+") — parse into bands vs add structured min/max fields; and which bands the filter offers (child's own grade highlighted vs all).
- [Affects R2][Technical] Whether the wizard's Next-save reuses the store's persist path or gets an explicit awaited variant with error surfacing.
- [Affects R14][Technical] Deploy sequencing so no window has the three checklist implementations diverged; and whether the stall threshold is restated as "missing at most one item" so it's invariant to the 8-vs-9-item checklist (recommended), or the >80% figure is kept with the shift documented.
- [Affects R8][Technical] Where the structured Academics entries live (children columns vs jsonb) and whether a plan is required per entry for completeness (success criteria imply yes).

## Next Steps
→ `/ce:plan` for structured implementation planning — no blocking questions remain (caps: none per-group, 120 total; catalog: The 120-owned fork, diffed and updated 2026-07-14). (A pre-brainstorm WIP sketch is stashed at `git stash@{0}` — children group/academics columns and data-model types; treat as input, not decided — note it predates the review's cutover and three-mirror decisions.)
