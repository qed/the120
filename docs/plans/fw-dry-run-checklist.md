---
title: Founders Weekend — device dry-run checklist
status: unscheduled
owner: Peter Kuperman
applies_to: the guide iPads, the staff laptops, and one projector
---

# Founders Weekend — device dry-run checklist

**This checklist is UNSCHEDULED.** It has no date and deliberately carries none in its
filename. The plan that commissioned it named
`docs/plans/2026-08-17-fw-dry-run-checklist.md`; Boston (Aug 21–23) was cancelled on
2026-07-27 and the Chicago rehearsal on 2026-07-23, so that date describes nothing. A
checklist named for a date that passes unused is how it gets ignored — so this one is
named for what it is, and gets a date only when a real one exists.

Run it before the next weekend, whenever that is. Nothing in it expires.

## Why this document exists at all

This repo runs `environment: "node"`. There is **no jsdom, no IndexedDB, no Web Locks
and no service worker** in CI. That is a deliberate constraint, not an oversight — but
it means a specific set of code paths have **no automated coverage of any kind**, and
several of them can destroy a child's verified check-in.

Every item in Part 1 is one of those paths. They are not "extra confidence". They are
the only test that will ever be run on them.

> **This is not a release gate.** Nothing here blocks a deploy. It is the list of things
> that can only be learned from a real device, written down so they are learned on
> purpose rather than during an event.

Related, and **never to be edited**:
[`docs/plans/2026-07-23-001-feat-fw-cohort-sprints-plan.md`](./2026-07-23-001-feat-fw-cohort-sprints-plan.md)
is `status: completed` and is the historical record of what shipped in the FW build. If
this dry run finds something, it changes the CODE and this file — not that plan.

## What you need

- **Two guide accounts** (call them A and B) with a grant on the same test cohort.
- **One staff account** that has *never* opened Founders Weekend — an admissions-only
  person is ideal. Several checks below are specifically about them.
- **One shared iPad**, Safari, at **375px** (portrait, no split view). Safari matters:
  it is the shared-iPad browser and it is the engine whose storage APIs behave worst.
- **A way to kill the network for real** — airplane mode, or better, a captive portal
  you have not signed into. `navigator.onLine` is *true* behind a captive portal, and
  several branches exist only for that case.
- A test cohort you are willing to leave junk in.

---

# Part 1 — the paths nothing in CI can reach

## 1.1 The selective queue clear, at realistic size

`clearFwQueueUnlessBlocked`'s cursor path (`app/fp/lib/fw-queue.ts`) was rewritten in
Unit 4 from an all-or-nothing `store.clear()` to a three-way disposition with a
selective cursor delete. Its only exercise is a hand-written fake port in
`fw-sync-engine.test.ts`, which models the **semantics** and not the **transaction
mechanics**.

