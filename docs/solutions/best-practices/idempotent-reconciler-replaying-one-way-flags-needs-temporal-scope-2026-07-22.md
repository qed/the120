---
title: "An idempotent reconciler replaying one-way flags needs temporal scope: occurred_at (the source moment) vs created_at (the heal time), and strictly-before-trigger matching"
date: 2026-07-22
category: best-practices
module: path-notifications
problem_type: best_practice
component: background_job
severity: high
applies_when:
  - "A cron/reconciler re-derives state from an append-only spine over a trailing window, re-applying its conclusions on every run (the 'healer' architecture)"
  - "Any effect it re-applies is IRREVERSIBLE or one-way (a superseded/tombstone/read-only flag that only ever moves null → non-null)"
  - "The same subject can legitimately re-enter the flagged state after the reversal (redo → re-verify, reopen → re-close, resubscribe after unsubscribe)"
  - "Rows can be BACKFILLED, so a row's insert time is the heal time, not the moment the thing it describes actually happened"
related_components:
  - database
  - email_processing
tags:
  - reconciler
  - replay
  - idempotency
  - supersede
  - append-only
  - occurred-at
  - one-way-flag
  - temporal-scoping
---

# An idempotent reconciler replaying one-way flags needs temporal scope

## Context

The Path Unit 12's notification layer is a **derive-from-durable-spine + healer** design: the
atomic transition RPC writes append-only `path_task_events` / `path_reviews` rows in the same
transaction as the state change, and notifications are *derived* from those spines — inline for
latency, and re-derived by a 10-minute cron over a trailing window so a crash between the RPC
commit and the inline enqueue loses nothing. Insert-idempotency comes from semantic dedupe keys
plus `ON CONFLICT DO NOTHING`, so the healer can replay the whole window every run, forever, safely.

