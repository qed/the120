---
module: fp-v3-parent-dashboard
tags: [stats, null-vs-zero, population-scope, ui-honesty, defaults, gating]
problem_type: logic_error
component: page
severity: medium
applies_when:
  - "Rendering a metric that is loaded for only SOME of the rows on screen"
  - "A count defaults through `?? 0` on the way to a progress bar or a stat"
  - "Restoring a stat that was removed while the audience widened"
  - "A loader is gated on a predicate but the renderer is not gated on the same one"
---

# A restored stat must be gated on the signal that makes it true, or it fabricates a zero

## The problem

The founder asked for the kid cards on `/dashboard` to show stats again, so each
card regained the child's verified First Profit task count and a Path bar:

```tsx
<KidCard c={c} verified={verifiedTaskCounts?.[c.id] ?? 0} />
...
<span>{verified} / {PATH_TASK_TOTAL} verified</span>
```

That reads as careful defensive code. It is not. The `?? 0` collapses three
different states into one confident sentence:

| Real state | What the card says |
|---|---|
| On the Path, 0 tasks verified | "0 / 125 verified" ✅ true |
| On the Path, counts read failed | "0 / 125 verified" ⚠️ honest floor, documented |
| **Not on the Path at all** | **"0 / 125 verified"** ❌ **fabricated** |

The third row is the bug. The gate loads counts ONLY for a path-register family:

```ts
if (dashboardRegister(children) === "path") {
  verifiedTaskCounts = ...;   // otherwise it stays null
}
```

but `dashboardGateVerdict` still RENDERS `/dashboard` for families outside that
register — a `hasPassword` legacy parent, or a `deriveEnrolled` family whose
child has `status === "member"` and never climbed the applicant ladder. For
them `verifiedTaskCounts` is permanently `null`, so every card asserted that
their kid had completed 0 of 125 tasks of a curriculum they had never joined.

Nothing failed. Types were satisfied, tests were green, the bar rendered its
documented 2% floor. The UI was simply, confidently wrong.

## Why the old code did not have this bug

The pre-U4 card that these stats came from rendered the bar only inside its
`if (arrived)` branch — post-arrival children only. The bar and the population
it described were introduced together. Reinstating the bar without reinstating
its population gate is what created the falsehood: the stat was copied, its
precondition was not.

## The fix

Gate the RENDERER on the same signal that gates the LOADER — per row, not per
family:

```tsx
// The same signal `isPathRegisterChild` keys on: an fp account exists.
const onThePath = c.fpUsername != null;
...
{onThePath && (
  <>
    <span>{Math.min(verified, PATH_TASK_TOTAL)} / {PATH_TASK_TOTAL} verified</span>
    <span style={{ width: `${pathBarWidthPct(verified, PATH_TASK_TOTAL)}%` }} />
  </>
)}
```

Per-child rather than per-family matters: a mixed family (one FP kid, one legacy
sibling) gets a bar on exactly the card that has one to show.

## The general rules

1. **A loader gated on a predicate needs a renderer gated on the same
   predicate.** When you find `if (predicate) load(...)`, search for the render
   site. If it defaults instead of checking, the default is being shown to
   precisely the population the predicate excluded.
2. **`?? 0` on a metric is a claim, not a fallback.** "No data" and "zero" are
   different sentences to a reader. Zero says *measured, and it is none*. Only
   use the zero floor where the row is genuinely in the measured population —
   there it honestly means "has not started."
3. **Ask who is NOT in the numerator's world.** Any surface that renders one row
   per entity while its data covers only some entities has this bug latent. The
   question to ask of a new stat is not "what if the read fails" (everyone asks
   that) but "who reaches this screen without belonging to this metric at all."
4. **A restored feature must restore its guards.** Reinstating UI from an older
   version copies the visible part; the branch it used to live inside is easy to
   leave behind, and it is usually the part encoding who the feature was for.
5. **Clamp both halves of a stat.** The bar width was clamped to 100 but the
   printed numerator was not, so a drift between counted rows and the manifest
   total would render "190 / 125" beside a full bar. If you clamp the picture,
   clamp the number.

## Related

- `splitting-one-page-into-two-routes-breaks-every-inbound-promise-and-existence-pins-do-not-catch-it-2026-08-09.md`
  — same day, same restructure. That one is about links that outlive the thing
  they point at; this one is about stats that outlive the population they
  describe. Both are "the thing moved, its precondition did not."
