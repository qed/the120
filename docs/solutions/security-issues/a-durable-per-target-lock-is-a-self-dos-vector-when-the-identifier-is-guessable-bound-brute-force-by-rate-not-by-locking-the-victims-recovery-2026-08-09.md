---
title: A durable per-target lock is a self-DoS vector when the identifier is guessable; bound brute force by rate, not by locking the victim's recovery
date: 2026-08-09
module: fp-login-code
component: /api/fp/login-code redeem (fpv03 U3c)
tags: [auth, brute-force, self-dos, rate-limit, guessable-identifier, one-time-code, enumeration]
problem_type: security_issue
severity: P1 (caught in review before ship)
---

# Problem

The parent-emailed login-code redeem endpoint defended its 6-digit code
(10^6 space) with a durable per-code guess counter: a wrong redeem bumped
`guess_count` on ALL of a child's outstanding codes, and at cap (6) even the
CORRECT code stopped redeeming until the 10-minute TTL expired.

Because the login identifier is a *guessable, public* username
(`firstname.lastname@firstprofit.school`, derivable from a classmate's name),
this handed any anonymous caller a repeatable denial-of-service on a specific
kid's ONLY password-recovery door: six wrong POSTs — no password, no email
access, no secret — locked every outstanding code, and the lock could be
re-applied every 10 minutes indefinitely. The kid typing the real code from
the parent's inbox got the same generic 401, with no signal anything was
wrong. The known-username path also did extra work (the bump), leaking
username existence as a timing oracle on the same endpoint.

# Root cause

A durable lock keyed on an attacker-controllable, guessable identifier is
*intrinsically* a self-DoS primitive. Any state an attacker can drive that
degrades the legitimate user's access — with only public knowledge of the
identifier — is weaponizable. The guess counter conflated two goals:
bounding brute force (legitimate) and locking a target (harmful here).

# Solution

Separate the goals. **The correct code always redeems** — the consume CAS is
`child_id + code_hash + consumed_at IS NULL + expires_at > now`, with no
guess-count predicate (column and bump removed entirely). Brute force is
bounded purely by RATE, which throttles the *attacker's source*, not the
*victim's account*:

- redeem: 5 / 15 min per (ip, username) — deliberately below any threshold
  that matters against 10^6 — plus 40 / 15 min per IP; per-IP strike recorded
  BEFORE the parse/classify early returns so a malformed flood still pays.
- request: per-username + per-IP + per-PARENT-INBOX buckets (the harmed
  resource — a shared family mailbox — is per-parent, not per-child).
- Unchanged: 10-min TTL, one-time-use CAS, hashed-only storage, max-outstanding
  per child, one byte-identical 401.

Removing the bump also closed the timing oracle: unknown-username and
known-wrong-code now issue byte-identical statement sequences.

Trade-off accepted: the rate-limit store is in-memory/per-instance (cold-start
empty) — a weaker durable guarantee than a per-account counter — but that is a
platform-wide limitation with its own remediation path (a durable limiter),
NOT a reason to reintroduce a lock that a guessable identifier turns into a
weapon. Correct-code-always-wins is the non-negotiable invariant.

# Prevention

1. Before adding any durable per-account/per-target lock, ask: can an attacker
   reach this state knowing only a GUESSABLE identifier? If yes, it is a
   self-DoS vector — don't lock the victim; rate-limit the source.
2. A recovery door (forgot-password) must never be lockable by someone who
   only knows the account's public name. The legitimate secret (the emailed
   code) must always work within its TTL.
3. Keep "bound brute force" and "lock a target" as separate mechanisms: rate
   limits throttle the source; one-time-use + short TTL bound a single code's
   exposure. A counter that does both is the smell.
4. Guessable identifiers raise the stakes on every adjacent enumeration/timing
   channel — re-audit them when an identifier becomes public or predictable
   (see [re-audit-an-accepted-enumeration-side-channel-when-the-login-identifier-becomes-a-unique-credential-2026-08-01.md]).
