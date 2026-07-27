---
title: "An offline-replay drain reuses signals across a SAFETY BOUNDARY: a read/verdict/type-guard that is safe to fail-closed (or fail-open) for authorization or display becomes PERMANENT DATA LOSS when the same collapsed signal drives an irreversible drain action (reject, clear, route-online). Make the disposition TRI-STATE — success / genuine-no / could-not-tell-→-retry — at the boundary where it turns a captured tap into an append-only fact"
date: 2026-07-24
last_updated: 2026-07-27
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

> **⚠️ SUPERSEDED 2026-07-27 — this fix was incomplete, and the snippet above is the
> bug.** Making the clear atomic *with itself* left the harder question unasked: is
> "atomic" counting the same thing the verdict counted? It was not. The verdict counted
> only own + un-blocked + recognized entries; this `store.count()` counted
> **everything**. A device holding one blocked or one foreign entry therefore got `ok`
> from the check and `cleared:false` from the act — permanently, with the UI showing
> race-condition copy for a state that was not a race and would never resolve.
>
> The signature takes the verdict's own predicate, so check and act cannot drift.
> **Renamed and widened again on 2026-07-27 (Unit 4)** — the boolean became a three-way
> disposition, because "must not be destroyed" and "must stop the clear" turned out to
> be different questions (another account's un-landed work is the first without being
> the second):
>
> ```ts
> export function clearFwQueueUnlessBlocked(
>   disposition: (rawEntry: unknown) => FwClearDisposition   // "abort" | "preserve" | "remove"
> ): Promise<{ cleared: boolean; blocking: number; remaining: number }>
> ```
>
> `fwSignOutVerdict` and `fwEntryBlocksSignOutClear` no longer exist; the sequence is
> `runFwSignOutFlow` and the per-record rule is `fwEntryClearDisposition`. See
> `logic-errors/a-check-that-authorises-a-destructive-act-must-fold-over-the-same-classifier-derive-the-per-record-predicate-from-the-whole-set-counter-2026-07-27.md`.

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

### 5. A COUNT is a two-valued disposition too: `1` cannot mean "I could not tell" (added 2026-07-27, Staff Front Door Unit 4)

The four above are all booleans or verdicts, which makes the tri-state fix look like a
lesson about *flags*. It is not. It is a lesson about any type whose legal range has no
room left for "unknown".

The device's residue clear reports how many queue records survived it, so the handover
reconcile can tell *"kept another guide's captures on purpose"* (a policy outcome —
advance the owner key, this is fine) from *"wiped the device clean"*. The clear can also
**throw** — `openFwDb()` rejecting, `tx.onabort`, Safari under storage pressure. The
first draft handled that in the obvious way:

```ts
} catch (e) {
  console.error("[fw/sync] residue clear failed:", e);
  queueCleared = false;
  queueRemaining = 1;   // ← "something is probably still there"
}
```

The reasoning was sound as far as it went: `0` would read as *"this device is clean"*,
which a failed clear is in no position to claim. So it reported a non-zero number.

**But `1` is a perfectly legal value on the success path** — it is exactly what "one
foreign capture deliberately preserved" looks like. So downstream, in
`runFwCacheOwnerReconcile`, a genuine IndexedDB fault arrived indistinguishable from a
routine, correct preserve: the reconcile took the `queueRemaining > 0` branch, returned
`queue_preserved`, and **advanced the owner key over it**. The next mount then sees
`prior === actorUserId`, skips the reconcile entirely, and the failure is masked
permanently. That is B2 — the defect this whole subsystem was rewritten to fix — coming
back one layer down, through a sentinel rather than through an unconditional overwrite.
Two reviewers traced it independently.

**Fix — the same third value, in the type rather than in the range:**

```ts
/** `null` means COULD NOT DETERMINE — the clear threw rather than answering.
 *  Every number here is a claim about the device that a failed transaction is in
 *  no position to make. */
queueRemaining: number | null;

// …and at the last boundary before the irreversible effect (advancing the key):
if (!result.rosterCleared || !result.shellCleared || result.queueRemaining === null) {
  return { kind: "clear_failed" };   // key NOT advanced; next mount retries
}
```

**The generalised rule: a sentinel must not be an in-range value of the type it stands
in for.** When you reach for a stand-in — `1`, `0`, `-1`, `""`, `Number.MAX_SAFE_INTEGER`,
an empty array — ask whether a correct run can produce it. If it can, you have not
added a third state; you have made two states collide, and the collision is silent
precisely because both are plausible.

