Continue the Staff Front Door build in C:\Users\pkupe\aardvark\120-The120.

## Read first
- **`docs/LANES.md` binds you.** You are **Lane A**. **Unit 7 authors NO migration** —
  but Lane A now HOLDS the migration lock (taken in Unit 6's PR #69 with Peter's
  approval, since the schema it needed is live). Do not hand it back this unit: Unit
  10 is the plan's next migration and the hand-back question is settled then, per the
  option Peter approved ("I'll ask again in a later unit"). If Lane B asks for it
  mid-unit, that is Peter's call, not yours.
- Plan: docs/plans/2026-07-27-001-feat-staff-front-door-plan.md (12 units, status:
  active). Units 1–6 checkboxes record what shipped; **Unit 6's carries the beacon
  mechanism revision** (the sign-out action writes its own residue report — do not
  regress it to fire-and-forget).
- Requirements: docs/brainstorms/2026-07-26-staff-front-door-requirements.md (R19,
  R20, R25 for this unit).

## State
Everything through Unit 6 is merged. `main` is at `a7fc1fb`.
- Units 1–6 → PRs #59, #60, #62, #64, #67, #69 (all squash). Lane B ships to the same
  main continuously (#63, #65, #66, #68 so far) — rebase before your PR, always.
- **110 files / 2971 tests**, `tsc` clean, `next build` clean, `/staff` `ƒ (Dynamic)`.
- **74 docs in docs/solutions/**.
- **The archive schema is LIVE in production**: `path_cohorts.archived_at` /
  `archived_by` (nullable, FK restrict), and `path_fw_residue_reports` (the beacon's
  durable table). Nothing reads the archive columns yet — that is this unit.

## Do this next
**Unit 7 — Archive and unarchive cores.** Requirements R19, R20, R25. Dependencies:
Unit 6 (merged, applied).

The plan's Unit 7 section is the definition of done. Its load-bearing decisions:
- **Revoke first, then archive.** Call the core `revokeFwBoardToken` with **no**
  `expectedTokenId`; fold `no_active_token` into success in the archive's own
  failure-copy function, not in the core it calls. (Archive-then-revoke failing
  between leaves an archived cohort with a live board — invisible and harmful;
  revoke-then-archive failing between leaves an active cohort with a dark board —
  visible and recoverable.)
- **CAS both directions**, `.select("id")`, zero rows → typed `already_archived` /
  `already_active`. Two concurrent archives: one wins, the other is told so, and
  `archived_by` names the FIRST actor.
- **Unarchive nulls BOTH columns** (attribution describes current state; reversal
  loses who archived — accepted in planning).
- **Gate with `requireCohortStaff`** (fw-ops.ts's) — cohort-scoped, refuses
  `kind='path'` ids, hardens the actor id against the synthetic empty-id session.
  Since Unit 5 it returns `{ok:false; reason:"not_staff"|"unavailable"}` and catches
  `IdentityUnavailableError` — keep its shape.
- **Every archive guard lives in the CORE**, because `scripts/fw-ops.ts` drives the
  cores under service-role credentials with no action-layer gate. Add the CLI verbs
  there too (the agent-native contract: every operator capability reachable without
  a browser).
- Add the columns to `COHORT_COLUMNS` and a fail-closed line to `narrowOpsCohort`.
- Files: `fw-ops-core.ts`, `fw-ops-rules.ts`, `actions/fw-ops.ts`,
  `scripts/fw-ops.ts`; tests in `fw-ops-core.test.ts`, `fw-ops-rules.test.ts`.

Plan test scenarios (all nine): archive with live token (revoke THEN archive, assert
ordering); archive with no token ever; unarchive → both null, cohort reappears; two
concurrent archives → one `already_archived`, first actor attributed; unarchive an
active cohort → `already_active`, not an error; `kind='path'` → refused by the gate's
cohort read; revoke fails → archive does NOT proceed; non-staff → the collapsed
staff-only message; unarchive then mint → new token, old URL never resolves again.

## Traps
1. `main` moves under you (Lane B). Rebase before the PR; check the branch before
   every commit; re-check `ls supabase/migrations/` if anything schema-adjacent appears.
2. No jsdom. Cores are tested against the fake-Supabase harness idiom in
   `fw-ops-core.test.ts` — read its existing archive-adjacent tests (token mint/revoke)
   first; the compensation patterns there are the ones to mirror.
3. Mutation-test every scan; the source-scanning doc is at ROUND 5 now (Lane B added
   one: prefer an injection seam over a scan when the property is a behaviour, not an
   absence).
4. The audit table takes no cohort subject — archive attribution is the ROW's columns,
   not a new `FW_OPS_AUDIT_ACTIONS` member. Do not widen that union; its set-equality
   test will catch you.
5. `fwStaffGateCopy(gate.reason)` is the refusal string at the action layer — reuse
   it; do not resurrect a hand-copied STAFF_ONLY.

## Carried (do not lose)
- `requirePathUser` is B4's un-fixed twin (both calls bare) — not this unit's scope.
- Residue-table retention policy unset — revisit with dry-run data.
- Lock hand-back: decide at Unit 10.

## Steps — all five, per unit
1. /ce:work on **Unit 7 (Archive and unarchive cores)** — plan section + Verification
   = definition of done. Full vitest + next build.
2. Full /ce:review (expect probes on the revoke→archive ordering under partial
   failure, the CAS's zero-row semantics, the CLI parity, and whether `narrowOpsCohort`
   fails closed on a pre-migration row shape).
3. Full /ce:compound.
4. Rebase on origin/main, PR, squash-merge (#59–#69 series), update the plan's Unit 7
   checkbox, leave `status: active`.
5. Write `docs/plans/NEXT-SESSION-unit-8.md`, naming **Unit 8 — Read-side enforcement
   and the write-path guard table** explicitly in its Steps. Unit 8 has no migration.

## Important rule
Protect all steps in each session. Keep a list at the bottom of the terminal with
progress across the 5 steps.
