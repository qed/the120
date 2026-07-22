---
title: "Narrow untyped supabase service-role rows into closed unions in a PURE module and fail closed — the read-path complement to CHECK-vs-TS-enum drift"
date: 2026-07-21
category: best-practices
module: authentication
problem_type: best_practice
component: authentication
severity: medium
applies_when:
  - "Reading an untyped supabaseAdmin() (no Database generic) row into a TS closed union (role/status/kind) that gates access or a security decision"
  - "A DB CHECK constraint and a TS union both encode the same closed set, kept in sync by hand"
  - "A type guard / row parser is about to be written inline inside a server-only or \"use server\" wrapper"
tags:
  - supabase
  - service-role
  - type-guard
  - fail-closed
  - authorization
  - enum-drift
  - server-only
---

# Narrow untyped supabase service-role rows into closed unions in a PURE module and fail closed

## Context

This repo's service-role client (`supabaseAdmin()`) is created with **no `Database` generic**, so every `.from(t).select(...)` returns `{ [col]: any }` rows. When such a row feeds a **closed TS union that gates access** — e.g. `path_role_grants.role` → `PathRole = "student" | "parent" | "guide"` in the Path authorization verdict — a naive `const grants = rows.map((g) => ({ role: g.role, ... }))` **silently coerces** whatever string the DB returned into the union. TypeScript can't help (`g.role` is `any`), so a value outside the union (from a future CHECK widening, a renamed column, or a manual DB edit) flows into the security decision as if it were a trusted role. The DB CHECK constraint is the *only* backstop, and it protects the **write** path, not this **read** path.

This is the read-path sibling of the documented `crm-audit-action-allowlist` enum-drift problem (which is about a DB CHECK drifting from a TS enum on **inserts**). Surfaced in The Path T1 Unit 5's `ce:review` — the authorization verdict is the single service-role boundary between a caller and another family's evidence, so "a bad string becomes a trusted role" is a security-grade concern.

## Guidance

**1. Narrow every untyped row through runtime type guards before it enters the decision, and FAIL CLOSED** — a row that fails the guard is *dropped*, never coerced:

```ts
export function parseRoleGrant(row: {
  role?: unknown; scope_type?: unknown; scope_id?: unknown;
}): RoleGrant | null {
  if (isPathRole(row.role) && isPathScope(row.scope_type) && typeof row.scope_id === "string") {
    return { role: row.role, scopeType: row.scope_type, scopeId: row.scope_id };
  }
  return null; // fail closed: an unrecognized row is never trusted
}
```

**2. Put the guard + parser in a PURE module, not inline in the `server-only`/`"use server"` wrapper.** `import "server-only"` throws outside a server context, so a guard defined inside it is **untestable in place** — which violates this repo's own convention (*decision logic lives in a pure `*-rules.ts` module; the wrapper stays thin*, per `app/path/lib/__tests__/smoke.test.ts` and the `access.ts`/`auth.ts` split). Keeping `parseRoleGrant` in the plain module makes the drop-vs-keep decision directly unit-testable.

**3. Derive the union type FROM a const array (single source), don't hand-write both.** `const PATH_ROLES = [...] as const; type PathRole = (typeof PATH_ROLES)[number];`. A hand-written `readonly PathRole[]` array only guarantees each element is *in* the union — **not** that the array covers every member, so a widened union with a forgotten array entry compiles clean and silently drops the new value. Deriving the type from the array makes array↔type drift impossible; only the array↔DB-CHECK pair remains hand-synced (two sources, not three).

**4. LOG every dropped row.** A fail-closed drop is safe but can be *invisible*: if one of a user's rows is dropped and others survive, the caller proceeds with a **silently truncated** set (e.g. a lost sibling grant) — a real member losing partial access with no trace, and no `notFound()` to signal it. Log the drop (the coded fields, never a raw id) so it is as discoverable as a query error:

```ts
for (const row of grantRows ?? []) {
  const grant = parseRoleGrant(row);
  if (grant) grants.push(grant);
  else console.error(`[path/auth] dropped malformed grant row for user ${user.id}: role=${String(row.role)} scope_type=${String(row.scope_type)}`);
}
```

## Why This Matters

Without the guard, a schema/TS drift is a **silent coercion** on a security decision (a bad string treated as a real role). With it, the same drift becomes a **contained, fail-closed functional gap** (a legitimate grant silently doesn't apply) — a bug, but never a bypass. That is a materially better failure mode. The guard covers only the read path; the **write** path (provisioning inserts) still hits the DB CHECK head-on if the TS side is widened without a matching migration — so keep the array and the CHECK in lockstep, exactly per the CRM audit-enum doc. Putting the guard in a pure module is what lets a test prove the fail-closed behavior; leaving it inline behind `server-only` means the security-critical narrowing is exercised by nothing until a real request hits it in production.

## When to Apply

- Any read of an untyped `supabaseAdmin()` row into a closed union that gates access, status, or routing.
- Any place a DB CHECK and a TS union encode the same closed set (roles, statuses, kinds).
- Before writing a type guard or row parser inline in a `server-only`/`"use server"` file — extract it to the pure module first.

## Examples

`app/path/lib/access-rules.ts` (the instance): `PATH_ROLES`/`PATH_SCOPES` const arrays → derived `PathRole`/`PathScope` → `isPathRole`/`isPathScope`/`parseRoleGrant`, all pure and unit-tested (`app/path/lib/__tests__/access-rules.test.ts`); `app/path/lib/auth.ts`'s `requirePathUser` consumes `parseRoleGrant` and logs each dropped row. Contrast the pre-hardening version, which mapped rows with a raw `{ role: g.role, ... }` assignment (silent coercion) inline in the server-only wrapper.

## Related

- `docs/solutions/best-practices/crm-audit-action-allowlist-db-check-constraint-drifts-from-ts-enum-2026-07-15.md` — the **write-path** sibling: a DB CHECK drifting from a TS enum surfaces as a runtime insert failure. This doc is its read-path complement; together they cover both directions of the same closed-set-in-two-places drift.
- `docs/solutions/test-failures/security-definer-sql-case-third-untested-copy-parse-migration-file-2026-07-22.md` — the **compute-path** sibling of the same family: a value map inside an RPC's SQL `CASE` drifts silently from its TS copy, closed by a migration-file-parsing parity test.
- `docs/solutions/best-practices/shared-db-taking-core-must-not-live-in-a-use-server-file-server-action-boundary-2026-07-17.md` and `.../server-only-import-breaks-tsx-scripts-plain-core-re-export-2026-07-21.md` — why the guard must live in the plain module, not the `server-only` wrapper.
