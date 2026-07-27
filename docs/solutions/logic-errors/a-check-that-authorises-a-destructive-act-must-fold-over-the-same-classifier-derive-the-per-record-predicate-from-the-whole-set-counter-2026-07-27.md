---
title: "A CHECK that authorises a DESTRUCTIVE ACT and the act itself were two hand-written predicates for one question, so one blocked or foreign queue entry made the verdict say `ok` and the clear say `cleared:false` — forever, on a shared device with no way out. Don't re-derive the act's predicate: express it AS the check's classifier applied to a single record, so the two agree by construction rather than by review"
date: 2026-07-27
last_updated: 2026-07-27
category: logic-errors
module: "path / First Profit (FW) — offline sign-out (runFwSignOutFlow + clearFwQueueUnlessBlocked, app/fp/lib/fw-sync-rules.ts, app/fp/lib/fw-queue.ts; both renamed from fwSignOutVerdict + clearFwQueueIfEmpty)"
problem_type: logic_error
component: sync_engine
severity: critical
symptoms:
  - "A guide iPad holding exactly ONE blocked (server-rejected) or ONE foreign (another account's) queue entry could not sign out, ever — the button showed \"A check-in just came in — try signing out again in a moment\", which was false and never became true"
  - "The verdict authorising sign-out returned `{ok:true}` while the clear it authorised returned `cleared:false` on the same queue, in the same tick"
  - "The only escape was a dismiss control on a banner reachable from one route; a staff member on any other surface had none"
  - "Both predicates were individually correct for the question each thought it was answering, and both were tested — nothing tested that they answered the SAME question"
root_cause: logic_error
resolution_type: code_fix
related_components:
  - app/fp/lib/fw-sync-rules.ts (classifyFwSignOutQueue, countFwSignOutBlockers, fwEntryClearDisposition)
  - app/fp/lib/fw-queue.ts (clearFwQueueUnlessBlocked)
  - authentication
tags:
  - check-then-act
  - destructive-action
  - offline-sync
  - predicate-drift
  - indexeddb
---

# Two predicates for one question, on a destructive path

## Problem

Sign-out from a Founders Weekend guide iPad asks two questions:

1. *May this device sign out?* — `fwSignOutVerdict`
2. *May this queue be destroyed?* — `clearFwQueueIfEmpty`

They are the same question asked of each record. They were answered by two
independently hand-written predicates:

