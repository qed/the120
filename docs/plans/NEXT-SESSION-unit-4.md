Continue the Staff Front Door build in C:\Users\pkupe\aardvark\120-The120.

## Read first
- Plan: docs/plans/2026-07-27-001-feat-staff-front-door-plan.md (12 units, 5 phases, status: active)
- Requirements: docs/brainstorms/2026-07-26-staff-front-door-requirements.md (R1–R26)
The plan's Key Technical Decisions section is load-bearing — several entries exist
because a review agent found the obvious approach was wrong. Units 1–3's checkboxes
record what shipped; **Unit 3's is long and you need all of it**, because it carries a
deliberate deviation Unit 4 must finish, a tripwire that enforces it, and one open
question Unit 4 inherits.

## State
Everything through Unit 3 is merged. `main` is at e789877.
- Unit 1 → PR #59, Unit 2 → PR #60, Unit 3 → PR #62 (all squash).
- PR #61 was an unrelated brand/favicon commit that landed on the Unit 3 branch
  mid-review; it was split onto its own branch off main and merged first, then Unit 3
  was rebased. **If you find unrelated commits on your branch, do the same** — one PR
  per unit, matching #57–#62.
- **102 files / 2775 tests**, `tsc` clean, `next build` clean, `/staff` still `ƒ (Dynamic)`.
- No open branches except `feat/fw-board` (stale, unrelated).
- 67 docs in docs/solutions/; ten now trace to this plan.

Unit 3 built `app/lib/staff-bar/{bar-rules.ts,StaffBar.tsx,actions.ts}` — every decision
pure and tested in `bar-rules.ts`, the component composing only, and two Server Actions
(`loadStaffBarIdentity`, `signOutStaffBar`). **Nothing mounts it yet.** It also fixed
B1, B2 and B3 in the FW sign-out path.

## Do this next
**Unit 4 — Mount the bar and repair `/fp/fw`.** Requirements R8–R14, R15, R16, R18, R24.
Dependencies: Unit 3, merged.

This is the second half of Phase 3, the guide-facing slice. Phase 3 is deliberately
EARLY — it is the only slice that can regress live guide check-in, and Boston is
Aug 21–23 with Hamptons five days later. Everything after this (Phases 4–5) is
staff-only. Do not reorder.

## The one thing that must not be half-done
**Unit 3 did NOT remove `FwPwa.tsx`'s `reconcileFwCacheOwner` effect**, though the plan's
Unit 3 Files list said to. The Key Technical Decisions text says "removed *when the bar
takes it over*", and Unit 4 is what mounts the bar — deleting it a PR early would have
left `main` with **no** cache-owner reconcile on the one subtree where shared iPads
change hands.

**Unit 4 must mount the bar in `app/fp/fw/(app)/layout.tsx` AND delete FwPwa's reconcile
effect in the same change.** Not one or the other.

