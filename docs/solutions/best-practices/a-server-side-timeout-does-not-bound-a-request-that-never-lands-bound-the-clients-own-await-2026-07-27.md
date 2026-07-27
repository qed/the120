---
title: "A server-side timeout bounds only what runs AFTER the request lands — it does nothing for a request that never lands. A captive portal drops the request silently and the client's fetch never settles; if that await sits inside a cross-document lock, ONE hang wedges every future acquisition across every tab until a full reload. Bound the client's own await, and dispose of a timeout as retry-with-queue-intact, not as failure"
date: 2026-07-27
category: best-practices
module: "path / First Profit (FW) — drain client/server boundary (drainFwQueueOnce, app/fp/lib/fw-sync-client.ts; withFwTimeout, app/fp/lib/fw-call.ts)"
problem_type: best_practice
component: sync_engine
severity: high
applies_when:
  - "A client awaits a Server Action, RPC, or fetch whose internals are individually timeout-guarded server-side, and you are treating that as 'the call is bounded'"
  - "The awaited call runs while holding a lock, a mutex, a transaction, or any exclusive resource"
  - "The product is used on venue wifi, hotel wifi, conference networks, cellular handoff, or anywhere a captive portal can intercept — `navigator.onLine` is TRUE behind one"
  - "A user-facing control awaits the call and shows a spinner with no independent bound"
  - "You are adding a timeout and must decide what a timeout MEANS for retry state, attempt counters, and idempotency"
related_components:
  - app/fp/lib/fw-call.ts (withFwTimeout, FW_CALL_TIMEOUT_MS, FW_ACTION_TIMEOUT_MS)
  - app/fp/lib/fw-sync-client.ts (drainFwQueueOnce)
  - app/fp/lib/actions/fw-sync.ts
tags:
  - timeouts
  - captive-portal
  - offline-sync
  - web-locks
  - server-actions
---

# A server-side timeout does not bound a request that never lands

## Context

This codebase already had a good timeout helper and used it conscientiously. Inside
the drain Server Action, the per-cohort authorization resolve was wrapped, with a
comment naming the exact risk:

```ts
// Bound the resolution: it runs inside the client's Web Lock, so an unguarded
// hang here would wedge the single-drainer (reliability P1b). A timeout is
// treated as UNKNOWN — retry, never a permanent reject.
const raced = await withFwTimeout(resolveFwActorForCohort(cohortId), `fw drain authz (${cohortId})`);
```

The reasoning is right. The coverage was not. That guard bounds a Supabase call
**inside** the action — meaning it only ever runs once the request has already
arrived at the server. The client's own leg was unguarded:

```ts
res = await drainFwQueue(runnable);   // no timeout, no AbortController
```

A captive portal does not reject. It does not return an error. It **silently drops the
request**, and the promise never settles at all. Nothing server-side can bound a
request the server never received.

That await happened while holding an origin-scoped, cross-document Web Lock. So one
hung drain — from a background kick, from a manual "Sync now", or from the sign-out
sequence itself — blocked every subsequent blocking acquisition **in every tab of the
origin**, including every future sign-out, with a full page reload the only escape and
nothing on screen to suggest it.

## Guidance

**Bound the client's own await, separately from anything the server does.**

```ts
/** The cap on ONE Supabase round trip. */
export const FW_CALL_TIMEOUT_MS = 8_000;

/** The cap on the CLIENT's wait for a whole Server Action round trip.
 *  Deliberately larger, and deliberately a separate number. */
export const FW_ACTION_TIMEOUT_MS = 30_000;

// The budget is a defaulted parameter, so every existing caller is unchanged.
export async function withFwTimeout<T>(
  promise: PromiseLike<T>,
  label: string,
  budgetMs: number = FW_CALL_TIMEOUT_MS
): Promise<{ timedOut: false; value: T } | { timedOut: true }> { /* … */ }
```

```ts
raced = await withFwTimeout(drainFwQueue(runnable), "drain action", FW_ACTION_TIMEOUT_MS);
```

Four rules that make this work rather than just fire:

1. **Two budgets, not one.** The per-call budget bounds one round trip. The action
   budget wraps a session load, an authorization resolve, the work, and per-item
   writes. Reusing the small one out here aborts legitimate slow-but-working calls —
   which is worse than no timeout, because it manufactures failures under load.

2. **Decide what a timeout MEANS, explicitly.** Giving up on waiting is not cancelling
   the request; it may still land. So a timeout must be disposed of as **retry with
   state intact**: leave the queue untouched, do **not** advance attempt counters
   toward a give-up ceiling, do **not** claim the session expired. Anything else
   converts a network hiccup into permanent state change. This is only safe because
   every item carries an idempotency key.

3. **Compose with an existing user-visible state rather than inventing one.** Here the
   timeout leaves the queue unchanged, so the sequence's re-check observes no progress
   and returns the state that already existed for exactly this situation — copy that
   names the captive portal instead of looping on "try again in a moment". No new
   state, no new string, no new branch in the UI.

4. **Test the shape that actually breaks you.** Not a rejection, not a slow response —
   a promise that **never settles**:

```ts
it("a promise that NEVER settles still resolves — the captive-portal shape", async () => {
  const dropped = new Promise<string>(() => {});
  const promise = withFwTimeout(dropped, "drain action", FW_ACTION_TIMEOUT_MS);
  await vi.advanceTimersByTimeAsync(FW_ACTION_TIMEOUT_MS + 1);
  await expect(promise).resolves.toEqual({ timedOut: true });
});
```

## Why this matters

`navigator.onLine` is `true` behind a captive portal. Every naive "are we online?"
check says yes, every retry re-issues a request into the same hole, and the honest
answer — *this device looks connected but cannot reach us* — is only reachable if
something bounds the wait.

The lock interaction is what turns an annoyance into an outage. Without a lock, a hung
request is one stuck operation. With a cross-document lock, it is every future
operation of that class, everywhere in the origin.

## When to apply

See `applies_when`. Two triggers deserve to be reflexes:

- **"The server guards this" is not the same as "this is guarded."** Ask where the
  guard starts running. If the answer is "once the request arrives", the client is
  unguarded.
- **Any `await` inside a lock needs a bound.** Not because it is likely to hang, but
  because the cost of it hanging is not proportional to its likelihood.

## Examples

**The gap, stated precisely:**

| | Bounded by a server-side timeout? |
|---|---|
| Slow DB query once the request arrives | ✅ yes |
| Server-side hang after arrival | ✅ yes |
| Request dropped in flight (captive portal) | ❌ **no — the server never runs** |
| DNS black hole / cellular handoff | ❌ no |
| Response lost on the way back | ❌ no |

## Related

- `docs/solutions/best-practices/web-locks-are-not-reentrant-re-entry-hangs-instead-of-throwing-so-hold-the-lock-at-exactly-one-level-2026-07-27.md` — the other way this same lock is held forever. Re-entry and unbounded awaits are the two halves; fixing one without the other leaves the wedge reachable.
- `docs/solutions/logic-errors/a-check-that-authorises-a-destructive-act-must-fold-over-the-same-classifier-derive-the-per-record-predicate-from-the-whole-set-counter-2026-07-27.md` — the change that widened the lock's scope to a whole sequence, making a hang block more than a drain.
- `docs/solutions/best-practices/offline-drain-reuses-a-fail-closed-signal-across-a-safety-boundary-irreversible-action-needs-tri-state-2026-07-24.md` — the tri-state disposition rule a timeout must follow: could-not-tell → retry, never the terminal action.
