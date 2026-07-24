---
title: "An offline-replay drain reuses signals across a SAFETY BOUNDARY: a read/verdict/type-guard that is safe to fail-closed (or fail-open) for authorization or display becomes PERMANENT DATA LOSS when the same collapsed signal drives an irreversible drain action (reject, clear, route-online). Make the disposition TRI-STATE — success / genuine-no / could-not-tell-→-retry — at the boundary where it turns a captured tap into an append-only fact"
date: 2026-07-24
category: best-practices
module: path-fw-offline
problem_type: best_practice
component: sync_engine
severity: high
applies_when:
  - "A drain/replay layer reuses an existing read or verdict — one written to fail-CLOSED (deny) for authorization, or to collapse errors into a benign default for display — to decide whether to permanently REJECT, DISCARD, or CLEAR queued work"
  - "An authorization resolver collapses `read failed` and `genuinely not authorized` into one falsy result (safe: an outage denies access, and access is retryable) and that same result is then used to write a terminal reject into an append-only log"
  - "A boolean type-guard (`x is T`) is reused as BOTH the drain-eligibility gate AND the display/dismiss gate, so a record that fails the guard becomes invisible to the very surface meant to let a human recover it"
  - "A capture path branches on `navigator.onLine` to choose online-vs-offline, treating a link-layer `true` as proof the backend is reachable"
  - "A sign-out / cache-clear reads the queue UNSERIALIZED (or fails OPEN on a read error) and then unconditionally clears — the emptiness check and the destructive clear observe different snapshots"
related_components:
  - authentication
  - database
tags:
  - offline-sync
  - fail-closed
  - data-loss
  - drain
  - tri-state
  - append-only
  - authorization-reuse
  - navigator-online
---

# Offline drains reuse signals across a safety boundary — an irreversible action needs a tri-state, not a reused fail-closed "no"

## Context

FW Unit 8 (Founders Weekend offline capture) is a drain that replays queued guide
check-in taps into a **shared append-only event log**. Its pure fold (minimal-legal
reduction × same-actor guard × reject) was reviewed hard and came back sound. Every
P0/P1 the 13-persona review found lived in the SURROUNDING composition, and four of
them turned out to be **the same mistake wearing four costumes**: a signal that was
correct and safe for its ORIGINAL purpose was reused, unchanged, to drive an
IRREVERSIBLE drain action — and at that new boundary the collapse it was designed
around became permanent data loss.

The whole feature exists to guarantee "a 20-minute outage loses nothing and misleads
no one." Each of these bugs violated exactly that guarantee, and none was in the logic
everyone was watching.

## Guidance

**When a drain/replay layer reuses a read, a verdict, a type-guard, or a
connectivity flag to decide whether to permanently reject, discard, clear, or
route-away a captured unit of work, stop and ask: what does this signal do when it
CANNOT TELL? If the honest answer for the original caller was a safe default
(fail-closed to "deny", fail-open to "empty", collapse to "not recognized"), that
same default is now a DATA-LOSS verdict.** Give the disposition three outcomes at the
boundary, not two:

- **success / genuine result** → act,
- **genuine no** (positively confirmed) → the terminal action (reject / clear / route),
- **could-not-tell** (a read error, a timeout, an unparseable shape, an unreachable
  backend) → **retry / preserve**, never the terminal action.

The four costumes, each with its fix:

### 1. A fail-CLOSED authorization read becomes a permanent reject

`resolveFwActorForCohort` collapses `read failed` and `genuinely not a guide` into one
`{ok:false}` — correct for a PAGE gate (an outage denies access; the guide refreshes).
The drain reused that verdict to decide "revoked guide → write a `reauth_failed` reject
for every queued tap." On venue wifi — the exact operating condition — a transient
grants-read blip then permanently discarded a guide's real captures to a staff-only
reject. Retrying the resolver does not help: `loadFwSession` is request-memoized, so
the same request re-reads the same blipped result.

**Fix — tri-state at the drain, by probing the reads the verdict depends on:**

```ts
// The verdict rests on THREE independent reads (grants, cohort, staff row), each of
// which fail-closes to "no" on its OWN error. Probe ALL of them with fresh reads:
// any unreadable → the refusal COULD be a blip → unknown (retry); only when all read
// cleanly is the refusal trusted as a genuine revoke (→ reject).
if (verdict.ok)                    authorizedCohortIds.push(cohortId);
else if (await probeAuthReadable(db, userId, cohortId)) { /* genuine revoke → reject */ }
else                               unknownCohortIds.push(cohortId); // blip → retry
```

`runFwDrain` then rejects only cohorts in NEITHER set, and retries `unknownCohortIds`.
Probe the tables the verdict actually depends on — probing one unrelated table (we
first probed only `path_cohorts`) misses an independent blip in the grants/staff read.

### 2. A fail-OPEN sign-out read wipes an undrained queue

`fwSignOutVerdict` originally caught any IndexedDB read error and returned `{ok:true}`
("a queue we cannot read must not trap a guide"). But `ok:true` then ran
`clearFwQueue()` — a blind `store.clear()`. A transient read error on a device that
still held captures destroyed them. Fail-OPEN was safe for "don't trap the guide" and
data-loss for "then clear everything."

