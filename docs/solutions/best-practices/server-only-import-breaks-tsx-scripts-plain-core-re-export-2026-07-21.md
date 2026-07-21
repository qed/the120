---
title: 'import "server-only" breaks standalone tsx scripts that reuse app code — extract a plain core and re-export from the guarded wrapper'
date: 2026-07-21
category: best-practices
module: standalone-scripts
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - Writing a Node/tsx script (run via `tsx`) that reuses Next app modules (render, gate, sign, dedupe)
  - Sharing HMAC/token, template-render, or consent-gate logic between the Next app and a script
  - A script crashes at import with MODULE_NOT_FOUND for `server-only` or "cannot be imported from a Client Component"
root_cause: wrong_api
resolution_type: code_fix
tags: [server-only, tsx, next-js, module-boundary, standalone-scripts, re-export, shared-code, backfill]
---

# import "server-only" breaks standalone tsx scripts that reuse app code — extract a plain core and re-export from the guarded wrapper

## Context

This repo runs one-off tooling as plain Node scripts via `tsx` (`scripts/backfill-families.ts`, `scripts/seed-staff.ts`, and now `scripts/backfill-welcome-email.ts`). The Week-1 Welcome Email plan called for "one shared send core" reused by both the Next app (the `/api/welcome` route, the `addFamily` server action, the resend action) **and** the tsx backfill script — render, CASL gate, claim-then-send, and the signed unsubscribe URL all in one place.

That is infeasible as written: `import "server-only"` **throws** outside Next's bundler, and the unsubscribe/HMAC chain the script needed was `server-only` (`app/lib/nurture/token.ts` → `app/lib/hmacToken.ts`). `tsx scripts/backfill-welcome-email.ts` would crash at import before sending anything. The plan-review's feasibility pass caught this at high confidence *before* it hit runtime; the fix below is what shipped.

## Guidance

Keep the **shared logic in plain modules** (no `"use server"`, no `import "server-only"`) so both the Next bundle and a `tsx` script can import them. Where a `server-only` guard is genuinely wanted for the app (to keep a secret-bearing module out of client bundles), make the guarded file a thin **re-export wrapper** over a plain core:

```ts
// app/lib/hmac-core.ts — PLAIN (no "server-only"). Importable by Next AND tsx.
import { createHmac, timingSafeEqual } from "crypto";
export function signToken(purpose: string, id: string): string { /* ... */ }
export function verifyToken(purpose: string, id: string, token: string): boolean {
  // constant-time compare — see Related (state-changing-email-links doc)
}

// app/lib/hmacToken.ts — server-only wrapper for APP imports (client-bundle guard intact)
import "server-only";
export { signToken, verifyToken } from "@/app/lib/hmac-core";
```

App code keeps importing the guarded wrapper (`@/app/lib/hmacToken`), so nothing about the client-bundle protection changes. The tsx script imports the plain core (`@/app/lib/hmac-core`) directly. **One implementation, no divergence.**

Apply the same split to every layer the script needs:
- unsubscribe URL: `app/lib/nurture/unsubscribe-url.ts` (plain) ← `app/lib/nurture/token.ts` (`import "server-only"; export … from "./unsubscribe-url"`)
- render / CASL gate / CAS interpreters: `app/lib/welcome/welcome-rules.ts` (plain)
- send-I/O wrapper: `app/lib/welcome/send.ts` (plain — and also NOT a `"use server"` file, per the sibling boundary doc in Related)

**Two Next boundaries, don't conflate them:**

| Directive | What it does | Where it belongs |
|---|---|---|
| `import "server-only"` | Bundler guard that **throws** if the module is pulled into a client bundle *or run outside Next's bundler (e.g. `tsx`)* | The guarded **wrapper**, never the shared logic a script imports |
| `"use server"` | Marks a file whose exports become public, arg-serialized **Server Actions** | Auth-owning action files only — never a shared db-taking core (see Related) |

**Bonus:** `tsx` DOES resolve the `@/*` tsconfig path alias, so a script can `import { … } from "@/app/lib/…"` — no relative paths needed. This isn't obvious because the pre-existing scripts avoid `@/` imports entirely (they roll their own Supabase client, etc.). Verify once (`npx tsx -e 'import("@/app/lib/…")'`) and reuse.

## Why This Matters

- **`server-only` fails closed, at import.** The crash (`MODULE_NOT_FOUND` for the `server-only` package outside the bundler, or the in-bundle "This module cannot be imported from a Client Component" throw) fires before any real work — "the backfill crashes on startup" is easily mistaken for a config/env problem.
- **Transitive imports bite.** The script needn't import a `server-only` module *directly*; importing anything that transitively imports one (a token util, the admin Supabase client) triggers it. This is exactly why `scripts/backfill-families.ts` builds its own `createClient` instead of importing the app's `server-only` admin client.
- **Re-export wrappers preserve the guard AND enable reuse.** The alternatives are worse: dropping `server-only` outright weakens the client-bundle protection; duplicating the logic in the script invites drift between two copies of security-sensitive code (token signing, HTML-escape/render). The wrapper keeps one source of truth.

## When to Apply

- Any new `tsx`/Node script that wants to reuse Next app logic.
- Before writing the script: check whether the modules it imports (or their transitive imports) carry `import "server-only"`. If so, extract the reusable part into a plain module and make the guarded file a re-export.

## Examples

**Before** (infeasible — the script crashes at import):

```ts
// scripts/backfill-welcome-email.ts
import { unsubscribeUrl } from "@/app/lib/nurture/token"; // token.ts is `import "server-only"` → throws under tsx
```

**After** (plain core + server-only re-export; app imports unchanged):

```ts
// app/lib/nurture/unsubscribe-url.ts — PLAIN
import { signToken } from "@/app/lib/hmac-core";
export function unsubscribeUrl(familyId: string): string { /* ... */ }

// app/lib/nurture/token.ts — server-only re-export (every existing app importer keeps working)
import "server-only";
export { unsubscribeUrl, unsubscribeToken, verifyUnsubscribeToken } from "@/app/lib/nurture/unsubscribe-url";

// scripts/backfill-welcome-email.ts — imports the PLAIN module
import { unsubscribeUrl } from "@/app/lib/nurture/unsubscribe-url"; // works under tsx
```

Net: the app still imports `@/app/lib/nurture/token` (guarded); the script imports `@/app/lib/nurture/unsubscribe-url` (plain). The Week-1 backfill reuses the app's exact `sendWelcome` + render + HMAC through this split — dry-run and a full 32-recipient send were verified against the live DB with zero divergence between go-forward and backfill output.

## Related

- **Sibling Next boundary (companion doc):** `docs/solutions/best-practices/shared-db-taking-core-must-not-live-in-a-use-server-file-server-action-boundary-2026-07-17.md` — the `"use server"` boundary. That doc prescribes a plain `import "server-only"` module as the safe home for a shared core; **this doc documents how that same home breaks the moment a `tsx` script must reuse it** — split a plain-core module and re-export. Read both together.
- **Preserve the token contract when splitting `hmacToken.ts`:** `docs/solutions/security-issues/state-changing-email-links-mutate-on-get-scanner-prefetch-false-confirm-2026-07-16.md` documents the constant-time `crypto.timingSafeEqual` compare in the HMAC verify — keep it intact in the plain core.
- Origin: `docs/plans/2026-07-20-001-feat-week1-welcome-email-plan.md` (Unit 3; the "shared pure logic across all paths; thin I/O per runtime" decision).