- [ ] **Correctness.** As guide A, capture ~10 check-ins offline. Sign in as guide B on
      the same device and let the handover reconcile run. **A's captures must still be
      there** (the bar's queue chip shows a foreign count) and B's roster/shell caches
      must be fresh.
- [ ] **Timing at ~90 entries.** Build a queue of about ninety entries — a realistic
      full-weekend backlog for one guide — and time the clear. **The transaction runs
      while the cross-document drain lock is HELD**, so a slow one blocks every other
      tab's drain and every sign-out app-wide.
      - Record the wall-clock time here: `________ ms`
      - **Over ~500ms is a finding**, not a curiosity. Report it.
- [ ] **Mixed queue.** ~90 entries containing all five classes at once (own drainable,
      own blocked, quarantined, foreign undrained, foreign blocked). Confirm exactly the
      right ones survive: **own-blocked and foreign-blocked gone; quarantined and
      foreign-undrained still there.**

## 1.2 The real `navigator.locks` branch

`withFwDrainLock` uses `navigator.locks` where it exists and a single-document fallback
where it does not. **On Safari before 15.4 the fallback serializes within one document
only — zero cross-tab protection** — and Unit 4 tripled the number of surfaces that can
trigger a reconcile.

- [ ] **Two tabs, one device.** Open `/fp/fw` in two tabs. Tap sign out in both within a
      second of each other. Exactly one sequence should proceed; the other waits and
      then observes the result. **Neither tab may hang.**
- [ ] **Reconcile versus sign-out.** With a queue present, trigger a handover reconcile
      in one tab (fresh mount as a different account) while tapping sign out in the
      other. Nothing should wedge, and no capture should vanish.
- [ ] **Check the actual Safari version on the iPads in the room** and write it here:
      `____________`. If any is below 15.4, the two-tab guarantee does not exist on that
      device and that is worth knowing *before* an event, not during.

## 1.3 Unit 3's handover preserve-vs-purge branches

These decide whether a prior guide's captures survive a device changing hands.

- [ ] **Handover with un-landed work, offline.** A captures offline, closes the tab. B
      signs in on the same device, still offline. **A's captures survive**; B's session
      works.
- [ ] **Handover with un-landed work, online.** Same, but online. A's captures are still
      preserved — the drain scopes to the signed-in actor, so **no drain under B's
      session can ever ship A's work.** Confirm they are not silently drained *or* lost.
- [ ] **Handover with a failing cache delete.** Hard to force; if you can (fill storage,
      or deny it in Safari settings), the outcome must be `clear_failed`: the owner key
      is **not** advanced and the next mount retries.
- [ ] **First-ever FW use.** A brand-new device, guide A signs in. The key is adopted,
      **nothing is destroyed**, and no reconcile runs.

---

# Part 2 — the two runtime properties nothing in CI can see

## 2.1 Sticky stacking at 375px

The bar publishes `--staff-bar-h` from a `useLayoutEffect` and the two FW headers offset
by it. Two `position: sticky` elements that both resolve to `top: 0` do **not** stack.

- [ ] At **375px**, on `/fp/fw/ops` and on a per-cohort surface, scroll down and confirm
      **the weekend name is not covered by the bar.**
      **That name is wrong-stamp prevention** — it is how a guide knows which weekend
      they are checking a child into. If it is covered, this is a data-integrity bug
      wearing a CSS costume.
- [ ] Force the bar to **wrap to two lines** (a queue chip plus an error message at
      375px) and re-check the same two screens. The height is measured, not constant,
      and this is the case the constant would have got wrong.
- [ ] Rotate to landscape and back. The measurement must survive.

## 2.2 The orphaned reconcile

The reconcile effect's `cancelled` flag gates only its `setState`, **not the in-flight
`writeOwner`**. Rapid navigation between applications can in principle let an unmounted
bar's reconcile complete *after* a newer one and stamp a stale owner key. Confidence
0.6, unreproducible in node.

- [ ] Navigate fast between `/crm`, `/staff` and `/fp/fw` — a dozen times, quickly,
      while a handover reconcile is in flight (i.e. signed in as a different account
      from the one that last used the device).
- [ ] Then read `localStorage["fw.cacheOwner"]`. **It must equal the account you are
      currently signed in as.** Write down what you actually see: `____________`
- [ ] If it is ever the *other* account, that is the race, it is real, and it needs a
      generation guard on `writeOwner`. Say so in the report.

---

# Part 3 — the behaviour Units 1–5 introduced, on the accounts that will meet it

These are the plan's named integration scenarios. Each one is a sentence a real person
will read on a real screen.

- [ ] **Guide captures offline, walks to `/staff`, signs out** → refused, **with a
      count**, and the sentence tells them to stay signed in until they are back online.
- [ ] **Guide A leaves an undrained queue and closes the tab; staff B signs in and lands
      on `/staff`** → **B's sign-out works AND A's captures still exist or were
      drained.** Not merely "does not wedge" — check the captures.
- [ ] **CRM-only staff sign out normally** with no FW residue: no refusal, no chip, and
      **the FW IndexedDB database is never created on their browser** (check Storage in
      Safari's inspector — a database that appears here is B1 regressing).
- [ ] **Guide A signs in, closes the tab, device offline, guide B opens the same URL** →
      the cached shell shows **no email and no staff-only affordance.**
- [ ] **Guide-account rehearsal of Units 1 and 4** — the guide sign-out control and the
      guide picker page both changed and neither is staff-only. Walk both as a guide.
- [ ] **The captive-portal case.** Join a wi-fi you have not signed into, so `onLine` is
      true but nothing reaches us. Tap sign out with a queue.
      Expect **`drain_stalled`**: "this device looks connected but can't reach The 120".
      **Not** "try again in a moment" — that sentence is an infinite loop here.

## 3.1 Unit 5's own changes

- [ ] **A quarantined record no longer refuses anybody.** Put an unreadable record in the
      queue (edit one in the inspector to a bogus `schemaVersion`). Then:
      - As the **admissions staffer who has never used FW**, sign out from `/crm`. **It
        must succeed.** Before Unit 5 they were refused and told to open Founders
        Weekend and dismiss it there.
      - Confirm the record is **still on the device afterwards.** It stops blocking; it
        does not stop mattering.
- [ ] **The identity-unavailable boundary.** Throttle the network to near-zero (Safari's
      inspector can) and load `/crm` and `/staff`.
      - Expect **"We couldn't confirm your access just now"** with a working **Try
        again** — *not* a 404, and *not* "staff-only".
      - **Tap Try again with the network restored: the page must load.** This is the one
        that proves `unstable_retry` re-fetches rather than merely re-rendering.
- [ ] **A slow read must not evict a guide.** Same throttle, on `/fp/fw`. The guide must
      **not** be redirected to the sign-in door. B4's entire purpose.
- [ ] **The residue beacon.** *(Automatable — a script with Vercel log access can
      parse-and-shape-check this without a human; only the device half needs hands.)*
      After any `queue_preserved` or `clear_failed` above, search the deployment's
      runtime logs for `[fw/residue]`. Each should be one JSON object with stable keys:
      the outcome, the count (or `null`), the **sender** (`sessionUserId`), the
      **claimed actor** (`claimedActorUserId` — these differ exactly when a handover
      raced the report), the `deviceId`, and the application.
      - **This is a log line, not a table** — a table needs a migration and Lane A does
        not hold the migration lock. Confirm the line is there and legible; the
        persistent store is Unit 6's.
- [ ] **Version skew.** The one that needs two people. Leave the iPad open on `/fp/fw`.
      **Deploy.** Then, on the still-open iPad, tap sign out.
      - Expect a clean **reload**, then a normal sign-out.
      - The old behaviour: the device wiped its residue and then called a Server Action
        that no longer existed, leaving a device that *looked* handed-over-ready with a
        live session and a "try again" that could never work.
      - **If this still fails, `deploymentId` is not reaching the build.** Check that
        `VERCEL_DEPLOYMENT_ID` or `VERCEL_GIT_COMMIT_SHA` is present at build time, and
        that `<html>` carries a `data-dpl-id` attribute in production. *(That
        sub-check is automatable — curl the page and grep the attribute; only the
        two-person deploy-while-open sequence needs humans.)*

---

# Part 4 — reporting

Anything that fails here is worth more than a green test suite, because it is the only
place these paths get exercised.

- [ ] Write findings into `docs/solutions/` under the matching category, with the
      frontmatter (`module`, `tags`, `problem_type`) the other 68 docs use.
- [ ] **The one open decision this dry run is meant to settle:** Unit 4's `clear_failed`
      still **refuses sign-out** when the roster or shell cache clear throws, leaving the
      session open. The trade-off is recorded in `FwSignOutOutcome`: an un-ended session
      on a shared iPad is arguably worse than a stale cache, and the reason it still
      refuses is that ending silently is what made B3 invisible in the first place.
      **Revisit it only with evidence from here.** Record how often 1.3's failing-clear
      case actually fires, and what the person holding the device did next.
- [ ] Note the Safari version(s), the iPad model(s), and the venue's network shape. Every
      finding above is conditional on those, and next time the conditions will differ.
- [ ] **Before deleting any guide/staff ACCOUNT** (offboarding): query
      `path_fw_residue_reports` for that account first. Its rows CASCADE away with the
      account — deliberate, so telemetry never blocks a deletion — which means the
      pointer to "device D still holds their un-sent check-ins" vanishes with it.
      Recover the device's queue before the account, not after.
