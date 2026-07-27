Continue the Staff Front Door build in C:\Users\pkupe\aardvark\120-The120.

## Read first
- **`docs/LANES.md` — NEW, and it binds you.** Two worktrees now run in parallel on one
  machine against the **same live Supabase project**. You are **Lane A**. Read all four
  shared-state rules before touching anything; the two that will bite you are named
  under "Traps" below.
- Plan: docs/plans/2026-07-27-001-feat-staff-front-door-plan.md (12 units, 5 phases,
  status: active)
- Requirements: docs/brainstorms/2026-07-26-staff-front-door-requirements.md (R1–R26)

The plan's Key Technical Decisions section is load-bearing — several entries exist
because a review agent found the obvious approach was wrong. Units 1–4's checkboxes
record what shipped. **Unit 4's is long and you need all of it**: it carries two
decisions Peter took that reversed the plan's own defaults, and three open items he
still has to answer.

## State
Everything through Unit 4 is merged. `main` is at `3390b1d`.
- Unit 1 → PR #59, Unit 2 → #60, Unit 3 → #62, Unit 4 → #64 (all squash).
- **102 files / 2810 tests**, `tsc` clean, `next build` clean, `/staff` still `ƒ (Dynamic)`.
- **68 docs in docs/solutions/**; twelve now trace to this plan.
- **PR #63 landed from Lane B mid-session** (`chore(lanes)`) and added `docs/LANES.md`,
  `scripts/new-lane.ps1`, `supabase/MIGRATION-LOCK.md`. `main` moves under you now —
  see Trap 1.

Unit 4 mounted the bar in the three outermost guarded layouts, deleted all three
disagreeing sign-outs (`signOutFwGuide`, `FwSignOutButton`, CrmTabs' client signOut),
moved the cache-owner reconcile from `FwPwa` to `StaffBar`, and landed R12/R13/R14 as
pure functions in `fw-nav-rules.ts`.

## Do this next
**Unit 5 — Service-worker discipline and the dry-run checklist.** Requirements R18 plus
the origin's dry-run obligation. Dependencies: Unit 4, merged.

This closes Phase 3. Everything after it (Phases 4–5) is staff-only. **It is also the
reliability pass** — B4 and B5 have been carried since Units 1 and 2 and Unit 4 made B5
measurably hotter. Do not carry them a third time.

## THE CALENDAR IN THE PLAN IS STALE — read this before you plan anything
**Peter cancelled Boston (Aug 21–23) on 2026-07-27.** The target is September; the
Chicago rehearsal was already cancelled on 2026-07-23. His instruction, verbatim in
substance: *"Don't worry about deadlines. Just worry about building it right."*

Consequences you must act on:
- The plan's Phase-3-is-early rationale, its Risks table slip reasoning, and **the
  dry-run date itself** all argue from a dead premise. A note at the top of the plan's
  Documentation / Operational Notes says so.
- **The plan tells you to create `docs/plans/2026-08-17-fw-dry-run-checklist.md`. Do not
  use that filename.** Aug 17 is not a date any more. Name it without one
  (`docs/plans/fw-dry-run-checklist.md`) or with the date it is actually scheduled for,
  and say in the document that it is unscheduled. A checklist named for a date that
  passed unused is how it gets ignored.
- **Never let schedule risk decide scope in this plan again.** Unit 4's biggest decision
  turned on exactly this: the recommendation was "defer, it's core surgery days before
  Boston", and the moment Peter said Boston was cancelled the right answer flipped to
  fixing it properly. If your only argument for deferring something is the calendar, you
  have no argument.

## Surface these three to Peter EARLY — they are decisions, not tasks
Unit 4's review produced three items that need his answer before or during this unit.
Ask them in plain language, without jargon: he told Unit 4 he does not know what a
"sign-out interlock" or an "undrained capture" is, and he asks good questions when the
scenario is described concretely.

1. **Quarantined records are not actor-scoped** (three independent reporters). Unit 4
   scoped the sign-out interlock to the signing-out account for *foreign* captures, but
   `partitionFwQueue` cannot attribute a **quarantined** record to anyone — a record
   whose shape this build cannot read has no readable `actorUserId`. So one corrupted
   record left by a guide who has gone home still refuses an unrelated admissions
   staffer's sign-out, and the copy tells them to open Founders Weekend — an app they
   have never used — and dismiss it. This is the same gap Peter already ruled on once.
   **It is not fixable by scoping alone**: the fix needs a *resolved* identity, and the
   value is fail-closed-unresolved at the moment the button is tapped. That coupling is
   why it landed here rather than in Unit 4.
2. **No `deploymentId` is configured** (`next.config.ts`). A guide iPad left open across
   a deploy runs the old bundle: it completes the client-side residue clear — wiping the
   queue, roster and shell caches — and *then* calls a Server Action that no longer
   exists. The device looks clean and handed-over-ready; the session is still
   authenticated; the copy says "try again", which can never work, when only a reload
   can. Adding `deploymentId` changes deployment semantics, so it is Peter's call, not
   yours. Documented in
   `docs/solutions/best-practices/deleting-a-use-server-export-is-a-deploy-skew-hazard-…md`.
3. **The R16 fix made a real failure mode quieter.** The old refusal forced a human to
   notice a device holding someone else's captures. Now sign-out succeeds and those
   captures sit there silently — the only signal is the bar's queue chip, on that one
   device, once identity resolves. There is no log, table, or CLI query that can answer
   "which devices are holding un-landed work?". The agent-native reviewer's suggestion is
   a lightweight beacon reporting `{outcome.kind, queueRemaining, actorUserId,
   application}` on `clear_failed` / `queue_preserved`. That is new scope; get a decision
   rather than assuming.

## What Unit 5 owns
- **B4 — `loadFwSession()` has no `withFwTimeout`.** Both its `getUser()` and its
  `path_role_grants` select are bare, and it is the *first* thing `drainFwQueue` does,
  **inside the client's Web Lock**. `fw-sync.ts` wraps the per-cohort authz resolve forty
  lines later with the comment *"it runs inside the client's Web Lock, so an unguarded
  hang here would wedge the single-drainer"* — the call that runs first, in the same
  lock, has no such guard. Unit 1 bounded the client's leg (`40bdcc1`); the
  server-internal half is still unguarded. **A timeout is UNKNOWN → retry, never a
  terminal refusal.**
- **B5 — `requireStaff()` has no timeout on either Supabase call, and there is no
  `error.tsx` at `app/staff`, `app/crm`, or the app root.** Unit 4 made this
  quantifiably worse and the reliability reviewer measured it: `loadStaffBarIdentity()`
  now fires on **every fresh mount of three guarded layouts**, and it calls
  `loadFwSession()` — the B4 function — in a *separate request* that `cache()` cannot
  span. `/staff` and `/crm` pay a brand-new unbounded `getUser()` round trip that never
  happened on those surfaces before Unit 4; `/fp/fw` pays it twice per view. R23 means a
  hang degrades only the identity string, not the sign-out control — so this is cost and
  exposure, not a brick. Fix both halves together; they are one reliability pass.
- **`sw-discipline.test.ts`** pins `scope: SW_SCOPE` for `PathPwa` only. Add the
  equivalent for `FwPwa`, plus a repo-wide check that nothing outside `app/fp/fw/**`
  calls `serviceWorker.register`. Assert the general navigate clause still caches
  nothing.
- **The dry-run checklist**, as a standalone document (see the naming note above). The
  completed FW plan (`docs/plans/2026-07-23-001-feat-fw-cohort-sprints-plan.md`) is
  `status: completed` and is the historical record of what shipped — it gets a pointer,
  never an edit.

## The dry run is the ONLY coverage for three code paths — write the checklist accordingly
This repo runs `environment: "node"` with no jsdom, no IndexedDB, no Web Locks and no
service worker. These are untested by construction, not by oversight, and every one of
them can destroy a child's verified check-in:

- **`clearFwQueueUnlessBlocked`'s cursor path** (`app/fp/lib/fw-queue.ts`) — rewritten in
  Unit 4 from an all-or-nothing `store.clear()` to a three-way disposition with a
  selective cursor delete. Its only exercise is a hand-written fake port in
  `fw-sync-engine.test.ts`, which models the *semantics* but not the transaction
  mechanics. **Include a timing check at a realistic ~90-entry queue, not just a
  correctness check** — the transaction runs while the cross-document drain lock is held.
- **`withFwDrainLock`'s real `navigator.locks` branch.** On pre-15.4 Safari the fallback
  serializes within one document only — zero cross-tab protection — and Unit 4 tripled
  the surfaces that can trigger a reconcile.
- **Unit 3's handover preserve-vs-purge branches**, which decide whether a prior guide's
  captures survive a device changing hands.

Two more runtime properties nothing in CI can see, both flagged in Unit 4's review:
- **Sticky stacking.** The bar publishes `--staff-bar-h` from a `useLayoutEffect` and the
  two FW headers offset by it. Verify on a real 375px iPad that the weekend name is not
  covered by the bar when scrolled — that name is wrong-stamp prevention.
- **An orphaned reconcile.** The reconcile effect's `cancelled` flag gates only its
  `setState`, not the in-flight `writeOwner`. Rapid navigation between applications can,
  in principle, let an unmounted bar's reconcile complete *after* a newer one and stamp
  a stale owner key. 0.6 confidence, unreproducible in node.

## Settled — do not re-litigate
- **The bar takes only `application` and `actorUserId`.** Props to a client component
  serialize into the RSC payload and `/fp/fw` navigations are cached into
  `path-sw-fw-shell-v1`. `bar-wiring.test.ts` fails if you add a prop. A performance
  reviewer proposed special-casing the identity fetch off `/crm` and `/staff` (no SW
  there, so the rationale is weaker) — **declined**, because it gives the bar two
  identity paths, which is the "two predicates that must agree" shape Units 1 and 3
  exist to kill. The reasoning is recorded in `actions.ts`.
- **Mount in the outermost guarded layout per application only.** The set is asserted
  repo-wide.
- Sign-out renders **unconditionally** (R23). Identity degrades; the control does not.
- Unit 1's five-class queue classification and its ports shape.
- **R16 is scoped to the signing-out account** (Peter, 2026-07-27). Foreign undrained
  captures are `preserve`d and never block anyone's sign-out. `foreign_queue` is deleted
  from the refusal union — do not reintroduce it.
- **R13's copy renders server-side** (Peter, 2026-07-27), against the plan's client-side
  default. The cost is recorded in `fwPickerZeroState`'s docblock.

## Traps that will cost you if rediscovered
1. **`main` moves under you now.** Lane B ships to the same `main` from
   `C:\Users\pkupe\Aardvark\120-funnel`. **Rebase on `origin/main` immediately before
   opening your PR** (LANES.md rule 4). It is also why your checkout can change under
   you mid-session — Unit 4 lost four commits onto local `main` this way and had to move
   them back. **Check `git branch --show-current` before every commit.**
2. **You do NOT hold the migration lock.** `supabase/MIGRATION-LOCK.md` says Lane B.
   Unit 5 has no migration, so this does not bind you yet — **but Units 6, 7 and 10 all
   do**, and both worktrees point at the same live Supabase project where authoring *is*
   applying. Stop and ask Peter before authoring one; take the lock in the same PR.
3. **Web Locks are NOT reentrant — re-entry HANGS, it does not throw.**
   `withFwDrainLock` is the single blocking acquisition; `drainFwQueueOnce` is lock-free.
   `runFwSignOut` and `reconcileFwCacheOwner` each take it internally, exactly once.
4. **`FwPwa` must NOT be mounted globally.** Its Background Sync effect awaits
   `navigator.serviceWorker.ready`, which off `/fp/fw` matches no registration and NEVER
   SETTLES. It keeps SW registration and the queued indicator; only the reconcile moved.
5. **No jsdom, `environment: "node"`.** Every UI decision must be a pure exported
   function with a test. Three units running have had this as their headline finding.
6. **Source scans are defeated by the operator you did not think of.** Unit 4's testing
   reviewer walked through three of them with `||`, `==`, and `=== true ?` — with live
   proof, whole suite green. Anchor on operator *adjacency* (`isCompared` /
   `isBranchedOn` in `bar-wiring.test.ts`), or assert the absence of all operators where
   none is legitimate. **Mutation-test every scan you write, with a mutation you would
   not have written.** See the ROUND 2 section of
   `docs/solutions/test-failures/a-source-scanning-test-is-defeated-by-a-spelling-*.md`.
7. **A sentinel must not be an in-range value of the type it stands in for.**
   `queueRemaining = 1` on a thrown clear looked conservative and made a real IndexedDB
   fault identical to a legitimate preserve. See item 5 of
   `docs/solutions/best-practices/offline-drain-reuses-a-fail-closed-signal-*.md`.
8. **A gate's input ORDER encodes which input you trust first, and that is a claim about
   how each input is PRODUCED.** Unit 4's headline finding: a value that was safe first
   because it arrived as a synchronous server prop became a fail-closed *guess* when the
   control moved to a client component, and short-circuited the probe it was ordered
   ahead of. See ROUND 3 of
   `docs/solutions/best-practices/checking-a-lazily-created-client-resource-*.md`.
9. **`app/lib/**/__tests__/**`, `app/staff/**/__tests__/**`, `app/crm/__tests__/**` and
   `app/fp/**/__tests__/**` are ALREADY allowlisted.** A test anywhere else new makes
   `app/lib/__tests__/vitest-include-coverage.test.ts` fail and name the orphan. If you
   do add a glob, **append to Lane A's own commented block** — never interleave
   alphabetically (LANES.md rule 3).
10. **`fp-rename-straggler.test.ts` reads raw source lines including comments.** A
    fixture URL or a comment containing the old route prefix reddens it.

## Open items carried forward
- **Unit 4's `clear_failed` still refuses sign-out** when the roster or shell cache clear
  throws, leaving the session open. The trade-off is documented in `FwSignOutOutcome`:
  an un-ended session on a shared iPad is arguably worse than a stale cache, and the
  reason it still refuses is that ending silently is what made B3 invisible. **Revisit
  only with evidence from the dry run** — which is now your document to write.
- The plan's Deferred to Implementation section still has four unresolved items.
- **`bar-wiring.test.ts` does three jobs** (the bar, the `/fp/fw` picker, the CRM tab
  row). A reviewer wanted it split into `fw-nav-rules.test.ts` and a CRM sibling;
  declined in Unit 4 because moving the scans means triplicating the source-reading
  helpers. Pointer comments were added instead. Low priority, genuinely optional.
- **Two guards are deliberately un-mutation-covered** and labelled as such in source: a
  defence-in-depth `=== "remove"` whose sibling exhaustive switch makes it unreachable,
  and the `--staff-bar-h` ownership check that node has no DOM to exercise. Do not
  "fix" the labels by writing assertions that do not actually cover them.

## Steps — follow all five

**Step 1:** Run /ce:work on **Unit 5 (Service-worker discipline and the dry-run
checklist)**, using the plan's Unit 5 section + its Verification as the definition of
done. Fix B4 and B5 together, add the `FwPwa` SW-scope pins and the repo-wide
`serviceWorker.register` check, and write the dry-run checklist as a standalone document
with a filename that does not carry a dead date. Surface the three decisions above to
Peter early — they may change what you build. Run the full vitest suite AND
`next build`. **No migration** (and you do not hold the lock).

**Step 2:** Run the full /ce:review on the work. Not a partial review. (Expect reviewers
to probe whether the timeouts are UNKNOWN-→-retry rather than terminal refusals, whether
`error.tsx` actually catches what you think it catches, whether the SW scan can be
defeated the way Unit 4's three were, and whether the checklist names behaviour the dry
run can actually observe on a device.)

**Step 3:** Run the full /ce:compound on the work. Not a partial compound learning.

**Step 4:** **Rebase on `origin/main` first** (LANES.md rule 4), then commit, push and
merge — one PR per unit, squash, matching #57–#64. Update the plan's Unit 5 checkbox
with what landed, the re-measured suite counts, and any allowlist entries added. Leave
frontmatter `status: active` — **Unit 12 is the last unit**, not this one.

**Step 5:** Build the prompt to run the next unit (**Unit 6 — Archive schema migration**)
following the format of this prompt, at `docs/plans/NEXT-SESSION-unit-6.md`. When you
write its Steps section, **name Unit 6 explicitly** — a previous handoff carried a stale
Step 1 describing a unit that had already shipped, which cost a session start to detect.
**Unit 6 is the first unit in this plan that authors a migration, and Lane A does not
hold the lock** — its prompt must open with that, not bury it.

## Important rule
Protect all steps in each session. Keep a list at the bottom of the terminal with
progress across the 5 steps.
