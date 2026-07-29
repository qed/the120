---
module: funnel
date: "2026-07-29"
problem_type: best_practice
component: api_route
severity: high
applies_when:
  - "A poll endpoint doubles as a work driver (each tick may resume/retry priced work)"
  - "The pacing lives in the client (setTimeout interval) and the endpoint is reachable directly"
  - "The work consumes org-shared quotas (Google Admin SDK, auth admin APIs, model calls)"
symptoms:
  - "A scripted curl loop against the arrival poll re-ran the full provisioning pipeline (auth listUsers page-walk + Google Directory calls) on every request"
  - "The lease only serialized OVERLAPPING runs — sequential re-drives were unbounded the moment each run landed"
root_cause: async_timing
resolution_type: code_fix
tags:
  - rate-limit
  - cooldown
  - poll
  - driver-route
  - lease
  - quota
---

# A client poll interval is not a server bound — the driver route needs its own cooldown

## Context

U7's arrival page polls `/api/funnel/arrival` every 3 seconds, and each
tick doubles as the primary provisioning driver: resumable claims get a
full drive (lease, consent read, auth page-walk, Google Directory calls).
The 3s pacing lived only in `ArrivalFlow.tsx`'s `setTimeout` — a raw
fetch loop ignores it. The lease looked like protection but is not: it
serializes runs that OVERLAP, and `finishRun` clears it on every landing,
so sequential re-drives were limited only by round-trip time. The quotas
being burned (Google Admin SDK) are org-wide — one scripted parent could
degrade provisioning for other families.

## Guidance

When a poll endpoint drives priced work, the pacing must be a SERVER-side
fact the endpoint reads, not a client convention. Cheapest form: a
cooldown derived from state the work already writes —

```ts
// arrival-rules.ts (pure, tested, mutation-checked)
export const RESUME_COOLDOWN_MS = 30_000;
// pending / identity_only: honour the cooldown since the last landing.
if (input.lastWriteAt) {
  const age = input.now.getTime() - new Date(input.lastWriteAt).getTime();
  if (age < RESUME_COOLDOWN_MS) return false;
}
```

`updated_at` is refreshed by every landing write, so the rule needs no
new column and no rate-limit store: ticks inside the cooldown pay three
cheap DB reads and zero external calls. The lease still guards overlap;
the cooldown guards sequence. Both are needed and they are not the same
guarantee (sibling lesson:
[a-lease-grant-serializes-the-take-not-the-run](a-lease-grant-serializes-the-take-not-the-run-fence-every-later-write-2026-07-29.md)).

## Why This Matters

Every driver-shaped poll route has this shape: the endpoint is the
retry loop, so whoever controls request cadence controls spend. Client
intervals, exponential backoff in the component, "the UI only calls it
every N seconds" — none of it survives curl.

## When to Apply

Any endpoint where handling a request may perform work with real cost
(external APIs, model calls, mail) and the endpoint is designed to be
called repeatedly. The question to ask at review: *if this URL is hit in
a while-true loop, what bounds the spend?* The answer must live
server-side.

## Examples

Shipped in PR #115 (`shouldResumeProvisioning` + the arrival route
passing `updated_at`); pinned by "the cooldown bounds SEQUENTIAL
re-drives" and mutation-tested (removing the cooldown check reddens).
