import "server-only";
import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/app/lib/supabase/server";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import type { PathRole, PathScope, RoleGrant } from "./access-rules";

/** The signed-in Path identity a page works with: the user and the grants
 *  resolvePathAccess needs, loaded once per request. */
export type PathPrincipal = { userId: string; grants: RoleGrant[] };

const PATH_ROLES: readonly PathRole[] = ["student", "parent", "guide"];
const PATH_SCOPES: readonly PathScope[] = ["student", "family", "cohort"];

// Narrow the untyped service-role rows into the closed unions BEFORE they enter
// the authorization model. The DB CHECK constraints already forbid other values,
// but this is the single service-role boundary protecting another family's
// evidence, so a schema drift (a widened CHECK, a renamed column) must fail
// CLOSED here — an unrecognized row is dropped, never coerced into a bad grant —
// rather than silently entering resolvePathAccess as an off-union string.
const isPathRole = (x: unknown): x is PathRole =>
  typeof x === "string" && (PATH_ROLES as readonly string[]).includes(x);
const isPathScope = (x: unknown): x is PathScope =>
  typeof x === "string" && (PATH_SCOPES as readonly string[]).includes(x);

/**
 * Authoritative Path membership gate (Decision 1) — called by `/path` server
 * COMPONENTS to establish who the caller is. Mirrors `requireStaff`: the proxy's
 * JWT check is only the cheap outer fence; this validates the session user with
 * `getUser()` (revocation-sensitive, unlike `getClaims`) and loads their
 * `path_role_grants` via the service-role client, so the result never depends on
 * RLS policy shape (there are none — RLS is on with zero policies).
 *
 * No session         → redirect to /path/sign-in (Unit 6).
 * Session, no grants → notFound() — a signed-in non-member is a 404.
 *
 * Two deliberate scoping notes:
 * - `notFound()` is the idiomatic route-segment 404 in a Server Component; per
 *   Next's bundled docs it is NOT documented for Server Actions. Per-TARGET
 *   authorization for actions — mapping a `resolvePathAccess` verdict onto
 *   redirect/404 — lands with its real call sites and tests in a later unit,
 *   following crm/auth.ts's redirect-to-a-page pattern if `notFound()` proves
 *   not to propagate from an action.
 * - The grants returned here are the ONLY thing resolvePathAccess is trusted to
 *   act on, and they are scoped to THIS user by the `.eq("user_id", …)` below.
 *   A caller building an AccessTarget must take its ids from the AUTHORITATIVE
 *   resource row (a path_student_profiles lookup), never a client-supplied route
 *   or form param — resolvePathAccess compares ids, it cannot detect a forged
 *   target. That contract is where an IDOR would live; keep it at every call
 *   site (access-rules.ts states the same).
 */
export async function requirePathUser(): Promise<PathPrincipal> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/path/sign-in");

  const { data: grantRows, error } = await supabaseAdmin()
    .from("path_role_grants")
    .select("role, scope_type, scope_id")
    .eq("user_id", user.id);

  // Fail closed either way, but do not let an outage masquerade SILENTLY as
  // "not a member": a real query failure and a genuine zero-grant member both
  // fall through to notFound(), so log the distinction for operators.
  if (error) {
    console.error(`[path/auth] loading grants for user ${user.id} failed: ${error.message}`);
  }

  const grants: RoleGrant[] = (grantRows ?? []).flatMap((g) =>
    isPathRole(g.role) && isPathScope(g.scope_type) && typeof g.scope_id === "string"
      ? [{ role: g.role, scopeType: g.scope_type, scopeId: g.scope_id }]
      : []
  );

  if (grants.length === 0) notFound();

  return { userId: user.id, grants };
}
