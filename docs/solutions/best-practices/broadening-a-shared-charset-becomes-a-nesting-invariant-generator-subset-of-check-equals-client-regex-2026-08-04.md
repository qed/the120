---
title: "Broadening a shared charset: the agreement invariant becomes NESTING (generator ⊆ CHECK === client-regex), not equality — relax the acceptor pair, leave the narrower producer"
date: 2026-08-04
category: best-practices
module: fp-username
problem_type: best_practice
component: validation
symptoms:
  - "A value has a generator, a DB CHECK, and a client regex that were all one charset; now some values need a broader charset"
  - "Fear that broadening one of the three will silently break the 'they must all agree' invariant"
tags:
  - charset
  - validation
  - db-check
  - regex
  - invariant
  - fp-username
related_components:
  - fp-username
  - login
---

# Broadening a shared charset is a NESTING invariant, not an equality one

## Context

An earlier learning established that a value's **generator, DB CHECK, and client
regex must agree on ONE charset** — per-component tests never catch the
disagreement (the generator emits X, the CHECK rejects X, and nothing exercises the
seam). fp_username was that value: generator, `children_fp_username_format` CHECK,
and login `USERNAME_FORMAT` were all `^[a-z0-9]+$`.

Then a requirement arrived: usernames may be **email-shaped** (`cedric@firstprofit.
school`) as opaque strings. Broadening naively risks re-triggering the exact
disagreement the earlier learning warns about.

## The refinement

When you BROADEN the accepted set, the invariant is no longer "all three equal" —
it becomes **nested**:

```
generator output  ⊆  DB CHECK  ===  client regex
```

- **The acceptors (DB CHECK + client login regex) are broadened TOGETHER, to the
  identical charset.** They are the pair that must stay byte-for-byte equal — a
  value the client accepts but the CHECK rejects (or vice versa) is the classic
  write-time 23514 / login-time unclassifiable split. Here both became
  `^[a-z0-9]([a-z0-9._+@-]*[a-z0-9])?$`, bounded to the same length (the login
  request schema max and the CHECK `char_length` must match too).
- **The producer (auto-generator) is LEFT NARROWER** — it keeps emitting
  `^[a-z0-9]+$`, now a strict SUBSET. Generated values still pass the broadened
  CHECK and still classify at login, so nothing breaks. Only *externally supplied*
  values (admin/script/future picker) use the broader charset, and the CHECK is
  their backstop.

The safety proof for the migration falls out of the nesting: because the new CHECK
charset is a superset of the old, **every existing row still satisfies it**, so the
constraint swap validates the live table with no backfill and no failure.

## Why this works

The disagreement failure is one-directional: it happens when the PRODUCER emits
something an ACCEPTOR rejects. Broadening the acceptors while holding the producer
narrower moves strictly away from that failure (producer ⊆ acceptor can never
produce a rejected value). The only thing you must still enforce with equality is
**acceptor === acceptor** (client regex === DB CHECK === length bound), because
those two guard the same write/read seam from opposite sides.

## Prevention

- **When broadening a shared charset, change the acceptors as a matched pair and
  leave the generator alone** (unless the generator itself must emit the new
  shapes). Re-state the invariant in the code comments as `generator ⊆ CHECK ===
  regex` so a future reader does not "fix" it back to equality.
- **Broaden to a SUPERSET so the migration is a no-backfill constraint swap.** If
  the new set were not a superset, existing rows could violate the new CHECK and the
  `ADD CONSTRAINT` would fail — verify the superset relation before shipping.
- **Keep the length bound in the equality set.** The client request schema max and
  the CHECK `char_length` are part of "the charset" — a value long enough to store
  but too long to type back is the same class of seam bug.
- **Security check when the broadened value is a login identifier:** confirm the new
  shapes take the SAME refusal path/timing as existing ones (here, email-shaped
  moved from early-refuse to the normal one-round-trip username lookup — more
  uniform, no new enumeration oracle), and that the added characters are inert in
  every render/URL context (`@ . _ + -` are HTML/URL-safe; `< > / % ' "` space are
  not — do not add those to an opaque-but-rendered token).
