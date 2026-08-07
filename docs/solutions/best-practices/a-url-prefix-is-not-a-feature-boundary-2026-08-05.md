---
module: fp-v3-onboarding
tags: [retirement, deletion, namespace, routing, scope, blast-radius]
problem_type: best_practice
component: service_object
applies_when:
  - "A unit is scoped as 'delete everything under <prefix>'"
  - "A requirement names a directory or route namespace as the thing to remove"
  - "Unrelated features share a namespace for historical reasons"
---

# A URL prefix is not a feature boundary

## Context

The requirement was unambiguous: remove all First Profit code, content and
surfaces from the120.school, so the two products live in two repos. The natural
reading of that is "delete `app/fp/**`", and the plan's deletion list said as much.

But `app/fp/fw` was **Founders Weekend** — a staff and guide operations tool for
in-person cohort check-in, run on iPads, with a projected live board. It is not
First Profit. It has no counterpart in the first-profit repo to redirect to. It
sits under `/fp` because that is where it happened to be built.

A delete-by-prefix sweep would have removed a working staff tool that nothing in
the requirement was talking about, and it would have done so *while passing every
check*: the build stays green, no live import dangles, the grep-to-zero test goes
to zero. The deletion is only wrong at the product level, which no test can see.

Two of its routes made it worse than a recoverable mistake. `/fp/fw/invite/[token]`
sets a guide's password and `/fp/fw/board/[token]` (plus its polled `feed` route)
are **token handshakes**, and their URLs are built by producers the same unit was
told to keep. Retiring them behind redirect stubs would have destroyed the
handshake, not preserved it.

## Guidance

**Scope a deletion by what a thing IS, not by where it lives.**

- **Enumerate what is actually under the namespace before accepting it as the
  scope.** List the subtrees and ask of each: is this the feature being retired,
  or a lodger? Directory and route prefixes accumulate lodgers, especially when a
  product grew out of an earlier one.
- **A lodger is identified by its audience and its replacement**, not its path.
  First Profit's learner UI had both a different audience (kids) and a
  destination to send people to (firstprofit.school). Founders Weekend had
  neither: staff audience, no replacement. That asymmetry is the tell.
- **Check whether the namespace's occupants have separate producers.** If mail,
  scripts, or config outside the deletion set build URLs into a subtree, that
  subtree is load-bearing for something the unit is not retiring.
- **Prefer leaving a lodger in place over deleting it "for consistency".** An
  ugly shared prefix is cosmetic; a deleted staff tool with no replacement is an
  outage for the people who run the business.
- **Then say so, loudly, to the owner.** A scope carve-out is a decision the
  owner must ratify, because from the outside it reads as an incomplete unit. Name
  what you did not delete, why, and what a follow-up would look like (retire it
  whole, or move it off the shared prefix).

## Why This Matters

"Delete everything under X" is attractive precisely because it is mechanical, and
mechanical scopes are exactly the ones that do not notice they are wrong. Every
automated signal a deletion unit has — compiles, tests pass, no dangling imports,
identifiers grep to zero — measures *internal consistency after the deletion*.
None of them measures whether the deleted thing should have been deleted. A tool
with no remaining callers looks identical to a tool whose users are people, not
code.

The cost is asymmetric, too. Leaving a lodger in a shared namespace costs some
tidiness and a follow-up ticket. Deleting it costs a capability with no
replacement, and the people who notice are staff mid-event, not a test suite.

## When to Apply

- A plan or requirement expressed as a path (`app/fp/**`, `/admin/*`,
  `lib/legacy/`) rather than as a capability.
- Any namespace that predates a product split, rename, or spin-out.
- Before deleting a subtree that contains token routes, webhooks, cron targets,
  or anything else a machine addresses — see the related learning below.

## Examples

The check, before accepting a prefix as scope:

```
for each subtree under <prefix>:
    who uses it?            (learners / parents / STAFF / a machine)
    what replaces it?       (a URL in the other app / nothing)
    who builds its URLs?    (only deleted code / a producer we are KEEPING)

  audience = staff  AND  replacement = none   -> lodger, do not delete
  URLs built by a producer being kept          -> pairing contradiction, stop
```

Related: [a retired route that a machine calls back is not a bookmark](../logic-errors/a-retired-route-that-a-machine-calls-back-is-not-a-bookmark-a-redirect-stub-deletes-the-handshake-2026-08-05.md)
(why the token routes could not have been stubbed even if the tool were in scope)
and [before deleting a capability, ask production whether anyone is using it](./before-deleting-a-capability-ask-production-whether-anyone-is-using-it-2026-08-05.md)
(the other half of scoping a deletion by evidence rather than by shape).
