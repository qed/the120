# NEXT SESSION — the funnel wrap: the three migration units

> **Where to work (changed 2026-07-29):** `C:\Users\pkupe\Aardvark\120-The120`.
> The `120-funnel` worktree is gone and the two-lane setup is retired — see
> `docs/LANES.md`. One working tree, ordinary feature branches. Note that
> `main` used to be protected structurally (git refuses to check out a
> branch already checked out in another worktree); that guarantee left with
> the second worktree, so branch from `origin/main` deliberately.

*Written 2026-07-28. Units 1, 2, 4, and 5 of
`docs/plans/2026-07-28-003-feat-funnel-wrap-execution-plan.md` are merged
(PRs #99–#102). Suite on origin/main: 140 files / 3,715 tests; tsc, build
clean. What remains — Units 3, 6, 7, 8 — is blocked, and this file says on
what.*

## Why the remaining units stopped

**Units 3, 6, and 8 each author a production migration.** In this repo
authoring *is* applying (`supabase/MIGRATION-LOCK.md`: no staging, no
undo). The session that wrote Units 1–5 could not apply them:

- no `SUPABASE_ACCESS_TOKEN` in the environment,
- no Supabase CLI installed, no CLI token file,
- the service-role key in `.env.local` cannot run DDL.

Migrations in this repo have been applied via the **Management API**. That
credential is the blocker, and applying irreversible DDL to a live
production database is a decision Peter should make explicitly, not one an
agent should take on the strength of a plan approval.

**Unit 7 is not blocked by credentials** — it is blocked by Unit 6, which
it depends on for the provisioning state it renders.

## Unit 3 — DONE 2026-07-29 (PR #104 merged, migration verified live)

Applied as `20260815120000 / funnel_waitlist_move`, verified against
production, and rehearsed end-to-end in a rolled-back transaction:

```
start        = draft/added
→ in_review  = in_review/in_review
→ waitlisted = waitlisted/waitlisted
→ invited    = invited/in_review      (the ordinary-menu path; no stranding)
→ offered    = offered/offered        (W7a: offer from waitlist works)
```

**A trap for anyone rehearsing this again.** The Management API connects
as `postgres`, not `service_role`. `children_status_guard` and
`children_applicant_state_guard` both coerce non-service-role writes, so
a naive rehearsal shows `status` never moving and `waitlisted` never
sticking — which looks exactly like a broken migration and is not. Set
the claim first:

```sql
perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
```

The rehearsal pattern itself is worth reusing: do the moves inside a
`do $$ … $$` block and end with `raise exception` carrying the collected
results. The raise guarantees rollback and the API hands the results back
in the error message, so production is read-only throughout.

## (historical) Unit 3 was BUILT and waiting — PR #104 (draft)

Everything except applying the SQL is done: the migration authored, the
RPC rewritten, the CRM vocabulary + move menu + queue filter wired, the
parked-promise rule, the stepper fallback, and 14 new tests. Suite 3,729
green on that branch.

**To land it:**
1. `select version, name from supabase_migrations.schema_migrations order by
   version desc limit 5;` — the file is named `20260815120000` on a guess
   from the repo listing, which the lock file says is not the truth in a
   two-lane repo. Rename if that slot is taken.
2. Apply `supabase/migrations/20260815120000_funnel_waitlist_move.sql`
   (transactional; every statement idempotent).
3. Mark PR #104 ready and merge. **Not before** — the code offers staff a
   waitlist button the DB CHECK would reject.

## What Peter needs to decide or supply

1. **A Management API token** (or run the migrations himself from the
   SQL editor, with the agent supplying reviewed SQL). Either works; the
   plan's migration ritual is unchanged: query
   `supabase_migrations.schema_migrations` for the next free version
   IMMEDIATELY before authoring, re-read `MIGRATION-LOCK.md` (Lane B —
   funnel — currently holds it, so no transfer is needed), keep every
   statement idempotent, `funnel_` prefix, version > `20260814120000`.
2. **Unit 6 also needs Google admin-console prework**, and the FIRST line
   of it is the one that can invalidate the rest:
   - **Verify the edition name.** The whole mailbox arc assumes an
     Education edition. Business/Enterprise editions bar under-18 account
     holders outright. If it is not Education, Units 6–8 halt and W10's
     contingency executes.
   - Then: a student OU with every service except Gmail off; a **custom
     admin role assigned directly to a service account** (user
     create/suspend + license management — NOT domain-wide delegation);
     DWD scoped to `gmail.settings.sharing` ONLY, for the per-user
     forwarding W14 needs; secrets into Vercel env, production scope only.

## Deploy-day checks for what already merged

- **Unit 5 is the one with a lockout risk.** Immediately after it deploys,
  have `peter@the120.school` and `ethan@the120.school` each run a password
  reset and confirm the mail arrives. They are the only two domain
  accounts that should be able to — the enumeration found 252
  `@the120.school` auth users and exactly those two are not `.fw`
  students. Watch for the retention cron's ops mail titled
  "auth-mail allowlist is missing a staff address": anyone it names is a
  human whose reset is being silently refused.
- **Unit 1 bumped the policy version to `2026-07-28.2`.** Checkout now
  refuses a stale tab with a 409 and asks it to refresh; a brief tail of
  those right after deploy is expected and should die off.
- **Unit 4**: `nurture_sends` offer rows should appear as `o3:<uuid>`,
  never bare `o3`. Two rows for one child id would mean a double nudge.

## Carried into the migration units

- **Unit 8 gained a requirement from the U2 review**: a standing capacity
  reconciliation in the retention cron sweep. U2's inline over-capacity
  page is best-effort — if the webhook is killed between the fulfil write
  and the 200, Stripe's retry is a `replay_noop` that can never re-alert.
  Today the only healing is that the next fulfilment past capacity pages
  again; the cron makes it durable.
- **Unit 6 gained a consent gate** (U1 shipped the artifact): provisioning
  must refuse to mint unless the fulfilled deposit carries a policy
  acceptance at-or-after `CONSENT_MIN_POLICY_VERSION`, compared with
  `policyVersionAtLeast` — never lexicographically. Deposits accepted
  before the bump park at `pending` with a staff-visible reason; run the
  count query and decide the re-consent touch before the gate deploys.
- **Unit 6's guard work has a head start**: the domain default-deny guard
  and its scheduled allowlist audit already exist
  (`app/lib/auth-mail-guard.ts`). What U6 adds is teaching it the
  funnel-student namespace so bare student addresses stop being reported
  as missing staff entries — see the test that pins exactly that.

## The open residual nobody can close in app code

`AccountModal`'s signup calls Supabase from the browser with the public
anon key. The form now refuses the school domain using the same verdict
function the server uses, but a crafted request bypasses browser code
entirely. Closing it needs a **project-level Supabase auth hook or email
domain deny-list** — configuration, not code. It pairs with the standing
ops invariant that no Workspace catch-all is armed. Recorded in
`REVIEWED_CALL_SITES` with that reasoning, and in
`docs/solutions/security-issues/a-default-deny-guard-cannot-ask-does-this-account-exist-on-a-public-path-2026-07-28.md`.
