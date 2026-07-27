---
title: "Web Locks are NOT reentrant, and re-entry does not throw — it HANGS. A function holding `navigator.locks.request(name)` that calls anything which acquires the same name deadlocks silently, forever, with no error and no timeout. Split every lock-taking helper into a lock-free inner primitive plus exactly ONE blocking acquisition, and say so in the docblock"
date: 2026-07-27
category: best-practices
module: "path / First Profit (FW) — offline drain and sign-out (withFwDrainLock / drainFwQueueOnce, app/fp/lib/fw-sync-client.ts)"
problem_type: best_practice
component: sync_engine
severity: high
applies_when:
  - "A sequence must hold a lock across several steps (check → act, read → mutate → verify) and one of those steps is an existing helper that already acquires the same lock"
  - "You are adding a caller to a function whose name does not reveal that it takes a lock — `runXDrain`, `syncNow`, `flushQueue`"
  - "You are using `navigator.locks`, a Postgres advisory lock, a Redis lock, or any resource-holding async primitive whose re-acquisition QUEUES rather than errors"
  - "A user-facing control sits on a spinner with no timeout and no error, and the work it awaits is inside a lock"
  - "A single-writer guarantee is being extended from one document to a sequence spanning several awaits"
related_components:
  - app/fp/lib/fw-sync-client.ts (withFwDrainLock, drainFwQueueOnce, runFwClientDrain)
  - app/fp/lib/fw-sync-rules.ts (runFwSignOutFlow, FwSignOutPorts.withDrainLock)
tags:
  - web-locks
  - reentrancy
  - deadlock
  - offline-sync
  - concurrency
---

# Web Locks are not reentrant, and re-entry hangs rather than throwing

## Context

A mutex you can re-enter is common enough (Java's `synchronized`, .NET's `lock`,
Python's `RLock`) that "acquire it again from inside" reads as safe. The Web Locks API
is not one of those. Neither are Postgres advisory locks taken on separate sessions,
nor most distributed lock implementations.

The failure mode matters more than the fact: **re-entry does not throw.** A nested
`navigator.locks.request()` for a name the current context already holds is simply
queued behind a release that cannot happen, because the holder is blocked waiting for
the queue. There is no error, no rejection, no timeout, and no log line. The promise
never settles.

This surfaced while extending a sign-out sequence to hold one lock across
verdict → drain → re-verdict → clear. The drain step was an existing exported
function — `runFwClientDrain` — which already took the same lock. Calling it from
inside the sequence would have hung every sign-out, on every device, permanently.

## Guidance

**Split lock-taking helpers into two functions: a lock-free inner primitive that does
the work, and a thin outer wrapper that acquires the lock and calls it.** Callers that
already hold the lock use the inner one. Acquire at exactly one level.

```ts
const FW_DRAIN_LOCK = "fw-offline-drain";

/** THE ONE PLACE THE LOCK IS TAKEN — read this before adding a second. */
function withFwDrainLock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && "locks" in navigator && navigator.locks) {
    return navigator.locks.request(FW_DRAIN_LOCK, fn) as Promise<T>;
  }
  // Fallback: a module-level promise chain. See the limitation below.
  const turn = fallbackDrainChain.then(fn);
  fallbackDrainChain = turn.then(() => {}, () => {});
  return turn;
}

/** ONE drain pass — LOCK-FREE by design. Nothing in here may acquire the lock. */
async function drainFwQueueOnce(ctx, opts): Promise<void> { /* … */ }

/** The public, lock-taking entry point for callers that do NOT already hold it. */
export async function runFwClientDrain(ctx, opts): Promise<void> { /* … withFwDrainLock(…) … */ }
```

The sequence then passes the **inner** function as its drain step and takes the lock
once for the whole sequence.

Three supporting rules:

1. **Say it in the docblock, on both halves.** "LOCK-FREE by design; callers hold the
   lock themselves" and "THE ONE PLACE THE LOCK IS TAKEN". A hang has no stack trace
   pointing at the mistake, so the comment is the only warning a future caller gets.
2. **Name the hazard, not just the rule.** "Web Locks are not reentrant" is easy to
   read past. "Does not error, it HANGS forever" is not.
3. **`ifAvailable: true` is a different primitive, not a safer one.** It does not wait
   — the callback receives `null` instead. That converts a deadlock into a *silent
   skip*, where the inner work never runs and the caller sees a resolved promise as
   though it had. Both branches need a deliberate choice: background kicks skip, a
   user-waited action queues.

## Why this matters

The cost is asymmetric. A deadlock in a background sync is a stalled queue. A deadlock
in a lock a *user-facing control* awaits is a device that cannot complete the action,
with a spinner and no error, recoverable only by a full reload — which a person
mid-task has no reason to think of.

Because Web Locks are **origin-scoped and cross-document**, the blast radius is not
one component or one tab. One stuck holder blocks every future blocking acquisition
across every tab of that origin.

## When to apply

See `applies_when`. The strongest trigger: **you are about to call an existing helper
from inside a lock, and you have not read that helper's implementation.** Helper names
almost never encode "this takes a lock".

## Known limitation of the fallback path

When `navigator.locks` is absent, the fallback above is a module-level promise chain.
That is **per-document serialization only** — it does not exclude across tabs. Two tabs
on such a browser can run the sequence concurrently. If a docblock claims a cross-tab
guarantee, it must carve this out explicitly, or the fallback should refuse the
destructive path rather than silently degrade to a weaker guarantee than advertised.

In this codebase the atomic check-and-clear transaction, not the Web Lock, is what
actually prevents losing a racing write — so the fallback degrades safety-of-ordering,
not safety-of-data. Know which of those your lock is carrying.

## Examples

**The hang, concretely:**

```ts
// runFwSignOutFlow already holds "fw-offline-drain".
await ports.withDrainLock(async () => {
  let verdict = await verdictNow();
  if (needsDrain(verdict)) {
    await runFwClientDrain(ctx, { wait: true }); // ← acquires the SAME lock. Hangs here.
  }                                              //   No error. No timeout. Forever.
  // unreachable
});
```

**Verifying it:** grep the whole repo for every acquisition of the lock name, not just
the ones near your change, and confirm exactly one is blocking:

```bash
rg -n "navigator\.locks|fw-offline-drain"
```

(If that grep can silently miss a file, see the ripgrep NUL-byte doc below.)

## Related

- `docs/solutions/logic-errors/a-check-that-authorises-a-destructive-act-must-fold-over-the-same-classifier-derive-the-per-record-predicate-from-the-whole-set-counter-2026-07-27.md` — the fix that required holding the lock across a whole sequence in the first place.
- `docs/solutions/best-practices/a-server-side-timeout-does-not-bound-a-request-that-never-lands-bound-the-clients-own-await-2026-07-27.md` — the other way this same lock gets held forever: not re-entry, but an unbounded network await inside it. Read both; they are the two halves of "how this lock wedges".
- `docs/solutions/workflow-issues/a-literal-nul-byte-makes-ripgrep-treat-the-file-as-binary-and-skip-it-silently-2026-07-27.md` — why the verification grep above can lie.
