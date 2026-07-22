---
title: "A type-only re-export from a \"use server\" file emits registerServerReference and throws \"X is not defined\" at module load, taking every action in the graph down"
date: 2026-07-22
category: runtime-errors
module: path
problem_type: runtime_error
component: service_object
symptoms:
  - "Server Action call fails with `ReferenceError: TransitionResult is not defined` — a TYPE name appearing as a missing runtime value"
  - "EVERY action in the module graph fails, not just the one being called (the first mounted caller surfaced it as an upload error notice)"
  - "tsc --noEmit is clean and the error appears only at runtime, on the first request that loads the actions module"
root_cause: wrong_api
resolution_type: code_fix
severity: high
tags: [use-server, server-actions, type-reexport, register-server-reference, nextjs-16, turbopack, referenceerror]
---

# A type-only re-export from a `"use server"` file emits `registerServerReference` and throws `"X is not defined"` at module load

## Problem

`app/path/lib/actions/transition.ts` (a `"use server"` file) carried `export type { TransitionResult };` as a convenience re-export for consumers. At runtime, calling **any** Path Server Action — including actions in *other* files, because they share the actions module graph — failed with `ReferenceError: TransitionResult is not defined`. Found live on Unit 14's first mount of the capture surface: the student's upload flow surfaced it as "Upload failed", with the ReferenceError text reaching the client as the error message (dev mode).

## Symptoms

- `⨯ ReferenceError: TransitionResult is not defined` in the dev server log — the name is a **type**, so seeing it as a missing runtime value is the fingerprint.
- Actions that never mention the type also fail: the throw happens at module evaluation, so the whole `"use server"` graph is down.
- `tsc --noEmit` clean, `npm run test` green — nothing static catches it; only a real action invocation does.

## What Didn't Work

- Assuming `export type { … }` is erased like everywhere else in TypeScript. The type-checker does erase it — but Next's use-server transform (Next 16.2 / Turbopack) processes the export **syntactically** and emits a `registerServerReference(TransitionResult, …)` wrapper for it, exactly as it does for every value export of a `"use server"` file. At runtime no such binding exists → ReferenceError at module load.

## Solution

Never re-export anything — **including types** — from a `"use server"` file. Export only async action functions; consumers import shared types from the plain module that defines them.

```ts
// BEFORE (app/path/lib/actions/transition.ts — "use server")
import { …, type TransitionResult } from "@/app/path/lib/progress-core";
export type { TransitionResult };            // ← throws at runtime

// AFTER
// (no re-export; the file exports only `applyTransition`)
// Consumers do:
import type { TransitionResult } from "@/app/path/lib/progress-core";
```

Local `export type X = { … }` *declarations* inside `"use server"` files have not shown this failure in this repo (several action files declare their result types inline and work) — the observed trigger is the **re-export** form `export type { X }`. Treat both with suspicion; the declaration form merely hasn't bitten yet, and keeping types in the plain core module is safe in all cases.

## Why This Works

Every export of a `"use server"` file becomes a client-callable server reference: the transform rewrites exports into `registerServerReference(<localBinding>, id, name)` calls so the client bundle can address them. A type-only re-export leaves no local binding after type erasure, but the transform still emits the registration for the export name — referencing a binding that does not exist. Removing the re-export removes the phantom registration; importing the type from its defining (plain) module is fully erased as normal.

## Prevention

- **Rule:** a `"use server"` file's export list is *actions only*. Types live in the plain core module (`progress-core.ts`, `evidence-rules.ts`, …) and are imported from there — which the repo's action-file layering (gate → zod → pure decide → loader I/O) already encourages.
- The failure is invisible to `tsc`, `eslint`, and the unit suite; it surfaces on the **first live action call**. Any new `"use server"` file deserves one real invocation (browser or curl) before it ships — Unit 14 caught this only because it was the first unit to actually mount the actions.
- Grep check when touching action files: `grep -rn "export type {" app/**/actions/` should return nothing.
- The in-code comment at the former re-export site in `transition.ts` records the failure mode at the exact place someone would reintroduce it.

## Related Issues

- `docs/solutions/best-practices/shared-db-taking-core-must-not-live-in-a-use-server-file-server-action-boundary-2026-07-17.md` — sibling rule: every *value* export of a `"use server"` file becomes a public Server Action. This doc extends the same boundary to *type re-exports*, which don't become actions but still break the module.
- `docs/solutions/best-practices/server-only-import-breaks-tsx-scripts-plain-core-re-export-2026-07-21.md` — the third member of the module-boundary family: why shared cores stay plain (no `server-only`, no `"use server"`).
- Found and fixed during Unit 14 (`.context/compound-engineering/ce-review/2026-07-22-unit14/run.md`); the plan's T1 sequence is `docs/plans/2026-07-21-001-feat-the-path-t1-core-loop-plan.md`.
