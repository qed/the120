Continue the First Profit funnel build in C:\Users\pkupe\Aardvark\120-funnel.

**You are Lane B.** Worktree sibling of C:\Users\pkupe\Aardvark\120-The120 (Lane A,
Staff Front Door, active). Read `docs/LANES.md` first.

## Read first
- `docs/LANES.md`; `supabase/MIGRATION-LOCK.md` (Lane B holds it — **U4 needs no
  migration**; `entry_source` already exists from U1)
- Plan: `docs/plans/2026-07-27-002-feat-first-profit-funnel-plan.md`, the **Unit 4**
  section in full plus **Decision 4** (landing pages emit `?g=`/`?src=`, `/start` reads
  them — a Server Component `searchParams` read opts the WHOLE route into dynamic
  rendering and costs six indexable pages their static generation) and **Decision 10**
  (Tailwind v4 `@theme` is not scopable; class strings must be complete literals)
- Requirements R10–R18
- `docs/solutions/best-practices/tailwind-v4-theme-not-scopable-inline-literals-two-namespace-classname-swap-2026-07-22.md`
- `docs/solutions/workflow-issues/a-phased-plans-unit-boundary-is-a-schedule-not-a-proof-that-the-swap-is-atomic-2026-07-27.md`
  — governs the CTA reroute: a scheduled removal must verify its replacement is mounted
  **at that moment**

