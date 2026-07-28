---
title: "Composing a two-write operation over a hardened offline queue: ordinary entries, per-leg ids, and a monotonic enqueue clock"
date: 2026-07-28
category: best-practices
module: path-fw-offline
problem_type: best_practice
component: service_object
severity: high
applies_when:
  - "A single user gesture must become two dependent writes through an offline queue (e.g. undo-then-decide, release-then-claim)"
  - "The queue's replay engine already provides ordered per-group replay with halt-on-first-non-settle"
  - "Entries carry idempotency keys with server-side replay probes"
related_components:
  - database
  - testing_framework
tags:
  - offline-queue
  - idempotency
  - client-id
  - ordering
  - monotonic-clock
  - composed-operation
  - fw-sync
---

# Composing a two-write operation over a hardened offline queue: ordinary entries, per-leg ids, and a monotonic enqueue clock

## Context

The FW check-in redesign (PR #94) needed a one-tap "flip": a checked task switched to Not-yet, which the engine's shared ordering rule (`undo_first`) defines as two server writes — undo, then not_yet. The offline queue (`fw-sync-rules.ts` / `fw-sync-client.ts` / `fw-sync-engine.ts`) was already hardened: cancel-pair reduction, per-(student,task) ordered replay with halt-on-first-non-settle, client-id idempotency with a server-side replay probe, cross-actor guards. The question was how to represent the composed operation without destabilizing any of it.

## Guidance

**1. Two ordinary entries, not a new op kind and not a dependency link.** The engine's ordered replay with halt-on-first-non-settle already gives leg-2-conditional-on-leg-1 from position alone: a retried leg 1 holds leg 2 as retry; a terminally rejected leg 1 rejects the pair as a unit (`planFwStudentTask`'s leading-undo posture). A composed op kind would have violated the `path_fw_replay_rejects.action` CHECK constraint, carried one idempotency key for two writes, and forced a `FW_QUEUE_ENTRY_SCHEMA_VERSION` bump (the queue is a cross-deploy contract). A dependency-link field would have been redundant with ordering.

**2. One distinct, retry-stable client id per leg — minted BEFORE any online attempt, and the error backstop must reuse exactly those ids.** The idempotency scope is (student, task, client_id) and both legs share (student, task):

- Shared ids: the undo commits under the id, the not_yet then matches the replay probe and returns `replayed` — a success-shaped outcome that silently drops the actual decision.
- Fresh ids per retry: a replayed pair re-applies leg 1 (undo from not_yet is legal), churning state and minting duplicate events.
- **The subtle one (caught in review as a P1):** a `catch` block that re-derives ids from the ledger after leg 1 settled gets a *new* id, because settle() releases the key. Hoist the id derivation above the `try` and have the catch close over those values — never call the ledger inside the catch.

Treat the server's `replayed` outcome as leg-success: a landed-but-unanswered undo must still release leg 2.

**3. Strictly increasing `enqueuedAt` via a shared monotonic clock — same-millisecond timestamps are an ordering hazard when the tiebreak is random.** `orderFwEntries` tiebreaks same-ms entries by random UUID; a flip enqueued in one millisecond had a ~50% chance of replaying as `[not_yet, undo]`, which the reducer cancels as a pair — silently losing the whole flip. The fix is a document-level monotonic clock (`createFwEnqueueClock`: each stamp is `max(now, last+1)`; the flip reserves two ticks atomically) that ALL enqueue paths stamp through — a flip-local `+1ms` is not enough, because a third real tap in the same millisecond could still interleave between the legs via the random tiebreak.

**4. Online, the composition is sequential awaited actions with a gated second leg**, and on ambiguity (`unavailable`/throw) backstop-enqueue BOTH legs with their held ids and let the drain do the conditional replay. Never withhold leg 2's enqueue offline waiting for leg 1 to settle — that reinvents the engine client-side and loses leg 2 if the user navigates away.

## Why This Matters

The engine invariants (`reduceFwOps`, `transition-table.ts`, the drain fold) went completely untouched — the composition rides existing machinery, which is why 21 rules-layer pins plus 4 engine scenarios could prove it exhaustively. Every alternative representation would have rippled through the reject-table schema, the queue version contract, or the idempotency model.

## When to Apply

Any time one gesture must become N dependent writes through this queue (or a queue with the same shape): represent them as N ordinary entries in one enqueue call with strictly increasing stamps and per-leg stable ids, and let ordered replay carry the dependency.

## Examples

The failure the clock prevents (before): two entries stamped in the same ms → `orderFwEntries` random tiebreak → `[not_yet, undo]` → `reduceFwOps` cancels the pair → tap silently lost. After: `enqueueClock.take(2)` guarantees leg order; a same-ms third tap stamps after both legs.

Pinned in `app/fp/lib/__tests__/fw-sync-rules.test.ts` (flip section) and `fw-sync-engine.test.ts` (drain scenarios); the catch-block id constraint is source-pinned in `fw-ops-chrome-wiring.test.ts`.

Related: `docs/solutions/logic-errors/idempotency-key-unique-scope-wider-than-the-operation-it-names-silently-swallows-distinct-writes-2026-07-23.md` (the same swallowed-as-replay failure shape, one level down); `docs/solutions/best-practices/offline-sync-device-clock-is-untrusted-input-membership-holds-single-clock-freshness-clamp-and-record-2026-07-22.md` (the shared conclusion: never trust ambient time for ordering — hold an explicit invariant).
