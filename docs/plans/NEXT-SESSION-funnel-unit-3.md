Continue the First Profit funnel build in C:\Users\pkupe\Aardvark\120-funnel.

**You are Lane B.** This is a git worktree of the same repo as
C:\Users\pkupe\Aardvark\120-The120 (Lane A, building the Staff Front Door in parallel).
Read `docs/LANES.md` before your first command.

## Read first
- Lane contract: `docs/LANES.md`, and `supabase/MIGRATION-LOCK.md` (Lane B holds the lock
  — **Unit 3 authors a migration**, so confirm the holder line before writing it)
- Plan: `docs/plans/2026-07-27-002-feat-first-profit-funnel-plan.md` — the Unit 3 section
  in full, plus Key Technical Decision 3 (self-issued token over Resend, F8) and the
  Deferred bullet on whether the token table is new or extends `path_parent_invites`
  (U3 decides against real schema; its RESTRICT FKs and FW-specific columns may not fit).
- Requirements: R6, R7, R7a–R7d, R8 in
  `docs/brainstorms/2026-07-27-first-profit-funnel-requirements.md`
- The proven pattern end to end: `app/fp/lib/actions/invite.ts` (256-bit token, sha256 at
  rest, single-use CAS claim, rate-limit release on infra failure) and
  `app/unsubscribe/route.ts` (GET renders, POST mutates)
- `docs/solutions/security-issues/state-changing-email-links-mutate-on-get-scanner-prefetch-false-confirm-2026-07-16.md`
  and `docs/solutions/best-practices/in-memory-rate-limiter-toctou-race-and-fifo-eviction-clears-lockout-2026-07-22.md`
  (its own carry-forward says the in-memory store is inadequate at public-funnel volume —
  R7d requires DB-backed limiting keyed `${ip}:${normalizedEmail}` with a per-IP backstop)

