---
title: 'A percentage circuit-breaker halts a small bulk send on one transient blip — retry transient send failures (an idempotency key makes it safe)'
date: 2026-07-21
category: best-practices
module: bulk-email-send
problem_type: best_practice
component: email_processing
severity: medium
applies_when:
  - Building or running a throttled bulk / transactional email send or backfill
  - A failure (or bounce/complaint) circuit-breaker keeps auto-pausing a small send on transient errors
  - Deciding whether it is safe to retry a failed transactional send
root_cause: config_error
resolution_type: code_fix
tags: [bulk-email, retry, idempotency-key, circuit-breaker, auto-pause, resend, transient-failure, backfill]
---

# A percentage circuit-breaker halts a small bulk send on one transient blip — retry transient send failures (an idempotency key makes it safe)

## Context

The Week-1 Welcome Email backfill (`scripts/backfill-welcome-email.ts`) sends to every consented family with a per-send throttle and an auto-pause circuit breaker: hard-stop when the failure rate is **≥ 10% after a min-sample of 10 attempts**. On the real 32-recipient send, a single transient `"fetch failed"` (a network blip reaching the Resend API) in the first 10 sends = 1/10 = 10% → the run auto-paused. Re-running resumed (the fixed campaign-cutover skipped the completed sends), then it paused **again** on the next transient blip — a *different* address each time. The failures were transient (the same address succeeded on retry), not deliverability problems. The stop-start was pure friction on a 1-minute job.

## Guidance

Two cheap fixes:

**1. Retry transient send failures in the loop — the provider idempotency key makes it safe.**

Most people don't retry a failed transactional send for fear of double-sending. With a per-message idempotency key (Resend's `Idempotency-Key` header, 24h window), that fear is removed: if the first attempt actually reached the provider and only the *response* was lost, the retry with the same key is a **no-op**; if it never reached the provider, the retry sends fresh. Either way — no duplicate.

```ts
const sendOnce = () => sendWelcome(admin, input, {
  resendOf: r.welcome_email_at ?? undefined,
  idempotencyKey: `welcome-backfill-${r.id}`,   // STABLE per recipient
});
let res = await sendOnce();
for (let attempt = 2; res.status === "send_failed" && attempt <= 3; attempt++) {
  await sleep(2000);        // short backoff
  res = await sendOnce();   // same idempotency key → can't duplicate
}
// only a PERSISTENT failure (after 3 tries) counts toward the circuit breaker
```

The key must be **stable across retries** (keyed to the recipient/message, never `Date.now()` or a per-call value) — a fresh key each attempt defeats the dedupe.

**2. Size the circuit-breaker to the batch — a percentage with a low min-sample is too twitchy for small sends.**

A "≥ 10% failures after 10 attempts" hard-stop trips on the *first* transient failure of a small run (1/10). For a list of tens, prefer a **count-based** tolerance (pause after N genuine failures) or a min-sample that scales with the list, so a lone blip doesn't halt everything. Keep the breaker — it still catches a *systemic* failure (bad domain auth → everything fails) — but let transient noise pass, especially once retries absorb it.

## Why This Matters

- **Retries convert transient noise into successes**, so the breaker only ever sees genuine, persistent failures. Without retries, a flaky connection (~10% transient failures observed here) makes any percentage breaker fire almost immediately.
- **The idempotency key is what makes the retry decision easy** — it's the difference between "never retry a send" (safe but leaves gaps) and "retry freely" (complete, still no duplicates). Reach for it *before* deciding a send is un-retryable.
- **A too-sensitive breaker on a small, high-value founder send is worse than useless** — it turns a 1-minute send into a manual stop-start and tempts the operator to disable the safety entirely, which is the opposite of what a circuit breaker is for.

## When to Apply

- Any throttled bulk / transactional email loop (backfills, nurture batches, re-sends).
- When a send loop's circuit breaker halts on transient provider/network errors rather than real deliverability signals.
- Confirm the provider supports an idempotency key (Resend: `Idempotency-Key`, 24h) before relying on retries being duplicate-safe.

## Examples

The 32-recipient welcome backfill auto-paused **twice** (one transient `"fetch failed"` per ~10 sends) before the retry was added. After adding the 3-attempt retry with the stable `welcome-backfill-<id>` key, the final pass completed clean (`sent=14, failed=0`), and the DB confirmed **33/33 families welcomed with zero duplicates**. The circuit-breaker threshold itself was left as-is for this run (the retry absorbed the noise), but the sizing note above is the durable follow-up for the next small send.

## Related

- The durable dedupe vs. the retry-window layer: `docs/solutions/best-practices/resend-safe-atomic-claim-then-send-cas-guarded-claim-and-unclaim-2026-07-15.md` and `docs/solutions/best-practices/atomic-claim-then-send-db-guarded-stamp-column-dedupes-best-effort-email-2026-07-14.md` — the DB `welcome_email_at` stamp is the *durable* single-send guard; the `Idempotency-Key` is the 24h layer that makes the retry above safe.
- Backfill script reuse across app + tsx (why the script can call the app's exact `sendWelcome`): `docs/solutions/best-practices/server-only-import-breaks-tsx-scripts-plain-core-re-export-2026-07-21.md`.
- Origin: `docs/plans/2026-07-20-001-feat-week1-welcome-email-plan.md` (Unit 7 / R10 — the throttle + auto-pause design).
