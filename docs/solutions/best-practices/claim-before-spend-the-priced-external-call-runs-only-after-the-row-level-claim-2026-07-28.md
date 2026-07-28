---
module: funnel
date: "2026-07-28"
problem_type: best_practice
component: service_object
severity: high
applies_when:
  - "A priced or rate-limited external call (model, payment, email) is followed by a guarded write"
  - "A cap or uniqueness constraint is meant to bound how many attempts can be spent"
  - "Concurrent requests (tabs, retries, scripts) can race the same slot"
symptoms:
  - "N racing regenerations each ran a full model conversation; only one CAS write won; the cap counted 1"
  - "A lost insert race or failed insert still paid for the model call it could never persist"
root_cause: async_timing
resolution_type: code_fix
tags:
  - claim-before-spend
  - cas
  - race
  - rate-limit
  - ai-spend
  - idempotency
  - ordering
---

# Claim before spend: the priced external call runs only after the row-level claim

## Context

U10's first draft did generate-then-write, both ways: compose called the model
and then inserted the projects row (the one-active-per-child index arbitrating
races), and regenerate called the model and then CAS-updated
`ai_regeneration_count`. The adversarial reviewer priced the race: M
concurrent regenerations at count=0 each pass the `canRegenerate` read, each
run up to a full model conversation, and only one wins the CAS — so the "two
regenerations" cap actually priced CAS *wins*, while attempts were unmetered.
Same shape on compose: every lost insert race was a free model conversation.
The comment in the code even said "the attempt COUNTS whether it accepted or
fell back" — true only in the serialized case.

## Guidance

Invert the order: **take the durable claim first, spend second.**

- Regenerate: CAS-increment the counter as a *reservation* before any model
  call. Losers conflict immediately, having spent nothing; the winner's
  attempt counts whether the model succeeds or falls back.

```ts
const reserved = await session.reserveRegeneration(project.id, project.aiRegenerationCount);
if (reserved === "conflict") return { kind: "conflict" };   // zero model calls
const run = await runCompose(deps, parts);                   // only the winner pays
await session.saveDraft(project.id, draft, aiModel);         // no counter change
```

- Compose: insert the row FIRST, carrying the canned fallback content. The
  partial unique index arbitrates the race at the insert; only the winner
  calls the model, then upgrades the row in place. A failed insert (including
  the RLS outage this same review found) costs zero model calls.

Assert the ORDER in tests, not just the outcomes — an `events[]` array in the
fake deps (`["insert","advance","generate","saveDraft"]`) makes
claim-before-spend an executable invariant instead of a comment.

## Why This Matters

A cap that is checked by read-then-spend-then-write bounds *persisted wins*,
not *spend*. For anything priced per attempt — model tokens, payment intents,
outbound email — the gap between the read and the guarded write is exactly
where concurrent requests multiply cost, and the failure is invisible: the
data ends up correct, only the bill is wrong. The insert-first variant has a
second payoff: any write-path failure (permissions, constraint, outage)
surfaces *before* money moves.

## When to Apply

Any sequence of the form `check guard → priced external call → guarded write`.
Reorder to `claim (CAS/insert under constraint) → priced call → plain write`,
and give the claim a named conflict result the caller can render honestly.

## Examples

Before: `canRegenerate(read count) → generate → UPDATE … WHERE count = expected`
(N racers: N generates, 1 counted). After: `UPDATE count = expected+1 WHERE
count = expected → generate → UPDATE fields` (N racers: 1 generate, 1 counted,
N−1 instant conflicts). See `app/lib/funnel/compose-core.ts` (U10) and the
ordering assertions in `app/lib/__tests__/funnel-compose-core.test.ts`.