## State
`main` is at `d32108f` (funnel Unit 2, PR #68). Units 1–2 are live: the schema
(`applicant_state`, `projects`, partial unique indexes, `entry_source` + consent
text/version columns), the pure rules modules (`applicant-rules`, `session-rules`), and
`account.ts` (provision-or-recognize; cookie-probe fail-closed; atomic compensation).
Lane A is on its Unit 6 and touches `app/staff/`, `app/lib/staff-bar/`, `app/crm/`,
`app/fp/fw/` — plus, note, BOTH lanes have appended to
`docs/solutions/test-failures/a-source-scanning-test-is-defeated-by-a-spelling-*.md`
today (it's at ROUND 5); if you extend it, rebase early.

- **110 files / 2949 tests**, `tsc` clean, `next build` clean, measured on main at
  `d32108f`'s parent branch.
- Port: `npm run dev -- -p 3001`. Lane A holds 3000.
- The Supabase Management API playbook for applying the migration:
  `docs/solutions/integration-issues/supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md`.
  Remember: **authoring a migration IS applying it to production.** Gate the
  `schema_migrations` insert on the apply succeeding; author idempotent; verify by
  SELECT; prove constraints in a rolled-back DO-block probe (the U1 shape).

## Do this next
**Unit 3 — Resume tokens and the return path.** R6, R7, R7a–R7d, R8. Dependencies: U2
(met). Files per plan: `supabase/migrations/<ts>_funnel_resume_tokens.sql`,
`app/lib/funnel/resume-rules.ts` (pure), `app/lib/funnel/actions/resume.ts`,
`app/resume/[token]/page.tsx` (read-only GET), `app/resume/[token]/ResumeForm.tsx`,
`app/lib/__tests__/funnel-resume-rules.test.ts`.

## The one thing that must not be half-done
**The token lifecycle and the rate limiter land together, DB-backed, in the same
migration.** R7d's limiter cannot be the in-memory store (documented TOCTOU + FIFO
eviction clears lockouts, and serverless instances don't share memory). The migration
must carry BOTH the token table AND the rate-limit store the endpoint needs, or U6 (which
reuses the same limiter shape for capture) inherits a second migration that was supposed
to be pure application code.

## Settled — do not re-litigate
- **Self-issued 256-bit token over Resend (F8).** Not Supabase `signInWithOtp` — the
  built-in mailer caps at 2/hour project-wide, PKCE breaks cross-device, no OTP precedent.
- **GET renders a button and establishes NOTHING; POST redeems.** Mail scanners fetch
  every URL (R7a; documented incident class).
- **The resume position is resolved server-side after redemption and never appears in the
  URL** (R7b). Redemption routes through `resolveReentry` (session-rules.ts) — the matrix
  is already built and tested; U3's landing supplies the context, it does not re-derive
  destinations.
- **Request-a-link responses are constant regardless of address existence** (R7c —
  enumeration).
- **No new Supabase auth-mail call**: the mail goes via Resend
  (`app/lib/email.ts` rails). `no-auth-mail-guard.test.ts` must stay green with no new
  `REVIEWED_CALL_SITES` entry.

## Carried into U3 from Unit 2's review (these are YOURS)
1. **Redemption self-heals a missing parents row.** A compensation-interrupted provision
   can strand an auth account with no parents row (undisclosed password, dead
   `email_exists`). Redemption proves inbox control — that is the moment the row can be
   safely recreated. Check-and-repair on redeem.
2. **Redemption owns session-vs-link family-identity reconciliation.** A valid link for
   family B clicked under a live session for family A: the token's family is resolved
   server-side and DECIDES; `ReentryContext` is single-family by contract (see the
   comment block on it). Sign the old session out or scope the new one — never hand the
   matrix a mixed context.
3. **How the session is minted at redemption**: same shape as account.ts? No — the
   account EXISTS here. Candidates: `admin.generateLink` is still off-limits
   (MAIL_CAPABLE + forges email_confirmed_at). The invite.ts precedent has no
   password to sign in with. You will need a shape for "mint a session for a known
   user id server-side without a password" — study what `app/fp/lib/actions/invite.ts`
   does AFTER acceptance for its created accounts, and note the U2 learning that
   `email_confirmed_at` must never be set as a side effect of a server call. If the
   clean shape requires admin-generated one-time credentials, rotate them atomically
   and never disclose. Decide deliberately, document in the module header.

## Traps that will cost you if rediscovered
1. **Authoring a migration applies it.** Idempotent DDL, gated schema_migrations insert,
   SELECT verification, rolled-back constraint probe. RLS enabled + zero policies on
   every new table (tokens table AND rate-limit table) — the anon key ships in every
   client bundle.
2. **Token at rest is sha256 only.** A DB read must never be a usable credential. CAS the
   claim on (id, unaccepted, token-hash) so a resend's rotation kills an in-flight
   redeem — invite.ts's exact shape.
3. **Rate-limit strikes are RELEASED on infra failure** (a DB outage is not a real
   attempt) and the DB-backed check must be race-safe: two concurrent requests for the
   same key must not both pass (the documented TOCTOU; use an atomic upsert/count, not
   select-then-insert).
4. **Migration-parity tests anchor on TABLE or CONSTRAINT names** — never a bare column
   name (`token_hash`, `status` are common). The U1/U2 parity-test shapes are the
   template (`app/lib/__tests__/funnel-migration-parity.test.ts`).
5. **`app/resume/**` is NOT in the vitest allowlist.** Decisions live in
   `app/lib/funnel/resume-rules.ts` (allowlisted); if you ever put a test under
   `app/resume/`, add the glob + a name-pinned assertion in
   `vitest-include-coverage.test.ts` in the same commit, in Lane B's reserved block.
6. **Scans only for absences; behavior gets a seam** (ROUND 5, source-scanning doc). The
   action takes a `deps` injection like `ProvisionDeps` so redemption/compensation
   branches are tested by execution, not regex.
7. **`redirect()` stays outside `try`** — a caught NEXT_REDIRECT reports failure on
   success; this repo has shipped that bug once.
8. **Email HTML escapes every user-supplied value** (`escapeHtml` from
   `app/crm/lib/library-rules` — invite.ts shows where).

## Open items (unchanged)
- External deps: hero photography (U5), mailbox provider (blocks U15), AI provider with
  ZDR (U10), moderation approach (U9), Ontario counsel on the refund deadline. None block
  U3. **U9/U10/U13/U15 will need Peter before their builds start** — batch the questions.
- U4 must not merge before U6 (or leave JoinButton wired).
- R64 (mobile-first) still owned by no unit; review-wait/waitlist/active-child screens
  still undesigned.

## Steps — follow all five
**Step 1:** Run `/ce:work` on **Unit 3 (Resume tokens and the return path)**, plan's Unit
3 section + Verification as the definition of done. Test-first on resume-rules;
mutation-test the enumeration and single-use guards (both look identical from outside
when wrong). Author + apply + verify the migration via the Management API. Full vitest +
`next build`.

**Step 2:** Full `/ce:review`. Expect probes on: GET-mutates-nothing (scanner prefetch),
single-use under concurrency, enumeration timing/response identity, rate-limiter TOCTOU,
the session-minting shape, the parents-row self-heal, cross-family redemption.

**Step 3:** Full `/ce:compound`.

**Step 4:** Rebase on origin/main (Lane A is active — expect movement), commit, push, PR
(squash, matching #57–#68), merge per the standing continuous-run authorization. Update
the plan's Unit 3 checkbox with what landed + re-measured suite counts.

**Step 5:** Write `docs/plans/NEXT-SESSION-funnel-unit-4.md` in this format. Name Unit 4
(Attribution and the sitewide CTA reroute) explicitly in its Steps section, and carry the
hard precondition forward: **U4 must not merge before U6 unless JoinButton stays wired.**

## Important rule
Protect all five steps. Keep the task list visible. Before authoring the migration,
confirm the lock in `supabase/MIGRATION-LOCK.md`; if Lane A has taken it, stop and ask
Peter.
