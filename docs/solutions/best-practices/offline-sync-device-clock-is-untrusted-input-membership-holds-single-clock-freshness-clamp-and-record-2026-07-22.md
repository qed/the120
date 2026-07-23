---
title: "In offline-first sync the device clock is UNTRUSTED INPUT: ordering invariants must be queue-membership (never wall-clock comparison), freshness math must use one clock (client receipt time, never a server-issued mint time vs client now), and evidentiary timestamps need clamp-AND-RECORD with a floor as well as a ceiling"
date: 2026-07-22
category: best-practices
module: path-offline-sync
problem_type: best_practice
component: sync_engine
severity: high
applies_when:
  - "A durable client-side queue (IndexedDB or similar) orders or gates work by comparing wall-clock timestamps stamped at different moments on the same device — any clock correction (NTP resync on reconnect, cellular time signal, manual change) between two stamps can invert their order"
  - "Token/URL freshness is computed as `now - mintedAt` where mintedAt came from a SERVER response but now is client Date.now() — two clocks, one subtraction"
  - "A timestamp is recorded into a permanent/evidentiary record from a device that can be offline for days (exactly when RTC drift and dead-clock resets are most likely)"
  - "Failure handling maps 'not fresh yet' and 'auth failed' into the same generic retry, so a wrong freshness verdict never surfaces — the retry loop hides the clock bug indefinitely"
related_components:
  - storage
  - testing_framework
tags:
  - offline-sync
  - clock-skew
  - ntp-rollback
  - untrusted-input
  - queue-ordering
  - token-freshness
  - timestamp-clamping
  - indexeddb
---

# The device clock is untrusted input: three ways an offline queue quietly lies, and the three disciplines that stop it

## Context

The Path's Unit 11 offline capture queue (evidence captured without signal, drained on
foreground signals) shipped its first draft with three timestamp uses that all looked
obviously correct and were all wrong — each found by adversarial review constructing a
concrete device-clock timeline, none findable by happy-path testing, and each one a
*silent* failure on exactly the device class the feature targets: a child's phone or
cheap tablet that has been offline for days. Long-offline devices are simultaneously
the ones most likely to have drifted clocks AND the ones that resync (NTP/cellular)
at the precise moment the queue drains — reconnect.

The unifying mistake: treating the device clock as a trustworthy monotonic authority,
when it is user-visible, correction-prone, occasionally corrupt (dead-RTC 1970 resets
on cheap hardware), and never guaranteed to agree with the server's clock.

## Guidance

### 1. Ordering/dependency invariants: queue MEMBERSHIP, never wall-clock comparison

The draft held a queued `submit` while "earlier" evidence for the same task was still
queued — where *earlier* meant `Date.parse(e.enqueuedAt) <= Date.parse(submit.enqueuedAt)`.
Failure construction: child captures a video at T1 (stale clock), the OS corrects the
clock backward on reconnect, child taps Submit at T2 where T2 < T1. The submit's stamp
is now numerically earlier than its own evidence's; the `<=` filter finds nothing to
wait for; the drain submits an **empty task** to the parent, and the evidence attaches
moments later mislabeled as arrived-after-submit.

```ts
// WRONG — the hold depends on two stamps from a correctable clock agreeing about order
const earlier = entries.filter(
  (e) => e.kind !== "submit" && e.taskId === entry.taskId &&
    Date.parse(e.enqueuedAt) <= Date.parse(entry.enqueuedAt)
);

// RIGHT — queue membership IS the invariant; wall-clock is display/FIFO only.
// The evidence was necessarily captured before the submit intent (the UI's own
// ordering) — if it's still queued, the submit waits. No timestamps consulted.
const pendingEvidence = entries.filter(
  (e) => e.kind !== "submit" && e.taskId === entry.taskId
);
```

If a true total order across entries is ever needed, use a monotonic sequence number
assigned at enqueue — never wall-clock.

### 2. Freshness math: ONE clock — record receipt time on the client, and treat a future mint time as stale

The draft persisted a signed-upload slot with `mintedAt: slot.tusMintedAt` — the
**server's** clock — then computed freshness as `Date.now() - mintedAtMs` against the
2h token TTL. On a device whose clock runs behind the server (drift, or just a slow
RTC), the subtraction is negative and stays below the re-mint threshold **forever**:
a genuinely dead token is judged fresh on every drain. Compounding it, the upload leg
deliberately maps all failures to generic "retry" (freshness re-mint is supposed to
happen *before* the attempt), so the dead token retries silently on every foreground
signal — no error ever surfaces, and the app's own promise ("it will send itself the
moment you're back online") is broken invisibly.

```ts
// WRONG — server clock in, client clock compared
mintedAt: slot.tusMintedAt              // server new Date().toISOString()
// ... later ...
if (Date.now() - Date.parse(mintedAt) >= TTL - MARGIN) remint();

// RIGHT — stamp RECEIPT time from the client clock (elapsed-client-time vs
// client-now is one clock), and fail toward a cheap re-mint on impossibility:
mintedAt: new Date().toISOString()      // the moment THIS client received the slot
// ...
if (slotMintedAtMs > nowMs) return "token_stale"; // future mint = clocks mixed/moved
if (nowMs - slotMintedAtMs >= TTL - MARGIN) return "token_stale";
```

