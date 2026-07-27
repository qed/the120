Continue the First Profit funnel build in C:\Users\pkupe\Aardvark\120-funnel.

**You are Lane B.** This is a git worktree of the same repo as
C:\Users\pkupe\Aardvark\120-The120, which is Lane A and is building something else at the
same time. Read `docs/LANES.md` before your first command — it is the contract between the
two lanes and it is short.

## Read first
- Lane contract: `docs/LANES.md`, and `supabase/MIGRATION-LOCK.md` (Lane B holds the lock)
- Plan: `docs/plans/2026-07-27-002-feat-first-profit-funnel-plan.md` (17 units, 5 phases,
  status: active). **Read its Key Technical Decisions section in full** — Decisions 1, 2, 9
  and 11 all bear directly on Unit 1, and Decision 2 exists because the first draft of this
  plan was architecturally wrong in a way seven reviewers had to find.
- Requirements: `docs/brainstorms/2026-07-27-first-profit-funnel-requirements.md` (R1–R64,
  rulings F1–F8)
- Screens (pixel source of truth, not needed for Unit 1 but read once):
  `artifacts/First Profit/First Profit application process design handoff/design_handoff_first_profit/README.md`

## State
`main` is at `20079c8`. Nothing of the funnel is built — no `/start`, no `/first-profit`, no
mini-app, no `projects` table, no `entry_source` column.