The tell is identical to the four above ("a two-valued disposition at an irreversible
boundary"), but it hides better: nobody reads `number` as a two-valued type. It becomes
one the moment the only alternative to "a real count" is "a fake count".

### 6. UNKNOWN is not NONE — an identity gate's timeout must not be its terminal state (Unit 5, 2026-07-27)

The tri-state rule's largest application yet, and the one that generalizes it beyond
the drain: an IDENTITY read that does not answer must not report the answer's absence
as either of the answers. `loadFwSession()` returned `FwSession | null`, and `null`
meant "signed out" — so once the call was bounded (it had to be; it runs first inside
the client's Web Lock), a timeout reported as `null` would have thrown a mid-shift
guide to the sign-in door with un-landed captures on the device. Strictly worse than
the hang it replaced. `requireStaff()` had the same two states, where the collapse
read as *revocation*: a stalled staff-row read redirected an active staff member to a
404.

The fix is the type, not the timeout: a three-way `IdentityRead<T>` whose third member
is **neither nullable nor falsy** —

```ts
type IdentityRead<T> =
  | { kind: "identity"; identity: T }
  | { kind: "none" }
  | { kind: "unknown"; detail: string };
```

— so the pre-fix idiom (`if (!session) …treat as signed out`) is a compile error at
every call site rather than a review finding. Each consumer then decides what UNKNOWN
means FOR IT: pages throw to a retryable error boundary; Server Actions return a typed
`unavailable` (never `no_session`, which clients act on by demanding re-auth); the
staff bar alone may collapse it to "no chrome", because R23 keeps its control rendered
either way and nothing acts on the string.

**The named un-fixed twin:** `requirePathUser` (`app/fp/lib/auth.ts`) still has both
of its calls bare and both of its states terminal. `fw-auth.ts`'s own docblock names
it as the sibling. Whoever bounds it must bring this shape along, or they will have
built the worse-than-the-hang version.

### 7. Fail-closed can OVER-close: a blip on a fact just proven is not an unknown (Unit 8, 2026-07-27)

The inverse failure of the collapse this doc opens with. Unit 8's first draft made
the board page's shell loader fail closed on ANY cohort-read error, so a retired
weekend could not hide behind a blip — and in doing so it 404'd a healthy LIVE
board whenever the same row blipped, on the surface whose whole design brief is
"never blank a projector at an event". The review's settlement is the rule:

**Before failing closed on a read error, ask what the caller already proved.** The
page reaches the shell only after `resolveFwBoardToken` succeeded — and THAT
function read the same cohort row, through the same fence, milliseconds earlier. An
error on the re-read is a blip on a fact just proven, and the safe degrade is
correct; what refuses is a read that ANSWERED (an archived row, or no row). The
same review round fixed the same collapse in the import gate the other way — a
blip there had been reported as "the cohort is gone", a terminal claim from a
non-answer — landing both on the same three-way shape this doc's items 1 and 6
describe: answered-yes, answered-no, could-not-tell, each with its own consequence.

Corollary from the same unit: **an accepted side-channel is a decision to write
down.** The archived fence gives a once-real token a second read before its 404 —
a timing difference an attacker could measure. Closing it costs every garbage probe
a dummy read to hide a fact of no exploitable value; the docblock now says so,
which is what separates a trade-off from an oversight.

## Why This Matters

A drain that writes into an append-only log has no undo. Every one of these was a
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
  **And make them observe the same PREDICATE, not just the same snapshot** — one atomic
  count of the wrong set is still the wrong answer (added 2026-07-27; see below).
- Any function reporting a COUNT, a SIZE, or an ID whose failure path needs a stand-in
  value. Ask whether a correct run can produce that same value; if it can, use
  `T | null` rather than a reserved number (added 2026-07-27; see item 5).

## Related

- `best-practices/offline-sync-device-clock-is-untrusted-input-membership-holds-single-clock-freshness-clamp-and-record-2026-07-22.md` — the sibling "untrusted input at the offline seam" learning (device clock); this one is its authorization/verdict/type-guard analog.
- `best-practices/no-transaction-multi-step-write-compensation-post-write-verify-cas-scoped-claim-2026-07-22.md` — the drain's per-replay posture (probe-then-insert rejects, post-write-verify).
- `logic-errors/idempotency-key-unique-scope-wider-than-the-operation-it-names-silently-swallows-distinct-writes-2026-07-23.md` — the exactly-once key the drain's replays carry, whose scope this unit preserved rather than regressed.
- `logic-errors/a-check-that-authorises-a-destructive-act-must-fold-over-the-same-classifier-derive-the-per-record-predicate-from-the-whole-set-counter-2026-07-27.md` — the completion of item #2 above. Three days after this doc shipped, the same function pair was found still broken: the clear was atomic but counted a different set than the verdict. Read that one for the rule this doc's item #2 stops one step short of.
- `best-practices/web-locks-are-not-reentrant-re-entry-hangs-instead-of-throwing-so-hold-the-lock-at-exactly-one-level-2026-07-27.md` and `best-practices/a-server-side-timeout-does-not-bound-a-request-that-never-lands-bound-the-clients-own-await-2026-07-27.md` — the two ways the drain lock this doc's engine relies on can be held forever.
