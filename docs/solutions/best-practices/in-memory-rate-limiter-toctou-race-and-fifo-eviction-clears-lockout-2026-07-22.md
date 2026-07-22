---
title: "An in-memory rate limiter needs ONE atomic check-and-record primitive (not check-then-act) and importance-aware eviction (not FIFO) — either gap turns a lockout into a switch an attacker can flip"
date: 2026-07-22
category: best-practices
module: path-rate-limit
problem_type: best_practice
component: authentication
severity: high
applies_when:
  - "A rate limiter / throttle / lockout guard calls a separate check() then record() with ANY await between them (a DB scan, an external call, a signInWithPassword loop) before the guarded work runs"
  - "A bounded in-memory Map/cache backs a security decision (a lockout counter, a token bucket) and evicts on overflow by insertion order (FIFO) or another policy blind to what each entry represents (an active lockout's many strikes vs. a throwaway key's single entry)"
  - "The target runtime reuses long-lived processes across concurrent requests (Vercel Fluid Compute or similar warm-instance concurrency) — the model that makes the check-then-act race real, not theoretical"
  - "The limiter's key is a bare user-supplied identifier (a typed name, an email prefix) with no source-scoping dimension (client IP, session, device) — collateral lockout and a cheap flood-to-evict both trace back to this"
  - "Writing the FIRST stateful in-memory guard in a codebase — the primitive becomes the precedent every later throttle copies"
related_components:
  - tooling
tags:
  - rate-limiting
  - race-condition
  - toctou
  - check-then-act
  - eviction-policy
  - fail-open
  - brute-force
  - fluid-compute
---

# An in-memory rate limiter needs ONE atomic check-and-record primitive (not check-then-act) and importance-aware eviction (not FIFO)

## Context

The Path's R29 student sign-in throttle (T1 Unit 6) is the first rate limiter anywhere in this repo. It had to be **in-memory**: Unit 6's plan forbade adding new tables, and student sign-in is the one *unauthenticated* action in the app — it runs before any DB work, so it can't lean on a durable store that itself needs a round trip. It targets **Vercel Fluid Compute**, where warm instances are reused and multiplex *concurrent* requests on one event loop — so a race between two requests hitting the same in-memory bucket is a real, exploitable condition, not a theoretical one a single-threaded mental model would dismiss.

The design is a pure sliding-window evaluator (`app/path/lib/rate-limit-rules.ts`: `evaluateRateLimit`, `pruneEvents`) plus a stateful store (`app/path/lib/rate-limit-store.ts`) holding nothing but timestamps per key, wired into `app/path/lib/actions/sign-in.ts`. Building that store surfaced **three** defects that a naive first pass — and any sequential/happy-path test — would have shipped clean. All three were caught in the Unit 6 `/ce:review` (findings F1/F2/F15) and fixed before merge.

## Guidance

### 1. Check-then-act TOCTOU → one atomic check-and-record, no `await` between read and write

The naive shape — evaluate, then separately record after the guarded work — looks correct in isolation but leaves a window open to any concurrent caller:

```ts
// BEFORE — two calls, an await in between: the race window
const decision = checkRateLimit(nameKey, SIGN_IN_RATE_LIMIT);        // read
if (!decision.allowed) return { success: false, error: RATE_LIMITED };
await scanCandidatesAndVerifyPassword();                             // <-- other requests run HERE
recordRateLimitEvent(nameKey, SIGN_IN_RATE_LIMIT);                   // write, arbitrarily later
```

Two concurrent requests for the same key both read "4 of 5, allowed" before either writes its event — the 6th and 7th attempts both slip through. The fix collapses read and write into one function with **no `await` between them**:

