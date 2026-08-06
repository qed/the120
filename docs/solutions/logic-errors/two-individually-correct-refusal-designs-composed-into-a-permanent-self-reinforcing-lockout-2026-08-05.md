---
title: "Two individually correct refusal designs composed into a permanent, self-reinforcing lockout"
date: 2026-08-05
category: logic-errors
module: fp-progress-route
problem_type: logic_error
component: service_object
symptoms:
  - "A CAPACITY refusal (row cap or response-byte cap) was emitted as the byte-identical 401, which the staff SPA reads as \"not staff\" and signs the user out of the whole Watchtower"
  - "The refusal is deterministic, so signing back in reproduces it immediately — there is no request the staff member can make that succeeds"
  - "Capacity deliberately does not refund rate-limit strikes, so ~60 attempts saturate the 15-minute limiter and the identical 401 persists even after an operator raises the cap"
  - "The only log line, under never-log discipline, names no child and no count — nothing an operator can act on"
  - "A malformed `?tasks=` list did not refund strikes either, so a client regression sending one per render burned 60 strikes and then got the 401 sign-out the 400 existed to prevent"
root_cause: logic_error
resolution_type: code_fix
severity: high
related_components:
  - security
  - development_workflow
tags:
  - composition-failure
  - status-code-contract
  - anti-oracle
  - rate-limiting
  - lockout
  - first-profit
  - staff-dashboard
---

# Two individually correct refusal designs composed into a permanent, self-reinforcing lockout

## Problem

`GET /api/fp/progress` is the staff-only cohort feed behind the Watchtower flow
board. Two safety measures govern how it refuses. Each was designed
deliberately, each is defensible on its own terms, and **each was reviewed and
approved in isolation.**

### Measure 1 — every refusal is a byte-identical 401

An anti-oracle measure, and the house pattern across the whole child gateway. A
prober must not be able to learn whether the endpoint exists, whether an account
is staff, or whether they tripped a limiter. There is no per-reason body and no
per-reason header:

```ts
// Serialized ONCE at module load: refusals are byte-identical by construction,
// not by convention. Same copy as the login/grade/suggestions surfaces (one
// voice — a child or an attacker probing this staff URL sees exactly what a bad
// login shows them, no new oracle).
const REFUSAL_BODY = JSON.stringify({ success: false, error: SIGN_IN_FAILED_MESSAGE });

export function shapeProgressRefusal(
  reason: ProgressRefusalReason
): { status: 401; body: string } {
  void reason; // deliberately unused — the output must not vary with it
  return { status: PROGRESS_REFUSAL_STATUS, body: REFUSAL_BODY };
}
```

The headers are identical too, by construction rather than by discipline — one
`headers` object serves the 200, the 400 and every 401, because *"headers are
exactly where a per-reason oracle (a stray `Retry-After`) creeps back in."*

Correct. Nothing to fix.

### Measure 2 — the staff SPA treats 401 as "not staff" for the whole shell

A 401 means *unauthorised*. The Watchtower shell reads one from any staff
endpoint as "this session is not a staff session", tears down, and signs the user
out. That is a sane client contract for a status code that genuinely means what
it says, and it is what makes revocation (flipping `staff.is_active`) take effect
without waiting out token expiry.

Correct. Nothing to fix.

### Composed: capacity refusals

The route refuses rather than truncating when a cohort read is too big — a
documented, load-bearing decision, because PostgREST silently caps an unranged
select and *"a truncated cohort read here would not look broken — it would look
like a smaller school, with the missing children reading as 'not enrolled'
rather than 'not loaded'."*

That refusal was spelled as **the same 401.**

So the day a school crosses `PROGRESS_MAX_ROWS`, or a shaped body crosses
`PROGRESS_MAX_RESPONSE_BYTES`, every staff member is **signed out of the entire
Watchtower** — not shown an error on one board. And then:

1. **It is deterministic.** Signing back in loads the shell, the board fires the
   same request, the same cap is crossed, they are signed out again. There is no
   request they can make that succeeds.
2. **It does not refund rate-limit strikes** — correctly, on its own terms: a
   capacity breach is repeatable, and refunding it would make the most expensive
   path in the service free to loop. With `PROGRESS_RATE_LIMIT` at
   `{ windowMs: 15 * 60_000, limit: 60 }`, roughly sixty attempts saturate the
   bucket. Now `rate_limited` answers — the **identical** 401 — and holds for
   fifteen minutes **even after an operator raises the cap.** The fix stops
   working before it can be observed to work.
