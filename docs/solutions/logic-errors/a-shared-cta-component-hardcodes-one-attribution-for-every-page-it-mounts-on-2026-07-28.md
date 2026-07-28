---
title: "A shared CTA component hardcoded one attribution source for every page it mounts on — the vocabulary had markers no surface could ever emit"
date: 2026-07-28
category: logic-errors
module: app/components/CtaBand.tsx
problem_type: logic_error
component: frontend
severity: medium
symptoms:
  - "Conversions from /faq, /parents, /tuition and /scholars all record entry_source = 'home'"
  - "The 'faq' and 'parents' markers exist in the closed vocabulary but are emitted by nothing — dead values that look live"
  - "Every test passes: the source IS a member of the vocabulary, just not the right member"
root_cause: logic_error
resolution_type: code_fix
last_updated: 2026-07-28
related_components:
  - frontend
tags:
  - attribution
  - shared-components
  - closed-vocabulary
  - entry-source
  - type-safety
---

# A shared CTA component hardcoded one attribution source for every page

## Problem

Funnel U4 built a closed, compile-checked vocabulary of twelve entry markers
(`home`, `faq`, `parents`, `tuition`, `lp-athletes`, …) so that a surface
cannot invent an attribution bucket. U6 then rerouted every marketing CTA
through a shared `<StartCta source={...}>`.

`CtaBand` — the big red band at the bottom of a page — took no `source` prop.
It hardcoded one:

```tsx
<StartCta source={"home"} variant="white" … />
```

`CtaBand` is mounted on `/`, `/faq`, `/parents`, `/tuition`, `/scholars`, and
two Gauntlet pages. On `/faq` and `/parents` it is the **only** funnel CTA on
the page. So every conversion from those pages recorded `entry_source = "home"`
— and because `entry_source` is stamped once and immutably at C1 (R58), the
misattribution is permanent per family.

Two consequences, both quiet:

1. **`home` is inflated** with traffic that never touched the home page — the
   single number the whole funnel exists to produce.
2. **`faq` and `parents` are unreachable.** They sit in the vocabulary looking
   like live buckets. A report showing zero conversions from `/faq` would be
   read as "the FAQ doesn't convert" rather than "nothing can emit that value."

## What Didn't Work

- **The closed vocabulary.** It guarantees a source is *a* legal marker, not
  the *correct* one. `"home"` is perfectly valid on `/faq`.
- **The reroute enforcement test.** It asserted every `<StartCta>` passes a
  source from `CTA_SOURCES` — which this did. Membership is not correctness.
- **Type checking.** `source: CtaSource` was satisfied.
- **Reading the diff.** The hardcoded literal sits inside a component whose
  own file gives no hint of how many pages mount it. Two independent reviewers
  found it only by grepping for `<CtaBand` and cross-referencing the mount
  list — which is exactly the work the type system should have done.

## Solution

Make the shared component's caller supply the value, and make it **required**:

```tsx
export default function CtaBand({
  source,
  …
}: {
  /** REQUIRED, and required for a reason: this band is mounted on /faq,
   *  /parents, /tuition, /scholars, the Gauntlet pages and the home page. */
  source: CtaSource;
  …
})
```

A required prop turns seven silent misattributions into seven compile errors,
each resolved at the mount site by someone who can see which page it is.

## Why This Works

Attribution is a fact about **where the click happened**, and a shared
component by definition does not know that. Any default it picks is a guess
that will be wrong for every caller but one — and wrong *plausibly*, which is
worse than wrong loudly, because a plausible value passes every membership
check you write.

The general rule: **a shared component must not hold a value that varies by
mount site.** If it needs one, take it as a required prop. An optional prop
with a default is the same bug with a nicer face — the default becomes the
answer for every caller that forgets, and forgetting is invisible.

## Prevention

1. When a shared/reused component needs context about *where it is*, take it
   as a **required** prop. No default.
2. Before hardcoding a value from a closed vocabulary, grep for the
   component's own mount sites. More than one means the value is a parameter.
3. If a vocabulary has members, assert that **every** member is emitted by
   something — an unreachable marker is a dead branch dressed as a live one:

```ts
it("every marker is emitted by at least one surface", () => {
  const emitted = new Set(
    sources().flatMap((f) => [...read(f).matchAll(/source=\{?"([^"]+)"/g)].map((m) => m[1]))
  );
  const unreachable = CTA_SOURCES.filter((s) => !emitted.has(s));
  expect(unreachable).toEqual([]);   // or list the deliberate exceptions
});
```

4. Membership tests and correctness tests are different tests. "Is this value
   legal?" does not answer "is this value right here?"

## Related Issues

- `docs/solutions/test-failures/a-source-scanning-test-is-defeated-by-a-spelling-you-did-not-guess-2026-07-27.md`
  — the same shape one level up: a scan that checks the property it can see
  rather than the property it means.
- `docs/solutions/security-issues/constant-response-is-not-constant-timing-and-a-guard-moves-when-you-extract-2026-07-27.md`
  — a guard that stopped guarding when the code moved; here, a value that
  stopped being right when the component was reused.
