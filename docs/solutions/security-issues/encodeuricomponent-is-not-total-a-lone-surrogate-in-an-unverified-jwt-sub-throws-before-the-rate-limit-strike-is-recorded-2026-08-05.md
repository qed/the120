---
title: "encodeURIComponent is not total — a lone surrogate in an unverified JWT sub throws before the rate-limit strike is recorded"
date: 2026-08-05
category: security-issues
module: fp-api-rate-limiting
problem_type: security_issue
component: authentication
symptoms:
  - "A crafted Bearer token whose payload carries `\"sub\":\"\\ud800\"` makes the route throw URIError: URI malformed inside rate-limit key derivation, before either bucket is written"
  - "Both the per-(ip,user) strike and the per-IP strike are skipped, so the request is unaccounted and the throttle can be bypassed indefinitely"
  - "The route answers 500 instead of its byte-identical 401 refusal — and if the derivation ever sits outside the whole-body try/catch, Next's own 500 shape confirms the staff-only endpoint exists"
  - "Invisible to the existing tests: every key-derivation fixture used well-formed ASCII subs and IPv4/IPv6 addresses"
root_cause: wrong_api
resolution_type: code_fix
severity: high
related_components:
  - security
  - service_object
tags:
  - rate-limiting
  - encodeuricomponent
  - lone-surrogate
  - jwt
  - composite-key
  - total-functions
  - first-profit
---

# `encodeURIComponent` is not total — a lone surrogate in an unverified JWT `sub` throws before the rate-limit strike is recorded

## Problem

Every First Profit API route derives its composite rate-limit bucket keys as
`namespace:encodeURIComponent(ip):encodeURIComponent(userSegment)` — the
per-segment escaping introduced by the composite-key collision learning. On the
token-bearing routes (`grade`, `site`, `suggestions`, and the new staff
`progress` feed) the user segment is `unverifiedJwtSub`'s output: the `sub`
claim of an **attacker-supplied, unverified** JWT.

`encodeURIComponent` is a **partial** function. Given a lone (unpaired)
surrogate it does not escape it — it throws:

```
> encodeURIComponent(JSON.parse('"\\ud800"'))
Uncaught URIError: URI malformed
```

And a lone surrogate is trivially reachable from a JWT. JSON permits `"\ud800"`,
`JSON.parse` produces the unpaired code unit, and the whole thing round-trips
through a base64url payload segment untouched. `unverifiedJwtSub` does no
charset validation at all:

```ts
export function unverifiedJwtSub(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      sub?: unknown;
    };
    return typeof payload.sub === "string" && payload.sub.length > 0 ? payload.sub : null;
  } catch {
    return null;
  }
}
```

Any non-empty string is returned. Nothing between the wire and
`encodeURIComponent` narrows the charset.

## Symptoms

The damage comes from **where** the throw lands. The house discipline on these
routes is *gate FIRST, atomically*: derive the bucket keys and call
`checkAndRecordRateLimit` **before** any DB I/O and before `auth.getUser()`, so
an unauthenticated flood is bounded before it costs anything. That ordering
means the URIError fires in the gap between "keys derived" and "strikes
recorded":

1. **Both strikes are skipped.** The per-(ip,user) bucket and the per-IP
   aggregate are each written by the call that never runs. An attacker holding
   one crafted token gets **unlimited unaccounted requests** against the route —
   the throttle is not merely evaded for one bucket, it is never touched.
2. **The refusal becomes a 500.** These routes exist to answer with one
   byte-identical 401 (`shapeProgressRefusal` and its siblings serialize the
   body once at module load precisely so no refusal can vary). A thrown
   URIError replaces that with an error response.
3. **A conditional enumeration oracle.** Today the derivation sits inside each
   route's whole-body try/catch, so the caught throw is re-shaped into the
   standard refusal and the byte-identical posture holds. But the guard's
   position is load-bearing and it is exactly the kind of thing that moves
   during an extraction: if the derivation is ever hoisted above the try, Next
   serves *its own* 500 shape — a response byte-distinguishable from the 401 an
   unknown URL produces, which confirms to an attacker that a staff-only
   endpoint exists at that path.
4. **No child data leaks by this path.** Worth stating because it bounds the
   severity: the thrown message is the fixed string `"URI malformed"` and embeds
   no part of the input, so even a logged stack carries no username, no label,
   no token.

