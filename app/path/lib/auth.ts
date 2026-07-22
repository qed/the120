import "server-only";
import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/app/lib/supabase/server";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { parseRoleGrant, type RoleGrant } from "./access-rules";

/** The signed-in Path identity a page works with: the user and the grants
 *  resolvePathAccess needs, loaded once per request. */
export type PathPrincipal = { userId: string; grants: RoleGrant[] };

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
 * `notFound()` is the idiomatic route-segment 404 in a Server Component; per
 * Next's bundled docs it is NOT documented for Server Actions. Per-TARGET
 * authorization for actions — mapping a `resolvePathAccess` verdict onto
 * redirect/404 — lands with its real call sites and tests in a later unit,
 * following crm/auth.ts's redirect-to-a-page pattern if `notFound()` proves not
 * to propagate from an action.
 *
 * The grants returned here uphold the two invariants documented on
 * `resolvePathAccess` (access-rules.ts): (1) they are scoped to THIS user by the
 * `.eq("user_id", …)` below, and (2) any AccessTarget a caller builds from them
 * must take its ids from the authoritative resource row, never a client param.
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

  // Fail closed either way, but never let a failure masquerade SILENTLY as "not a
  // member": log a query outage AND every row parseRoleGrant drops, so a real
  // member whose access is understated (a dropped sibling grant that still leaves
  // grants.length > 0) is never invisible.
  if (error) {
    console.error(`[path/auth] loading grants for user ${user.id} failed: ${error.message}`);
  }

  const grants: RoleGrant[] = [];
  for (const row of grantRows ?? []) {
    const grant = parseRoleGrant(row);
    if (grant) {
      grants.push(grant);
    } else {
      console.error(
        `[path/auth] dropped malformed grant row for user ${user.id}: ` +
          `role=${String(row.role)} scope_type=${String(row.scope_type)}`
      );
    }
  }

  if (grants.length === 0) notFound();

  return { userId: user.id, grants };
}