```ts
// AFTER — rate-limit-store.ts: checkAndRecordRateLimit
export function checkAndRecordRateLimit(
  key: string,
  config: RateLimitConfig,
  now: number = Date.now()
): RateLimitDecision {
  const pruned = pruneEvents(buckets.get(key) ?? [], now, config.windowMs);
  const decision = evaluateRateLimit({
    events: pruned, now, windowMs: config.windowMs, limit: config.limit,
  });
  if (!decision.allowed) {
    if (pruned.length === 0) buckets.delete(key);
    else buckets.set(key, pruned);
    return decision;
  }
  pruned.push(now);
  storeBucket(key, pruned);
  return decision;
}
```

The reasoning that makes this safe, stated explicitly: **JS is single-threaded, so any synchronous function body runs to completion before the event loop can schedule another callback.** As long as no `await` (or any microtask/macrotask yield) appears between reading `buckets.get(key)` and writing it back, the function is *indivisible* from the perspective of every other request — there is no interleaving to exploit. The moment you add an `await` inside that span, you reopen the window.

Two companions this pattern needs to stay honest:

- **Gate before any I/O.** `sign-in.ts` calls `checkAndRecordRateLimit` *before* the candidate-scan query and *before* `signInWithPassword` — the atomic step happens first, the slow/awaited work happens after, never interleaved with the check.
- **An explicit RELEASE for "this wasn't a real attempt."** If the awaited work after the gate fails for an infrastructure reason (not a wrong guess), the provisional strike must be undone or an outage silently locks users out:

```ts
// sign-in.ts — an outage is not a failed guess
if (res.error) {
  console.error(`[path/sign-in] candidate load failed: ${res.error.message}`);
  releaseRateLimitEvent(nameKey);
  releaseRateLimitEvent(ipKey);
  return { success: false, error: "Something went wrong on our side — try again in a minute." };
}
```

```ts
// rate-limit-store.ts — undo exactly the most-recent event
export function releaseRateLimitEvent(key: string): void {
  const events = buckets.get(key);
  if (!events || events.length === 0) return;
  let maxIdx = 0;
  for (let i = 1; i < events.length; i++) if (events[i] > events[maxIdx]) maxIdx = i;
  events.splice(maxIdx, 1);
  if (events.length === 0) buckets.delete(key);
  else buckets.set(key, events);
}
```

On genuine success, `clearRateLimitBucket(nameKey)` so stale strikes don't compound with a later, unrelated attempt.

### 2. Fail-open FIFO eviction → evict the least-consequential bucket, never an active lockout

A bounded `Map` capped at `MAX_RATE_LIMIT_BUCKETS` has to evict *something* once full — that's inherent. The trap is *which*:

```ts
// BEFORE — FIFO by insertion order (Map iteration order == insertion order)
buckets.set(key, events);
if (buckets.size > MAX_RATE_LIMIT_BUCKETS) {
  const oldestKey = buckets.keys().next().value; // first-inserted, whatever it is
  buckets.delete(oldestKey);
}
```

An attacker who has already locked a victim's bucket (5 events, old timestamps) floods thousands of single-event throwaway keys. Each flood key is newer, so under FIFO the victim's lockout is exactly what ages to the front and gets evicted first — the attacker pays pennies to un-lock their own target. The fix evicts by **fewest events**, so a multi-strike active lockout is never the cheapest thing to remove, and never evicts the key just written:

```ts
// AFTER — rate-limit-store.ts: fewest-events eviction, ties broken by oldest recency
function storeBucket(key: string, events: number[]): void {
  buckets.delete(key);
  buckets.set(key, events);
  if (buckets.size <= MAX_RATE_LIMIT_BUCKETS) return;
  let victimKey: string | undefined;
  let victimCount = Infinity;
  let victimRecency = Infinity;
  for (const [k, ev] of buckets) {
    if (k === key) continue; // never evict the bucket we just wrote
    const recency = ev.length ? Math.max(...ev) : -Infinity;
    if (ev.length < victimCount || (ev.length === victimCount && recency < victimRecency)) {
      victimKey = k; victimCount = ev.length; victimRecency = recency;
    }
  }
  if (victimKey !== undefined) buckets.delete(victimKey);
}
```