Two rules fall out: (a) any elapsed-time comparison must have both operands from the
same clock — record *receipt* time locally rather than trusting a server-issued stamp;
(b) an "impossible" reading (mint time in the future) means the clock moved or sources
got mixed — fail toward the cheap side (a re-mint costs one request; a wedged token
costs the feature).

### 3. Evidentiary timestamps: clamp AND record, with a floor as well as a ceiling

A future `capturedAt` was already clamped to now and recorded. But an absurd **past**
value sailed through: a dead-CMOS/RTC-reset device (a real failure mode on cheap
tablets and long-powered-off hardware) boots reading 1970, and that literal date would
enter the permanent evidentiary record with no recorded anomaly. When the clock is
broken, the only trustworthy time is receipt time — and the record must carry the
anomaly, never the fiction:

```ts
export const EVIDENCE_TIME_FLOOR_MS = Date.parse("2025-01-01T00:00:00.000Z"); // pre-program = impossible

export function clampToNow(isoValue: string, nowMs: number): ClampResult {
  const parsed = Date.parse(isoValue);
  const nowIso = new Date(nowMs).toISOString();
  if (Number.isNaN(parsed)) return { value: nowIso, clamped: true, original: isoValue };
  if (parsed > nowMs)       return { value: nowIso, clamped: true, original: isoValue };
  if (parsed < EVIDENCE_TIME_FLOOR_MS)
                            return { value: nowIso, clamped: true, original: isoValue };
  return { value: isoValue, clamped: false };
}
```

The `original` travels with the record (here: a private `exif.clock_skew_clamped`
annotation on the evidence row) so a reviewer can see *that* the device clock was
wrong instead of silently trusting a rewritten value. Silent rewriting and silent
acceptance are both dishonest; clamp-and-record is the honest third option.

## Why This Matters

All three failures are invisible in testing (test machines have correct, synced
clocks), permanent in effect (an empty submit presented to a parent; a child's video
that never uploads; a 1970 capture date in a keepsake record), and concentrated on
the least-observable devices in the fleet. The class survives ordinary review because
each use reads as idiomatic — `a.time <= b.time`, `now - mintedAt`, "store what the
client sent" — and only falls to review that asks, per timestamp: *which clock stamped
this, which clock is it compared against, and what happens if the clock moved between
the two?*

## When to Apply

- Any client-side durable queue whose drain order, holds, or dependencies matter
- Any TTL/expiry/freshness check where the reference stamp could come from another machine
- Any timestamp persisted into an audit trail, evidentiary record, or permanent keepsake from a device that can run offline
- Review checklist for offline-first features: for every `Date.now()`, `Date.parse`, or timestamp comparison, name the clock on each side

## Examples

Tests that pin each discipline (all in `app/path/lib/__tests__/sync-rules.test.ts`):

```ts
// 1 — the NTP-rollback hold: evidence stamped LATER than its dependent submit still holds it
planDrain([media({ enqueuedAt: iso(T0 + 60_000) }), submit({ enqueuedAt: iso(T0) })])
// → submit held "awaiting_evidence"

// 2 — future mint time is stale, never fresh-forever
classifyUploadFreshness({ slotMintedAtMs: T0 + 60_000, tusCreatedAtMs: null, nowMs: T0 })
// → "token_stale"

// 3 — dead-RTC floor: 1970 clamps to now, recorded
clampToNow("1970-01-01T00:00:07.000Z", T0)
// → { value: iso(T0), clamped: true, original: "1970-01-01T00:00:07.000Z" }
```

Live code: `app/path/lib/sync-rules.ts` (`planDrain`, `classifyUploadFreshness`,
`clampToNow`/`EVIDENCE_TIME_FLOOR_MS`) and `app/path/lib/sync-engine.ts`
(`toStoredSlot` stamping receipt time client-side for both upload strategies).

## Related

- [id-keyed-upsert-trusts-client-id-as-ownership-verify-existing-row-owner-2026-07-22](id-keyed-upsert-trusts-client-id-as-ownership-verify-existing-row-owner-2026-07-22.md) — the sibling "client-supplied input treated as authoritative" case in the same evidence pipeline (there: `evidenceId`; here: the clock)
- [resend-safe-atomic-claim-then-send-cas-guarded-claim-and-unclaim-2026-07-15](resend-safe-atomic-claim-then-send-cas-guarded-claim-and-unclaim-2026-07-15.md) — the earlier articulation of "don't let casual `Date` handling near a correctness comparison" (opaque stamps, never re-parsed)
- [already-exists-idempotency-signal-differs-per-upload-leg-tus-detailederror-body-unparsed-2026-07-22](../integration-issues/already-exists-idempotency-signal-differs-per-upload-leg-tus-detailederror-body-unparsed-2026-07-22.md) — the same upload pipeline's other untrusted-signal lesson (verify every leg, not the one you probed)
- [no-transaction-multi-step-write-compensation-post-write-verify-cas-scoped-claim-2026-07-22](no-transaction-multi-step-write-compensation-post-write-verify-cas-scoped-claim-2026-07-22.md) — sibling adversarial-review-before-ship invariant fix in the same T1 build