This is enforced, not remembered. `app/lib/staff-bar/__tests__/bar-wiring.test.ts` counts
reconcile owners mounted in the FW subtree and asserts exactly one:
- **0 owners** (you deleted FwPwa's effect without mounting the bar) → red
- **2 owners** (you mounted the bar and left FwPwa's effect) → red, and this is a real
  race on one localStorage key
That test names FwPwa as today's owner in its second assertion — **that is the assertion
you update**, and the count above is what stops you updating only half.

## Settled — do not re-litigate
Decided across two requirements reviews, one plan review, and three code reviews:
- Mount in the **outermost guarded layout per application only** — `app/staff/layout.tsx`,
  `app/crm/(app)/layout.tsx`, `app/fp/fw/(app)/layout.tsx`. The ops and cohort layouts
  NEST inside the FW one; mounting in all five renders the bar two or three levels deep.
- The CRM's six section tabs survive as their own row. Only identity and sign-out move up.
- Unauthenticated doors get nothing (R18) — which falls out of mounting in `(app)` groups
  rather than by URL prefix.
- The bar takes **only** `application` and an opaque `actorUserId` from the server.
  Everything role-derived is client-fetched. This is not stylistic — client-component
  props serialize into the RSC payload, and `/fp/fw` navigations are cached into
  `path-sw-fw-shell-v1`, so a prop-borne email or role leaves a cached shell that differs
  between a staff and a non-staff visit. **Do not add a prop to StaffBar**;
  `bar-wiring.test.ts` fails if you do.
- Sign-out renders UNCONDITIONALLY (R23). Identity degrades; the control does not.
- Unit 1's five-class queue classification and its ports shape are settled.

## Traps that will cost you if rediscovered
1. **Web Locks are NOT reentrant — re-entry HANGS, it does not throw.**
   `withFwDrainLock` is the single blocking acquisition; `drainFwQueueOnce` is lock-free.
   Both `runFwSignOut` and `reconcileFwCacheOwner` take it internally, exactly once.
   StaffBar takes no lock of its own and a test asserts it.
2. **`FwPwa` must NOT be mounted globally.** Its Background Sync effect awaits
   `navigator.serviceWorker.ready`, which off `/fp/fw` matches no registration and NEVER
   SETTLES. SW registration and the queued indicator stay in `/fp/fw`; only the
   reconcile moves to the bar.
3. **No jsdom, `environment: "node"`.** Every UI decision must be a pure exported
   function with a test. Unit 3's headline review finding was two decisions written
   inline in `StaffBar.tsx` where flipping either left all 218 tests green — five
   reviewers found it independently. **Unit 4 adds role-branched copy to
   `app/fp/fw/(app)/page.tsx` (R13/R14); put those decisions in a rules module**, which
   is what the plan's `fw-nav-rules.ts` test file is for.
4. **A branch that returns what its fallback returns has no behavioural signature.**
   Mutation-test any guard whose value is future-proofing.
   See docs/solutions/security-issues/an-inert-defensive-branch-has-no-behavioural-*.md
5. **Source-scanning tests are defeated three ways** — a regex pinned to the spellings
   you thought of, a substring satisfied by the COMMENT explaining it, and
   `process.cwd()`. Strip comments, anchor on semantics, resolve from `import.meta.url`.
   See docs/solutions/test-failures/a-source-scanning-test-is-defeated-by-a-spelling-*.md
6. **"Fail closed" is a property of a value USED BY A CONSUMER, not of the value.**
   Unit 3's P0: one fail-closed default shared between a destructive gate and a
   read-only badge made the badge CREATE the IndexedDB database the gate existed to keep
   off that browser — permanently. If you share a safety default, ask what each consumer
   does with it. See docs/solutions/best-practices/checking-a-lazily-created-*.md
7. **Tailwind v4 theme is not scopable.** `staffBarSkin()` in `bar-rules.ts` is the
   class-name swap; `/staff` currently maps to the `hq` token set and Unit 11 may move it
   to `crm`. It is a one-line table change plus one test line, by design.
8. **`app/lib/**/__tests__/**` and `app/staff/**/__tests__/**` are ALREADY allowlisted.**
   A test anywhere else new makes `app/lib/__tests__/vitest-include-coverage.test.ts`
   fail and name the orphan. `app/fp/lib/__tests__/fw-nav-rules.test.ts` is covered.
9. **`fp-rename-straggler.test.ts` reads raw source lines including comments.** A fixture
   URL or a comment containing the old route prefix reddens it. Fix the fixture.
10. Migrations apply to production immediately on authoring via the Management API.
    **Unit 4 has no migration.**

## What Unit 4 owns
- **Mount the bar** in the three outermost guarded layouts, passing `application` and
  `actorUserId` only.
- **Retire the disagreeing sign-outs.** `app/fp/fw/(app)/ops/layout.tsx` signs out via a
  bare `<form action={signOutFwGuide}>` with **no verdict, no drain, no evidence gate and
  no atomic clear** — a guide who is also staff can capture in the cohort view, then sign
  out from `/fp/fw/ops` and skip block-until-drained entirely, abandoning the queue.
  Both doors sit in the same `(app)` layout for the same actor. **Assert the retirement,
  do not assume it.**
- **`FwSignOutButton.tsx` still swallows the redirect digest.** It awaits
  `signOutFwGuide()` — which `redirect()`s — inside a generic `catch` with no
  `isNextRedirect` check, so a *successful* sign-out can report "Couldn't sign out just
  now." `StaffBar.tsx` has the fix (`if (isNextRedirect(e)) throw e;` before any
  `setMessage`) and a test pinning the ordering; copy that shape or retire the button.
- **R12/R13/R14 on `app/fp/fw/(app)/page.tsx`** — staff exempt from the single-cohort
  redirect, role-branched zero-cohort copy, hub link for staff only. `isStaff` is already
  computed at line 44, before the redirect at line 72.
- Delete FwPwa's reconcile effect and flip the tripwire (see above).

## Open items carried forward
- **B4 + B5 (P1, Unit 5).** `loadFwSession()` has no `withFwTimeout` and runs first inside
  the client's Web Lock; `requireStaff()` has no timeout on either Supabase call and there
  is no `error.tsx` at `app/staff`, `app/crm`, or the app root. **Unit 4 mounting the bar
  across three more layouts makes B5 hotter still — do not fix it here, but note if you
  make it worse.** Unit 3 already bounded its own new calls (`resolveStaffBarRoles`,
  `fwQueueDbExists`, the in-lock queue read); `signOutStaffBar`'s final `auth.signOut()`
  is deliberately UNbounded, because giving up on waiting there would report sign-out
  while the session lived.
- **NEW, needs a decision Unit 4 or 5 should surface to Peter.** Mounting the sign-out
  interlock on `/crm` means a CRM-only staff member can be refused sign-out by *another*
  account's stuck FW queue (`foreign_queue`), with a remedy outside their control ("that
  guide needs to sign in here"). **R16 scopes the constraint to "undrained captures for
  the signing-out account", so this exceeds the requirement.** Unit 1's five-class
  disposition is settled, so Unit 3 recorded it rather than changing it — but Unit 4 is
  what makes it reachable on `/crm`. Decide deliberately.
- **Unit 3's `clear_failed` refuses sign-out** when the roster or shell cache clear throws,
  leaving the session open. The trade-off is documented in `FwSignOutOutcome` — an
  un-ended session on a shared iPad is arguably worse than a stale cache, and the reason
  it still refuses is that ending silently is what made B3 invisible. Revisit only with
  evidence from the dry run.
- The plan's Deferred to Implementation section has four unresolved items.
- **Owed to Peter: the on-device dry run**, carried from Unit 1 and now more load-bearing.
  `fw-queue.ts`'s real IndexedDB path and `withFwDrainLock`'s real `navigator.locks`
  branch are node-only by design, so the atomic clear AND Unit 3's handover
  preserve-vs-purge branches rest on that run. Unit 5 owns the checklist document, but
  the reconcile is the code path that destroys a prior guide's captures if B2 is wrong.

## Steps — follow all five

**Step 1:** Run /ce:work on **Unit 4 (Mount the bar and repair `/fp/fw`)**, using the
plan's Unit 4 section + its Verification as the definition of done. Mount the bar in the
three outermost guarded layouts, retire the ops-layout and cohort-layout sign-out
controls, land R12/R13/R14, and delete FwPwa's reconcile effect in the same change that
mounts the bar in `/fp/fw`. Put every new role-branched decision in a rules module with a
test — not in a `.tsx`. Run the full vitest suite AND `next build`. No migration.

**Step 2:** Run the full /ce:review on the work. Not a partial review. (Expect reviewers
to probe whether the bar renders exactly once per page, whether any decision escaped into
a layout, whether the retired sign-out doors are actually gone rather than merely
unlinked, whether the 375px CRM contract still holds with two rows of chrome, and whether
the reconcile-owner count is still exactly one.)

**Step 3:** Run the full /ce:compound on the work. Not a partial compound learning.

**Step 4:** Commit, push, and merge to main (one PR per unit; squash, matching #57–#62).
Update the plan's Unit 4 checkbox with what landed, the re-measured suite counts, and any
allowlist entries added. Leave frontmatter `status: active` — **Unit 12 is the last
unit**, not this one.

**Step 5:** Build the prompt to run the next unit (**Unit 5 — Service-worker discipline
and the dry-run checklist**) following the format of this prompt. When you write its
Steps section, name Unit 5 explicitly — a previous handoff carried a stale Step 1
describing a unit that had already shipped, which cost a session start to detect.

## Important rule
Protect all steps in each session. Keep a list at the bottom of the terminal with
progress across the 5 steps.
