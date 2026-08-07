---
module: fp-v3-onboarding
tags: [single-source-of-truth, refactor, routing, drift, review-scope]
problem_type: best_practice
component: service_object
severity: medium
applies_when:
  - "Centralising a decision, constant, or artifact that several call sites compute"
  - "A review finds one consumer that did not adopt the new source"
  - "A later change will delete the thing the stragglers still point at"
---

# A single source of truth is not done until every producer is enumerated and pinned

## Context

Three times on one branch, a value that several call sites derived independently was
centralised — and each time a straggler survived the refactor and had to be found by
review rather than by the work itself:

1. **Two "final" constants.** A write side and a read side each declared the same
   status literal, each pinned by its own test to its own literal. Renaming one would
   have silently disabled a feature with both suites green.
2. **Two renders of "the same" cover.** Signup rendered it from name+age+answers;
   sign-in re-rendered it from the name alone, because that was all it had. Families
   saw two different pictures.
3. **Two routers.** A v2 to v3 remap table was introduced as "the ONLY source" for six
   named producers. Five adopted it. The dashboard card kept building its own
   `/start/child/${id}`, so the same family was diverted into the new flow by one entry
   point and into the retired flow by another.

Each was individually small. Together they are one pattern: **centralisation is a claim
about the whole codebase, and nothing in the change itself makes that claim true.**

## Guidance

**Enumerate the producers before you centralise, and make the list executable.**

- Write down every call site that computes the thing today, from a search rather than
  from memory, and put the list in the new module's header. If the plan already names
  them (ours did: "resolveReentry, screenRoute, childNextScreen, /resume redemption,
  /start self-redirect, and dashboard cards"), treat that as a checklist to verify, not
  as a description of what happened.
- **Assert agreement, not adoption.** "This consumer calls the new function" is a
  source-text pin and it rots. The durable test is: *for the same input, producer A and
  producer B answer the same thing.*
- **Treat a straggler finding as a question about the whole set.** When review says
  "this consumer bypasses the new source", re-run the enumeration rather than fixing
  the one named. Here the reviewers caught the card; re-checking found
  `dashboardGateVerdict` building the same literal — and it was the *louder* producer,
  because it server-redirects the whole page, so a family would never even have reached
  the card that was "fixed".
- **Dead code is the tell.** The new `childNextRoute` had zero call sites outside its
  own test. A centralising function nobody calls means the centralisation did not
  happen, and that is visible without any reviewer.
- **Watch for the deletion that turns drift into breakage.** A straggler pointing at a
  live route is a correctness smell; the same straggler after that route is archived is
  a 404 for real users. If a later unit removes the old target, the enumeration is a
  prerequisite of that unit, not optional cleanup.

## Why This Matters

A single source of truth buys exactly one thing: the guarantee that two answers cannot
disagree. A straggler does not merely miss an improvement, it *removes the guarantee
while leaving the appearance of it* — worse than not centralising at all, because
everyone downstream now reasons as if divergence is impossible.

The failure is also structurally invisible. Every straggler above was correct in
isolation, had passing tests, and read fine in review. Only a test that compares two
producers can see the disagreement, because the disagreement does not exist inside
either one.

## When to Apply

- Any refactor whose commit message says "single source of truth", "the one place",
  "canonical", or "no longer duplicated".
- Introducing a lookup table, shared constant, derivation function, or stored artifact
  that replaces recomputation.
- Reviewing a diff that adds a centralising module: grep the old literal across the
  repo and confirm the count went to zero, or that each survivor is deliberate and
  commented.

## Examples

The shape to prefer:

```ts
// not this - a pin that the consumer calls the thing
expect(src).toContain("childNextRoute(");

// this - the consumers cannot disagree, whatever they call
const child = seedChild({ applicantState: "added", fpUsername: null });
expect(cardCtaHref(child)).toBe(screenRoute(resolveReentry(factsFor(child))));
```

And in the module header, the enumeration itself:

```
Producers that MUST read this table (verified 2026-08-05):
  resolveReentry, screenRoute, childNextScreen, /resume redemption,
  /start self-redirect, dashboard cards, dashboardGateVerdict
Deliberately NOT routed: secondaryReviewLink (opens the read-only v2 walkthrough,
which is real content until Unit 9 archives it - Unit 9 owns retargeting it).
```

Related: [two call sites deriving the same artifact will diverge](../logic-errors/two-call-sites-deriving-the-same-artifact-will-diverge-render-once-and-store-it-2026-08-05.md)
and [a status value that names queued work is a promise](../logic-errors/a-status-value-that-names-queued-work-is-a-promise-do-not-write-it-until-something-queues-2026-08-05.md).