3. **The log says nothing an operator can act on.** Never-log discipline (R3)
   forbids a username and forbids a row count, because a count is a fact about
   the children. The line is value-free by design:

```ts
      console.error(
        `[fp/progress] ${label} exceeded ${PROGRESS_MAX_ROWS} rows — refusing to serve a truncated cohort`
      );
```

Three properties, each individually right, composing into: *staff report their
access was revoked; it reproduces on every sign-in; it survives the fix for
fifteen minutes; and the logs are mute by policy.*

Nothing in the system is behaving incorrectly. There is no bug in any component.
The bug lives entirely in the **composition**, which is why isolated review of
each measure passed.

## The tell that this was findable

The same route had **already carved out a 400-class response** — for a malformed
`?tasks=` parameter — with exactly this rationale written down:

```
 *   400 — the ONE documented exception, generic-bodied, and reachable ONLY by an
 *   ALREADY-AUTHENTICATED staff caller.
 *   … the staff SPA reads 401 as "not staff" for the WHOLE shell — so answering
 *   401 here would sign staff out of the entire Watchtower over a typo or a row
 *   count, deterministically, with the limiter then holding them out for another
 *   15 minutes.
```

The reasoning existed, in this file, in prose, written by the same author. It had
simply not been applied to the **capacity family** — because a parameter typo
feels like a client mistake and a row count feels like a server condition, and
that intuition is about *where the fault lies*, not about *what the client does
with the answer*. Only the second one matters here.

The carve-out even had the shape right: reachable only after both halves of the
staff gate pass (so no new oracle), validated before any DB read, and echoing no
submitted value.

## A second instance of the same composition

The 400 path itself carried the other half of the same failure: **it did not
refund strikes either.**

A client-side regression that sends a malformed list on every render burns sixty
strikes in sixty renders. Then `rate_limited` answers the 401 — and signs the SPA
out of the whole Watchtower. The 400 bought sixty requests of debuggability and
then handed back the exact failure it was built to prevent.

Worth stating plainly, because it is the sharper version of the lesson: **a
carve-out that only changes the status code is incomplete if the limiter can
convert the caller back onto the path you carved them off.** The status code and
the strike policy are one decision, not two.

## Solution

Capacity breaches join the 400-class family, and a request that never touched a
cohort read refunds its strikes.

```ts
export type ProgressBadRequestReason =
  | RequestedTaskIdsRefusal
  /**
   * A read matched more rows than PROGRESS_MAX_ROWS, or exhausted its page /
   * round-trip budget. Deliberately DISTINCT from `outage`: an outage is a blip
   * and the route REFUNDS the rate-limit strike for it, while a capacity breach
   * is deterministic and repeatable — refunding it would make the most expensive
   * path in the service free to loop.
   */
  | "too_many_rows"
  /** The shaped body exceeded PROGRESS_MAX_RESPONSE_BYTES. Deterministic like
   *  `too_many_rows`, and refunded like it: never. */
  | "too_large";
```

The 400 body is byte-identical across its own reasons for the same anti-oracle
reason the 401 is, and it never echoes a submitted id:

```ts
export function shapeProgressBadRequest(
  reason: ProgressBadRequestReason
): { status: 400; body: string } {
  void reason; // deliberately unused — the output must not vary with it
  return { status: PROGRESS_BAD_REQUEST_STATUS, body: BAD_REQUEST_BODY };
}
```

No new oracle is created, because the 400 is **reachable only after both halves
of the staff gate have passed** — the JWT claim and the live `staff` row. An
unauthenticated prober cannot distinguish anything; they get the 401 they always
got.

The read-refusal site now routes the two reasons to different families *and*
different strike policies, in one place:

```ts
    /**
     * Refuse a read. The two reasons differ on BOTH axes, and neither pairing is
     * arbitrary (see ReadResult):
     *   - `outage` → the 401, strike REFUNDED (our fault, not repeatable).
     *   - `too_many_rows` → 400-class, strike KEPT (their data, fully
     *     repeatable — and a 401 here would sign the staff SPA out of the whole
     *     Watchtower over a capacity number).
     */
    const refuseRead = (reason: "outage" | "too_many_rows"): Response => {
      if (reason === "outage") {
        releaseStrikes();
        return refuse("outage");
      }
      return badRequest(reason);
    };
```

