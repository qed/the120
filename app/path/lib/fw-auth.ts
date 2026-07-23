import "server-only";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/app/lib/supabase/server";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { parseRoleGrant, type RoleGrant } from "./access-rules";
import {
  resolveFwActor,
  type FwActorVerdict,
  type FwCohortLike,
} from "./fw-access-rules";
import { loadFwCohort, loadStaffRowActive } from "./fw-guide-core";

/**
 * The FW request-scoped identity gate (FW Unit 2) — `requirePathUser`'s sibling
 * for the guide door, and deliberately NOT a call into it.
 *
 * Two divergences, both load-bearing:
 *
 *   1. **Zero grants is legal here.** `requirePathUser` calls `notFound()` on a
 *      grant-less session, which is right for the Path (a signed-in non-member
 *      is a 404). It is WRONG for FW: a staff member reaching a weekend surface
 *      through the FW-D3 bridge holds no `path_role_grants` row at all, by
 *      design — the bridge exists so staff need not grant themselves into every
 *      cohort they walk into. Reusing requirePathUser would 404 exactly the
 *      people who run the event.
 *   2. **The session-less destination is the GUIDE door** (`/path/fw/sign-in`),
 *      matching the proxy's `fw-login` outcome. A guide whose session expired
 *      mid-Saturday must not land on the student/parent door.
 *
 * Everything else is inherited: `getUser()` (revocation-sensitive, unlike
 * `getClaims`) validates the session; grants load via the service-role client so
 * the result never depends on RLS shape (there are no policies); every malformed
 * grant row is dropped fail-closed AND logged, so an understated actor is never
 * silent.
 */

export type FwSession = {
  userId: string;
  /** Already scoped to THIS user by the `.eq("user_id", …)` below — the trust
   *  boundary `resolveFwActor` documents and cannot enforce itself. */
  grants: RoleGrant[];
  /** The JWT's `app_metadata.role === "admin"`. Necessary for the bridge, never
   *  sufficient — `loadStaffRowActive` supplies the other half. */
  hasAdminClaim: boolean;
};

/** Load the FW session, or null when there is none. Never redirects — callers
 *  that want a redirect use `requireFwSession`; the invite/claim surfaces
 *  deliberately work session-less. */
export async function loadFwSession(): Promise<FwSession | null> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: grantRows, error } = await supabaseAdmin()
    .from("path_role_grants")
    .select("role, scope_type, scope_id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(`[fw/auth] loading grants for user ${user.id} failed: ${error.message}`);
  }

  const grants: RoleGrant[] = [];
  for (const row of grantRows ?? []) {
    const grant = parseRoleGrant(row);
    if (grant) {
      grants.push(grant);
    } else {
      console.error(
        `[fw/auth] dropped malformed grant row for user ${user.id}: ` +
          `role=${String(row.role)} scope_type=${String(row.scope_type)}`
      );
    }
  }

  return {
    userId: user.id,
    grants,
    hasAdminClaim: user.app_metadata?.role === "admin",
  };
}

/** Session or the guide door. For FW pages inside the guarded subtree. */
export async function requireFwSession(): Promise<FwSession> {
  const session = await loadFwSession();
  if (!session) redirect("/path/fw/sign-in");
  return session;
}

export type FwActorContext = {
  session: FwSession;
  cohort: FwCohortLike;
  verdict: FwActorVerdict;
};

/**
 * Resolve who the caller is FOR ONE COHORT — the gate every guide-facing page
 * and check-in action runs.
 *
 * The cohort row is loaded here, authoritatively, and never taken from the
 * caller: `kind` is what makes the bridge apply, so a client-supplied kind would
 * let any staff-claim holder declare a Path cohort "fw" and write cascade-free
 * events into a real Path student's record.
 */
export async function resolveFwActorForCohort(cohortId: string): Promise<FwActorContext> {
  const session = await loadFwSession();
  if (!session) {
    return {
      session: { userId: "", grants: [], hasAdminClaim: false },
      cohort: null,
      verdict: { ok: false, reason: "no_session" },
    };
  }

  const db = supabaseAdmin();
  const cohort = await loadFwCohort(db, cohortId);
  // Skip the staff-row read entirely when the claim is absent — the bridge needs
  // both, so a claim-less session can never be promoted by this row.
  const staffRowActive = session.hasAdminClaim
    ? await loadStaffRowActive(db, session.userId)
    : false;

  return {
    session,
    cohort,
    verdict: resolveFwActor({
      session: { user: { id: session.userId } },
      grants: session.grants,
      cohort,
      bridge: { hasAdminClaim: session.hasAdminClaim, staffRowActive },
    }),
  };
}

export type FwStaffGate =
  | { ok: true; userId: string }
  | { ok: false; reason: "no_session" | "not_staff" };

/**
 * The COHORT-FREE staff gate, for ops actions that have no cohort in hand
 * (re-issuing a guide's invite is per-account, not per-weekend).
 *
 * Same two inputs as the bridge and the same rule — claim AND live active row —
 * so a deactivated staff member loses ops power on their very next action even
 * while their JWT still says admin. Returns a typed verdict rather than
 * redirecting: these are Server Actions, and the repo's posture is that actions
 * return typed refusals and never throw.
 */
export async function resolveFwStaffGate(): Promise<FwStaffGate> {
  const session = await loadFwSession();
  if (!session) return { ok: false, reason: "no_session" };
  if (!session.hasAdminClaim) return { ok: false, reason: "not_staff" };
  const active = await loadStaffRowActive(supabaseAdmin(), session.userId);
  if (!active) return { ok: false, reason: "not_staff" };
  return { ok: true, userId: session.userId };
}

/** Every cohort id this session holds a `guide` grant for — the input
 *  `listFwCohortsForActor` filters against (it re-reads `kind` itself, so a
 *  Path-cohort guide grant here surfaces nothing). */
export function grantedCohortIds(grants: readonly RoleGrant[]): string[] {
  return grants.filter((g) => g.role === "guide" && g.scopeType === "cohort").map((g) => g.scopeId);
}
