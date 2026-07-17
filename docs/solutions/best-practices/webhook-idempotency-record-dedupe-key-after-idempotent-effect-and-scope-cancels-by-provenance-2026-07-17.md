---
title: "Webhook idempotency for idempotent effects: record the dedupe key AFTER the effect, and scope destructive events by the id that set the state"
date: 2026-07-17
module: crm
problem_type: best_practice
component: service_object
severity: high
applies_when:
  - "Building a webhook/callback receiver whose effect is an idempotent set-to-value (stamp a timestamp, set a field, clear a flag)"
  - "The provider sends no stable delivery id and retries at-least-once with possible reordering (Cal.com, and many others)"
  - "A record can be mutated by BOTH an external automation and a human/other source, and the automation must not clobber the other's writes"
root_cause: async_timing
resolution_type: code_fix
related_components:
  - background_job
  - integration_issue
tags:
  - webhook
  - idempotency
  - at-least-once
  - dedupe
  - ordering
  - calcom
  - postgrest
---

# Webhook idempotency for idempotent effects

## Context

Phase 3 of the CRM external-events work added a public Cal.com booking webhook
(`app/api/webhooks/calcom/route.ts`) that stamps/clears `families.call_booked`.
Cal.com delivers **at-least-once**, sends **no delivery-id header**, and can
**reorder** deliveries (a stale `BOOKING_CANCELLED` can arrive after a newer
rebook; a reschedule mints a **new** booking `uid`). Two design traps had to be
avoided; both were caught at plan-review before code existed.

## Guidance

### 1. Record the dedupe key AFTER the effect, not before

PostgREST calls from a route are **not transactional across statements**. If you
insert the dedupe key first and lean on "return 500 → the provider retries", a
transient failure *between* the key insert and the effect is unrecoverable: the
key is already committed, so the retry hits the unique key and returns a 200
no-op — the effect is **permanently dropped**.

When every effect is an **idempotent set-to-value**, record the key *after* the
effect succeeds. A concurrent redelivery that races in before the key is recorded
at worst re-applies the same value (harmless), and a transient failure leaves the
key un-recorded so the retry genuinely re-applies the effect.

```ts
// runCalcomWebhook (app/crm/lib/lead-ingest.ts)
const { data: seen } = await db.from("processed_webhook_events")
  .select("event_key").eq("event_key", eventKey).maybeSingle();
if (seen) return { status: "deduped" };          // already handled

const effect = await stampCallBookedFromWebhook(db, event);  // idempotent set-to-value

const { error } = await db.from("processed_webhook_events").insert({ event_key: eventKey });
if (error && !isUniqueViolation(error)) throw new Error(...);  // benign dup from a race → swallow
// a DB error inside the effect propagates → route 500 → provider retries → effect re-applies
```

**Contrast with the claim-then-send pattern** (`docs/solutions/best-practices/resend-safe-atomic-claim-then-send-cas-guarded-claim-and-unclaim-2026-07-15.md`
and `…/atomic-claim-then-send-…2026-07-14.md`): there the log row is written
*first* as the lock, because the effect (sending an email) is **not** idempotent
and a failed send **releases** the claim so it retries. The ordering is opposite
**because the failure semantics are opposite** — release-on-failure vs.
re-apply-on-retry. Pick the ordering from whether the effect is idempotent and
whether there's a release step, not by rote.

- No delivery id → synthesize a stable key from what makes the delivery unique:
  `sha256(triggerEvent + ':' + uid + ':' + createdAt)`.

### 2. Guard ordering with a stored event timestamp (NULL = proceed)

Idempotency alone does not fix reordering. Store the winning event's `createdAt`
alongside the state (`call_booked_event_at`) and apply an incoming event only if
`incoming.createdAt >= stored`. Evaluate in **JS, not a bare SQL `>=`** — a SQL
predicate would exclude the NULL row (a record with no prior webhook stamp);
NULL must mean "proceed". Unparseable timestamps fail closed.

### 3. Scope destructive events by the id that SET the state (provenance)

The same field (`call_booked`) can be set manually (staff booked a call
off-platform) or by the webhook. A `BOOKING_CANCELLED` must clear **only** a
stamp the webhook itself set — otherwise a stray/foreign cancel wipes a human's
booking. Store the id that set the state (`call_booked_uid`) and clear only when
the cancelled uid matches it. A manual stamp leaves that column **NULL**, so it
can never match — it is structurally protected. Crucially, the manual write path
(`stampCall`/`clearStamp`) must **reset the provenance column to NULL**, or a
stale id survives a manual clear and a later foreign cancel matches it.

## Why This Matters

At-least-once + no-ordering delivery is the *normal* case for webhooks, not an
edge case. The failure modes are silent: a dropped stamp (staff never sees a
booked call), a flicker (stamp set then wiped by a stale cancel), or a human's
manual booking erased by an unrelated cancellation. Each looks like "the webhook
is flaky" and is nearly impossible to reproduce after the fact. Getting the three
rules right up front is far cheaper than chasing the ghosts later.

## When to Apply

- Any webhook whose effect is a set-to-value and whose provider retries — use the
  record-after-effect ordering.
- Any field written by both an automation and a human/other source — add a
  provenance id and scope destructive events by it; reset it on the manual path.
- Any reordering-prone provider — add the stored-timestamp ordering guard.

## Examples

**Wrong** (the plan's first draft — the review caught it): insert the dedupe key
first, do the non-idempotent-looking stamp, return 500 on failure "so it
retries". A transient failure after the key insert → retry is a 200 no-op → the
booking never stamps.

**Right** (what shipped): dedupe-check → effect → record key after → 500 only on a
real effect error (key not yet recorded, so the retry re-applies). Cancels clear
only when `call_booked_uid == payload.uid`; `stampCall`/`clearStamp` null the
provenance columns so a manual stamp is never wiped.

Pure decision helpers (`deriveEventKey`, `isFresh`, `cancelUidMatches`) live in
`app/lib/calcom/events.ts` and are exhaustively unit-tested; the db-taking glue is
thin — see also the shared-core module-boundary rule in
`docs/solutions/best-practices/shared-db-taking-core-must-not-live-in-a-use-server-file-server-action-boundary-2026-07-17.md`.
