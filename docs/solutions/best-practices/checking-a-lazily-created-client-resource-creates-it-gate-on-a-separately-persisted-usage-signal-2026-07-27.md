---
title: "Merely CHECKING a lazily-created client resource CREATES it: `indexedDB.open()` makes the database, so \"is anything queued?\" cannot be asked without first answering \"was there ever a queue?\" — and on a user who never used the feature, a rejecting open then blocks them permanently on a queue that never existed. Gate on a separately-persisted usage signal BEFORE touching the resource — and know that such a gate can fail OPEN"
date: 2026-07-27
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
related_components:
  - app/fp/lib/fw-queue.ts (openFwDb, hasFwQueueDbOpened)
  - app/fp/lib/fw-sync-rules.ts (FwDeviceEvidence, hasFwDeviceEvidence)
tags:
  - indexeddb
  - lazy-initialization
  - side-effects
  - fail-closed
  - offline-sync
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

## When to apply

See `applies_when`. The sharpest trigger: **you are mounting an existing control on a
new surface.** Ask what the old surface was initialising that the new one is not.

## A note on `indexedDB.databases()`

It is tempting as a way to ask "does this database exist" without creating it. Two
real objections remain: it is async, and it answers *does a database exist* rather than
*did this actor ever use this feature* — which is usually the question you actually
have.

A third objection often cited — "Safari does not implement it" — was true of pre-2024
Safari and is **no longer true**. This repo carried that claim in two comments until it
was corrected. If you rely on a browser-support fact in a comment, date it.

## Related

- `docs/solutions/logic-errors/a-check-that-authorises-a-destructive-act-must-fold-over-the-same-classifier-derive-the-per-record-predicate-from-the-whole-set-counter-2026-07-27.md` — the fix this gate was added alongside.
- `docs/solutions/best-practices/offline-drain-reuses-a-fail-closed-signal-across-a-safety-boundary-irreversible-action-needs-tri-state-2026-07-24.md` — the tri-state rule this gate's `unknown` state applies; same subsystem, same ethos.
- `docs/solutions/best-practices/web-locks-are-not-reentrant-re-entry-hangs-instead-of-throwing-so-hold-the-lock-at-exactly-one-level-2026-07-27.md` — the gate deliberately runs before the lock this describes.
