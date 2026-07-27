Continue the Staff Front Door build in C:\Users\pkupe\aardvark\120-The120.

## STOP — Unit 10 authors a DATA migration against production
Lane A HOLDS the lock (taken Unit 6, Peter's approval; hand-back is decided after
this unit — it is the plan's last migration). The plan's named timestamp
`20260805130000` is LONG stale — timestamps have collided twice with Lane B; check
`ls supabase/migrations/` at authoring time (next free after `20260806130000` as of
this writing: `20260807120000`). Lane B breached the lock once (funnel U3, recorded
in Unit 8's handoff) — re-verify production's recorded versions before applying.

## Do this next
**Unit 10 — Retire the four production cohorts.** R21. Dependencies: Units 6, 7, 9
(all merged).

The plan's whole spec: a data migration setting `archived_at` ONLY, leaving
`archived_by` NULL (per `created_by`'s recorded rationale — the banner renders
"archived by: unrecorded", which Unit 9 tested). `WHERE`-guarded on slug so it is a
no-op on a fresh environment. All four rehearsal cohorts in scope — none is a real
weekend. Board tokens were already all revoked as of 2026-07-27, but the
verification asserts it anyway: a column-only archive on a cohort with a live token
is precisely the invisible state Unit 8's read fence now also guards, but assert it
at the source. **Test expectation: none** — a data migration with no application
code; correctness IS the POST-APPLY verification query. (The parity suite does not
gain a file; the split-phase convention doc covers why data migrations stand alone.)

**Verification:** all four have `archived_at is not null`; every token on all four
has `revoked_at is not null`; `npm run fw -- cohorts` shows an empty active set
(and `--json` parses).

Read the four slugs FROM PRODUCTION before authoring — do not trust memory or the
plan; the WHERE guard must name what actually exists.

## Steps — all five
1. /ce:work: author the migration (next free timestamp), apply via the Management
   API (one PowerShell invocation — state does not persist between calls), verify,
   record the version.
2. Full /ce:review (small diff — data-migrations persona; probe the WHERE guard's
   no-op claim and the token assertion).
3. /ce:compound if anything novel surfaced (a clean data migration may add nothing
   — that is an acceptable outcome; do not force a doc).
4. Rebase → PR → squash-merge → Unit 10 checkbox → status: active. **Settle the
   lock hand-back in the PR**: this was the plan's last migration, so transfer the
   holder line back to Lane B (or to "unheld — ask Peter") in the same diff, per
   the option Peter approved at Unit 6.
5. Write `docs/plans/NEXT-SESSION-unit-11.md` naming **Unit 11 — The hub page**
   explicitly (R1–R4; `getSeatsRemaining()` + `listFwActiveWeekends` read
   concurrently; "next weekend" as a pure function; R4's asymmetry stated in code;
   no migration).

## Important rule
Protect all steps in each session. Keep a list at the bottom of the terminal.
