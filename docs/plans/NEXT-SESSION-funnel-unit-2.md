Continue the First Profit funnel build in C:\Users\pkupe\Aardvark\120-funnel.

**You are Lane B.** This is a git worktree of the same repo as
C:\Users\pkupe\Aardvark\120-The120, which is Lane A and is building something else at the
same time. Read `docs/LANES.md` before your first command — it is the contract between the
two lanes and it is short.

## Read first
- Lane contract: `docs/LANES.md`, and `supabase/MIGRATION-LOCK.md` (Lane B holds the lock)
- Plan: `docs/plans/2026-07-27-002-feat-first-profit-funnel-plan.md` (17 units, 5 phases,
  status: active). **Read the Unit 2 section in full, and Key Technical Decisions 2 and 3**
  — Decision 2 (a real auth account at C1, email unverified) is the load-bearing decision
  of the whole build and Unit 2 is where it becomes code. Read the "Deferred to
  Implementation" bullet on **how the C1 session is actually minted** — that open question
  is yours to close.
- Requirements: `docs/brainstorms/2026-07-27-first-profit-funnel-requirements.md` (R8a,
  R9a, R9b for this unit)
- The pattern to follow end-to-end: `app/fp/lib/actions/invite.ts` (provision-then-session,
  compensation-based consistency, rate-limit release on infra failure) and
  `app/fp/lib/fw-access-rules.ts` (typed verdicts that never throw)

## State
`main` is at `20079c8`. **Unit 1 is merged-or-pending as PR #66** (branch
`feat/funnel-unit-1`) — if it is not yet merged, ask Peter before branching, and branch
from it rather than main so you inherit the schema mirrors.

- **106 files / 2871 tests**, `tsc` clean, `next build` clean, measured on
  `feat/funnel-unit-1` at commit `2975656`.
- The Unit 1 schema is LIVE in production: `children.applicant_state` (all 9 children
  NULL), `projects` (0 rows, RLS on, zero policies), the R2 and R52a partial unique
  indexes, and `families.entry_source` / `consent_text` / `consent_version` (all NULL).
- `canReserveSeatForChild` is wired into `/api/checkout` (options-object signature). The
  dashboard CTA and CRM gates still call bare `canReserveSeat` — deliberate; they adopt it
  in the units that load the column into their views.
- Port: `npm run dev -- -p 3001`. Lane A holds 3000.

## Do this next
**Unit 2 — Account provisioning at C1 and the re-entry matrix.** Requirements R8a, R9a,
R9b. Dependencies: Unit 1 (met). Files per the plan: `app/lib/funnel/session-rules.ts`
(pure re-entry matrix), `app/lib/funnel/account.ts` (`server-only` provision-or-recognize),
`app/lib/__tests__/funnel-session-rules.test.ts`.

## The one thing that must not be half-done
**Provision-or-recognize must be decided as a whole, including how the C1 session is
minted.** The plan's Deferred-to-Implementation names two candidate shapes:
`admin.createUser` with a server-generated password never disclosed, followed by
server-side `signInWithPassword` (the shape `app/fp/lib/actions/invite.ts` already uses);
or `admin.generateLink`. **The second is in `no-auth-mail-guard.test.ts`'s `MAIL_CAPABLE`
set** and would need a new reviewed-allowlist entry or guard routing. Either way, two
constraints are fixed and non-negotiable: **no consent stamped before the first verified
click** (the 2026-07-13 forged-consent incident), and **no second account for an existing
email** — an existing account gets a resume link, never a duplicate.

## Settled — do not re-litigate
- **A real auth account is created at C1 with the email unverified (Decision 2).**
  `children.parent_id` is NOT NULL → `parents(id)` → `auth.users`, so a child row needs an
  account to exist; the service role bypasses RLS but NOT a NOT NULL FK. With the account,
  `auth.uid()` exists from the first screen and the existing RLS policies authorize the
  funnel unchanged. This unit is account creation plus a decision table — NOT a parallel
  authorization layer.
- **Resume tokens are Unit 3, not this unit.** U2's "resume link" branch can return a
  typed verdict that U3 turns into a real mail. Do not build token storage here.
- **No Supabase OTP (F8)**: the built-in mailer caps at 2 emails/hour project-wide, and
  `createServerClient` forces PKCE after the options spread so cross-device breaks.
- **`applicant_state` vocabulary and transitions live in
  `app/lib/funnel/applicant-rules.ts`** — derive from it; never re-declare a state string.
- Unverified address becomes taken (accepted trade): the real owner recovers via the
  verified-click path; a squatter cannot self-register it afterwards.

## Traps that will cost you if rediscovered
1. **Migrations apply to production the moment you author them.** Unit 2 should need NO
   migration — everything it needs landed in U1. If you find yourself authoring one, stop
   and re-read the plan first. (Lock check: `supabase/MIGRATION-LOCK.md`, Lane B holds it.)
2. **`no-auth-mail-guard.test.ts` fails on any new mail-capable Supabase auth call** in
   `app/` that is not on its reviewed allowlist. `admin.generateLink` is mail-capable.
   `admin.createUser` with `email_confirm` handling is how invite.ts stays off the list.