- **102 files / 2810 tests**, `tsc` clean, verified in this worktree on this branch.
- You are on `feat/funnel-unit-1`, branched from `origin/main`.
- Lane A merged Staff Front Door Unit 4 (PR #64) and is now on its Unit 5. It touches
  `app/lib/staff-bar/`, `app/staff/`, `app/crm/(app)/layout.tsx` and `app/fp/fw/`. You touch
  none of those. Outside `app/lib/__tests__/vitest-include-coverage.test.ts` the two lanes
  share no source file — that was verified, not assumed.
- Port: `npm run dev -- -p 3001`. Lane A holds 3000.

## Do this next
**Unit 1 — Applicant state, projects, and the reserve-gate repair.** Requirements R1–R5,
R52a, R2, plus the columns U6 needs. Dependencies: none. This is the foundation every other
unit stands on.

## The one thing that must not be half-done
**Unit 1 is the only Phase 0 migration, and it must carry U6's columns too.**

U6 (capture, Conversion 1) needs `entry_source` — which does not exist anywhere in this repo,
not as a column and not in app code — and the consent text and version columns F6/R30a
require, because `families` carries only booleans and timestamps. **U6 has no migration of its
own.** Under Lane B's rule that authoring a migration *is* applying it to production, shipping
Unit 1 without those columns means a second production migration later for a unit that was
supposed to be pure application code.

Author them here. All of them, in one file.

## Settled — do not re-litigate
These came out of five research agents and seven document reviewers. Reopening them costs a
session.

- **A real auth account is created at C1 with the email unverified (Decision 2).** The funnel
  is NOT a service-role system with hand-written scope checks — an earlier draft said it was,
  and it was wrong twice: `children.parent_id` is `NOT NULL references parents(id)` which
  references `auth.users`, so a family with no account has nowhere to store a child; and it
  would have added ~50 unenforced authorization sites. With an account at C1, `auth.uid()`
  exists from the first screen and the **existing RLS policies do the work unchanged**.
- **`applicant_state` is a NEW column. `children.status` is untouched** and remains the single
  source for the reserve gate and for `move_candidate`. They are not two writers on one fact.
- **Do NOT rewrite `children_seed_group_assignment`.** An earlier draft told you to, reasoning
  that frictionless door switching (R35) would flood the staff review queue. That is false
  under Decision 1: the trigger early-returns on `status = 'draft'`, funnel children stay
  `draft` until C2, and funnel state lives on a different column. **Rewriting it is the change
  that would create the flood.**
- **Do NOT move scholars' `href` in this unit.** `app/components/GroupsBand.tsx` renders
  `g.href` directly and `app/groups/[slug]/page.tsx` `notFound()`s on scholars until U5 admits
  it to `generateStaticParams`. Moving it in Phase 0 points a live home-page card at a 404 for
  the length of Phase 1. It moves in U5, with the route that serves it.
- Foundry is dead (F1). Short funnel, no pre-deposit task work (F2). Admissions approval is
  preserved, so the deposit follows a staff offer (F5). CASL checkbox at capture (F6).
  Waitlist at zero seats (F7). No Supabase OTP (F8).

## Traps that will cost you if rediscovered
1. **Migrations apply to production the moment you author them.** No staging copy, no
   rehearsal, no undo. Use the Management API playbook in `docs/solutions/`; the CLI's DB
   password is stale and unavailable. Gate the `supabase_migrations.schema_migrations` insert
   on the apply call actually succeeding — it once recorded a version whose DDL had failed.
   Author every statement idempotent; the first failure aborts the whole file.
2. **The service role bypasses RLS. It does not bypass a NOT NULL foreign key.** This is the
   error that reshaped the plan. Verify any assumption about what a row can reference.
3. **`children_status_guard` COERCES, it does not raise.** An illegal status is silently
   rewritten to the old value. It fails quietly in production while passing in any
   service-role test, because the trigger short-circuits on `service_role`. Test through a
   real user JWT, not the service role.
4. **`statusIndex` is an allow-list returning `-1` for unknown values**, so `canReserveSeat`
   returns false forever for anything not in it. Adding a state to the wrong column silently
   disables the deposit gate.
5. **Never blind-upsert onto a partial unique index.** PostgREST cannot infer a conflict
   target for `unique (lower(email)) where ... is null`, and doing it on a public endpoint was
   a documented P0 consent hijack. Select-first-and-branch.
6. **Every new table gets `enable row level security` with zero policies.** All 41 existing
   migrations do this, including tables only the service role touches. RLS with no grants makes
   a table invisible to anyone holding the public anon key — which ships in every client
   bundle. Applies to `projects` here.
7. **Migration-parity tests anchor on the TABLE or CONSTRAINT name, never a column name.** A
   new table with an ordinary `check (state in (...))` once hijacked
   `app/crm/__tests__/audit-actions-parity.test.ts` and reddened CRM on a commit touching no
   CRM code. Your `applicant_state` CHECK is exactly that shape.
8. **`environment: "node"`, no jsdom.** Every decision must be a pure exported function with a
   test. A decision written inline in a `.tsx` is structurally untestable and five reviewers
   will find it.
9. **`app/lib/**/__tests__/**` is already allowlisted** in `vitest.config.ts`, so
   `app/lib/__tests__/funnel-applicant-rules.test.ts` needs no config change. `app/start/**`
   is NOT allowlisted — if you ever put a test there, add the glob and a name-pinned assertion
   in `app/lib/__tests__/vitest-include-coverage.test.ts` in the same commit, in Lane B's
   reserved comment block. Note `app/crm` and `app/dashboard` use the **narrow** form
   (`app/crm/__tests__/**`, not `app/crm/lib/__tests__/**`).
10. **A branch that returns what its fallback returns has no behavioural signature.**
    Mutation-test any guard whose value is future-proofing.
11. **PostgREST silently truncates unranged selects at 1000 rows** with `error: null`. Any
    aggregate read needs `.range()` and a helper that refuses rather than truncates.

## What Unit 1 owns
- `applicant_state` column on `children`, with a CHECK whose TS mirror is derived from a const
  array so a rename is a compile error.
- `projects` table anchored on `children(id)` — not `families`, which parents cannot read at
  all under RLS. RLS enabled, zero policies.
- **R2's constraint: at most one `active` project per child.** The first draft omitted it.
- **R52a: one live paid deposit per child**, as a partial unique index. Today's schema is
  unique on `stripe_session_id` only, so two tabs produce two paid rows and consume two of 120
  seats. This lands before checkout exists, deliberately.
- `entry_source` plus the consent text and version columns (see above).
- `Group` landing-page fields in `app/lib/site.ts` — headline line 1, subhead, hero asset,
  phase colour token. **Not** the scholars href.
- A machine-readable `Date` constant beside `DEPOSIT_REFUND_DEADLINE_LABEL`, and collapse the
  three duplicate September-30 literals onto it (`app/dashboard/DashboardApp.tsx`,
  `app/lib/nurture/copy.ts`, `app/lib/welcome/template.ts`).
- `app/lib/funnel/applicant-rules.ts` — pure, tested, every state transition asserted.
- `app/dashboard/data.ts` — `statusIndex` / `canReserveSeat` awareness, with a regression test
  proving existing non-funnel children are unaffected.

Test scenarios are enumerated in the plan's Unit 1 section. Use them; they are not a starting
point to improvise from.

## Open items carried forward
- **Five external dependencies exist and none are resolved**: hero photography for six landing
  pages, an `@the120.school` mailbox provider (U15 is blocked on it), an AI provider with ZDR
  (which forecloses Fable 5), content moderation with no repo precedent, and Ontario counsel
  review of the refund deadline against the CPA's statutory cancellation right. None block
  Unit 1. All block something later.
- **U15 cannot start until the funnel-student address convention is picked.** "Widen the guard
  to the whole `@the120.school` namespace" is not implementable — `admissions@`, `hello@`,
  `peter@` and `staff@the120.school` are live addresses the guard's own tests require it to
  permit. Students need a local-part suffix analogous to FW's `.fw`.
- **U4 must not merge before U6.** U4 reroutes every `JoinButton` away from
  `app/components/account/AccountModal.tsx`, which holds the only `signUp()` in `app/`. U6 is
  what creates accounts at C1. Landing U4 first severs the site's only conversion path.
- **R64 (mobile-first, one-handed) is an orphaned requirement** — claimed by none of the 17
  units. The plan's Design Gaps section lists it along with the review-wait screen, the
  waitlist screen, and the active-child selector, all of which need a design pass before their
  units can be built.
- The plan's Deferred to Implementation section has four open items, including how the C1
  session is actually minted.

## Steps — follow all five
**Step 1:** Run `/ce:work` on **Unit 1 (Applicant state, projects, and the reserve-gate
repair)**, using the plan's Unit 1 section and its Verification as the definition of done.
Author one migration carrying everything listed under "What Unit 1 owns", apply it via the
Management API playbook, and verify with SELECTs. Put every decision in
`app/lib/funnel/applicant-rules.ts`, not in a component. Run the full vitest suite AND
`next build`.

**Step 2:** Run the full `/ce:review` on the work. Not a partial review. Expect reviewers to
probe whether the CHECK constraint and its TS mirror can drift, whether the partial unique
indexes actually hold under concurrency, whether `canReserveSeat` changed behaviour for
existing children, and whether the migration is genuinely idempotent.

**Step 3:** Run the full `/ce:compound` on the work.

**Step 4:** Commit, push, and open a PR (one per unit, squash, matching #57–#65). Update the
plan's Unit 1 checkbox with what landed, the re-measured suite counts, and any allowlist
entries added. Leave frontmatter `status: active` — **Unit 17 is the last unit.**

**Step 5:** Write `docs/plans/NEXT-SESSION-funnel-unit-2.md` following the format of this
prompt. Name Unit 2 explicitly in its Steps section — a previous Lane A handoff carried a
stale Step 1 describing a unit that had already shipped, and it cost a session start to detect.

## Important rule
Protect all five steps in each session. Keep a list at the bottom of the terminal with
progress across them.

Before authoring the migration, confirm you still hold the lock in
`supabase/MIGRATION-LOCK.md`. If Lane A has taken it, stop and ask Peter.
