---
title: "Merely CHECKING a lazily-created client resource CREATES it: `indexedDB.open()` makes the database, so \"is anything queued?\" cannot be asked without first answering \"was there ever a queue?\" — and on a user who never used the feature, a rejecting open then blocks them permanently on a queue that never existed. Gate on a separately-persisted usage signal BEFORE touching the resource — and know that such a gate can fail OPEN"
date: 2026-07-27
last_updated: 2026-07-27
category: best-practices
module: "path / First Profit (FW) — offline sign-out evidence gate (hasFwDeviceEvidence / readFwDeviceEvidence, app/fp/lib/fw-sync-rules.ts, app/fp/lib/fw-queue.ts)"
problem_type: best_practice
component: sync_engine
severity: high
applies_when:
  - "A predicate asks whether a lazily-created client resource holds anything — IndexedDB, Cache Storage, a first-touch localStorage bucket, an OPFS directory"
  - "That predicate runs for users who may never have used the feature that owns the resource (a shared surface, a global sign-out, an app-wide teardown)"
  - "The open/create call can REJECT for reasons unrelated to the data — storage policy, a locked-down profile, `onblocked` behind another tab — and the caller fails closed on that rejection"
  - "You are about to add a 'has this device ever used X?' heuristic built from client-side storage"
  - "A control is being mounted on a new surface where the component that previously initialised the resource is no longer co-mounted"
  - "A fail-closed default written for a DESTRUCTIVE consumer is about to be reused by a second, READ-ONLY consumer of the same gate"
  - "A probe's own side effect would change the answer that probe gives on every future call"
related_components:
  - app/fp/lib/fw-queue.ts (openFwDb, hasFwQueueDbOpened)
  - app/fp/lib/fw-sync-rules.ts (FwDeviceEvidence, hasFwDeviceEvidence)
tags:
  - indexeddb
  - lazy-initialization
  - side-effects
  - fail-closed
  - offline-sync
  - read-side-effects
---

# Checking a lazily-created resource creates it

## Context

`indexedDB.open(name)` is not a read. It **creates** the database if it does not
exist, and fires `onupgradeneeded` to let you build the schema. The same is true of
`caches.open()` and of the first write to a namespaced localStorage bucket.

So a function that asks "is the offline queue empty?" cannot answer without first
causing a queue to exist.

That is harmless for a user of the feature. It is not harmless for everyone else. In
this codebase, a sign-out verdict called into the queue unconditionally. On the browser
of a staff member who had never opened Founders Weekend, that:

1. created an FW queue database they had no use for; and
2. if the open **rejected** — Safari storage policy, a managed profile, `onblocked`
   behind another tab — returned `unreadable`, which correctly fails closed on a
   destructive path, and therefore **blocked their sign-out permanently**, on a queue
   that never existed and never could have held anything.

Failing closed was right. Asking the question at all was wrong.

## Guidance

**Gate on a separately-persisted signal that the user has actually used the feature,
and check it before touching the resource.**

```ts
export type FwDeviceEvidence =
  | { kind: "read"; cacheOwner: string | null; queueDbOpened: boolean }
  /** The READ ITSELF threw — carried as data so the fail-closed choice is made
   *  in one tested place rather than in a `catch`. */
  | { kind: "unknown" };

export function hasFwDeviceEvidence(e: FwDeviceEvidence): boolean {
  if (e.kind === "unknown") return true;   // could not look ≠ nothing there
  return e.cacheOwner !== null || e.queueDbOpened;
}
```

and in the sequence, before anything expensive or creating:

```ts
if (!hasFwDeviceEvidence(ports.readEvidence())) return { kind: "sign_out" };
// only now: take the lock, open the database, read the queue
```

Three properties worth copying:

1. **The gate runs before the lock, not just before the read.** A user who never used
   the feature pays nothing and creates nothing — no database, no lock acquisition.
2. **"The read threw" is a third state, carried as data.** Not a boolean, not a
   `catch` that guesses. `unknown` means *I could not look*, and on a destructive path
   that must never be read as *there is nothing here*.
3. **Prefer a signal you already write for another reason.** Here it is the identity
   key the app persists on every feature mount — a page that captured, drained, or
   cached anything has necessarily set it. A signal invented solely for the gate is one
   more thing that can be wrong.

## Why this matters

The harm is invisible and lands on the people least able to explain it: users who never
touched the feature, hitting a permanent block on a shared control. Nothing in the
error names the subsystem responsible, because from their perspective they never used
it.

## ⚠️ A usage-signal gate can fail OPEN. Know where.

This is the part that is easy to miss, and four independent reviewers converged on it.

The gate fails **closed** when the read throws. It can still fail **open** on a
*successful* read, because:

- the in-document "did this page open it" flag is per-document and `false` on every
  fresh load; so
- the gate rests entirely on the persisted key surviving; and
- **localStorage and IndexedDB are separate storage subsystems with independent
  eviction.**

Evict the key while the database survives with real data, and the gate reports "never
used this feature" for a device that is holding undrained work. The check is skipped
entirely.

`cacheOwner === null && !queueDbOpened` is genuinely ambiguous: it means *either*
"never used the feature" *or* "used it, and lost the marker". Client-side storage
cannot distinguish those.

In this codebase that is unreachable *today* only because the component that opens the
database is co-mounted on every layout that renders the control, so the flag is set
before a human could act. **That is incidental coupling, not a guarantee**, and it
stops holding the moment the control is mounted elsewhere.

