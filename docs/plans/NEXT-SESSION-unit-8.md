Continue the Staff Front Door build in C:\Users\pkupe\aardvark\120-The120.

## Read first
- **`docs/LANES.md` binds you.** You are **Lane A**. Unit 8 authors NO migration.
  ⚠️ **A lock breach happened on 2026-07-27**: Lane B's funnel Unit 3 (PR #70)
  authored AND applied `20260805150000_funnel_resume_tokens.sql` while
  `supabase/MIGRATION-LOCK.md` named Lane A as holder, without transferring. The
  schema was verified compatible after the fact (disjoint subsystem, versions
  recorded consistently) and Peter was told; if he hasn't ruled on it by the time
  you read this, do not re-litigate — but treat the lock as ADVISORY-grade until he
  does, and re-verify production versions before any future apply.
- Plan: docs/plans/2026-07-27-001-feat-staff-front-door-plan.md (12 units, status:
  active). **Unit 7's checkbox carries the mint-guard pull-forward** — the write-side
  archived guard ALREADY EXISTS (`cohort_archived` in `fwBoardTokenMintVerdict`, plus
  mint's insert-time re-check compensation). Unit 8 owns the READ side.

## State
Everything through Unit 7 is merged. `main` is at `f113f8e`.
- Units 1–7 → PRs #59, #60, #62, #64, #67, #69, #71. Lane B: #63, #65, #66, #68, #70.
- **112 files / 3032 tests**, tsc/build/eslint clean, `/staff` `ƒ (Dynamic)`.
- **75 docs in docs/solutions/**. The lock rests with Lane A (hand-back at Unit 10).
- Archive schema live; cores live; mint refuses archived cohorts. **The board READ
  and the LISTS still ignore archive state** — that is this unit.

## Do this next
**Unit 8 — Read-side enforcement and the write-path guard table.** Requirements R19,
R25. Dependencies: Unit 6 (merged). The plan's Unit 8 section is the definition of
done; read it in full — it carries a Write-path × Core × Verdict TABLE whose every
row must land as an explicit tested verdict.

Load-bearing decisions already settled (do not re-litigate):
- **The archived check goes in `resolveFwBoardToken`, for 404 semantics** (R25). A
  503 from `loadFwBoard` would tell the poller to hold its last frame — children's
  names on a projector indefinitely under a "catching up" chip. Only 404 clears the
  frame. This ADDS a `path_cohorts` read to every 4-second poll per live board; the
  plan records that cost as accepted and the origin's "free" claim as wrong.
- **`loadFwBoardShell` is gated too** (the page shell, not just the feed).
- **Archiving does NOT block guide check-in or quick-create** (nothing on the
  check-in path may see `archived_at`) — and both defaults are structurally
  invisible, so both get POSITIVE-INVARIANT TESTS NAMED FOR THEIR REASON, or a
  reviewer applying the retire-in-place learning will file them as P1s.
- **The read carries `archivedAt`; callers decide.** Do NOT filter in
  `listFwCohortsForActor`'s core read — the cohort layout uses one list for the
  header name AND the switcher, and `canSwitch` must count archived cohorts or a
  guide is stranded inside one with no Switch link back.
- The ops list filters archived by default (staff visibility is the point);
  Unit 9/the plan's later units own any "show archived" toggle — check the plan.

**FIRST TEST TO WRITE (carried from Unit 7's review):** archive a cohort with a live
token, then drive a mint AND a board-token resolve through the REAL route paths —
mint refused (`cohort_archived`, already true), board resolve 404s (this unit's
change). The write-side guard exists; this unit's job is making the promise hold
end-to-end and closing the TOCTOU's remaining read-side half.

Files (plan): `fw-board-loader.ts` (`resolveFwBoardToken` AND `loadFwBoardShell`),
`fw-board-rules.ts`, `fw-import-core.ts`, `fw-ops-core.ts`, `fw-guide-core.ts`;
tests across the matching suites. Walk the plan's guard table row by row: check-in
PROCEEDS (positive-invariant test), drain replay PROCEEDS, quick-create PROCEEDS,
import REFUSES (whole-chunk vs per-row is a deferred decision — decide it, record
why), guide provisioning/link-student/anonymize per the table.

## Traps
1. Lane B ships continuously — rebase before the PR; the shared solutions doc
   (a-source-scanning-*) has conflicted TWICE; resolve by keeping both lanes' rounds
   in order.
2. The future-window fixture rule for every archived test (window_passed masks a
   deleted guard).
3. Positive-invariant tests for the two structurally-invisible defaults (check-in
   and quick-create proceed) — named for their reason.
4. The board feed is the repo's ONE unauthenticated surface — no-store headers are
   pinned in sw-discipline.test.ts; do not disturb them.
5. Mutation-test every scan; fakes throw on unsupported operators; twin functions
   need twin tests (Unit 7's lesson, now in the scan doc's coda).

## Carried
- `requirePathUser` (B4's twin) still open; residue-table retention unset; lock
  hand-back at Unit 10; `loadFwOpsCohort` collapses not-found/read-failed (low).

## Steps — all five
1. /ce:work on **Unit 8 (Read-side enforcement and the write-path guard table)**.
2. Full /ce:review (expect probes on 404-vs-503 semantics under a mid-poll archive,
   the per-poll cohort read's cost, the guard table's completeness, and whether the
   positive invariants are genuinely pinned).
3. Full /ce:compound.
4. Rebase → PR → squash-merge (series #59–#71) → Unit 8 checkbox → status: active.
5. Write `docs/plans/NEXT-SESSION-unit-9.md` naming the plan's **Unit 9** explicitly
   (read its section first; note whether it migrates — Unit 10 is the next known
   migration and the lock hand-back question).

## Important rule
Protect all steps in each session. Keep a list at the bottom of the terminal with
progress across the 5 steps.
