Continue the Staff Front Door build in C:\Users\pkupe\aardvark\120-The120.

## Read first
- docs/LANES.md (Lane A; NO migration this unit — the lock is Lane B's again as of
  Unit 10). Plan: docs/plans/2026-07-27-001-feat-staff-front-door-plan.md, Unit 11
  section (~line 515). Units 1–10 checkboxes record what shipped.

## State
Everything through Unit 10 is merged; `main` at `a8f84ee`. Units → PRs #59, #60,
#62, #64, #67, #69, #71, #73, #74, #75. **112 files / 3096 tests.** 75 docs.
Production: all four rehearsal cohorts archived, zero active weekends — the hub's
count will truthfully read 0.

## Do this next
**Unit 11 — The hub page.** R1–R4. Dependencies: Units 2, 9 (merged).
Files: modify `app/staff/page.tsx`; create `app/staff/lib/hub-rules.ts`,
`app/staff/__tests__/hub-rules.test.ts` (both globs already allowlisted).

The plan's approach: two application cards, one live number each. CRM number from
`getSeatsRemaining()`, FW number from `listFwActiveWeekends` (Unit 9's narrow
read), read CONCURRENTLY. **"Next weekend" is a pure function** — sort by starts_at
ascending, exclude nulls, name the earliest still-upcoming; a weekend in progress
and an all-past set each get a DEFINED outcome. **R4's asymmetry stated in code**:
the FW read degrades to a number-less card (typed failure — never a fabricated 0,
which matters doubly now the true count IS 0); `getSeatsRemaining()` cannot report
failure and may render a stale constant. Clock read outside the component body.
CRM token set via class-name swap. Scenario from Unit 9 to close: "staff with two
cohorts, one archived → hub count 1" — now testable through hub-rules.

## Traps
1. No jsdom — every hub decision in hub-rules.ts with tests; page composes.
2. The zero state is REAL at launch (all four archived): the FW card must render
   count 0 honestly and distinguently from the degraded number-less card.
3. Lane B ships continuously; rebase before the PR.

## Steps — all five
1. /ce:work on **Unit 11 (The hub page)** — full vitest + next build.
2. Full /ce:review. 3. Full /ce:compound (skip honestly if nothing novel).
4. Rebase → PR → squash → checkbox → status: active (Unit 12 is last).
5. Write docs/plans/NEXT-SESSION-unit-12.md naming **Unit 12** explicitly (read
   its plan section; it is the LAST unit — its Step 4 flips the plan frontmatter
   to status: completed).

## Important rule
Protect all steps. Keep the 5-step list at the bottom of the terminal.