A 5-event bucket survives while any 1-event throwaway key exists. This still "fails open" for whatever key *is* evicted (inherent to any bounded map) — but the evicted key is now the least consequential one, and it only matters if a flood can reach the cap in the first place, which rule 3 bounds upstream.

### 3. Key scoping → scope by source + shared value, plus a coarse per-source aggregate

```ts
// BEFORE — keyed on the bare, attacker-supplied name alone
const key = `path-signin:${normalizedName}`;
```

Every student named "Maya" across every family shares one bucket: one kid's five mistyped passwords locks out *every other* Maya platform-wide, and an attacker can DoS any common name for the cost of five requests — no targeting, no IP even needed. The fix scopes the lockout to the source that caused it, and adds a second, coarser gate a name-varying attacker can't dodge:

```ts
// AFTER — sign-in.ts
const ip = clientIp(await headers());
const nameKey = `path-signin:${ip}:${normalized}`; // brute-force guard, scoped to source
const ipKey = `path-signin-ip:${ip}`;              // backstop: bounds a name-varying flood

if (!checkAndRecordRateLimit(nameKey, SIGN_IN_RATE_LIMIT).allowed) return { success: false, error: RATE_LIMITED };
if (!checkAndRecordRateLimit(ipKey, SIGN_IN_IP_RATE_LIMIT).allowed) return { success: false, error: RATE_LIMITED };
```

```ts
// rate-limit-rules.ts
export const SIGN_IN_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60_000, limit: 5 };
export const SIGN_IN_IP_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60_000, limit: 40 };
```

`(ip, name)` keeps the tight 5-per-15-min brute-force guard against a real guesser while confining collateral damage to the source. The per-IP cap (set loose — 40, so a family or several kids behind one NAT never trips it) bounds the attack that scoping-by-name alone invites: varying the typed name every request to get a fresh bucket — which also defeats the per-name throttle and (in this codebase) forces an unfiltered candidate scan per request, and is exactly the flood rule 2's eviction has to survive.

## Why This Matters

Each defect defeats the *exact* control the limiter exists to provide, silently:

- **TOCTOU** makes the limit a lie under concurrency — the path that says "5 attempts max" admits more, with no error and no log, visible only as a burst of successful guesses.
- **FIFO eviction** turns the bounded store into a tool *for* the attacker — the very presence of the cap becomes exploitable by anyone who can generate cheap keys.
- **Bare-name keying** turns a security control into a griefing vector against innocent third parties (every same-named student) and a bypass for the attacker (vary the name, get a fresh budget).

None is caught by a sequential, happy-path test. "Record 5 events, expect the 6th refused" passes in all three flawed versions — the store *works* for the case that matters least (one caller, no adversary, no volume). Only **concurrency-shaped** tests (fire N gates for one key, assert exactly `limit` admitted) and **flood-shaped** tests (lock a victim, flood thousands of throwaway keys, assert the lockout holds) exercise where these bugs live. The generalizable lesson: a stateful guard over shared state needs a test suite that models an adversary and a burst, not just a scenario.

## When to Apply

- Any in-memory or shared-state **guard-then-mutate** pattern — rate limiting, dedupe, claim-then-act, quota/slot minting — where the "is this allowed?" check is a separate call from the "record it" write, with any `await` between them.
- Any **bounded cache or store with eviction** — ask "what gets evicted when full, and can an attacker choose to make that the thing I care about?" FIFO-by-insertion, LRU-by-access, and similar are all vulnerable if "cheap to create" and "cheap to evict" line up for the attacker.
- Any **lockout, throttle, or budget keyed on a client-supplied or shared identifier** — ask "can one legitimate user's mistake collaterally lock out another sharing this key?" and "can the attacker cheaply generate new keys to dodge the limit?" If either is yes, scope by source (IP/session/account) and add a coarse aggregate cap on the source.

## Examples

The tests that pin each fix (`app/path/lib/__tests__/rate-limit-store.test.ts`):

