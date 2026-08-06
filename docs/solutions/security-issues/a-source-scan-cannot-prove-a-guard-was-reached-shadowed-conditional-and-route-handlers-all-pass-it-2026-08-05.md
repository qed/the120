---
module: fp-image-lab
date: "2026-08-05"
problem_type: security_issue
component: testing_framework
severity: high
symptoms:
  - "A page with its auth gate replaced by a local no-op passes the entire gate-enforcement suite"
  - "An ungated route handler under a guarded subtree is invisible to the test that claims to cover 'every routable module'"
  - "A gate wrapped in `if (process.env.NODE_ENV !== 'production')` satisfies a first-await ordering assertion"
root_cause: design_gap
resolution_type: test_fix
tags:
  - auth-gate
  - guard-test
  - source-scanning
  - shadowed-binding
  - route-handlers
  - server-actions
  - nextjs
---

# A source scan cannot prove a guard was reached: shadowed bindings, conditionals, and route handlers all pass it

## Problem

A staff-only Next 16 subtree gated every page and layout with `requireStaff()`,
and shipped a test to enforce it. The test discovered modules by glob and
asserted over comment-stripped source that each file:

1. contains `await requireStaff()`,
2. imports `requireStaff` from the one authoritative module, and
3. has that call as the first `await` in the default export.

Ten assertions, all green. **Two reviewers independently defeated it**, and a
third found a fourth hole.

## Symptoms

Each of these leaves the surface completely ungated with the suite green:

**Shadowed binding.** The cheapest one, and the import block is untouched, so a
diff review sees nothing either:

```ts
import { requireStaff } from "@/app/crm/lib/auth";   // ← still there
export default async function Page() {
  const requireStaff = async () => {};                // ← shadow
  await requireStaff();                               // ← assertion 1 ✓
```

Assertion 1 matches the call text. Assertion 2 matches the import statement.
Assertion 3 sees the call at offset 0. Nothing ties the *called binding* to the
*imported* one. (An aliased variant — `import { requireStaff as real }` plus a
local `function requireStaff()` — passes for the same reason.)

**A file convention the glob does not cover.** The glob was
`**/{page,layout}.tsx`. An ungated `api/generate/route.ts` is invisible. This is
the worst case, not an edge case:

> **Route handlers and server actions do not render through layouts at all.**

So the layout's gate — the thing everyone points at when a page's own gate is
questioned — *provably* cannot cover them. They are simultaneously the surface
where a gate matters most (ours spends money on a third-party model API) and the
one the test silently omitted. `template.tsx` and `default.tsx` are missed the
same way.

**A conditional gate.** `if (process.env.NODE_ENV !== "production") await requireStaff();`
puts the call at the same offset as the first `await`, so the ordering assertion
passes — while the gate is off in the only environment that matters.

**A dead gate.** The ordering check compared string offsets over a slice running
to end of file, so an `await requireStaff()` sitting in a never-invoked helper
*below* the export satisfied it.

## Why This Happens

Every one of these is the same mistake in a different costume:

> **The test asserted the guard's TEXT. The property it needed was that the
> guard RUNS.**

Source text cannot answer "was this reached", because reachability depends on
binding resolution, control flow, and call graph — none of which a regex sees.
The scan feels like coverage because it goes red for the *naive* regression
(deleting the call), which is the one case where text and behaviour coincide.

This repo already had the parent lesson —
`security-issues/guard-function-with-no-callers-is-not-a-mechanism-…-2026-07-23.md`
— "a guard nothing calls is not a mechanism." This is its sequel: **a test that
greps for the guard is not a mechanism either.**

## Solution

Make the test behavioural, and keep a scan only for what a spy structurally
cannot see.

```ts
// 1. BEHAVIOURAL: mock the gate, import each routable module, INVOKE its entry
//    point, assert the spy was called. A shadow, a conditional, and dead code
//    all fail this, because none of them actually calls the imported gate.
vi.mock("@/app/crm/lib/auth", () => ({ requireStaff: gateSpy }));
const mod = await import(modulePath);
await invokeEntryPoints(mod);      // default export for pages/layouts;
                                   // GET/POST/… for route handlers
expect(gateSpy).toHaveBeenCalled();
```

Three details that matter:

- **Cover every routable convention**, not just pages:
  `**/{page,layout,template,default,route}.{ts,tsx}` plus a separate scan for
  files containing `"use server"`, invoking each exported action. Route handlers
  have no default export, so any assertion keyed on
  `export default async function` passes *vacuously* over them — a module
  exposing no invokable entry must **fail**, not skip.
- **Keep a source fence for what the spy cannot see.** Under vitest,
  `NODE_ENV !== "production"` is true, so the conditional-gate mutation *passes*
  the behavioural test. The scan is what catches it — assert the gate is an
  unconditional top-level statement, and that the identifier is never re-bound
  or aliased.
- **Do not pin an expected-module list beside the glob.** It defeats the glob's
  purpose: a legitimately-added page fails the test, training the next author to
  update the list reflexively — the exact habit that neuters the guard. Keep only
  the zero-expansion guard (`expect(files.length).toBeGreaterThan(0)`), so a
  broken glob cannot assert nothing.

## Prevention

- **For any guard test, ask: "would this fail if the guard were replaced by a
  no-op with the same name?"** If not, it tests spelling.
- **Enumerate the framework's file conventions before globbing for them.** In
  Next that is page / layout / template / default / route, plus `"use server"`
  modules. Prefer widening the glob over listing files.
- **A rule that reddens on correct code gets deleted.** The first-await rule
  fired on Next 16's standard `const { runId } = await params;` — the
  conventional way to write a dynamic segment. Exempt params/searchParams
  explicitly and say so, or the next author weakens the rule for a legitimate
  page and the ordering protection is gone for everyone.
- **Give a security test a generous explicit timeout.** These dynamically import
  real modules, which is slow on a cold run; under the 5s default they flake,
  and *a security test that flakes is a security test that gets skipped.*
- Mutation-test the guard as a matter of course. The table that mattered here:
  shadowed binding, ungated route handler, ungated page, conditional gate
  (both inline and block form), commented-out gate, data-read-before-gate — all
  must go red; a correct `await params` before the gate must stay green.

## Related

- `docs/solutions/security-issues/guard-function-with-no-callers-is-not-a-mechanism-client-side-supabase-auth-bypasses-server-guards-2026-07-23.md`
  — the parent lesson this extends.
- `docs/solutions/security-issues/a-flag-that-gates-the-page-does-not-gate-its-server-actions-they-are-separately-addressable-endpoints-2026-08-05.md`
  — the same boundary from the other side: why the page's gate never covers its
  actions, which is why the glob had to include them.
- `docs/solutions/best-practices/memoizing-an-auth-gate-that-redirects-react-cache-throwing-gate-2026-07-27.md`
  — the gate being enforced here.
