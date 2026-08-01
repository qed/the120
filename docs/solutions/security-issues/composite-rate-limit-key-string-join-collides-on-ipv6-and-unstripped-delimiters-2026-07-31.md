---
title: "A composite rate-limit / cache key built by string-joining on ':' collides when a segment contains the delimiter (IPv6 addresses, un-normalized names) — encode the segments"
date: 2026-07-31
category: security-issues
module: fp-login
problem_type: security_issue
component: rate-limiting
symptoms:
  - "Two distinct (ip, name) pairs serialize to the same rate-limit bucket key, so strikes recorded against one merge into the other's budget"
  - "An attacker who controls the typed identifier can alias their bucket onto (or drain strikes into) another IP's bucket by choosing a colon-bearing name"
  - "Silent — no error; the collision only shows up as rate-limit accounting that does not match reality, and only for IPv6 clients or names containing ':'"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags:
  - rate-limiting
  - ipv6
  - composite-key
  - delimiter-injection
  - key-collision
  - supabase
  - fp-login
related_components:
  - security
  - authentication
---

# Composite rate-limit key string-join collides on IPv6 / un-normalized delimiters

## Problem

The First Profit cross-origin child-login route (`app/api/fp/login/`) keyed its
rate-limit buckets by string-joining the client IP and the normalized name on a
colon: `fp-login:${ip}:${normalizedName}`. That key is **not injective** — two
different `(ip, name)` inputs can produce the same string — because both
segments can legitimately contain the delimiter `:`.

## Symptoms

- `deriveRateLimitKeys('2001:db8', ':x')` and `deriveRateLimitKeys('2001:db8:', 'x')`
  both yield `fp-login:2001:db8::x` (or the shifted equivalent) — one bucket for
  two distinct callers.
- Production clients frequently present **IPv6** addresses (Vercel's
  `x-vercel-forwarded-for` / `x-forwarded-for`), which are full of colons.
- `normalizeStudentName` (in `provision-rules.ts`) only lowercases, trims, and
  collapses whitespace — it does **not** strip `:` — and the identifier
  classifier only rejects `@`, so a name like `:1:x` passes as a valid "name".
- The module's whole reason to exist (attested-IP extraction, per-IP + per-name
  buckets) is to stop an attacker from selecting or merging buckets; the naive
  join reopens exactly that, and it is invisible because nothing errors.

## What Didn't Work

- **Trusting `normalizeStudentName` to make the name delimiter-safe.** It is a
  display/matching normalizer, not a key-escaping function; it never promised to
  remove `:`. Assuming an upstream normalizer sanitizes for your key format is
  the trap.
- **Only testing with dotted-quad IPv4 and alpha-only names.** The original test
  suite did exactly this, so the collision class had zero coverage and looked
  fine.

## Solution

Escape each segment with `encodeURIComponent` before joining, so the delimiter
can never appear inside a segment:

```ts
// BEFORE — ambiguous: ':' can appear inside ip (IPv6) or name
return {
  nameKey: `fp-login:${ip}:${normalizedName}`,
  ipKey: `fp-login-ip:${ip}`,
};

// AFTER — injective: every ':' inside a segment becomes %3A
const ipEnc = encodeURIComponent(ip);
return {
  nameKey: `fp-login:${ipEnc}:${encodeURIComponent(normalizedName)}`,
  ipKey: `fp-login-ip:${ipEnc}`,
};
```

Regression tests that pin the property (not just happy-path IPv4):

```ts
// distinct pairs must not collide even when a segment holds ':'
expect(deriveRateLimitKeys("2001:db8", ":x").nameKey).not.toBe(
  deriveRateLimitKeys("2001:db8:", "x").nameKey
);
// IPv6 addresses are stable and per-ip distinct
expect(deriveRateLimitKeys("2001:db8::1", "maya").ipKey).toBe(
  deriveRateLimitKeys("2001:db8::1", "leo").ipKey
);
// and extractClientIp must return IPv6 unmangled in the first place
expect(extractClientIp(headersOf({ "x-forwarded-for": "6.6.6.6, 2001:db8::1" })))
  .toBe("2001:db8::1");
```

## Why This Works

`encodeURIComponent` percent-escapes `:` (and every other delimiter-class
character) inside each segment, so the only literal `:` left in the key are the
structural ones you wrote between segments. The mapping from `(ip, name)` to key
becomes one-to-one. Decoding is never needed — the key is opaque; it only has to
be collision-free.

## Prevention

- **Any key assembled from untrusted or structured segments must escape the
  segments, not just pick a delimiter.** A delimiter is only safe if it provably
  cannot occur in any segment — and IPs (IPv6), emails, names, and paths all
  routinely contain the usual delimiter characters. `encodeURIComponent`
  per-segment, or a length-prefixed / JSON encoding, makes the join injective.
- **Assume IPv6 for any client-IP value.** Fixtures and tests that only use
  dotted-quad IPv4 will pass while the IPv6 path is broken; add at least one
  IPv6 case to IP-handling and any key derived from an IP.
- **Do not rely on a display/matching normalizer to sanitize for a key format.**
  Its contract is about human equivalence, not delimiter safety; the two drift.
- Same failure family as SQL/log/CSV injection: it is delimiter-injection into a
  string that is later parsed positionally. The fix is always to encode at the
  boundary.