and the malformed-list path refunds, with the reason for the refund written at
the site rather than inferred:

```ts
    if (!requested.ok) {
      // REFUND both strikes. This request touched no cohort read at all, and a
      // client-side regression that sends a malformed list on every render would
      // otherwise saturate the limiter after 60 renders — at which point
      // `rate_limited` answers the 401 and signs the SPA out of the whole
      // Watchtower, which is the precise failure this 400 exists to prevent. The
      // caller is already past Origin and both halves of the staff gate, so
      // nothing unauthenticated can spend this budget.
      releaseStrikes();
      return badRequest(requested.reason);
    }
```

Note the two axes are now decided **independently and explicitly**: `outage` is a
401 *and* refunded; `too_many_rows` is a 400 *and* not refunded; a bad list is a
400 *and* refunded. Three of the four combinations are in use, each for a stated
reason. The earlier design collapsed all of them onto one.

The response-byte budget takes the same pairing:

```ts
      if (bytes > PROGRESS_MAX_RESPONSE_BYTES) {
        // 400-class and NO refund, exactly like the row cap: deterministic, and
        // not a statement about who the caller is.
        return badRequest("too_large");
      }
```

Pinned by test, on both axes at once:

```ts
    expect(over.status).toBe(400);
    // Deterministic capacity, so no refund — identical policy to the row cap on
    // the roster read.
    expect(rateRef.released).toEqual([]);
```

## Prevention

- **When two safety measures meet, enumerate the CROSS PRODUCT of their
  states.** Each measure's correctness is established in isolation; the failure
  lives only in the composition, so isolated review is structurally incapable of
  finding it. Here the grid is small — {401, 400} × {refund, no refund} × {blip,
  deterministic} — and writing it out makes the empty and the wrong cells
  obvious in a way that reading either measure never will.
- **A status code is a contract with the CLIENT, not a server-side
  classification.** Before reusing one for a new condition, ask what the client
  *does* on receiving it. "401 is the honest classification of this failure" and
  "401 is a safe thing to send this client" are different questions, and only the
  second one determines what the user experiences.
- **If a refusal is DETERMINISTIC and the caller cannot change their behaviour to
  fix it, it must not be spelled the same way as one they can.** A refusal the
  caller can act on ("your token expired, sign in again") and one they cannot
  ("your school is too big") demand different client behaviour. Collapsing them
  means the client's only available response is the wrong one, forever.
- **A carve-out is incomplete until its STRIKE policy is decided too.** Changing
  the status code while leaving the limiter to convert repeated attempts back
  onto the original path hands the failure straight back. Status and strike are
  one decision.
- **When you carve out an exception for one reason, immediately ask which other
  reasons belong in the same family.** The rationale for the 400 here was
  written, correct, and complete — and applied to one of the two conditions that
  needed it. A carve-out is a *family*, and the next member of that family will
  not announce itself.
- **A refusal an operator cannot diagnose is a worse refusal.** Never-log
  discipline is right and stays, but if the log line must be value-free then the
  *status code* is carrying the whole diagnostic load — which is another reason
  it cannot be shared with an unrelated condition.

## Related Issues

- `docs/solutions/security-issues/constant-response-is-not-constant-timing-and-a-guard-moves-when-you-extract-2026-07-27.md`
  — the anti-oracle discipline that Measure 1 implements. Read together: the rule
  is *identical responses across reasons within a family*, and the open question
  that rule never answers is which reasons belong in which family.
- `docs/solutions/security-issues/a-default-deny-guard-cannot-ask-does-this-account-exist-on-a-public-path-2026-07-28.md`
  — the constraint that makes the 400 safe here. The carve-out is admissible
  only because it sits behind both halves of the staff gate; on a public path the
  same carve-out would be the oracle Measure 1 exists to close.
- `docs/solutions/best-practices/in-memory-rate-limiter-toctou-race-and-fifo-eviction-clears-lockout-2026-07-22.md`
  — the limiter whose no-refund policy is the third component in this
  composition. Its behaviour is correct in isolation and is what converts a
  one-time capacity refusal into a fifteen-minute lockout that outlives the fix.
- `docs/solutions/integration-issues/postgrest-max-rows-1000-silently-truncates-unranged-select-paginate-and-refuse-2026-07-24.md`
  — why the route refuses instead of truncating at all. The refusal is right; only
  its spelling was wrong.
