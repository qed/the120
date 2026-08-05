---
module: fp-signup
tags: [idor, authorization, bearer-credential, resume, server-actions, enumeration, coppa]
problem_type: security_issue
component: authentication
severity: critical
symptoms:
  - "A convenience resume path returns an existing row's id to whoever submits the matching email"
  - "A mutating action authorizes on possession of that id alone"
  - "A code comment asserts the caller must own the row, but nothing enforces it"
root_cause: missing_permission
resolution_type: code_fix
---

# A resume path that returns the prior row's id turns that id into a bearer credential for someone else's account

## Problem

The v3 signup added an inline 6-digit email code. Two features landed in the same
unit and were individually reasonable:

1. **Resume.** A parent who comes back the next day with the same email should get a
   fresh code on their existing attempt rather than dead-ending. So `startSignup`
   looked up the pending attempt by email and returned
   `{ kind: "started", attemptId: prior.id }`. By design there was no expiry filter
   on that lookup.
2. **Edit-email.** A parent who typo'd their address should be able to correct it. So
   `v3EditEmail(attemptId, newEmail, newPassword)` checked the attempt was still
   `state === 'started'` and unverified, then deleted the orphaned auth account
   (`deleteUser`) and retargeted the row.

Composed, they are an unauthenticated account-deletion primitive. An attacker who
knows only a victim's email address:

```
POST v3StartAction   { email: victim@example.com, ... }
  -> resume finds the victim's pending attempt
  -> returns the VICTIM'S attemptId to the attacker
POST v3EditEmailAction { attemptId: <victim's>, email: attacker@evil.com, password: ... }
  -> state is 'started', verifiedAt is null  => "authorized"
  -> deleteUser(victim's parentId)           => victim's account destroyed
  -> attempt retargeted to the attacker
```

No code, no password, no session. Both calls sat far under the rate limits, and the
window was unbounded until the victim verified or exhausted their guesses. This is a
children's product; the deleted rows were parents mid-signup.

The same hole had a second consequence. `v3EditEmail`'s guard never inspected
`code_guess_count`, so a **locked** attempt (guess cap reached, still
`state='started'`) could be laundered: delete the account, abandon the row, restart
with the *same* email, and get a fresh row with `code_guess_count: 0`. The durable
6-guess cap protecting a 10^6-entropy code became unlimited — roughly 30 guesses per
15 minutes per IP, more with rotation.

## Symptoms

- A "resume"/"continue where you left off" path keyed on a **public identifier**
  (email, phone, order number) hands back an internal row id.
- A mutating or destructive operation takes that id and checks only *row state*
  (`is it still pending?`) rather than *caller identity* (`is it yours?`).
- The dangerous code carries a comment asserting the safe premise. Ours said:
  *"this only ever runs against an attempt the caller holds ... one THIS flow created
  and whose account it therefore minted."* That sentence was true when edit-email was
  written and false once resume shipped.
- Each feature has tests; the composition has none.

## What Didn't Work

- **Reading either function alone.** Both are individually defensible. The bug lives
  only in the composition, which no single file shows.
- **Trusting the comment.** The comment was the clearest statement of the invariant
  and also the bug: it recorded an assumption about callers that a later caller broke.
  A comment cannot enforce an invariant that a new code path can violate.
- **"The id is unguessable, so it is fine."** True and irrelevant. The attacker never
  guesses it; the system hands it over on request, keyed on a value that is public by
  construction (you email it to people).

## Solution

**Delete the credential rather than harden it.** Key the follow-up operations on the
email the server re-derives, so no row id ever crosses the trust boundary:

```ts
// BEFORE: start hands back a row id; later actions authorize on possession of it.
v3StartSignup(...)   -> { kind: "started", attemptId: prior.id }
v3VerifyCode(attemptId, code, ...)
v3EditEmail(attemptId, newEmail, ...)   // deletes the account behind attemptId

// AFTER: nothing identifying a row leaves the server.
v3StartSignup(...)   -> { kind: "code_sent" }        // no id, ever
v3VerifyCode(email, code, ...)          // server re-derives the pending attempt
v3ResendCode(email, ...)
v3EditEmail(newEmail, ...)              // NON-destructive: a plain fresh signup
```

Three properties fall out:

- **There is nothing to steal.** The attacker's `start` call still mails a code — to
  the victim's inbox, which is the point. It returns a bare `{ kind: "code_sent" }`.
- **Edit-email stops being a weapon.** With no id and no lookup, it degenerates into
  "start a signup for the corrected address" — something anyone could already do. The
  stale attempt for the mistyped address is left to expire and be reaped, and the
  orphaned passwordless account is logged in the stranded-account vocabulary for ops
  rather than deleted by an unauthenticated caller.
- **The counter cannot be reset.** No recycle primitive exists; belt-and-braces, the
  cap is also re-checked wherever an attempt could be reused.

Any abandon that survives is CAS'd (`WHERE id = ? AND state = 'started' AND
verified_at IS NULL`) so a racing verify wins deterministically and the inconsistent
`verified_at set + state='abandoned'` row is unreachable.

The rejected alternative was minting a separate high-entropy per-attempt handle and
requiring it. It fails on its own terms: the legitimate resume case is *by definition*
a client with no handle (new day, new browser), so the resume path would either break
resume or hand the new handle out exactly as before — hardening the credential while
preserving the leak. It also cost a migration against a live production database.

## Why This Works

Authorization has to be a property of the **caller**, not of the **row**. `state ===
'started'` is a fact about the row; it answers "is this operation still meaningful?"
and says nothing about "is this person allowed?". Once an identifier is returned in
response to a public input, it is a bearer credential for every operation that accepts
it, no matter how it was intended.

Removing the identifier from the response makes the attack unrepresentable rather than
merely refused, which is the stronger property: a future action that accepts an
attempt id cannot reintroduce the hole, because no client ever has one.

## Prevention

- **When you return an internal id, ask what it now authorizes.** Grep every consumer
  of that id and check each one for a caller-identity check. If any mutates, either
  stop returning the id or bind the mutation to something the requester proved.
- **A lookup keyed on a public identifier must not return private state.** Email,
  phone, and order numbers are inputs anyone can supply. Whatever comes back is
  disclosed to anyone.
- **Distinguish row-state guards from authorization guards in review.** `if (row.state
  !== 'started')` is a precondition. Ask separately: *what proves this caller owns this
  row?* If the answer is "they had its id", that is not an answer.
- **Treat a comment asserting an invariant as a request for a test.** Ours named the
  exact false premise. The test to write is the composition: "another caller obtains
  this id through any other path and cannot use it here."
- **Feature composition is its own review surface.** Both halves shipped in one unit
  with full unit tests and a green suite. Write at least one adversarial test per
  mutating action: *the caller who should not be able to do this, cannot.*
- **Check whether a fix also closes a rate-limit or counter reset.** Here, removing the
  recycle primitive closed a guess-cap bypass nobody had connected to it — worth
  looking for, because destructive primitives are frequently also reset primitives.
- Related: [a gate that reads a row is only as wired as the route that writes it](../logic-errors/a-gate-that-reads-a-row-is-only-as-wired-as-the-route-that-writes-it-an-unrouted-recordx-fails-the-gate-closed-forever-2026-08-01.md)
  (gate correctness is a property of callers, not of the module) and
  [sibling gates over the same untrusted field must share one trust rule](./sibling-gates-over-the-same-untrusted-field-must-share-one-trust-rule-photo-consent-skipped-the-published-version-guard-2026-08-05.md)
  (the same review found both; new code beside old code inheriting neither its guards
  nor its assumptions).
