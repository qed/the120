---
module: fp-v3-parent-dashboard
tags: [information-architecture, routing, deep-links, transactional-email, pins, reachability, review-scope]
problem_type: best_practice
component: page
severity: medium
applies_when:
  - "Splitting one page into a list route plus a detail route"
  - "Moving a control from a merged page onto a per-entity page"
  - "A transactional email, redirect, or bookmark points at the page being split"
  - "A pin asserts a control 'exists somewhere under <prefix>'"
---

# Splitting one page into two routes breaks every inbound promise, and existence pins do not catch it

## The problem

The parent-dashboard restructure split `/dashboard` (one merged page: apps launcher
+ per-kid controls) into a kid LIST at `/dashboard` and a per-kid portal at
`/dashboard/kids/<childId>`, moving the controls onto the portal.

Every INTERNAL surface was swept correctly — the deleted components' pins were
retargeted, no dead imports remained, RLS scoping held. What nobody swept was the
INBOUND links, because they live nowhere near the diff:

- The R21 "your kid's page is live" email says *"You can take the page offline any
  time from your family dashboard"* and links to `manageUrl`, which resolved to
  `${SITE_URL}${FP_PARENT_TARGET}` = `/dashboard`.
- After the split, `/dashboard` is a bare grid of kid cards. It carries no
  take-offline control at all. The parent must identify which of N cards is the
  child named in the email, open that portal, and scroll to "Manage <kid>".

That is a transactional SAFETY notice whose entire value is how fast a parent can
reach the control. The restructure turned one click into a hunt, and nothing failed.

## Why the test suite stayed green

There WAS a pin for exactly this promise — the "THE PAIRING" test in
`app/lib/__tests__/fp-ui-retirement.test.ts`, written after an earlier incident
precisely so a promise and its mechanism could never be two independently-true
assertions. It still passed. It asserted:

```ts
expect(FP_PARENT_TARGET).toBe("/dashboard");        // the link's destination
expect(read(".../KidPortal.tsx")).toContain("KidSite");  // the control exists
```

Both remained true, and the conjunction was now meaningless: the link goes to
`/dashboard`, the control exists under `/dashboard/kids/<id>`, and no assertion
connects the destination to the control. **An existence pin is not a reachability
pin.** "The control exists somewhere below this prefix" survives any restructure
that pushes it arbitrarily deep — which is the only failure mode the pin was
written to prevent.

The retargeting during the restructure even made it *look* maintained: the comment
was rewritten to explain that the control had moved to the portal, "still under
/dashboard, still what FP_PARENT_TARGET resolves to — the parent list links to it."
That sentence is true and is the bug: it treats "reachable by navigation" as
equivalent to "what the link promised."

## The fix

Make the link per-entity, and pin the DESTINATION to the control, not the prefix.

```ts
// app/lib/fp/retired-ui-routes.ts — built FROM FP_PARENT_TARGET, not a 2nd literal
export function fpParentKidTarget(childId: string): string {
  return `${FP_PARENT_TARGET}/kids/${childId}`;
}

// deps contract: a per-child URL, not a static one
manageUrl: (childId: string) => string;
manageUrl: (childId) => `${SITE_URL}${fpParentKidTarget(childId)}`,
```

And the pin stops asserting the prefix:

```ts
expect(gateway).toContain("fpParentKidTarget");
expect(fpParentKidTarget("abc123")).toBe("/dashboard/kids/abc123");
// ...paired, as before, with: the portal at that path mounts KidSite
```

## The general rules

1. **An IA split has an inbound blast radius the diff does not show.** Before
   splitting a page, grep for everything that LINKS to it — transactional email
   builders, redirect targets of retired routes, bookmarked URLs, anything reading
   a `*_TARGET` constant. Each one promised the merged page's contents; a list page
   honors none of those promises.
2. **Pin reachability, not existence.** If copy promises a control at a URL, assert
   that URL resolves to the page that mounts the control. `toContain("KidSite")`
   over a file found by any path proves only that the control was not deleted.
3. **A destination constant is a promise, so make it as specific as the promise.**
   A mail about ONE child should not link to a page listing N children. Where the
   caller already has the id (it did — `input.childId` was two lines away), the
   per-entity URL costs one function.
4. **Suspect a pin whose comment you just rewrote to explain why it still passes.**
   That rewrite is the moment to ask whether the assertion still tests the thing
   the comment claims. Here the comment had been rewritten twice across two
   restructures while the assertion never changed.

## Related

- `a-single-source-of-truth-is-not-done-until-every-producer-is-enumerated-and-pinned-2026-08-05.md`
  — same family: the thing that rots is the consumer nobody enumerated. The
  inbound-link sweep is the enumeration step for an IA change.
- `a-url-prefix-is-not-a-feature-boundary-2026-08-05.md` — the converse framing: a
  shared prefix does not make two things one feature, and here it does not make a
  deep page reachable from the prefix's root.
