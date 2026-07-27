Continue the Staff Front Door build in C:\Users\pkupe\aardvark\120-The120.

## STOP — Unit 6 authors a MIGRATION, and Lane A does NOT hold the lock
This is the first unit in this plan that authors a migration, and you may not author it
yet. `supabase/MIGRATION-LOCK.md` names **Lane B — First Profit funnel** as the holder,
both worktrees point at the **same live Supabase project**, and this repo's standing
rule is that **authoring a migration IS applying it to production** — there is no
staging copy and no "add the file and hold off". So, before anything else in Step 1:

1. **Ask Peter** to move the lock to Lane A (or to tell you Lane B is between
   migrations and it is safe). Plain language: "Unit 6 adds two columns to the
   weekends table. The other workstream currently holds the only-one-lane-writes-
   the-database token. May I take it?"
2. **Take the lock in the same PR as the migration** — change the holder line in
   `supabase/MIGRATION-LOCK.md` in the same diff. Never silently.
3. **The plan's migration filename is STALE.** It says
   `supabase/migrations/20260805120000_fw_cohort_archive.sql`, but Lane B's funnel
   Unit 1 (PR #66, merged 2026-07-27) already shipped
   `20260805120000_funnel_applicant_state.sql` — that exact timestamp is TAKEN. Pick
   the next free slot (`20260806120000_…` or later; check `ls supabase/migrations/`
   at the moment you author, because Lane B ships to the same `main` continuously).

If Peter says Lane B still needs the lock, Units 7 and 8 both depend on Unit 6 — do
not start them against an unauthored schema. Ask which he'd rather have: wait, or a
Unit that isn't 6 (there is none in Phase 4 without the migration; say so).

## Read first
- **`docs/LANES.md` binds you.** You are **Lane A**. All four shared-state rules;
  rules 1 (migrations) and 4 (rebase before PR) are the two that bite this unit.
- Plan: docs/plans/2026-07-27-001-feat-staff-front-door-plan.md (12 units, 5 phases,
  status: active)
- Requirements: docs/brainstorms/2026-07-26-staff-front-door-requirements.md (R19, R20
  for this unit)
- The plan's Key Technical Decisions section is load-bearing. For Unit 6 specifically:
  "Revoke first, then archive" and "Minting refuses on an archived cohort" are Unit
  7/8's business — **Unit 6 is SCHEMA ONLY** and the temptation to start the cores
  early is the scope creep to refuse.
- Units 1–5's checkboxes record what shipped. **Unit 5's carries four open items**
  (three carried decisions/tasks and one needing Peter — listed below).

## State
Everything through Unit 5 is merged. `main` is at `b71e863`.
- Unit 1 → PR #59, Unit 2 → #60, Unit 3 → #62, Unit 4 → #64, Unit 5 → #67 (all squash).
- **Lane B ships to the same main**: #63 (lanes contract), #65 (funnel plan), #66
  (funnel Unit 1 — which included a MIGRATION, hence the timestamp collision above).
- **107 files / 2917 tests**, `tsc` clean, `next build` clean, `/staff` still `ƒ (Dynamic)`.
- **72 docs in docs/solutions/**; sixteen now trace to this plan.

Unit 5 closed Phase 3: B4 and B5 are fixed as one reliability pass (both identity
gates are bounded and three-way — identity | none | unknown — with UNKNOWN throwing to
retryable error boundaries at the app root, /staff and /crm, never collapsing to a
terminal verdict); quarantined records no longer refuse anyone's sign-out and are
PRESERVED by the clear (Peter, 2026-07-27); `deploymentId` is configured (Peter); the
residue beacon ships as a structured `[fw/residue]` log line with authenticated-sender
+ claimed-actor + deviceId (Peter); the SW registration scan and FwPwa scope pins are
in; the dry-run checklist lives at `docs/plans/fw-dry-run-checklist.md` (undated,
`status: unscheduled` — never rename it onto a date that doesn't exist yet).

## Do this next
**Unit 6 — Archive schema migration.** Requirements R19, R20. Dependencies: none
(within the plan) — but the LOCK, above, gates everything.

Goal: `path_cohorts` carries archive state and attribution. Two nullable columns —
`archived_at timestamptz`, `archived_by uuid references auth.users (id) on delete
restrict` — idempotent, direct siblings of `created_by`. **SCHEMA ONLY**: no new audit
action, no widening of `FW_OPS_AUDIT_ACTIONS`, no insert/update statements, no core
code. Test file: `app/fp/lib/__tests__/fw-archive-migration-parity.test.ts` (that glob
is already allowlisted; expect zero vitest.config changes).

Execution note from the plan, still binding: **apply via the Management API
immediately** (the playbook is in docs/solutions; the CLI token is in Windows
Credential Manager under `Supabase CLI:supabase` — there is no DB password).
PRE-APPLY `to_regclass`; POST-APPLY column verification **before** recording the
version. Migrations apply immediately — the Chicago rehearsal was cancelled 2026-07-23
and there are no migration holds, ever.

Plan test scenarios (all five, plus anything they miss):
- Both columns added idempotently; `archived_by` carries `on delete restrict`, no cascade.
- Neither column `not null` — isolate the statement and assert the absence.
- No `insert into`, no `update public.` — schema-only.
- `FW_OPS_AUDIT_ACTIONS` set-equality untouched.
- The new file does not hijack a sibling scanner — run `fw-ops-migration-parity`,
  `fw-migration-parity`, `fw-move-task-parity`, `evidence-migration-parity`,
  `audit-actions-parity` by name. (The hijack happened once: see
  docs/solutions/test-failures/migration-scanning-parity-test-must-scope-to-its-table-*.)

## Carried from Unit 5 — one needs Peter, three don't
1. **NEEDS PETER: a successful sign-out over preserved foreign residue never beacons.**
   `FwSignOutOutcome`'s success member (`{kind:"sign_out"}`) carries no count, so the
   COMMON case — an orderly sign-out on a device still holding a departed guide's
   captures — produces no off-device record; the beacon fires only on `queue_preserved`
   (a reconcile outcome) and `clear_failed`. Ask him in plain language: "when someone
   signs out normally of an iPad that still holds another person's unsent check-ins,
   should the iPad also report that to the log?" If yes, the success member grows a
   count and the beacon maps it — a small, contained change, but it edits a settled
   union, so it is his call, not yours.
2. **The beacon's persistent store is THIS unit's neighbourhood.** Peter's decision
   was a log line now, a table when a migration unit arrives — and Unit 6 is the
   migration unit. But R19/R20's migration is scoped and reviewed; do NOT bolt a
   beacon table onto it silently. If you have the lock anyway, ASK Peter whether he
   wants the beacon table authored in the same window (a second small migration, its
   own file), and take his answer either way.
3. `requirePathUser` (`app/fp/lib/auth.ts`) is B4's named un-fixed twin — both
   Supabase calls bare, both states terminal. Not this unit's scope; it stays on the
   list until a unit owns it. The shape to copy is item 6 of
   docs/solutions/best-practices/offline-drain-reuses-a-fail-closed-signal-*.md.
4. Unit 4's `clear_failed` still refuses sign-out when a cache clear throws — revisit
   only with dry-run evidence (it is a checklist item now). `bar-wiring.test.ts`'s
   three-job split remains genuinely optional.

## Traps that will cost you if rediscovered
1. **`main` moves under you.** Lane B merged twice during Unit 5's session and once
   collided on the exact migration timestamp the plan had named. Rebase on
   `origin/main` immediately before opening your PR (LANES rule 4), and re-check
   `ls supabase/migrations/` for new files at that moment. **Check
   `git branch --show-current` before every commit.**
2. **Timestamps run ahead of the calendar** in this repo's migrations
   (`20260805…` shipped on 2026-07-27). "Next free slot" means lexicographically after
   the latest FILE, not after today's date.
3. **The migration-parity idiom**: these tests parse the SQL file's text. Comment
   stripping must be uniform, clause scope matters, and a scanner scoped too loosely
   gets hijacked by an unrelated sibling file — all three have happened; the docs are
   docs/solutions/test-failures/migration-parity-assertions-that-cannot-fail-* and
   migration-scanning-parity-test-must-scope-to-its-table-*.
4. **Mutation-test every scan you write, with a mutation you would not have written.**
   The source-scanning doc is now at ROUND 4 (bracket notation is a spelling; file-set
   equality is not a call-site cap; `Function.prototype.length` is arity theatre; an
   import-presence guard is walked through by deleting the catch). Read ROUNDs 2–4
   before writing the parity test.
5. **No jsdom, `environment: "node"`.** Still true. A migration unit mostly dodges
   this, but any helper you add follows the pure-function-with-a-test rule.
6. **`fp-rename-straggler.test.ts` reads raw source lines including comments** — a
   fixture URL or comment with the old route prefix reddens it. It also walks
   `git ls-files`, so a file moved with a bare `os.remove`/`mv` reddens it until the
   move is STAGED.
7. **`app/lib/**/__tests__/**`, `app/staff/**/__tests__/**`, `app/crm/__tests__/**`
   and `app/fp/**/__tests__/**` are ALREADY allowlisted.** A test anywhere else makes
   the coverage tripwire fail and name the orphan. New globs append to Lane A's own
   commented block (LANES rule 3) — never interleave.
8. **Squash-merge means your local branch's commits vanish from main's history.**
   After merging, `git checkout main && git pull`; do not rebase stale branches onto
   each other.

## Settled — do not re-litigate
- The bar takes only `application` and `actorUserId`; mounts only in the three
  outermost guarded layouts; sign-out renders unconditionally (R23).
- Unit 1's five-class queue classification; R16 scoped to the signing-out account
  (Peter); quarantined records preserve-not-refuse (Peter, Unit 5).
- R13's copy renders server-side (Peter).
- UNKNOWN is not NONE: identity gates are three-way, the unknown member is
  non-nullable and non-falsy, Server Actions return typed `unavailable`, pages throw
  to boundaries. Do not "simplify" a gate back to two states.
- The root error boundary shows GENERAL copy; only the gated boundaries (/crm, and
  /staff's page segment) claim "you are still signed in". The variants are pinned by
  a source scan.
- Archive decisions already settled in the plan: revoke-first-then-archive; minting
  refuses on archived (ordered after `cohort_not_fw`, before `no_event_window`, and
  the test fixture must use a FUTURE window); archiving does not block guide check-in
  or quick-create; every archive guard lives in the core; the read carries
  `archivedAt` and callers decide; unarchive nulls both columns.

## Steps — follow all five
**Step 1:** Resolve the LOCK with Peter (top of this file), then run /ce:work on
**Unit 6 (Archive schema migration)**, using the plan's Unit 6 section + its
Verification as the definition of done. Author the migration at the next FREE
timestamp, take the lock in the same PR, apply via the Management API with pre/post
verification, and write `fw-archive-migration-parity.test.ts`. Surface carried item 1
(the sign-out beacon gap) and item 2 (the beacon table) to Peter early — item 2's
answer may add a second small migration to this same window. Run the full vitest
suite AND `next build`.

**Step 2:** Run the full /ce:review on the work. Not a partial review. (Expect
reviewers to probe the parity test the way ROUNDs 2–4 describe, to check the
migration's idempotency claims against re-application, to verify `on delete restrict`
is asserted by clause and not by substring, and to check the lock transfer is in the
diff.)

**Step 3:** Run the full /ce:compound on the work. Not a partial compound learning.

**Step 4:** **Rebase on `origin/main` first** (LANES rule 4) — and re-check the
migrations directory for Lane B collisions at that moment — then commit, push and
merge — one PR per unit, squash, matching #59–#67. Update the plan's Unit 6 checkbox
with what landed, the re-measured suite counts, and any allowlist entries. Leave
frontmatter `status: active` — **Unit 12 is the last unit**, not this one.

**Step 5:** Build the prompt to run the next unit (**Unit 7 — Archive and unarchive
cores**) following the format of this prompt, at `docs/plans/NEXT-SESSION-unit-7.md`.
Name Unit 7 explicitly in its Steps section. Unit 7 has NO migration — its prompt
should say whether Lane A still holds the lock after this unit and whether to hand it
back, which is a question to settle with Peter in THIS session, not that one.

## Important rule
Protect all steps in each session. Keep a list at the bottom of the terminal with
progress across the 5 steps.
