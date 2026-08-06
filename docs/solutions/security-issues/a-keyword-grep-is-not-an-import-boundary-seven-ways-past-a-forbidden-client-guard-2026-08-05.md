---
module: fp-image-lab
date: "2026-08-05"
problem_type: security_issue
component: tests
severity: high
symptoms:
  - "A guard test claims no module in a subtree can import the anon Supabase client; seven different imports of it pass"
  - "A dynamic `await import()` of a forbidden module is invisible to both the grep and the eslint rule"
  - "A production module parked under __tests__/ is scanned by nothing and run by nothing"
root_cause: lexical_scan_instead_of_import_graph
resolution_type: test_fix
tags:
  - import-boundary
  - service-role
  - rls
  - eslint-no-restricted-imports
  - import-graph
  - negative-fixture
  - 42501
---

# A keyword grep is not an import boundary: seven ways past a forbidden-client guard

## Problem

A staff-only subtree must reach Postgres **only** through the service-role
client: its tables are RLS-on with zero policies, so an anon/PostgREST client
fails every write with `42501` **in production only**, while CI stays green on
injected fakes — a failure this repo has already shipped once
(`security-issues/rls-enabled-zero-policies-…-2026-07-28.md`). In this feature
that failure lands *after* a paid third-party image generation, so the money is
spent before the error appears.

The guard was a test that read every file under the subtree and asserted the
source text contained no forbidden identifier or import path:

```ts
const forbidden = /from\s+["']@\/app\/lib\/supabase\/(client|server)["']|supabaseBrowser|createBrowserClient|NEXT_PUBLIC_SUPABASE_ANON_KEY/;
```

Five tests, green. A reviewer wrote one PoC file that did four forbidden things
at once and the suite still reported 5 passed.

## Symptoms — seven bypasses, all verified green

| # | Bypass | Why the grep misses it |
|---|---|---|
| 1 | `await import("@/app/lib/supabase/client")` | the regex requires the token `from`; a dynamic import has none |
| 2 | `import * as m from "../../lib/supabase/client"` | the path alternation is anchored to the `@/` alias only |
| 3 | a re-export barrel **one directory outside** the subtree | the scan walks only the subtree |
| 4 | `import { createClient } from "@supabase/supabase-js"` with `process.env["NEXT_PUBLIC_SUPABASE" + "_ANON_KEY"]` | `createClient` was never in the list; the concatenation defeats the literal env-var term |
| 5 | `import { supabaseAdmin } from "../../../lib/supabase/admin"` | the one-accessor rule matched only the aliased specifier |
| 6 | the same import in a `.js` file | the glob was `**/*.{ts,tsx}` |
| 7 | a **production** module at `lib/__tests__/anon-helper.ts` | the scan ignored `**/__tests__/**`, and vitest never ran it either (not `*.test.ts`) |

A related eighth: the "did this file name one of our tables" check used
`/fp_image_lab_\w+/`, so `` `fp_image_lab_${x}` `` and `"fp_image_lab" + "_x"`
both slipped by, letting a file skip the whole check.

## Why This Happens

Every bypass is one mistake wearing different clothes:

> **The test asserted the ABSENCE OF SPELLINGS. The property it needed was a
> shape of the IMPORT GRAPH.**

A lexical scan has to enumerate every way a thing can be written — alias vs
relative vs dynamic vs vendor-direct vs re-exported vs a file extension you
forgot — and the attacker (usually a well-meaning future author in a hurry) only
has to find one you missed. Enumeration loses; resolution wins.

The `__tests__/` bypass deserves separate note because it is a *convention*
hole, not a syntax one: the directory is excluded by scanners because it is
assumed to hold tests, and excluded by the runner because the file is not named
`*.test.ts`. Anything parked there is governed by nothing.

## Solution

Two mechanisms, with an explicit statement of which one owns what.

**1. A real lint rule** — eslint resolves specifiers, so it covers the aliased,
relative, and vendor-direct forms without enumerating spellings:

```js
// eslint.config.mjs — exported so the test lints the REAL rule objects
export const IMAGE_LAB_IMPORT_RULES = {
  files: ["app/staff/image-lab/**/*.{ts,tsx,js,jsx,mjs,cjs}"],
  rules: { "no-restricted-imports": ["error", { patterns: [
    { group: ["**/lib/supabase/client", "**/lib/supabase/server", "@/app/lib/supabase/{client,server}"], message: "…" },
    { group: ["@supabase/supabase-js", "@supabase/ssr"], message: "the Lab never constructs a client" },
    { group: ["**/lib/supabase/admin"], message: "go through imageLabDb()" },
  ]}]},
};
```

**2. An import-GRAPH walk** for what a lint rule structurally cannot see —
verified, not assumed: **ESLint 9's `no-restricted-imports` does not inspect
dynamic `import()`**. So the test collects specifiers with
`ts.preProcessFile` (which *does* see dynamic imports), resolves them to files,
follows them transitively, and terminates only at a short, named
`AUDITED_CROSSINGS` list. That single change closes bypasses 1, 2, 3 and 5 at
once, because a barrel outside the subtree is just another edge in the graph.

**3. Negative fixtures — the part whose absence let all seven ship.** Every
bypass shape is asserted to be *caught*:

```ts
it.each(BYPASS_FIXTURES)("catches %s", async (_name, fixture) => {
  await withTempModule(fixture, async () => {
    await expect(runGuard()).rejects.toThrow();   // it must actually redden
  });
});
```

plus positive fixtures proving legitimate imports are **not** flagged, plus one
run with an empty crossings list proving the walk really does leave the subtree
(a walk that silently terminates early asserts nothing).

## Prevention

- **A guard test with no negative fixture is unverified.** Nothing else explains
  how seven bypasses coexisted with five green tests. If a rule cannot be shown
  going red, it is decoration.
- **Prefer resolution over enumeration.** Ask "does this check understand module
  resolution, or is it matching strings?" If the latter, list the spellings you
  are *not* covering in a comment — you will find you cannot finish the list.
- **State which mechanism owns which hole, in both files.** Here eslint cannot
  see dynamic imports, string-literal table names, or control flow; the graph
  walk and the separate source fences own those. Writing that split down stops a
  future reader assuming full overlap and deleting the "redundant" one.
- **Glob every extension the bundler accepts**, and exclude only `*.test.*` —
  never a whole `__tests__/` directory, which is a governance hole a production
  module can be parked in.
- **When the guard protects a paid or destructive path, say so at the top.** The
  cost of this one failing is a production `42501` *after* a vendor charge, and
  that sentence is what justifies the graph walk over the cheaper grep.

## Related

- `docs/solutions/security-issues/rls-enabled-zero-policies-but-the-server-code-is-postgrest-anon-key-2026-07-28.md`
  — the production incident this guard exists to prevent recurring.
- `docs/solutions/security-issues/a-source-scan-cannot-prove-a-guard-was-reached-shadowed-conditional-and-route-handlers-all-pass-it-2026-08-05.md`
  — the same lesson on the auth gate, found one unit earlier: source text cannot
  answer a question about behaviour or structure.
- `docs/solutions/security-issues/guard-function-with-no-callers-is-not-a-mechanism-client-side-supabase-auth-bypasses-server-guards-2026-07-23.md`
  — the original of the family.