## State
`main` is at `12d8b8a` (funnel Unit 3, PR #70). Branch `feat/funnel-unit-4` from
`origin/main`.

Units 1–3 are live and merged:
- **Schema**: `children.applicant_state`, `projects`, R2/R52a partial unique indexes,
  `families.entry_source` + consent text/version, `funnel_resume_tokens`,
  `funnel_rate_events`.
- **Modules**: `applicant-rules` (state machine), `session-rules` (R9a matrix +
  `screenRoute`), `account.ts` (provision-or-recognize, stamps
  `app_metadata.funnel`), `resume-rules` / `resume-store` / `resume-core` +
  `/resume/[token]`.
- **Reusable for U4/U6**: `checkFunnelRateLimit` (exported from `resume-store.ts`) is
  the DB-backed limiter — **import it, do not re-derive it**. `Group` in
  `app/lib/site.ts` already carries `headline`, `subhead`, `hero`, `phaseToken`
  (`--color-phase-*`, mapped per brief §3.3/D9) and `FIRST_PROFIT_LANDING`.
- **113 files / 3009 tests**, `tsc` / `next build` / eslint clean at `12d8b8a`.
- Port: `npm run dev -- -p 3001`.

## Do this next
**Unit 4 — Attribution and the sitewide CTA reroute.** R10–R18. Dependencies: Unit 1
(met). Files per the plan: create `app/lib/cta-source.ts` +
`app/lib/__tests__/cta-source.test.ts`; **extract, do not delete**
`app/2026-27/cta-source.ts`; modify `app/components/{Nav,CtaBand,Hero,GroupsBand,
ScholarsTuition}.tsx`, `app/2026-27/{MidPageCta,RedCtaBand}.tsx`, `app/tuition/page.tsx`,
`app/scholars/page.tsx`, `app/groups/[slug]/page.tsx`; add
`app/lib/__tests__/door-colors.test.ts`.

## The one thing that must not be half-done
**`app/2026-27/cta-source.ts` has 17 importers, not two.** Only `attributedBookingUrl`
has two call sites. The file also exports `type Audience` (imported by `SubNav.tsx`,
`ProgramContent.tsx`, `path-criteria.ts` and ten files under `app/2026-27/sections/`),
`ctaLabels`, `seatsDisplay`, and `WAITLIST_LABEL` — which R52b wants to reuse. **Move
`SRC_MARKER` and `attributedBookingUrl` out; leave the page-local vocabulary in place.**
Deleting the file is a 17-file breakage.

## ⚠️ The hard precondition — U4 MUST NOT MERGE BEFORE U6
`app/components/account/AccountModal.tsx` holds the **only `signUp()` in `app/`**. U4
reroutes every `JoinButton` away from it and R18 removes "Book a call" at the same time.
If U4 lands alone, a visitor can neither create an account, book a call, nor advance —
and nurture (the recovery mechanism) does not arrive until U17.

**So: build U4 fully, but land it behind U6, or leave `JoinButton` wired.** Concretely,
your options, decide deliberately and say which you chose in the PR:
1. Build U4 and U6 in sequence and merge U6 first (the plan's preferred order — but U6
   depends on U2/U3, both now met, so this is available).
2. Build U4 with the reroute behind a flag/constant that flips in U6's PR.
3. Build U4's attribution + door colours only, and defer the `JoinButton` swap itself
   to U6.
Do NOT merge a reroute whose destination does not yet create accounts.

## Settled — do not re-litigate
- **The Gauntlet's account modal does NOT reroute.** `app/gauntlet/ComingSoon.tsx:44`
  and `app/gauntlet/GauntletGame.tsx:315-333` use `openAccountModal` as a functional
  signup gate for tournament entry, not a marketing CTA.
- **`app/dashboard/SignIn.tsx:168` ("Create an account") stays.** R9 preserves it; it is
  not a marketing surface; it is the app's only remaining `signUp()` path.
- **13 `JoinButton` JSX usages plus one direct `openAccountModal`.** The three preserved
  sites above must be asserted as still present **by count**, so a later sweep cannot
  silently remove them.
- **Door colour tokens are `--phase-*` / `--color-phase-*`** in `app/globals.css`. The
  brief's `--tp-phase-*` spelling exists nowhere in this repo. `Group.phaseToken`
  already holds the correct names — map them to **complete literal class strings**;
  Tailwind's scanner cannot see `` `text-${g.phaseToken}` `` and a templated class
  compiles to nothing while looking right in source.
- **Landing pages EMIT `?g=`/`?src=`; they never READ them** (Decision 4). No Server
  Component in `app/groups/`, `app/first-profit/` or the home page may touch
  `searchParams`.
- `entry_source` is stamped ONCE, immutably, at C1 (U6's job). U4 produces the marker;
  U6 writes it; U16 reads it back.

## Traps that will cost you if rediscovered
1. **R16's contrast check is real work.** Gold (`--phase-scale`, 41 88% 52%) and coral
   (`--phase-sell`, 14 78% 54%) on `#f7f6f3` paper are both expected to FAIL WCAG AA at
   small text sizes. Ship darkened text-safe variants for labels; keep the raw tokens
   for chips/underlines. Assert contrast **numerically** in `door-colors.test.ts`, not
   by eye.
2. **`MatchOrCreateInput` / `buildLeadInsert` in `app/crm/lib/families-rules.ts` write a
   closed literal row and silently drop unknown fields.** That is U6's problem, but if
   you touch the source vocabulary, note it in the handoff.
3. **A source scan for "no marketing surface renders JoinButton" must strip comments and
   resolve paths from `import.meta.url`** — and must anchor on the SHAPE, not a
   spelling. Read ROUNDs 1–6 in
   `docs/solutions/test-failures/a-source-scanning-test-is-defeated-by-a-spelling-*.md`
   before writing it; every round is a scan that passed while broken.
4. **Prefer a behavioural test to a scan wherever a seam exists** (ROUND 5), and cut any
   seam at the OPERATION, not at a dependency's client type (ROUND 6).
5. **`/2026-27`'s existing Cal.com attribution must still work** — that is the unit's
   stated Verification. Test it, don't assume it.
6. **`next build` route table before and after**: no route may regress from static to
   dynamic. Capture the before-table first.

## Open items
- **Batch for Peter before their units start:** U9 moderation approach, U10 AI provider
  with ZDR (forecloses Fable 5) + model/effort sweep, U13's review-wait and waitlist
  screens (no design exists), U15's mailbox provider + funnel-student address
  convention, Ontario counsel on the refund deadline vs the CPA cancellation right.
  None block U4.
- Lane A owns two abbreviated deadline literals (`app/crm/lib/engine.ts`,
  `DepositThermometer.tsx`) carved out of `site-deadline.test.ts` by a self-expiring
  test.
- R64 (mobile-first, one-handed) is still claimed by zero units.

## Steps — follow all five
**Step 1:** `/ce:work` on **Unit 4 (Attribution and the sitewide CTA reroute)**, using
the plan's Unit 4 section + Verification as the definition of done. Decide and document
the U4-before-U6 landing strategy. Full vitest + `next build` with the route table
compared.

**Step 2:** Full `/ce:review`. Expect probes on the 17-importer extraction, the three
preserved call sites, contrast numbers, templated Tailwind classes, static-to-dynamic
regressions, and whether the reroute can strand a visitor.

**Step 3:** Full `/ce:compound`.

**Step 4:** Rebase on origin/main (Lane A is active), commit, push, PR (squash, matching
#57–#70), merge per the standing continuous-run authorization — **subject to the
U4/U6 precondition above**. Update the plan's Unit 4 checkbox + re-measured counts.

**Step 5:** Write `docs/plans/NEXT-SESSION-funnel-unit-5.md` in this format, naming
**Unit 5 (The landing template, six times)** explicitly — or Unit 6 if you chose to
reorder for the precondition. Say which, and why, in the first line of its State section.

## Important rule
Protect all five steps. Keep the task list visible. No migration should be needed; if
you think one is, re-read the plan before authoring — authoring applies it to production.
