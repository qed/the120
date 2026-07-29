---
module: funnel
date: "2026-07-29"
problem_type: best_practice
component: service_object
severity: critical
applies_when:
  - "Work is taken under a row-level lease/claim with age-based expiry"
  - "The leased run makes slow external calls (Google, Stripe, auth admin) after the grant"
  - "A second driver can legitimately take over an expired lease"
symptoms:
  - "A run stalled past its lease expiry wakes up and keeps writing — its finishRun overwrote the takeover's landed state"
  - "The zombie's landing write cleared lease columns out from under the live run, letting a third driver in concurrently"
root_cause: async_timing
resolution_type: code_fix
tags:
  - lease
  - fencing
  - cas
  - zombie-writer
  - takeover
  - provisioning
  - race
---

# A lease grant serializes the TAKE, not the RUN — fence every later write on still holding it

## Context

Funnel U6's provisioning lease RPC (`provision_lease`) was correct at the
grant: a plain `UPDATE … WHERE state retryable OR (in_progress AND expired)`
is row-locked, so two concurrent callers can never both be granted. The
adversarial reviewer's trace started *after* the grant: run A takes the
lease (120s expiry), stalls 121+ seconds on a slow Google call, run B
legitimately takes over, lands `complete` — and then A **wakes up**. Every
one of A's subsequent writes (`finishRun`, `claimLocalPart`,
`reassignLocalPart`) was keyed only on `child_id`, so A's stale patch
silently stomped B's landed state, reset it to `pending`, overwrote
`supabase_user_id` with A's own duplicate, and always nulled the lease
columns — releasing B's lease out from under it mid-run.

## Guidance

The boolean from `takeLease` is trustworthy for exactly zero external
calls. After any await, the only proof you still own the claim is the
database saying so **at write time**:

- Bind the run's `owner` into the deps at construction
  (`realProvisionDeps(owner)`), and condition **every** claim-table write
  on it: `.eq("child_id", childId).eq("lease_owner", owner).select(...)`;
  zero rows matched = the lease is no longer yours = return `false` and
  write nothing.
- RPCs that move protected state take `p_owner` and answer `'lost_lease'`
  when the caller is not the current leaseholder.
- The core treats a refused persist as a **lost run**, not a landed one:
  the `land()` helper degrades any outcome to
  `{kind: "deferred", detail: "state persist refused — lease lost"}`, and
  side effects gated on landing (ops pages, telemetry) fire only after a
  successful persist — the new leaseholder owns the claim's story now.

## Why This Matters

Without fencing, lease expiry — the very feature that stops a crashed run
holding its claim forever — is what *creates* the two-writer window. The
longer the external calls, the more ordinary the zombie becomes: no exotic
failure needed, just one slow API response. And the corruption is quiet:
the zombie's write looks like any other landing.

## When to Apply

Any lease/claim with expiry-based takeover where the leased run performs
writes after awaits. If `takeLease` can be granted twice across time, every
write the grant "authorizes" needs the owner in its WHERE clause.

## Examples

```ts
// adapter — the fence
const { data, error } = await db
  .from(CLAIM_TABLE)
  .update(row)
  .eq("child_id", childId)
  .eq("lease_owner", owner)   // ← the fence
  .select("child_id");
if (error || (data ?? []).length !== 1) return false; // lease lost: write nothing more

// core — a refused persist un-lands the whole run
const land = async (patch, outcome) =>
  (await deps.finishRun(childId, patch))
    ? outcome
    : { kind: "deferred", detail: "state persist refused — lease lost" };
```

Shipped in PR #113 (`provision-deps.ts`, `20260818120000_funnel_provisioning_fencing.sql`);
pinned by `funnel-provision-core.test.ts` ("a refused finishRun means the
run landed NOTHING") and mutation-tested (forcing `landed = true` reddens).
Sibling lesson: [claim-before-spend](claim-before-spend-the-priced-external-call-runs-only-after-the-row-level-claim-2026-07-28.md)
governs the grant; this one governs everything after it.