- The verdict counted only entries that were **own** (this actor's), **un-blocked**,
  and **recognized** by the current schema.
- The clear used a bare `store.count()`, which counted **everything** — including the
  blocked tombstones and foreign entries the verdict deliberately excluded.

A device holding one blocked or one foreign entry therefore got `ok` from the check
and `cleared:false` from the act. The UI read `cleared:false` as "a check-in raced in
between the check and the clear" — a real, designed-for condition — and told the guide
to try again in a moment. Nothing would ever change. The device was wedged.

## Symptoms

See frontmatter. The tell is a **permanent** "transient" message: copy written for a
race condition, displayed for a state that is not a race and will not resolve.

## Why it survived review

This is the part worth internalising.

- Each predicate was correct in isolation. Neither is a bug you can see by reading one
  function.
- Each was tested. The tests asserted what each function does, not that the two agree.
- The defect shipped in the same commit that produced five solution docs, and survived
  that review pass. It was found three days later, during planning for the next
  feature — not by the tests, not by the review, and not by production.
- A doc written the day before the bug landed already named the abstract rule
  (`idempotent-primitive-plus-unconditional-caller-…-2026-07-23.md`: *"find the
  predicate the system already uses to decide Y is usable… Two definitions of
  'usable' are a bug waiting for the case where they disagree."*). Knowing the rule
  was not enough to avoid it in a sibling module.

## Solution

One classifier both sides fold over, and — the load-bearing part — the per-record
predicate **expressed as** the whole-set counter applied to a one-element array,
rather than as a second hand-written test of the same conditions:

```ts
// ONE classification. Reuses the existing recognition and actor-scope helpers
// rather than re-deriving either.
export function classifyFwSignOutQueue(
  raw: readonly unknown[],
  actorUserId: string
): FwSignOutQueueClassification { /* drainable | ownBlocked | quarantined | foreignUndrained | foreignBlocked */ }

// ONE definition of "not empty enough to wipe".
// ⚠️ `foreignUndrained` was REMOVED from this count on 2026-07-27 — see the addendum
//    at the end of this doc. The shape of the lesson is unchanged; the membership is not.
export function countFwSignOutBlockers(q: FwSignOutQueueClassification): number {
  return q.drainable.length + q.quarantined.length + q.foreignUndrained.length;
}

// The clear's per-record predicate IS the counter, applied to a singleton.
// ⚠️ Now `fwEntryClearDisposition`, returning "abort" | "preserve" | "remove". Same
//    derivation, three answers instead of two — see the addendum.
export function fwEntryBlocksSignOutClear(raw: unknown, actorUserId: string): boolean {
  return countFwSignOutBlockers(classifyFwSignOutQueue([raw], actorUserId)) > 0;
}
```

and the driver takes that predicate instead of holding an opinion of its own:

```ts
// Before — a second definition of "empty", inside the destructive act:
export function clearFwQueueIfEmpty(): Promise<{ cleared: boolean; count: number }>

// After — the caller supplies the SAME rule its verdict classified with:
export function clearFwQueueIfEmpty(
  blocksClear: (rawEntry: unknown) => boolean
): Promise<{ cleared: boolean; blocking: number }>
```

The clear still **re-counts inside its own transaction** — a tap can be enqueued in
the window between check and act, and that must still abort the clear. What changed is
that it re-counts *with the same rule*, instead of a different one.

## Why this works

Writing `fwEntryBlocksSignOutClear` as a call to `countFwSignOutBlockers` means there
is no second predicate that *can* drift. Editing the classification changes both sides
simultaneously, because they are literally the same two functions.

## The invariant this rests on — and it is not enforced by types

The singleton trick is only sound because the classifier is **per-record pure**: no
dedup, no caps, no ordering dependence. Each record's disposition depends solely on
its own fields, so classifying it alone yields what it would get in the full batch.

Nothing in the type system enforces that. `clear` accepts an arbitrary
`(raw: unknown) => boolean`, and the classifier's signature does not distinguish
"per-record safe" from "batch-only" logic. **Adding any cross-record rule — dedup by
`clientId`, a cap on counted blockers, a rule that reads another record's position —
silently reintroduces the exact divergence this fix removed**, and only one
example-based test would notice.

If you add batch-level logic to a classifier used this way, you must also stop
deriving the per-record predicate from it.

## Prevention

- **Before writing a predicate, grep for the one that already exists.** The resource
  name is the search term. Two definitions of one question is a bug with a timer on it.
- **When a check authorises a destructive act, derive the act's test from the check** —
  do not write a matching one. "Matching" is a property review has to verify on every
  future edit; "derived" is a property the compiler and the call graph maintain.
- **Test the agreement, not just the parts.** Assert that the per-record predicate and
  the whole-set count agree numerically on a mixed queue. Ideally assert it as a
  property over subsets, not one example — the repo has no property-testing library, so
  this is currently one hand-picked 5-record case.
- **Treat "transient" copy shown for a non-transient state as a P0 smell.** If a message
  says "try again in a moment", something must be able to change. Ask what.
- **A refusal must name an action available on the surface the user is standing on.**
  The original escape hatch existed on exactly one route.

## Related

- `docs/solutions/best-practices/offline-drain-reuses-a-fail-closed-signal-across-a-safety-boundary-irreversible-action-needs-tri-state-2026-07-24.md` — the immediately prior chapter of this same bug, in this same function pair. Its item #2 fixed the clear to be atomic *with itself* but never asked whether "atomic" and "the verdict's definition of empty" were the same predicate. Its code sample has been corrected to the current signature.
- `docs/solutions/logic-errors/idempotent-primitive-plus-unconditional-caller-rotated-a-live-credential-reuse-the-existing-verdict-2026-07-23.md` — the same shape (**drifted duplicate definition**) in guide credentialing, named one day before this defect shipped.
- `docs/solutions/logic-errors/retire-in-place-soft-delete-keeps-the-relationship-row-so-the-write-path-stays-reachable-guard-the-mutation-choke-point-2026-07-24.md` and `docs/solutions/logic-errors/confirmation-gate-in-one-entry-point-bypassed-by-retry-paths-and-re-read-live-state-2026-07-24.md` — the neighbouring but **distinct** shape: a guard that exists but does not cover every path. Worth reading together; they are two failure families, not one.
- `docs/solutions/best-practices/web-locks-are-not-reentrant-re-entry-hangs-instead-of-throwing-so-hold-the-lock-at-exactly-one-level-2026-07-27.md` — from the same fix.
- `docs/solutions/best-practices/checking-a-lazily-created-client-resource-creates-it-gate-on-a-separately-persisted-usage-signal-2026-07-27.md` — from the same fix.

---

## ⚠️ ADDENDUM 2026-07-27 (Staff Front Door Unit 4): the derivation held; one member of the set was wrong

Everything above is still the rule, and the rule is what made this next fix safe to
make. But two things in the code samples are now stale, and one *behavioural* claim in
the Problem section has been deliberately reversed. Read this before citing the doc.

**1. The symbols were renamed and the predicate became three-valued.**

| Then | Now |
|---|---|
| `fwEntryBlocksSignOutClear(raw, actor): boolean` | `fwEntryClearDisposition(raw, actor): "abort" \| "preserve" \| "remove"` |
| `clearFwQueueIfEmpty(blocksClear)` | `clearFwQueueUnlessBlocked(disposition)` |
| `{ cleared, blocking }` | `{ cleared, blocking, remaining }` |

The derivation is unchanged — the per-record answer is still
`classifyFwSignOutQueue([raw], actorUserId)` folded down, never a hand-written twin, and
the agreement test still pins that the whole-set counter and the per-record rule are
the same function. Only the arity of the answer changed.

**Why it needed three values:** the boolean was answering two different questions with
one bit. *"This record must not be destroyed"* and *"this record must stop the clear
happening at all"* are not the same requirement. Another account's un-landed capture is
the first without being the second — it must survive, but there is nothing about it that
should abort a clear of everything else.

**2. The foreign-entry half of the Problem statement is now reversed by design.**

The symptom above reads: *"a guide iPad holding exactly ONE blocked … or ONE foreign
(another account's) queue entry could not sign out, ever."* The **blocked** half was a
straightforward defect and stays fixed. The **foreign** half was fixed here in the wrong
direction — this doc made the check and the act agree, and they agreed on *refuse*.

R16 scopes the sign-out interlock to *"undrained captures **for the signing-out
account**"*. Refusing on another account's work exceeded that, and the excess had teeth:
a guide who walked off without signing out left a shared iPad that **nobody else could
ever sign out of**, with the only remedy — "that guide has to come back and sign in
here" — entirely outside the refused person's control.

The original justification for refusing was that reconciliation would destroy the
survivors, so blocking sign-out was what kept them alive. That premise was removed by a
later fix (the handover reconcile now preserves what it cannot ship). Once the premise
went, nothing was left holding the refusal up but its own inertia.

So `countFwSignOutBlockers` no longer counts `foreignUndrained`; the clear still refuses
to destroy it (`preserve`), and the staff bar's queue chip is what names the account it
belongs to. `foreign_queue` was deleted from the refusal union outright rather than left
unreachable.

**The transferable part — and the reason this is an addendum rather than a new doc:**
making a check and an act agree by construction guarantees they answer the *same*
question. It says nothing about whether that is the *right* question. Both properties
need review, and the first one passing makes the second easier to stop looking at.

**SECOND OCCURRENCE, CLOSED (Staff Front Door Unit 5, 2026-07-27, Peter's call).** The
sibling predicted below went exactly as predicted, and its fix carried a trap the first
occurrence did not have. `quarantined` left `countFwSignOutBlockers` — the same
correction as `foreignUndrained`, applied to the class Unit 4 could not reach, because
a record whose shape this build cannot read has no `actorUserId` to scope by; the
refusal was not merely excessive but *unactionable* (the person refused could not fix
it even in principle).

The trap: **dropping a class from the blocker count is only HALF the change.** A
quarantined record used to reach `abort` *through* the count, so removing it from the
count alone let it fall through `fwEntryClearDisposition`'s branches to the `remove`
tail — silently DESTROYING the one class defined as "un-landed work this build cannot
even read". The other half is the explicit `preserve` branch, and the mutation that
deletes it is pinned by name in `fw-sync-rules.test.ts` ("…and they are PRESERVED by
the clear, never removed — the half that must not drift"). When check and act fold over
one classifier, editing what the CHECK counts silently re-routes what the ACT does —
that is the coupling working as designed, and it cuts both ways.

> *As originally written:* `quarantined` records are also counted as blockers, and
> `partitionFwQueue` cannot attribute them to any actor at all — a record whose shape
> this build cannot read has no readable `actorUserId`. So a corrupted record left by a
> departed guide still refuses an unrelated staff member's sign-out, and the copy sends
> them into an app they have never opened to dismiss it. Three reviewers raised it
> independently. It is not fixed here because the fix needs a *resolved* identity that
> does not exist at the moment the button is tapped; it is recorded for the reliability
> pass.
