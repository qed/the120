---
module: fp-signup
tags: [rate-limiting, cas, fail-closed, brute-force, concurrency, otp]
problem_type: security_issue
component: authentication
severity: high
symptoms:
  - "A retry loop that gives up returns a generic failure the caller treats as an outage"
  - "The condition that exhausts the retries is exactly the attack that needs counting"
  - "A wrapper refunds the rate-limit strike whenever the core reports failure"
root_cause: logic_error
resolution_type: code_fix
---

# A bounded-retry CAS on a security counter must give up toward the control, and a refunded rate-limit strike refunds the attacker

## Problem

A 6-digit email verification code has 10^6 entropy, so the security control is not the
code — it is the durable guess counter. Ours was `fp_signup_attempts.code_guess_count`,
incremented on every wrong guess and checked by the redeem CAS, with
`MAX_CODE_GUESSES = 6`.

PostgREST cannot express `count = count + 1`, so the increment was a compare-and-swap
on the observed value with bounded retries:

```ts
for (let i = 0; i < CODE_GUESS_CAS_RETRIES; i++) {   // 5
  const seen = await readCount();
  const casted = await db.update({ code_guess_count: seen + 1 }).eq("code_guess_count", seen);
  if (casted.rows.length > 0) return { ok: true, count: seen + 1 };
}
return { ok: false, count: MAX_CODE_GUESSES };       // gave up
```

The caller mapped `ok: false` to a generic `{ kind: "failed" }` **without counting the
guess**. The module's own comment defended this as failing toward "we could not count
this attempt, never toward unlimited" — but functionally an uncounted wrong guess *is*
an unlimited one.

What makes it exploitable rather than theoretical: **the condition that exhausts the
retries is precisely the attack.** CAS retries are only lost to *concurrent writers on
the same row*, which is what a scripted brute-forcer firing simultaneous guesses at one
attempt produces. Normal users never hit it; attackers hit it on purpose.

Then the wrapper doubled it. The Server Action released the rate-limit strikes on any
`failed` result, on the reasonable-sounding theory that our own errors should not spend
the caller's budget:

```ts
if (result.kind === "failed") {
  releaseRateLimitEvent(attemptKey);
  releaseRateLimitEvent(ipKey);
}
```

So a sustained-concurrency attacker produced guesses counted by **neither** the durable
per-row cap nor the volumetric backstop, and got their rate-limit budget refunded each
time.

## Symptoms

- A retry loop around an optimistic-concurrency write has a give-up branch returning a
  generic error.
- That generic error is indistinguishable, at the caller, from an infrastructure fault
   — so the caller "helpfully" retries, refunds, or otherwise forgives it.
- The exhaustion condition correlates with adversarial load rather than normal load.
- A security counter's increment is a separate round-trip from the check that reads it.

## Solution

**Give up toward the control, not toward the generic error**, and stop refunding the
strike for a real attempt:

```ts
// give-up branch now locks the attempt rather than dropping the guess
console.error(`[fp/signup] guess-count CAS exhausted for attempt ${attemptId}`);
await db.update({ code_guess_count: MAX_CODE_GUESSES }).eq("id", attemptId);  // unconditional
return { ok: false, reason: "exhausted", count: MAX_CODE_GUESSES };

// the core distinguishes the two failure modes
exhausted -> { kind: "locked" }    // a real attempt; counts; strike NOT refunded
error     -> { kind: "failed" }    // genuine infra fault; strike refunded
```

The refund rule became: refund only for failures that are *our* fault
(`failed`, and the post-redeem infra failures), never for outcomes that represent a
caller action (`locked`, `invalid_code`, `expired`).

A related trap closed at the same time: a verify against an email with no live attempt
now answers `invalid_code` with a decremented remaining-guess count, not `failed`.
Answering `failed` would have made non-existence both a free existence probe and a
refunded one.

## Why This Works

A bounded retry has three outcomes, not two: succeeded, failed for an external reason,
and *could not establish the result*. The third is the dangerous one, because whichever
direction it collapses into becomes the system's behavior under contention — and
contention is attacker-controllable. Collapsing "could not count" into "did not count"
hands the attacker exactly the state they were trying to produce; collapsing it into
"count it / lock it" costs at most a rare false lock for a user who double-submitted,
which is recoverable, while the alternative is unrecoverable.

The rate-limit refund is the same reasoning one layer up. A refund is a judgment that
"this did not consume anything real." An attempted guess consumes something real
whether or not the system managed to record it, so refunding it converts the volumetric
backstop into a no-op precisely when the durable control is also degraded.

## Prevention

- **Enumerate a retry loop's give-up branch as a security decision.** Ask: who causes
  exhaustion? If the answer is "concurrent writers on one row", the answer is also
  "an attacker", and the branch must fail toward the control.
- **Never map "could not determine" onto the same result as "infrastructure broke"**
  when a caller treats the latter as forgivable. Give it its own discriminated kind so
  the wrapper can decide deliberately.
- **Audit every rate-limit release against "would an attacker want this?"** A refund on
  generic failure is a common, reasonable-looking pattern that quietly makes failed
  probes free. Refund only for faults on your side, and enumerate which kinds those are.
- **A security counter that is not incremented atomically is a control with a race.**
  Prefer a real atomic increment where the client allows one; when it does not, treat
  the CAS give-up as the security boundary and pin it with a test that drives enough
  concurrent writers to exhaust the retries (ours needed 12).
- **Test that the guard bites.** Reintroducing the old give-up branch must turn a test
  red. Ours asserts "no concurrent wrong guess ever answers the one kind the action
  refunds", which pins the core and the wrapper's refund rule together.
- Related: [in-memory rate limiter TOCTOU race and FIFO eviction clears lockout](../best-practices/in-memory-rate-limiter-toctou-race-and-fifo-eviction-clears-lockout-2026-07-22.md)
  (why the in-memory limiter is a volumetric backstop only and must never be the
  load-bearing control) and
  [no-transaction multi-step write: compensation, post-write verify, CAS-scoped claim](../best-practices/no-transaction-multi-step-write-compensation-post-write-verify-cas-scoped-claim-2026-07-22.md).
