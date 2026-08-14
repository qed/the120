---
module: fp-parent-doors
tags: [rate-limiting, zod, postgrest, uuid, consent, fpv04]
problem_type: control_bypass
---

# A malformed id that reads as "our outage" refunds the rate-limit strike

**Context (fpv04 U8b, 2026-08-14).** Three parent doors — reset a child's
password, change their photo permission, take their public page offline — share
one carefully-written limiter discipline: record a strike on a per-parent bucket
AND a per-IP bucket, atomically, before any database I/O; refuse with a
byte-identical 401; and **refund both strikes only when the failure was ours**,
which the code expresses as an allowlist:

```ts
export const REFUNDED_OUTCOMES = ["outage"];
```

Each door validated its input with `z.string().min(1).max(100)`. Reasonable —
and the length bound was even chosen to match the core's own.

But `children.id` is a **uuid** column. A `childId` of `"x"` does not miss the
row: PostgREST answers `22P02 invalid input syntax for type uuid`, an ERROR.
Every layer then does exactly what it was told to do with an error — the core
returns `outage`, the route refunds both strikes, and the caller gets a 401.

So: loop `{"childId":"x"}`. Every request costs a token verification against the
auth provider plus a service-role round trip, and every request hands the strike
back. The bucket never fills. The documented volume control on the three doors
that move a child's credential, their photo permission and their public
visibility is bypassed — not by defeating it, but by *being refunded by it*.

**The rule.** **A validator must be tight enough that malformed input cannot
reach a layer that will misclassify it.** The question is not "is this string
plausible?" but "what does the database do with it if it is wrong?" — because
the answer decides whether the failure is filed under *the caller's fault* or
*ours*, and only one of those costs the caller anything.

```ts
const UUID_CHILD_ID = z.string().uuid();   // not .min(1).max(100)
```

Now a bad id is `malformed_request`: the strike stands, and no round trip
happens at all.

**Why it hid.** Three defensible decisions again:
- *"Validate shape, let the DB own the semantics"* — fine, until a shape error
  and an availability error arrive on the same channel.
- *"Refund only on outage"* — correct, and precisely the branch being abused.
- *"The tests pass"* — the fake Supabase in the test suite returns an empty
  result for an unknown id. It never emits `22P02`, so the whole class was
  invisible below the real driver. **A fake that is more forgiving than the real
  thing hides exactly the bugs it was built to catch.**

**The generalisation.** Any code path with a *refund*, a *retry*, or a *skip*
keyed on "this was our fault" deserves the question: **what caller-controlled
input can I send to make my own system report its own failure?** A caller who
can forge that classification gets whatever the branch grants — a free retry, an
unbounded loop, an uncounted attempt.

**Prevention.**

1. Type every id validator to the column's type, not to a length. `uuid()` for a
   uuid, a bounded enum for an enum.
2. Grep for refund/retry predicates and, for each, list the inputs that can
   reach them. If any is caller-shaped, tighten the validator rather than the
   predicate.
3. Test the malformed case for its LIMITER effect, not just its status code:
   assert the strike still stands. A test that only checks for 401 passes
   happily while the bucket is being emptied.
4. When a fake stands in for a database, make it reject what the database
   rejects — or accept that the class it forgives is untested.

**Related.** The same review found the neighbouring failure in the same feature:
the consent record's age band derived from a column *the child themselves can
write*, letting the protected party set the terms of their own protection. Both
are the same question asked twice — **whose input decides this, really?**
