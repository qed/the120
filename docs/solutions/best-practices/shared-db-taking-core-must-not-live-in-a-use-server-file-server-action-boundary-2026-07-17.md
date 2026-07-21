---
title: "A shared db-taking core must NOT live in a \"use server\" file — it becomes a public Server Action and can't serialize its db arg"
date: 2026-07-17
module: crm
problem_type: best_practice
component: service_object
severity: high
applies_when:
  - "Extracting a shared helper that takes a Supabase/db client and is called by more than one server action / route (create-or-match, ingestion, stamping)"
  - "Any Next.js App Router module that starts with the \"use server\" directive"
  - "A webhook/cron/route needs to reuse logic that a staff server action also uses, but WITHOUT the staff auth gate"
root_cause: missing_permission
resolution_type: code_fix
related_components:
  - authentication
  - background_job
tags:
  - next-js
  - app-router
  - use-server
  - server-actions
  - server-only
  - security
  - module-boundary
---

# A shared db-taking core must not live in a "use server" file

## Context

Phase 2 of the CRM external-events work needed one `matchOrCreateLead(db, …)`
primitive shared by a staff server action (`logWarmConvo`), a public double-opt-in
route (the gauntlet confirm), and later a public Cal.com webhook. The plan's first
draft put the primitive in `app/crm/lib/actions/families.ts` — which begins with
`"use server";`. A plan-level security review flagged this as a **P0** before any
code was written.

## Guidance

**A function that (a) takes a `db`/Supabase client and (b) deliberately skips the
staff auth gate must live in a plain server-only module — `import "server-only"`,
**no** `"use server"` directive** — mirroring `app/crm/lib/queries.ts` (which
imports `supabaseAdmin` and exports `db`-taking functions without being a Server
Action). Keep the thin, auth-owning wrappers (`requireStaff`-gated actions, the
route handlers) in their own files, importing and calling the shared core.

```ts
// app/crm/lib/lead-ingest.ts  — the shared core
import "server-only";                     // NOT "use server"
import { supabaseAdmin } from "@/app/lib/supabase/admin";
export async function matchOrCreateLead(db: ReturnType<typeof supabaseAdmin>, input) { … }

// app/crm/lib/actions/families.ts  — "use server": every export is a Server Action
export async function logWarmConvo(input: unknown) {
  const staff = await requireStaff();     // the action owns authorization
  return matchOrCreateLead(supabaseAdmin(), { … });  // db created HERE, never crosses the wire
}

// app/api/gauntlet/tournament/confirm/route.ts — the route owns its own gate (opt-in token)
await matchOrCreateLead(db, buildGauntletLeadInput(entry));
```

Rule of thumb: **`"use server"` files export the authorization surface; plain
`server-only` modules export the shared machinery.** Callers own their gate
(staff session, HMAC, double-opt-in); the core owns the data contract.

## Why This Matters

Two independent failures, either one sufficient to avoid this:

1. **Security (the P0).** Every export of a `"use server"` file is registered as
   a **client-callable Server Action** reachable by any browser, regardless of
   which UI wires it up. An auth-skipping core exported from such a file is a
   public, unauthenticated path to create leads / mint CASL consent / stamp
   records — silently bypassing the very gate (staff auth, webhook HMAC, opt-in
   token) the callers were relying on. The HMAC on the webhook route does nothing
   if the same effect is independently reachable as a bare Server Action.
2. **It doesn't even work.** Server Actions serialize their arguments across an
   RPC boundary; a live Supabase client (functions + connection state) is not
   serializable, so an exported `fn(db, …)` breaks the moment a second module
   imports it. The existing private helpers in `families.ts`
   (`findEmailConflict`, `audit`, `loadLiveFamily`) only get away with taking
   `db` because they are **un-exported**.

## When to Apply

- Any time a helper takes a `db`/client argument AND is (or will be) imported by
  more than one server action or route — extract it to `server-only`, never to a
  file under `actions/` or any file carrying `"use server"`.
- Any time a public route (webhook/cron) needs to reuse a staff action's effect
  without the staff gate — do NOT export a staff-less variant from the actions
  file; put the staff-less core in `server-only` and let each caller attach its
  own authorization.

## Examples

**Wrong** — the plan's first draft (security P0):
```
app/crm/lib/actions/families.ts   ("use server")
  export async function matchOrCreateLead(db, input) { … }   // ← public Server Action + unserializable db arg
```

**Right** — what shipped:
```
app/crm/lib/lead-ingest.ts        (import "server-only", no "use server")
  export async function matchOrCreateLead(db, input) { … }
app/crm/lib/actions/families.ts   ("use server")
  export async function logWarmConvo(input) { requireStaff(); return matchOrCreateLead(supabaseAdmin(), …) }
app/api/gauntlet/tournament/confirm/route.ts
  await matchOrCreateLead(db, buildGauntletLeadInput(entry))   // route owns the opt-in gate
```

Related: the create-or-match consent/idempotency contract this core centralizes
is governed by `docs/solutions/database-issues/blind-upsert-on-conflict-public-endpoint-expression-index-inference-and-consent-hijack-2026-07-16.md`
(never blind-upsert; select-first) and `docs/solutions/best-practices/bulk-import-crm-leads-families-derived-stage-parent-id-consent-2026-07-15.md`
(never a 2nd family for an account-holder; coalesce consent).

**Caveat — `server-only` is not reusable by standalone scripts:** this doc
prescribes a plain `import "server-only"` module as the safe home for a shared
core, but that home **breaks the moment a `tsx`/Node script must reuse it**
(`server-only` throws outside Next's bundler). When that happens, split a
plain-core module and make the `server-only` file a re-export wrapper — see
`docs/solutions/best-practices/server-only-import-breaks-tsx-scripts-plain-core-re-export-2026-07-21.md`.

**Secondary catch from the same phase:** for an "ensure this signal is present"
operation, use an **add-only** helper (`ensureSignals`), not a toggle
(`applySignalToggle`) — a toggle would *remove* an already-present signal, so
"family already has the signal → idempotent" silently breaks. Match the helper's
semantics (add vs toggle) to the caller's intent.