Except for one effect class. Reversal events (a revoke, a criterion return) also flag the
celebrations they reverse: `superseded_at`, a **one-way** null → non-null stamp Unit 16 renders as
past-tense history. The first implementation matched supersede targets by *subject alone* ("this
task's live `verified` events"). The adversarial reviewer constructed the break with no attacker
required, just the product's own designed workflow:

1. Task verified (event e1, a live celebration).
2. Parent revokes it — inline path correctly flags e1 superseded.
3. Student redoes the work; parent **re-verifies** minutes later (event e3, a fresh, correct celebration).
4. ≤10 minutes later the healer re-processes the *same old revoke* still inside its window and
   re-applies the supersede — which now matches e3 too. The flag is one-way, so the student's
   legitimate re-verification renders as superseded **forever**. The same shape hits attempt-2's
   fresh `review_underway` event via a replayed attempt-1 return.

The subtle second half: the obvious fix — compare against the notification row's `created_at` —
is wrong for exactly the rows the healer exists to create. A **backfilled** row's `created_at` is
the *heal time*, not the moment: verify at T0, revoke at T1, both rows backfilled at T2 > T1 would
make the old celebration look newer than the revoke and escape a supersede it genuinely deserves.

## Guidance

1. **Idempotent inserts compose with replay; one-way effects do not — inventory them.** A healer
   that replays its window is only as safe as its *least* idempotent effect. Dedupe-keyed inserts
   are replay-proof by construction. Anything irreversible (supersede flags, tombstones, deletes,
   notifications-as-side-effects) needs its own replay argument, effect by effect.

2. **Give every derived row the SOURCE moment, not just an insert time.** `path_notification_events`
   carries `occurred_at` — the spine event's own `at` / the review's `opened_at`/`decided_at` —
   distinct from `created_at`. Both the inline path and the healer derive it from the same spine
   fields, so a backfilled row carries the true moment. (Unit 16 gets honest feed ordering for free.)

3. **A reversal only ever flags what happened strictly BEFORE it.**

   ```ts
   // notify-rules.ts (pure, exhaustively tested)
   const triggerMs = trigger.occurredAt != null ? Date.parse(trigger.occurredAt) : NaN;
   if (!Number.isFinite(triggerMs)) return []; // no clock → never guess
   const alive = live.filter((e) => {
     if (e.supersededAt !== null) return false;          // an earlier correction is itself history
     const momentMs = Date.parse(e.occurredAt ?? e.createdAt); // legacy rows fall back
     return Number.isFinite(momentMs) && momentMs < triggerMs;
   });
   ```

   Replays converge: the stale revoke re-matches only what it already flagged (no-ops under the
   `superseded_at IS NULL` guard) and can never reach anything fresher than itself.

4. **Fail closed on a missing clock.** A trigger with no parseable `occurredAt` supersedes
   *nothing*. For a one-way flag, a false negative self-heals on the next inline reversal; a false
   positive is permanent.

5. **Both clocks must be server-minted.** The comparison only works because `at`, `decided_at`, and
   `occurred_at` are all DB-written `now()` values from the same clock — no client timestamp ever
   enters it (the offline-sync clock learning's discipline, applied server-side).

6. **Pin the regression, not just the rule.** The test that would have caught this models the
   replay: *trigger at T1, a fresh live event at T2 > T1, re-apply the trigger — the T2 event must
   survive*. A single-snapshot supersede test passes forever while the cron corrupts production.

## Why This Matters

- The failure needs no attacker and no race — the product's own revoke → redo → re-verify flow plus
  an ordinary cron tick corrupts a child's permanent record, silently, with no error anywhere.
- Because the flag is one-way, the corruption **cannot self-heal**; every subsequent cron run
  re-asserts it for the rest of the window.
- The `occurred_at` ≠ `created_at` distinction is what makes the fix survive the healer's own
  backfills — the naive created_at comparison fails precisely for the rows the healer creates.

## When to Apply

- Any reconcile/backfill job that re-applies conclusions over a window (not just notifications:
  audit flags, read-model tombstones, cache invalidation stamps, "latest wins" materializations).
- Whenever an event-sourced projection includes an irreversible mutation.
- NOT needed when every replayed effect is a dedupe-keyed insert or a value-idempotent set — replay
  is already safe there; this is specifically the one-way-effect carve-out.

## Examples

The live sequence that proved the fix (prod test family, Unit 12 drill): 1.1.5 verified via the
queue UI → criterion 1.1 returned (1.1.5's celebration + the `review_underway` event correctly
flagged) → healer re-ran three times — the flags were re-derived idempotently, and a
subsequently-re-verified task's fresh event stayed live under every replay. Regression pinned in
`app/path/lib/notify/__tests__/notify-rules.test.ts` ("a replayed stale trigger never flags an
event that happened AFTER it").

## Related

- [webhook-idempotency-record-dedupe-key-after-idempotent-effect-and-scope-cancels-by-provenance-2026-07-17.md](webhook-idempotency-record-dedupe-key-after-idempotent-effect-and-scope-cancels-by-provenance-2026-07-17.md)
  — the sibling insight for DELIVERY reordering: a late destructive webhook is gated on a stored
  event timestamp + provenance scoping. Same core lesson ("an idempotent-looking pipeline's
  destructive effect needs its own ordering guard"), different surface: theirs guards *arrival*
  order, this guards *replay* of a trailing-window re-derivation, and adds the
  `occurred_at`-vs-`created_at` backfill distinction plus the no-clock-flags-nothing rule.
- [offline-sync-device-clock-is-untrusted-input-membership-holds-single-clock-freshness-clamp-and-record-2026-07-22.md](offline-sync-device-clock-is-untrusted-input-membership-holds-single-clock-freshness-clamp-and-record-2026-07-22.md)
  — "name which clock stamps this value"; here both sides of the comparison are the same server clock.
- [resend-safe-atomic-claim-then-send-cas-guarded-claim-and-unclaim-2026-07-15.md](resend-safe-atomic-claim-then-send-cas-guarded-claim-and-unclaim-2026-07-15.md)
  — the send-side idempotency machinery this unit extended (Unit 12 additionally SPLIT the claim
  stamp from the success stamp — `claimed_at` with a stale-TTL retake made safe by the stable
  provider Idempotency-Key — so a process killed mid-send self-heals instead of leaving an
  invisible stamped-but-unsent row; see `app/path/lib/notify/send.ts`'s header).
- Implementation: `app/path/lib/notify/notify-rules.ts` (`supersedePlan`), `send.ts`
  (`applySupersedes`, `reconcileNotifications`), migration `20260723120000_path_notifications.sql`
  (`occurred_at`); review artifact `.context/compound-engineering/ce-review/2026-07-22-unit12/`.