```ts
// Atomic gate admits exactly `limit` — the race is closed
it("N atomic gates for one key admit exactly `limit`, refuse the rest", () => {
  let allowed = 0;
  for (let i = 0; i < cfg.limit * 3; i++) if (checkAndRecordRateLimit("k", cfg, NOW).allowed) allowed++;
  expect(allowed).toBe(cfg.limit);
});

// Active lockout survives a distinct-key flood — the test a FIFO policy would fail
it("an ACTIVE lockout survives a distinct-key flood — eviction takes the fewest-event bucket", () => {
  for (let i = 0; i < cfg.limit; i++) recordRateLimitEvent("victim", cfg, NOW);
  expect(checkRateLimit("victim", cfg, NOW).allowed).toBe(false);
  for (let i = 0; i < MAX_RATE_LIMIT_BUCKETS; i++) recordRateLimitEvent(`flood-${i}`, cfg, NOW);
  expect(checkRateLimit("victim", cfg, NOW).allowed).toBe(false);
});

// Release re-opens a just-closed gate — the outage-is-not-a-failed-attempt path
it("removes exactly one (most-recent) event, re-opening a just-closed gate", () => {
  for (let i = 0; i < cfg.limit; i++) checkAndRecordRateLimit("k", cfg, NOW);
  expect(checkRateLimit("k", cfg, NOW).allowed).toBe(false);
  releaseRateLimitEvent("k");
  expect(checkRateLimit("k", cfg, NOW).allowed).toBe(true);
});
```

**Residual honesty:** none of this makes the guard globally consistent. It is still an in-memory, per-instance, best-effort store *by design* — a cold start or a second warm Fluid Compute instance begins with an empty window, so the limit is per-instance, not global across the fleet. These three fixes harden the guard against the concurrency, eviction, and scoping failure modes *within* that design; they do not remove the need for a durable, shared store (a table or KV) before The Path's TP-1 milestone lifts the test-families-only posture. That migration is the honest carry-forward, tracked in `rate-limit-store.ts`'s own header.

## Related

- [`atomic-claim-then-send-db-guarded-stamp-column-dedupes-best-effort-email-2026-07-14.md`](atomic-claim-then-send-db-guarded-stamp-column-dedupes-best-effort-email-2026-07-14.md) — the **sibling fix for the same check-then-act race at a different atomicity layer.** That doc gets atomicity from a DB conditional `UPDATE … WHERE col IS NULL` (Postgres row-locking, safe *across* serverless instances); this doc gets it from JS's single-threaded event loop with no `await` between read and write (safe only *within* one warm instance — see the per-instance caveat above). Same rule ("never split check-then-act across an awaited gap"), two atomicity mechanisms — pick the DB one when cross-instance correctness matters.
- [`resend-safe-atomic-claim-then-send-cas-guarded-claim-and-unclaim-2026-07-15.md`](resend-safe-atomic-claim-then-send-cas-guarded-claim-and-unclaim-2026-07-15.md) — its CAS-guarded unclaim (don't blindly restore over a concurrent success) is the DB-CAS analog of `releaseRateLimitEvent`'s release-only-on-non-attempt rule. It solves a *cross-request* race that cannot occur here — JS's single-threaded execution is exactly why no CAS is needed in-process.
- [`optional-field-default-sentinel-not-legal-state-guard-fails-open-2026-07-21.md`](optional-field-default-sentinel-not-legal-state-guard-fails-open-2026-07-21.md) — same **fail-open guard family**: a convenience choice (there, an optional-field default; here, an eviction policy) must never coincide with satisfying exactly the condition the guard exists to refuse. Both are Path T1 P1 `/ce:review` findings whose failure mode is invisible — no exception, the guard silently returns the permitting answer.
- [`fail-closed-type-guard-untyped-service-role-rows-into-closed-unions-2026-07-21.md`](fail-closed-type-guard-untyped-service-role-rows-into-closed-unions-2026-07-21.md) — the broader fail-closed family index; a distant cousin (row-narrowing, not rate limiting), same "don't let an absent/overflow case coerce into a trusted, permitting outcome" discipline.
