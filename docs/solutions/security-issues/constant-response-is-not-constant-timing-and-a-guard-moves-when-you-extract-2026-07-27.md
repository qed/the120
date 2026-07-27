---
title: "A byte-identical response is not a constant response: an awaited email send makes the known-address branch measurably slower, and an early return on the per-target limit freezes the per-IP backstop"
date: 2026-07-27
category: security-issues
module: app/lib/funnel/resume-core.ts
problem_type: security_issue
component: authentication
severity: medium
symptoms:
  - "Request-a-link returns the same string for known and unknown addresses, but the known-address branch additionally awaits a token INSERT and a Resend HTTP round-trip — a ~100ms delta an attacker averages out to enumerate families"
  - "An unhandled rejection in the same endpoint returns a different response SHAPE than the constant, which is a second oracle in the same defense"
  - "Hammering one already-saturated ip:email bucket costs no further per-IP budget, because the per-target denial returns before the IP strike is recorded"
root_cause: logic_error
resolution_type: code_fix
last_updated: 2026-07-27
related_components:
  - authentication
  - background_job
tags:
  - enumeration
  - timing-oracle
  - rate-limiting
  - constant-response
  - resend
  - server-actions
---

# A byte-identical response is not a constant response

## Problem

Funnel U3's request-a-link endpoint implements R7c: the response must be
identical whether or not the address has an application, because an
enumeration oracle here leaks which families applied to a program **for their
children**. The body was constant. Three things still leaked.

**1. Timing.** The unknown-address branch returned right after one `SELECT`.
The known-address branch additionally awaited a token `INSERT` and
`sendEmail`, which performs a real `fetch` to Resend with an 8-second timeout.
That is a large, consistent delta on top of everything the paths share —
averaged over enough samples, it separates known from unknown as reliably as
different text would.

**2. Shape, on throw.** Every *handled* failure returned the constant, but the
function had no try/catch. A rejection anywhere — `headers()` outside a request
scope, a network-level supabase-js throw, the mail guard's deliberate throw —
surfaced as an unhandled Server Action error. A different response shape for
*some* inputs is exactly the oracle the constant existed to close.

**3. A frozen backstop.** The limiter checked the per-target bucket
(`ip:email`), returned the constant if denied, and only then recorded the
per-IP bucket. So after paying three strikes, an attacker could hammer that
same saturated bucket forever: each request denied at stage one, none ever
consuming per-IP budget. The 20-per-15-minute backstop — whose entire job is
bounding total volume when someone varies the email — bounded nothing.

## What would NOT have caught it

- **Asserting the response bodies are equal.** They were. All three leaks live
  outside the body.
- **Testing the limiter's arithmetic.** `rateCountVerdict` was correct in
  isolation; the flaw was the *order* of two correct checks in the caller.
- **A source scan for a try/catch.** The sibling `redeemResumeTokenCore` had
  one and the header documented the never-throw contract; only executing the
  throw path shows which functions actually honour it.

## Solution

```ts
// 1. Defer the send: the response no longer carries a Resend round-trip.
deps.defer(async () => {
  const sent = await deps.sendMail({ ... });
  if (!sent.ok) { await release(); }          // family got nothing
  await store.pruneRateEvents(...);            // opportunistic cleanup rides along
});
return constant;

// 2. Wrap the whole body — a throw is a different SHAPE, and a difference is an oracle.
} catch (err) {
  console.error("[funnel/resume] request exception:", err);
  return constant;
}

// 3. Record BOTH buckets before EITHER verdict applies.
const perTarget = await checkFunnelRateLimit(store, "resume-request", `${ip}:${email}`, ...);
const perIp     = await checkFunnelRateLimit(store, "resume-request-ip", ip, ...);
if (perTarget.infraFailed || perIp.infraFailed) { await release(); return constant; }
if (!perTarget.allowed || !perIp.allowed) return constant;
```

`infraFailed` is a third state distinct from allowed/denied: a DB outage is not
an attempt, so the strike is handed back — but a genuine denial keeps it.

## Why This Works

A constant response is a claim about **everything observable**, not about the
bytes. The observable set is: body, status, headers, *and elapsed time* — plus,
for a Server Action, whether it resolved or rejected. Any branch that does
strictly more work than another is distinguishable unless the extra work is
moved off the response path entirely. Deferring is better than padding with a
sleep: padding has to guess the delta and re-guess whenever Resend's latency
changes.

For the limiter: two sequential gates where the first can short-circuit means
the second gate only ever sees traffic the first one allowed. If the second
gate is a *backstop* — there to bound what the first one cannot — it must be
evaluated unconditionally, or it only measures the subset that was never the
threat.

## A companion finding: a guard moves when you extract

The same unit extracted `generateLink` out of the core into a new store module.
`no-auth-mail-guard.test.ts` immediately reddened: the new file contained a
mail-capable Supabase Auth call and no `assertNoAuthMailToFwStudent`. The guard
call had stayed behind in the caller.

Nothing about the behaviour changed — the guard still ran, one frame up the
stack — and the refactor was otherwise an improvement. But the enforcement test
is right and the code was wrong: **a guard one file away from its call is one
refactor away from being no guard at all.** The fix is the guard beside the
call, in the same function, with the caller's check kept as defence in depth.

This is the payoff of an enforcement test that asks a *structural* question
("does every file containing a mail-capable call also contain the guard?")
rather than a behavioural one. A behavioural test would have stayed green.

## Prevention

1. When a response is required to be constant, enumerate the observable
   channels — body, status, headers, **latency**, resolve-vs-reject — and name
   which mechanism closes each. Body equality alone is a partial answer.
2. Move slow, branch-specific side effects (mail, webhooks) off the response
   path rather than padding the fast path.
3. Wrap any endpoint with a constant-response contract in try/catch. The
   contract includes the failure modes you did not enumerate.
4. Sequential rate-limit gates: record every bucket before applying any
   verdict. A backstop that only sees allowed traffic is not a backstop.
5. Give infra failure its own state, distinct from denial, so the strike can be
   released — the family must not pay for your outage.
6. When extracting a function that calls a guarded API, move the guard with it.
   If an enforcement test reddens on a pure refactor, believe the test.

## Related Issues

- `docs/solutions/best-practices/in-memory-rate-limiter-toctou-race-and-fifo-eviction-clears-lockout-2026-07-22.md`
  — both of its findings are closed by the DB-backed insert-then-count store this
  unit added; this doc covers the third failure that design does not address.
- `docs/solutions/security-issues/guard-function-with-no-callers-is-not-a-mechanism-client-side-supabase-auth-bypasses-server-guards-2026-07-23.md`
  — the enforcement-test discipline that caught the moved guard.
- `docs/solutions/logic-errors/cookie-probe-before-account-side-effect-2026-07-27.md`
  — sibling from the same build: probe the capability before the side effect.
- `docs/solutions/security-issues/state-changing-email-links-mutate-on-get-scanner-prefetch-false-confirm-2026-07-16.md`
  — the GET/POST split this endpoint's landing page implements.
