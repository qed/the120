---
title: "A standalone tsx script that reuses an app dependency factory can transitively import Next.js `server-only` and crash at module load — tsc passes and unit tests of the pure logic pass, so it's invisible until you actually RUN the entrypoint"
date: 2026-08-01
category: build-issues
module: scripts
problem_type: build_issue
component: tooling
symptoms:
  - "A CLI/cron script fails at startup with `Cannot find module 'server-only'` before main() runs"
  - "tsc --noEmit is clean and the script's unit tests pass, but `npx tsx script.ts` crashes immediately"
  - "The failing import is not in the script — it's pulled in transitively via a deep chain into an app module that begins with import \"server-only\""
root_cause: dependency_issue
resolution_type: code_fix
severity: high
tags:
  - server-only
  - nextjs
  - tsx
  - scripts
  - service-role
  - module-load
related_components:
  - tooling
  - scripts
---

# A script reusing app deps can transitively import `server-only` and die at load

## Problem

The R28 family-erasure script (`scripts/erase-fp-family.ts`) reused the app's
service-role deps factory: `import { realEraseFamilyDeps } from
"app/lib/funnel/provision-deps"`. That module imports `supabaseAdmin` from
`app/lib/supabase/admin.ts`, whose **first line is `import "server-only"`**.

`server-only` is a Next.js *runtime alias* (the bundler maps it to a module that
throws if imported into a client bundle); it is **not an installed npm package**.
Under `tsx` — the runner in `npm run r28:erase` — there is no bundler, so the bare
specifier `server-only` is unresolvable and the whole module graph fails to load with
`Cannot find module 'server-only'` **before `main()` ever executes.** The script was
dead on arrival: dry-run and real run alike.

It was invisible because the two things normally trusted said "fine":
- **`tsc --noEmit` passed** — TypeScript resolves `server-only`'s types and never
  evaluates the import.
- **The unit tests passed** — they imported only the *pure* args module
  (`erase-fp-family-args.ts`, type-only imports), never the entrypoint's dep chain.

Only actually running `npx tsx scripts/erase-fp-family.ts …` revealed it.

## Symptoms

- `Cannot find module 'server-only'` (or `'server-cli-only'`, `next/*`) at script
  startup, with a stack that points into an app module, not your script.
- Green `tsc` + green unit suite, red the moment the entrypoint is executed.
- The script is the *first* one in `scripts/` to import a given app module — nothing
  else exercised that chain.

## Solution

Don't route a standalone script through a `server-only`-guarded app factory.
Construct the same dependencies via a script-safe path:

```ts
// scripts/erase-fp-family-deps.ts — no server-only anywhere in this chain
import { createClient } from "@supabase/supabase-js";
export function scriptEraseFamilyDeps(): EraseFamilyDeps {
  const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  // Workspace legs: lazily import googleapis, gate on GOOGLE_WORKSPACE_SA_KEY —
  // replicate the app helpers' semantics (idempotent 404->missing, PII-safe logs),
  // with a comment pointing at provision-deps.ts as the source of truth.
  return { db, /* suspend/delete/… */ };
}
```

Mirror the pattern the sibling script already used (`rls-reprobe-fp-parent.ts` calls
`createClient` directly and never imports `supabaseAdmin`). If the app factory and
the script must truly share code, extract the service-role client construction into a
module that does **not** `import "server-only"`, and have both import that — but never
add `server-only` to a path a script can reach.

**Verify by running it**, not by tsc: `npx tsx scripts/erase-fp-family.ts <safe args>`
must get past the imports and into `main()` (a missing-env refusal or a DB connect is
fine — the point is the module loaded).

## Why This Works

`server-only` is a *bundler contract*, not a runtime module. It only "resolves" inside
a Next.js build. A tsx/node script has no bundler, so any transitive path to it is a
hard load-time failure. Giving the script its own dep construction keeps its entire
import graph bundler-free, so it loads under a plain runtime.

## Prevention

- **A script entrypoint's import graph must be bundler-free.** Before reusing an app
  module from `scripts/`, check whether it (or anything it imports, transitively)
  starts with `import "server-only"` / `"server-cli-only"` or imports `next/*`. Deep
  chains hide it — `script → deps → admin.ts`.
- **`tsc` and pure-logic unit tests do NOT catch this.** tsc resolves the type; tests
  of the extracted pure module never touch the entrypoint's deps. The only reliable
  check is executing the entrypoint under its real runner (`tsx`/`node`). Add a smoke
  step that runs `--help`/dry-run for every script.
- **Keep pure logic in a side-effect-free module (good) — but also run the wiring.**
  Splitting `erase-fp-family-args.ts` (pure, tested) from `erase-fp-family.ts` (wiring)
  is right, yet it means the suite proves the logic while the *loadability* of the
  wiring goes unproven unless you run it.
- Sibling: the deploy-skew / server-action docs (same family: a Next.js runtime
  contract behaving differently outside the Next build).
