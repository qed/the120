---
module: nurture-engine
tags: [idempotency-keys, scoping, siblings, staff-ui]
problem_type: logic-error
---

# Changing a gate without changing its key leaves the old scope in force

## The requirement

The offer nudge was silenced family-wide: any child's paid deposit
stopped the seat reminder for *every* child. A family that deposited for
one child and was later offered a seat for a sibling got nothing. Peter
chose correctness — make it per child.

## The half-fix that looks complete

The obvious change is the gate: read `deposits.child_id` and check the
offered child's *own* deposit. Ship that alone and the bug survives,
because the one-time send key is still `${family.id}|offer|o3`.

Real ordering that still fails:

1. Child A is offered → nudged. The family-wide key `o3` is now claimed.
2. The family pays for A.
3. Child B is offered later.

B's gate now passes — B has no deposit. But the key `o3` is already taken
for that family, so nothing sends. The gate is per child; the *claim* is
per family, and the claim is what actually decides.

**Both halves or neither.** When you narrow a rule's scope, narrow every
mechanism that enforces it — the predicate *and* the idempotency key. A
key scoped wider than the operation it names silently swallows distinct
work, and it does it invisibly: no error, no log, just an email that never
arrives.

The engine's selection needed the same treatment: a family-level early
return had to go, and the candidate list had to filter per child.

## The legacy rows, and why measuring beat guessing

Changing the key orphans every row written under the old one.
`nurture_sends` has no child column, and the offer stamp it would have to
be reconstructed from is rewritten by the resend CAS — so there is no
sound way to attribute a legacy row to a child.

Rather than guess, **count them**: production held *zero*
`offer|o3` rows — the sequence had never sent. The legacy branch silences
nobody, and shipping it cost nothing. Five minutes of querying replaced an
unfalsifiable argument about migration strategy.

Keep the branch anyway, for a row written between the measurement and the
deploy. Never double-nudging beats guessing.

## The consumer nobody thought about

The step string is not private. `nurtureLabel` in the CRM renders
`Automated · ${sequence} ${step}` as a fallback for unknown steps — so
changing the key's *shape* to `o3:<uuid>` put a raw child identifier into
a staff-facing family timeline.

**When you change the shape of a value, grep for its readers.** An
identifier that was internal yesterday is on someone's screen today. The
label now strips the id, and a test asserts no unknown step can leak one.
