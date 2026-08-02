---
title: "An accepted login enumeration/timing side-channel must be RE-AUDITED when the identifier changes from a weak signal (a name) to a unique credential (a username) — the same code becomes a brute-force targeting oracle, and constant-work closes it"
date: 2026-08-01
category: security-issues
module: fp-login
problem_type: security_issue
component: authentication
symptoms:
  - "A login refuses with byte-identical body/status for unknown-user and wrong-password, but an unknown user returns faster because it skips the password check"
  - "A previously-accepted 'name exists' timing oracle now confirms a unique login handle after the login switched from name-matching to username-matching"
  - "Response timing distinguishes 'this login identifier exists' from 'it does not', enabling targeted brute force"
root_cause: design_gap
resolution_type: code_fix
severity: medium
tags:
  - authentication
  - user-enumeration
  - timing-side-channel
  - constant-time
  - login
  - brute-force
related_components:
  - security
  - fp-login
---

# Re-audit an accepted enumeration side-channel when the identifier becomes a credential

## Problem

First Profit's child login originally resolved a child by **first name**, then
called `signInWithPassword`. An unknown name produced zero matching candidates → zero
auth round-trips; a known name + wrong password produced one auth round-trip. The
response body/status were byte-identical, but the **timing** differed. This was a
known, *accepted* tradeoff — the docstring even disclosed it — because "a student
named Alex exists" is a weak, low-value signal.

U13 changed the identifier from name to a **globally-unique `fp_username`** (the
actual login credential). The same timing code was now a different beast: it confirms
whether a specific, unique login handle **exists** — a directly actionable brute-force
targeting oracle. The severity of the identical code jumped, purely because the
identifier's *meaning* changed, and nothing in the diff drew attention to it (the
oracle was pre-existing, so a line-by-line review of the change wouldn't flag it).

## Symptoms

- Unknown identifier and wrong-password refusals are indistinguishable on the wire but
  distinguishable by latency (one skips the password verification).
- A side-channel that was fine for a coarse signal now leaks a precise credential's
  existence after a schema/identifier change.

## Solution

Equalize the work on the no-match path — a **constant-work dummy verification**:

```ts
// route.ts — when a valid-shape username matches NO child, still pay one auth round-trip
if (candidates.length === 0) {
  const dummy = await authClient.auth.signInWithPassword({
    email: deriveStudentEmail(randomUUID()),   // s-<fresh-uuid>@…invalid — never resolvable
    password: parsed.password,
  });
  // classify an outage the same as the real loop; discard success (it can't succeed)
}
```

Because the username is globally unique, a real match costs exactly one auth call, so a
single dummy exactly equalizes "no match" with "wrong password." The dummy targets a
random `.invalid` address (RFC 2606, never provisioned) so it can never succeed, mints
no session, and touches no DB. Known and unknown valid-shape usernames now pay the same
one round-trip; the refusal body/status stay byte-identical.

Scope it honestly: the *pre-DB* refusals (malformed, email-shaped, rate-limited) are
intentionally NOT equalized — they reflect only the attacker's own input, not account
existence. The docstring should claim non-enumeration for the valid-shape path in both
body AND timing, and keep the pre-DB classes explicitly out of that claim.

## Why This Works

Enumeration resistance is about making "exists" and "doesn't exist" indistinguishable
across *every observable* — body, status, headers, AND timing/side-effects. Skipping
the expensive verification on the no-match branch reintroduces the distinction through
latency. Doing one equivalent unit of throwaway work on that branch removes the timing
tell without weakening anything else (rate limits still bound brute force).

## Prevention

- **When you change what a login identifier IS — name → email → unique username, or
  make it unique/case-folded — re-run the enumeration/timing threat model.** An
  *accepted* side-channel is accepted for a specific identifier's sensitivity; that
  acceptance does not carry over when the identifier becomes a credential. The
  dangerous case is invisible in the diff because the oracle code didn't change — only
  its meaning did.
- **"Byte-identical refusal body" is not "non-enumerating."** Enumerate every refusal
  path's *work profile* (pre-DB refuse / DB-miss / auth-miss) and confirm the branches
  that reveal account existence pay equal work. Reserve the "non-enumerating" claim for
  the paths you actually equalized.
- **Constant-work beats trying to be constant-time by hand:** issue one real (doomed)
  verification against a non-resolvable address rather than sleeping a guessed delay.
- Note contrasting scope: a lower-value sibling oracle (the `/fp` name-based login) can
  stay as a documented, accepted tradeoff — closing it isn't required just because you
  closed the credential-grade one. Match the mitigation to the identifier's value.