## Audit: four of seven derivations were vulnerable — and *why* the other three were not

This is the reusable part. Every composite key derivation in the FP surface was
checked, and the three safe ones are safe for exactly one reason: **a charset
validator provably runs before the derivation.**

| Derivation | Segment source | Verdict |
| --- | --- | --- |
| `deriveSuggestionsRateLimitKeys` | unverified JWT `sub` | **VULNERABLE** (fixed) |
| `deriveGradeRateLimitKeys` | unverified JWT `sub` | **VULNERABLE** (fixed) |
| `deriveSiteRateLimitKeys` | unverified JWT `sub` | **VULNERABLE** (fixed) |
| `deriveProgressRateLimitKeys` (new) | unverified JWT `sub` | **VULNERABLE** (fixed) |
| `deriveRateLimitKeys` (login) | typed identifier | SAFE — `classifyIdentifier`'s `USERNAME_FORMAT = /^[a-z0-9]([a-z0-9._+@-]*[a-z0-9])?$/` rejects a surrogate and refuses *before* the derivation runs |
| `deriveSignupRateLimitKeys` / `deriveVerifyRateLimitKeys` | request-body email | SAFE — `z.email()` in the zod schema rejects it at `safeParse`, which runs before the derivation |
| inline keys in `signup/child/route.ts` and `signup/consent/route.ts` | `attemptId` | SAFE — `attemptId: z.uuid()` |

The four vulnerable ones share the single property that the safe ones lack: the
segment reaches `encodeURIComponent` **without any charset validator having run
on it**. `unverifiedJwtSub` is a *parser*, not a validator — it answers "is
there a non-empty string sub here", which is a shape question, not a charset
question.

**The rule this yields:** a key segment is safe only if a charset validator
provably runs *before* the derivation. "It's a UUID in practice" is not a
validator — `z.uuid()` is. Provenance is not proof; a schema call is.

## What Didn't Work

- **Assuming the composite-key learning was fully applied.** The
  2026-07-31 doc told the team to escape per segment with
  `encodeURIComponent`, and all four routes did exactly that. Following the
  documented fix *verbatim* is what reproduced this bug: the guidance was
  correct about injectivity and silent about totality.
- **Reasoning from "sub is a UUID".** In every real token it is. The point is
  that the token is unverified — the value is whatever the attacker typed into a
  JSON payload, and only a validator makes it a UUID.

## Solution

One shared, **total** segment encoder in `app/fp/lib/rate-limit-rules.ts`, used
by every vulnerable derivation:

```ts
export function encodeRateLimitSegment(segment: string): string {
  return encodeURIComponent(
    // Unpaired high surrogate (not followed by a low one), or unpaired low
    // surrogate (not preceded by a high one).
    segment.replace(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
      "\uFFFD"
    )
  );
}
```

Call sites become a drop-in swap:

```ts
export function deriveProgressRateLimitKeys(
  ip: string,
  userSegment: string
): { userKey: string; ipKey: string } {
  const ipEnc = encodeRateLimitSegment(ip);
  return {
    userKey: `fp-progress:${ipEnc}:${encodeRateLimitSegment(userSegment)}`,
    ipKey: `fp-progress-ip:${ipEnc}`,
  };
}
```

### The deliberate tradeoff: replacement is not injective on malformed input

`\uFFFD` collapses *every* lone surrogate to one character, so two distinct
malformed segments (`"\ud800"` and `"\udc00"`) land in the **same** bucket. That
was chosen over an injective escape on purpose:

- Any injective escape (percent-encoding the surrogate, `\uXXXX`-expanding it,
  prefixing an escape marker) must alter the encoding of some **well-formed**
  string, because an injective map into the same output alphabet has to make
  room. Altering a well-formed encoding **moves shipped bucket keys** — every
  in-flight strike in the in-memory store would be orphaned at deploy, silently
  resetting live lockouts.
- The collapse is safe because it can only ever merge *attacker* traffic into a
  **stricter** shared bucket. No legitimate `sub` (a UUID) and no legitimate IP
  (IPv4 or IPv6 text) can contain a lone surrogate, so two real users can never
  be aliased onto one key. The failure mode of the collapse is "an attacker gets
  throttled harder than strictly necessary", which is the direction you want.