**The fix is not to harden the heuristic.** When the same question is answerable
server-side — here, "is this actor an FW guide?", known at the layout — gate on that
instead. It is unambiguous, needs no storage archaeology, and cannot be evicted.

### RESOLVED 2026-07-27 (Staff Front Door Unit 3)

It stopped being incidental. The gate now takes the server-known signal first, then a
direct existence probe, and only then the old heuristic:

```ts
export function hasFwDeviceEvidence(input: {
  evidence: FwDeviceEvidence;
  actorIsFwGuide: boolean;   // SERVER-known at the layout. Cannot be evicted.
}): boolean {
  if (input.actorIsFwGuide) return true;
  const { evidence } = input;
  if (evidence.kind === "unknown") return true;                       // could not look
  if (evidence.queueDbExists !== null) return evidence.queueDbExists; // asked directly
  return evidence.cacheOwner !== null || evidence.queueDbOpened;      // legacy, bounded
}
```

Note both new branches carry real signal: staff hold no guide grants by design, so
`actorIsFwGuide` is genuinely `false` for the CRM-only user this gate protects. A
same-evidence/opposite-answer test pair pins it, because a branch that returns what its
fallback returns has no behavioural signature.

## ⚠️ THE SEQUEL: the same fail-closed default, reused on a READ, inverted it

This is the part the fix above did not anticipate, and five independent reviewers found
it.

`actorIsFwGuide` has to fail **closed** when identity has not resolved — an unresolved
actor is treated as a guide, so the queue IS checked, because under-checking authorises
a destructive clear. Correct.

Then a second consumer appeared: a status **badge** showing what the device is holding.
It reused the same value. And `hasFwDeviceEvidence` short-circuits on it — so on every
first mount, before the identity round trip could resolve, the badge sailed past the
gate into `openFwDb()` and **created the database on exactly the browser this entire
document exists to protect.**

Two things make it worse than the original bug:

- **It is self-perpetuating.** Nothing in the codebase deletes that database, so the
  existence probe now answers `true` for that origin *forever*. The zero-cost path is
  not just skipped once; it is permanently retired for that device.
- **It fires on the core scenario, not an edge.** The persisted identity is deliberately
  refused when it names a different account — which is precisely a device handover, the
  case the whole subsystem exists for.

**The rule: "fail closed" is not a property of a value. It is a property of a value
used by a particular consumer.** Its direction is set by what the branch authorises:

| Consumer | Under-checking costs | Over-checking costs | Correct default |
|---|---|---|---|
| Destructive gate (sign-out) | captured data | a wasted read | **fail closed** — assume the worst |
| Observational read (badge) | nothing; no badge for a moment | **an irreversible side effect** | **decline to act** |

So the fix is not one default, tuned. It is two separately-named, separately-tested
functions — `staffBarSignOutActorIsFwGuide` (fails closed) and `staffBarQueueProbe`
(returns "do not probe" until identity is known) — and a test asserting they *differ*
on the unresolved case. Collapsing them back is what recreates the bug.

The general trigger: **when a safety default is about to be shared, ask what each
consumer does with it.** A default is only "safe" relative to an action.

## When to apply

See `applies_when`. The sharpest trigger: **you are mounting an existing control on a
new surface.** Ask what the old surface was initialising that the new one is not.

## A note on `indexedDB.databases()` — SUPERSEDED 2026-07-27

The original text of this section argued against it: *"it is async, and it answers
'does a database exist' rather than 'did this actor ever use this feature' — which is
usually the question you actually have."*

**The second half of that was wrong, and the fix above is why.** "Does the database
exist" is in fact the better question for THIS gate, because it is the question the
side effect turns on: a database that does not exist holds no queue AND opening it is
the harm; a database that already exists can be opened for free. The distinction
between "does it exist" and "did this actor use it" only matters when you are trying to
attribute the data, which this gate is not.

The "async" objection survives, and grew teeth: `databases()` is documented to **hang**
rather than reject on some engines. The synchronous heuristic it replaced could not
hang, so bounding the probe with a timeout is what keeps the swap a strict improvement.
A timeout is carried out as the same `null` ("could not look") a rejection produces.

The third objection once cited — "Safari does not implement it" — was true of pre-2024
Safari and is **no longer true** (Baseline since May 2024). This repo carried that
claim in two comments until it was corrected, and then carried the superseded objection
above for one more unit. If you rely on a browser-support fact in a comment, date it —
and when you reverse the conclusion, rewrite the comment rather than deleting it, so
the next reader sees the reversal instead of re-deriving it.

## Related

- `docs/solutions/logic-errors/a-check-that-authorises-a-destructive-act-must-fold-over-the-same-classifier-derive-the-per-record-predicate-from-the-whole-set-counter-2026-07-27.md` — the fix this gate was added alongside.
- `docs/solutions/best-practices/offline-drain-reuses-a-fail-closed-signal-across-a-safety-boundary-irreversible-action-needs-tri-state-2026-07-24.md` — the tri-state rule this gate's `unknown` state applies; same subsystem, same ethos.
- `docs/solutions/best-practices/web-locks-are-not-reentrant-re-entry-hangs-instead-of-throwing-so-hold-the-lock-at-exactly-one-level-2026-07-27.md` — the gate deliberately runs before the lock this describes.
