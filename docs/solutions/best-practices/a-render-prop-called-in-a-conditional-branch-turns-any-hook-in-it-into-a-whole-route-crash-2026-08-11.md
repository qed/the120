---
module: fp-v3-parent-dashboard (app/dashboard/kids/[id]/KidRouteShell.tsx)
tags: [react, render-props, rules-of-hooks, fiber, refactor-scope, source-scanning, pins, no-jsdom, deferred-fix]
problem_type: best_practice
component: page
severity: medium
applies_when:
  - "Extracting a shared shell from two routes and handing the page body back through a render prop"
  - "A `body` / `children` function is CALLED (`body(x)`) rather than MOUNTED (`<Body x={x} />`)"
  - "That call sits inside a conditional branch — a ternary, an `&&`, an early-return arm"
  - "The structurally correct fix is larger than the refactor that exposed the hazard"
  - "You are about to guard a source-level rule with a grep because the repo cannot render components in tests"
---

# A render prop called inside a conditional branch turns any hook in it into a whole-route crash

## What happened

`/dashboard/kids/<id>` (the kid's apps launcher) and `/dashboard/kids/<id>/account`
(the parent's controls) carried verbatim copies of the same six things: the store
read, the client auth gate, the ownership lookup over the RLS-scoped `children`,
the chrome and back link, and the loading / not-found / body three-way. Two copies
of an ownership check is two things to review and two things that can drift.

The duplication had been tolerated **on purpose** for one cycle: that shell IS the
ownership path, a security review had just cleared both copies, and refactoring
immediately would have thrown the clearance away. Deferring it was right, and so
was collecting it one unit later.

The extraction itself came out clean — `KidRouteShell` with a `surface` union and a
`body` render prop, zero security findings, and both pre-existing behavioural suites
passing **unchanged**, which is the strongest available evidence that a refactor
changed no behaviour. The interesting part is not the extraction. It is the hazard
the extraction created, which no test could see and which is not a bug today.

## The hazard

```tsx
{!ready ? <Loading/> : !child ? <NotFound/> : body(child)}
```

`body` is invoked as a plain function, inside a conditional branch of the SHELL's
render. So any hook a body called would execute **on the shell's fiber**, at a hook
position only reached on the child-found branch.

Then: kid found, N hooks run. The store's `children` changes so `child` becomes null
— an RLS refetch, another tab archiving the kid, a load race. The ternary skips the
body. The shell's fiber sees fewer hooks than last render. React throws, and the
**whole per-kid route** goes down for a real parent — not the body, the route.

The transferable shape is not "render props and hooks interact badly". It is:

> **A conditional CALL SITE changes the blast radius of a hook from local to
> whole-route.** The same `useState`, written inside a real child component, is a
> local concern; written inside a function called from a branch of the parent, it
> is a fiber-level liability for everything the parent renders. Nothing at the
> hook's own source location tells you which one you have.

Neither body calls a hook today. The risk is entirely in what the next edit does,
and the next edit will be made by someone who sees `const kidBody = (c: Child) => {`
and reasonably reads it as a component.

## Why the correct fix was rejected on purpose

Mounting the body as JSX — `<KidBody child={child} />` — gives it its own fiber and
the hazard disappears completely. It is the right end state. It was not the right
change *here*:

- It requires hoisting both bodies to module scope and threading every prop they
  currently close over. That is a larger behavioural change than the refactor it
  would protect, inside a unit whose entire value was "no behaviour change, and the
  two existing suites prove it."
- Defining the component **inside** the render instead would be worse than the
  render prop: a new function identity every render means React sees a different
  type and remounts the whole subtree, losing its state, on every parent render.

So the resting place was a **source pin plus a documented escape hatch**: the rule
("a body must not call hooks"), the mechanism (why), and the way out (make it a
MODULE-SCOPE component and mount it as JSX) all written where a body author reads
them — in the `body` prop's own docblock, not only in the file header.

> **When the structurally correct fix exceeds the mandate of the change that
> exposed the hazard, an enforceable pin plus a written escape hatch is a
> legitimate resting place — but only if it is enforceable and only if the escape
> hatch is spelled out.** A rule in a comment with no pin is a wish. A pin with no
> escape hatch turns into a blocker the day someone genuinely needs state, and
> gets deleted rather than obeyed.

## The pin is the real artifact, and it had to be region-scoped

A whole-file `use[A-Z]` grep over `KidPortal.tsx` and `KidAccount.tsx` would fire on
the legitimate hooks those components call **outside** the body, so it would be
either permanently red or weakened into uselessness — and a pin that cries wolf is
suppressed within a week. Four properties made it worth having:

1. **It slices out only the body closure.** From the declaration line to the first
   following line at the same indentation ending `};`.
2. **It throws if it cannot find the region** rather than scanning an empty string.
   A pin that cannot fail is worse than no pin.
3. **It guards that the captured region really IS the body** — the portal slice must
   contain `<FirstProfitCard child={c} />` and must NOT contain
   `export default function KidPortal`. Without this, a mis-anchored slice passes
   every hook assertion vacuously.
4. **Its failure message explains the fiber mechanism**, not "pattern found". The
   person who trips it is mid-edit and needs the escape hatch, not a regex.

```ts
const HOOK_PATTERNS = [/\buseState\s*\(/, /* …the named ones… */, /\buse[A-Z]\w*\s*\(/];
```

The named hooks are convenience; `use[A-Z]\w*\(` is the property. It was proven red
with a known hook AND with an invented `useTracker`, and proven NOT to fire for a
hook placed outside the body — per this repo's standing rule that a source scan's
only evidence of working is a mutation the author would not have written
(`test-failures/a-source-scanning-test-is-defeated-by-a-spelling-you-did-not-guess-2026-07-27.md`).

## The pin was the only option, and saying so is the point

vitest here is `environment: "node"` with `renderToStaticMarkup` and no jsdom, so a
live found → not-found **re-render** — the exact transition that triggers the crash
— is not expressible as a test. The pin is not a lazy stand-in for a runtime test
that was available and skipped; it is the strongest tool the harness offers, which
is also the case where this repo's "a scan earns its place only when the property is
an absence" rule lands squarely: *no hook is called in this region* is an absence.

Choosing a weaker guard **deliberately, and recording why**, is a different act from
not noticing the gap. Write the reason down next to the guard, or the next reader
grades your pin against a runtime test they assume you could have written.

## Two smaller things the same extraction settled

- **One component type now serves every kid in the session.** Next.js does not
  remount a client tree when a dynamic segment's value changes, so `/kids/A` →
  `/kids/B` reuses the same fiber with a new `childId`. The shell is stateless, and
  that is what makes the swap safe. Any `useState`/`useRef` added to it must be
  keyed on `childId` or derived — otherwise kid A's value is still on screen on kid
  B's page, which is a privacy failure, not a stale-render bug.
- **When a control moves into a shared component, its pins move too.** The auth
  gate and ownership lookup were pinned twice, once per route. Leaving those pins in
  place would quietly re-license a second copy of the control; they were replaced
  with one pin on the shell plus per-route assertions that each route does *not*
  contain `children.find(` or `useDashboard(`. The extraction's value is that there
  is one implementation to review, and the pins have to say so.

## Related

- `docs/solutions/test-failures/a-source-scanning-test-is-defeated-by-a-spelling-you-did-not-guess-2026-07-27.md`
  — the discipline this pin inherits: anchor on the general form, mutation-test it,
  and prefer a behavioural seam whenever the property is not an absence. Cite it
  rather than re-deriving it.
- `docs/solutions/test-failures/migration-scanning-parity-test-must-scope-to-its-table-unrelated-column-hijacks-the-allowlist-2026-07-23.md`
  — the same scoping failure in SQL: a scan that matches beyond its subject. Here
  the subject is a source REGION rather than a table, and the guard-the-slice test
  is the analogue of that doc's synthetic fixture.
- `docs/solutions/test-failures/a-mutation-that-reddens-nothing-means-the-test-is-vacuous-not-that-the-code-is-safe-2026-07-29.md`
  — why the region guard exists at all.
- `docs/solutions/best-practices/splitting-one-page-into-two-routes-breaks-every-inbound-promise-and-existence-pins-do-not-catch-it-2026-08-09.md`
  — the immediately preceding restructure in this lane, which created the two
  duplicate shells this unit collapsed.