Byte-identity for well-formed input is not asserted case by case — it is
**mechanized**, by comparing against the bare call across nine inputs spanning
IPv4, IPv6, delimiter-bearing, empty, percent, backslash, and astral-plane
strings:

```ts
it("is identical to encodeURIComponent for well-formed input (shipped key formats unchanged)", () => {
  for (const s of ["1.2.3.4", "2001:db8::1", "user:x", "sub-1", "", "a b/c?d&e=f", "\\", "%", "é😀"]) {
    expect(encodeRateLimitSegment(s), JSON.stringify(s)).toBe(encodeURIComponent(s));
  }
});

it("does NOT throw on a lone surrogate, which encodeURIComponent does", () => {
  const high = JSON.parse('"\ud800"') as string;
  const low = JSON.parse('"\udc00"') as string;
  expect(() => encodeURIComponent(high)).toThrow();
  expect(() => encodeRateLimitSegment(high)).not.toThrow();
  expect(() => encodeRateLimitSegment(`a${high}b${low}c`)).not.toThrow();
});
```

The `encodeURIComponent(high)` assertion is the load-bearing one: it pins the
*platform* behavior this helper exists to work around, so the test would go red
if a future runtime ever made the bare call total and the helper redundant.

## Why This Works

`encodeURIComponent` throws because it is specified over **UTF-8 encodable**
input, and a lone surrogate has no UTF-8 encoding — it is a UTF-16 storage
artifact, not a character. Replacing unpaired units with U+FFFD (the Unicode
replacement character, whose entire purpose is standing in for un-decodable
input) makes the string well-formed, at which point the escape is total by
construction: after the replace, every remaining code unit is either an ASCII
character or part of a valid surrogate pair.

The regex uses lookaround rather than a scan so pairing is decided locally:
a high surrogate survives iff a low one follows it, a low surrogate survives iff
a high one precedes it. Valid astral characters (`😀`) are untouched, which is
what keeps the well-formed output byte-identical.

And because the function no longer throws, the gate-first ordering does what it
was written to do: the strikes are recorded, the crafted token is throttled like
any other, and the route answers its ordinary byte-identical 401.

## Prevention

- **Charset-validate before deriving, or use the total helper.** For any new
  composite key: either the segment passed a `z.uuid()` / `z.email()` / format
  regex on the same request path *before* the derivation, or it goes through
  `encodeRateLimitSegment`. There is no third option, and "the value comes from
  a token so it's structured" is not the first one.
- **Treat any string reaching `encodeURIComponent` from a token, header, or
  request body as untrusted *at the charset level*, not just the value level.**
  `encodeURIComponent` is partial, and so is `decodeURIComponent` — it throws
  `URIError` on a malformed percent sequence, which is the same trap pointing
  the other way. Neither belongs on an un-narrowed untrusted string without a
  total wrapper.
- **Test every key derivation with a lone-surrogate input.** One line per
  derivation: `expect(() => derive(ip, JSON.parse('"\\ud800"'))).not.toThrow()`.
  This whole class had zero coverage because every fixture was well-formed ASCII
  — the same shape of gap as the IPv6-free fixtures in the composite-key doc.
- **When a fix must preserve shipped key formats, mechanize byte-identity as a
  test rather than asserting it case by case.** A loop comparing the new
  function against the old one across a spread of well-formed inputs is a
  standing proof that the migration is behavior-preserving; a paragraph in a PR
  description is not, and it cannot survive the next edit to the helper.
- **A fix documented in `docs/solutions/` inherits the responsibility to be
  total.** Guidance is copied verbatim across routes; if it is silent about a
  partial function, four routes will be silent about it too.

## Related Issues

- `docs/solutions/security-issues/composite-rate-limit-key-string-join-collides-on-ipv6-and-unstripped-delimiters-2026-07-31.md`
  — the doc that introduced per-segment `encodeURIComponent`. It is right about
  injectivity and silent about totality; following it verbatim is what produced
  this bug. That doc has been updated to point at this one.
- `docs/solutions/security-issues/constant-response-is-not-constant-timing-and-a-guard-moves-when-you-extract-2026-07-27.md`
  — the same "a guard's *position* is load-bearing, and extraction moves it"
  hazard that makes symptom 3 above a live risk rather than a hypothetical.
