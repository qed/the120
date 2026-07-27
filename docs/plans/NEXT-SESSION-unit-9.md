Continue the Staff Front Door build in C:\Users\pkupe\aardvark\120-The120.

## Read first
- **`docs/LANES.md` binds you.** Lane A. **Unit 9 authors NO migration** — but **Unit
  10 (next) DOES** (the retire-the-four-cohorts data migration), and Lane A holds the
  lock, so no hand-back before then. The 2026-07-27 lock breach by Lane B (funnel U3)
  stands recorded in Unit 8's handoff; treat the lock as advisory-grade until Peter
  rules, and re-verify production versions before Unit 10's apply.
- Plan: docs/plans/2026-07-27-001-feat-staff-front-door-plan.md — **Unit 9's section
  (lines ~470–497) is unusually detailed; read every scenario.** Units 1–8 checkboxes
  record what shipped.

## State
Everything through Unit 8 is merged. `main` is at `0490913`.
- Units 1–8 → PRs #59, #60, #62, #64, #67, #69, #71, #73. Lane B through #72.
- **112 files / 3079 tests**, tsc/build/eslint clean. **75 docs.**
- The archive machinery is COMPLETE below the surface: schema live, cores live,
  mint+read+import+link+provision all fenced, proceed-invariants pinned. **No list
  or page reflects archive state yet** — that is this unit.

## Do this next
**Unit 9 — Archive-aware list reads and ops surfaces.** R19, R26, R3's count
contract. Dependencies: Units 7, 8 (merged).

The plan's own approach lines, all load-bearing:
- `listFwOpsCohorts` excludes archived ids **before** the three-way count fan-out.
- `listFwActiveWeekends` — NEW, one paginated query for the hub (Unit 11 consumes it).
- `listFwCohortsForActor` gains `includeArchived`, returns `archivedAt` per row, and
  **gains `fetchAllRows`/`.range()` pagination IN THIS UNIT** (its staff result set
  now accumulates permanently).
- The cohort layout takes the UNFILTERED list (header name + `canSwitch` count every
  cohort the actor holds — a guide inside an archived cohort keeps the Switch link).
- The archived ops detail page renders in **archived mode** — banner, Unarchive, the
  de-escalating and obligation controls kept; roster-building affordances removed
  from the page AND refused server-side (already true). **Not a 404.**
- **The board-token panel stays unconditionally rendered** (a prior frontend-races
  review found a conditional render unmounting a just-minted, unrecoverable URL).
- `slug_taken` copy points at the archived list.
- New component `FwArchiveControl.tsx` — every decision in pure functions
  (environment:node), composition only in the .tsx.

All ten scenarios from the plan, including: archived_at set + archived_by NULL (the
launch state of all four backfilled cohorts) renders "actor unrecorded", never blank;
guide holding only an archived cohort is redirected INTO it, never told they hold no
grants; all-archived zero-state has a create path; the typed-failure-vs-empty-list
distinction survives pagination.

## Traps
1. Lane B ships continuously; the shared scan doc has conflicted three times.
2. The 1000-row cliff doc governs the new pagination (order before range; refuse a
   truncated result, never report it).
3. No jsdom: FwArchiveControl's confirm flow, banner copy, chip logic — all pure
   functions with tests; wiring pinned by comment-stripped scans, mutation-tested.
4. R3's count contract: the ops list's counts must describe the FILTERED set.
5. The future-window fixture rule for any archived test.

## Carried
- Lock hand-back decision at Unit 10 (next unit — it authors the data migration).
- `requirePathUser` (B4's twin); residue retention; `loadFwOpsCohort`'s null collapse.

## Steps — all five
1. /ce:work on **Unit 9 (Archive-aware list reads and ops surfaces)**.
2. Full /ce:review (expect probes on the pagination's refusal semantics, the
   unconditional token panel, the archived-mode page's server-side parity, and the
   canSwitch count contract).
3. Full /ce:compound.
4. Rebase → PR → squash-merge → checkbox → status: active.
5. Write `docs/plans/NEXT-SESSION-unit-10.md` naming **Unit 10 — Retire the four
   production cohorts** explicitly. Its prompt must OPEN with: it authors a DATA
   migration (`archived_at` only, `archived_by` NULL per the plan; WHERE-guarded on
   slug; no application code; correctness = the POST-APPLY query), Lane A holds the
   lock, timestamps have collided twice — check `ls supabase/migrations/` at
   authoring time, and the plan's named `20260805130000` timestamp is ALREADY STALE
   (both 20260806 slots are taken; use the next free).

## Important rule
Protect all steps in each session. Keep a list at the bottom of the terminal with
progress across the 5 steps.