**Fix — fail CLOSED on the read, and make the clear itself conditional and atomic:**

```ts
// The verdict fails CLOSED (blocks sign-out) on a read error — never fail-open-then-destroy.
catch (e) { return { ok: false, reason: "unreadable", queuedCount: 0 }; }

// The clear is atomic count-then-clear in ONE transaction, serialized on the write
// chain, so a tap enqueued in the gap makes it a no-op and the caller ABORTS sign-out:
export function clearFwQueueIfEmpty(): Promise<{ cleared: boolean; count: number }> { … }
```

### 3. A reused type-guard makes a quarantined record invisible, then destroyed

`isRecognizedFwEntry` (`x is FwQueueEntry`) gated BOTH "is this drainable?" and,
transitively, "is this displayable?". A cross-deploy record that failed the guard was
"quarantined" by re-writing it with a `blocked` note and the cast
`{...record, blocked} as FwQueueEntry` — but adding `blocked` never fixed what made it
fail (a `schemaVersion` bump), so it failed the guard again on every later read, never
entered the surfaced set, and was silently wiped by the sign-out clear. The lying `as`
cast is what let it ship.

**Fix — surface quarantined records DIRECTLY from the raw read, never re-cast to the
guarded type:**

```ts
function partitionFwQueue(raw): { recognized: FwQueueEntry[]; quarantined: {id,note}[] } {
  for (const record of raw) {
    if (isRecognizedFwEntry(record)) recognized.push(record);
    else if (typeof (record as {id?:unknown}).id === "string")
      quarantined.push({ id: record.id, note });   // surfaced by id, no cast, every scan
  }
}
// …and quarantined records BLOCK sign-out (needs_attention), never silently cleared.
```
Also: a `x is T` predicate must validate EVERY field of `T`, not just the identity
ones — a field the server's zod requires but the guard skipped (`lastAttemptAt`) lets a
"recognized" entry stall the server-side batch it can't parse.

### 4. `navigator.onLine === true` is not "the backend is reachable"

The capture path branched on `navigator.onLine === false` to enqueue offline. But
`navigator.onLine` reports link-layer association only — an iPad associated with a
venue AP whose uplink is dead reads `true`, takes the online branch, the Server Action
fails, and the tap sat in ephemeral React state that "Next student" discarded.

**Fix — never trust `navigator.onLine` to ROUTE a capture. Keep it only as a fast-path
optimization, and on any AMBIGUOUS online failure (a throw, or an `unavailable`
result), enqueue a durable backstop keyed by the SAME client ids the failed call used
(so the replay is idempotent):**

```ts
// keep the fast path: definitely offline → enqueue directly
// but the safety net is failure-driven, not navigator.onLine-driven:
if (res.reason === "unavailable" && (await queueBackstop(action, ids))) return; // durable
} catch { if (await queueBackstop(action, ids)) return; }                       // durable
```

## Why This Matters

A drain that writes into an append-only log has no undo. Every one of these four was a
signal whose designer made the RIGHT call for their context — deny on an auth outage,
don't trap a guide, don't feed an unknown shape to a typed switch, branch on the
platform's own online flag — and every reuse turned that right call into a silent,
permanent loss of a child's captured check-in, on the exact flaky-connectivity
condition the feature was built to survive. The bugs were invisible to the reviewers
watching the core fold because the core fold was correct; the loss was one layer out,
in the seams where a signal crossed from "safe to guess" to "irreversible if wrong."

The unifying tell: **a two-valued disposition (act / don't-act) at a boundary where
one branch is irreversible.** Two values cannot express "I could not tell" — so the
"could not tell" case silently rides the irreversible branch. The fix is always the
third value, and always at the LAST boundary before the irreversible effect (the drain,
the clear, the reject), never upstream where the collapse was legitimately made.

## When to Apply

- Writing or reviewing any drain / replay / reconciler / sync engine that turns queued
  client work into durable, hard-to-reverse server state (especially an append-only log).
- Reusing an authorization resolver, a `{ok:false}` verdict, or a fail-closed read to
  gate a WRITE or a REJECT rather than a read — the fail-closed direction flips meaning.
- Any client capture path deciding online-vs-offline from `navigator.onLine`.
- Any `x is T` type-guard that gates both machine processing AND human-facing recovery
  of the same record — split the two, and validate every field the predicate claims.
- Any "check emptiness, then destroy" sequence — make the check and the destroy observe
  one serialized, atomic snapshot, and fail CLOSED (preserve) when the check can't run.

## Related

- `best-practices/offline-sync-device-clock-is-untrusted-input-membership-holds-single-clock-freshness-clamp-and-record-2026-07-22.md` — the sibling "untrusted input at the offline seam" learning (device clock); this one is its authorization/verdict/type-guard analog.
- `best-practices/no-transaction-multi-step-write-compensation-post-write-verify-cas-scoped-claim-2026-07-22.md` — the drain's per-replay posture (probe-then-insert rejects, post-write-verify).
- `logic-errors/idempotency-key-unique-scope-wider-than-the-operation-it-names-silently-swallows-distinct-writes-2026-07-23.md` — the exactly-once key the drain's replays carry, whose scope this unit preserved rather than regressed.