3. **Two concurrent captures for one address must converge on ONE account** — a `23505`
   from the loser is the WINNER's row; adopt, don't compensate-delete (the invite.ts
   comments walk the difference; and see the idempotent-primitive learning:
   `ok: true` is not permission to issue a credential).
4. **A `"use server"` file's failure modes are invisible to tsc, eslint and vitest.** The
   provisioning path needs one real invocation before ship (dev server, port 3001).
   Server Actions model expected errors as return values, never throws; `redirect()` stays
   outside `try`.
5. **Never blind-upsert onto `families`** — `unique (lower(email)) where ... is null` is a
   partial expression index PostgREST cannot infer, and it was a documented P0 consent
   hijack. `matchOrCreateLead` (select-first-and-branch) is the only door.
6. **`children_status_guard` coerces and short-circuits on service_role** — test through a
   real user JWT, not the service role, for anything touching `children`.
7. **The re-entry matrix is a pure function returning a destination** (R9a: rows =
   cookie/link/password/enrolled state, columns = child counts) — a table-driven test must
   assert no cell is undefined. `environment: "node"`, no jsdom: nothing decision-shaped
   goes in a `.tsx`.
8. **`app/lib/**/__tests__/**` is already allowlisted** in vitest.config.ts — U2's tests
   need no config change. `app/start/**` is NOT allowlisted (that matters from U6 on).
9. **Verify RLS by test, not by policy-reading**: the plan's U2 verification is a funnel
   family's `children` read returning their rows and ONLY their rows under the anon key
   with their own session — and family F requesting family G's child reading zero rows.

## Carried forward from Unit 1's review (owners assigned, not yours)
- **U14 (webhook):** the live `deposits_one_live_paid_per_child` index cannot be absorbed
  by the webhook's `onConflict: "stripe_session_id"` — a double-tab double-payment today
  is a charged-but-unrecorded payment plus a ~3-day Stripe retry storm. Interim signature:
  any `[webhook] deposit insert failed` log line → reconcile against the Stripe dashboard.
  Partial refunds also unconditionally clear rows out of the index predicate. Documented in
  `docs/solutions/database-issues/partial-unique-index-under-live-upsert-onconflict-names-different-key-23505-retry-storm-2026-07-27.md`.
- **Unit that first writes `projects`:** reconcile `on delete cascade` from `children`
  with the ungated "Remove this child" button before real project data exists.
- **Lane A:** two abbreviated deadline literals in `app/crm/lib/engine.ts` and
  `app/crm/components/dashboard/DepositThermometer.tsx` are carved out of the deadline
  sweep by a self-expiring test (`site-deadline.test.ts`) — flagged in PR #66.

## Open items carried forward (unchanged from Unit 1's handoff)
- Five external dependencies, none resolved, none blocking U2: hero photography, an
  `@the120.school` mailbox provider (blocks U15), an AI provider with ZDR, content
  moderation, Ontario counsel on the refund deadline vs the CPA cancellation right.
- U15 cannot start until the funnel-student address suffix convention is picked.
- **U4 must not merge before U6** — U4 severs the only `signUp()` path if U6's account
  creation isn't behind it.
- R64 (mobile-first, one-handed) is still claimed by zero units; the review-wait screen,
  waitlist screen, and active-child selector still need design passes before their units.

## Steps — follow all five
**Step 1:** Run `/ce:work` on **Unit 2 (Account provisioning at C1 and the re-entry
matrix)**, using the plan's Unit 2 section and its Verification as the definition of done.
Test-first on the matrix; close the C1-session-minting question deliberately (document
which shape you chose and why in the module header); one real invocation of the
provisioning path through the dev server before calling it done. Run the full vitest suite
AND `next build`.

**Step 2:** Run the full `/ce:review` on the work. Not a partial review. Expect reviewers
to probe the concurrent-capture convergence, whether consent can leak onto the
provisioning path, whether an existing account can ever get a duplicate, whether the
matrix has an undefined cell, and whether the mail guard stayed green without a new
exemption.

**Step 3:** Run the full `/ce:compound` on the work.

**Step 4:** Commit, push, and open a PR (one per unit, squash, matching #57–#66). Update
the plan's Unit 2 checkbox with what landed, the re-measured suite counts, and any
allowlist entries added. Leave frontmatter `status: active` — **Unit 17 is the last unit.**

**Step 5:** Write `docs/plans/NEXT-SESSION-funnel-unit-3.md` following the format of this
prompt. Name Unit 3 (Resume tokens and the return path) explicitly in its Steps section —
a previous Lane A handoff carried a stale Step 1 describing a unit that had already
shipped, and it cost a session start to detect.

## Important rule
Protect all five steps in each session. Keep a list at the bottom of the terminal with
progress across them.

Before authoring any migration (you should need none), confirm you still hold the lock in
`supabase/MIGRATION-LOCK.md`. If Lane A has taken it, stop and ask Peter.
