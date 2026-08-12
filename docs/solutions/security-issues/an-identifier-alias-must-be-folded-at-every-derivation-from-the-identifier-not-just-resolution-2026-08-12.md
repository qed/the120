---
module: fp-login
tags: [alias, rate-limiting, enumeration, fpv04]
problem_type: security-hardening
---

# An identifier alias must be folded at EVERY derivation from the identifier, not just resolution

**Context (fpv04 U3, 2026-08-12).** D7 gave child logins a domain-swap alias:
a typed `stem@the120.school` resolves to the minted `stem@firstprofit.school`.
The first implementation folded the alias exactly where the feature lives —
the RESOLUTION step (`fpUsernameAliasTarget` + `childLoginUsernameMatches`) —
and nowhere else. Adversarial review then walked every OTHER place a key is
derived from the typed identifier and found the rate-limit keys at the
login-code doors still keyed on the raw spelling: alternating the two
spellings from one IP doubled the per-(ip,username) guess budget at the
redeem door, whose rate limiter is its ONLY brute-force control (no durable
counter, by an earlier deliberate decision). The same review also found the
resolver's widened `.in()` lookup could non-deterministically prefer the
wrong child when a literal `@the120.school`-shaped username collides with
another child's alias target — the code could be MAILED TO THE WRONG FAMILY.

**The rule.** When two identifier spellings become equivalent, that
equivalence must be applied at every derivation from the identifier, and
collisions between the alias space and the literal space must get a
deterministic precedence:

1. **Rate-limit / abuse keys:** collapse to ONE canonical spelling before
   keying, or the alias is a budget multiplier.
2. **Caches, dedupe sets, audit trails:** same collapse, or one account shows
   up as two.
3. **Lookup widening:** any query widened to `IN (typed, aliased)` needs an
   explicit winner when both match different rows — exact-literal match beats
   alias match, asserted by a test that SEEDS the collision, never left to DB
   row order.

**How to find the misses:** grep every use of the normalized identifier
downstream of the door (key derivation, cache keys, log fields) the moment an
alias is introduced. The alias feature's own tests all pass while every one
of these is wrong — the failures only exist ACROSS spellings, which no
single-spelling test exercises.
