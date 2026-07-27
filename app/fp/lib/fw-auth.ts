import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/app/lib/supabase/server";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { IdentityUnavailableError, type IdentityRead } from "@/app/lib/identity-unavailable";
import { FW_CALL_TIMEOUT_MS, fwRead, withFwTimeout } from "./fw-call";
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
 *   2. **The session-less destination is the GUIDE door** (`/fp/fw/sign-in`),
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
  /**
   * The account's email, carried from the `getUser()` this loader already makes.
   *
   * Nullable because `auth.users.email` is nullable in principle. Added for the staff
   * bar's identity read (R17: the bar names the ACCOUNT, and an email is all the
   * schema holds) — carried here rather than re-fetched, because a second
   * `auth.getUser()` is a second network round trip to the Auth server on every bar
   * mount, and `getUser()` is deliberately revocation-sensitive rather than a local
   * JWT decode. No existing caller is affected.
   */
  email: string | null;
  /** Already scoped to THIS user by the `.eq("user_id", …)` below — the trust
   *  boundary `resolveFwActor` documents and cannot enforce itself. */
  grants: RoleGrant[];
  /** The JWT's `app_metadata.role === "admin"`. Necessary for the bridge, never
   *  sufficient — `loadStaffRowActive` supplies the other half. */
  hasAdminClaim: boolean;
};

/**
 * Load the FW session — THREE-WAY (Staff Front Door Unit 5, B4).
 *
 * REQUEST-MEMOIZED with React's `cache()`, following the precedent
 * `loadFamilyContextCached` set in `family-loader.ts` ("one set of queries per
 * request instead of two"). Next 16 layouts do not re-render on navigation but
 * they DO run on a full render, so `(app)/layout.tsx`'s gate and the page's own
 * gate would otherwise each pay a `getUser()` round trip plus a grants query —
 * four network hops where two will do, on every iPad reload and every hard
 * navigation into the FW subtree, over venue wifi (performance review).
 *
 * ── B4: why this stopped returning `FwSession | null`
 *
 * Both Supabase calls below were bare. Nothing in the Supabase client sets a fetch
 * timeout and no route here configures `maxDuration`, so either could hang for the
 * whole serverless budget — and this function is the FIRST thing `drainFwQueue`
 * does, INSIDE the client's Web Lock. `fw-sync.ts` bounds the per-cohort authz
 * resolve forty lines later with the comment *"it runs inside the client's Web Lock,
 * so an unguarded hang here would wedge the single-drainer"*. The call that runs
 * first, in the same lock, had no such guard. Unit 1 bounded the CLIENT's leg
 * (`40bdcc1`); this is the server-internal half.
 *
 * Adding the bound is the easy part. The part that matters is what a bounded call
 * REPORTS. Returning `null` on a timeout would have been the worst possible fix: null
 * means "there is no session", `requireFwSession` redirects on it, and a guide whose
 * venue wifi stalled for eight seconds would be thrown out to the sign-in door
 * mid-shift — with a queue of un-landed check-ins on the device and an
 * `authRequired` flag that is a lie. A timeout is UNKNOWN. It is never a verdict
 * about the account.
 *
 * So the return type says so. `IdentityRead` is deliberately not nullable and not
 * falsy-shaped, so the old `if (!session)` collapse is a compile error at every call
 * site rather than something a reviewer has to notice.
 *
 * ── Why the GRANTS read is unknown-on-failure, where it used to degrade
 *
 * The grants query previously logged its error and continued with `grants: []`. That
 * looks conservative and is not: `grantedCohortIds(session.grants)` is what
 * `loadStaffBarIdentity` turns into `isFwGuide`, which is the SERVER-KNOWN half of
 * the sign-out evidence gate (B1). An understated grant list therefore reads as "this
 * account is not an FW guide", which makes the bar skip the device's own queue check
 * and sign out over un-landed captures — silently. A read that failed must not be
 * able to do that, so an unreadable grants query is `unknown` like the session read.
 * Malformed INDIVIDUAL rows are still dropped-and-logged: that is a per-row decision
 * about data we DID receive, which is a different question from not receiving it.
 */
export const loadFwSessionRead = cache(async function loadFwSessionRead(): Promise<
  IdentityRead<FwSession>
> {
  const supabase = await supabaseServer();

  // BOUNDED + throw-guarded. `getUser()` is a network round trip to the Auth server
  // (deliberately, for revocation sensitivity), so it carries the network budget, not
  // the storage-probe one.
  let userRaced;
  try {
    userRaced = await withFwTimeout(supabase.auth.getUser(), "fw session getUser", FW_CALL_TIMEOUT_MS);
  } catch (e) {
    console.error("[fw/auth] getUser threw:", e);
    return { kind: "unknown", detail: "getUser threw" };
  }
  if (userRaced.timedOut) return { kind: "unknown", detail: "getUser timed out" };

  const user = userRaced.value.data.user;
  if (!user) return { kind: "none" };

  // Through `fwRead`, which is this repo's one definition of "bounded and guarded
  // against a throw" for a Supabase read — not a second hand-rolled race.
  const { data: grantRows, error } = await fwRead(
    () =>
      supabaseAdmin()
        .from("path_role_grants")
        .select("role, scope_type, scope_id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true }),
    `fw grants for ${user.id}`
  );

  if (error) {
    console.error(`[fw/auth] loading grants for user ${user.id} failed: ${error.message}`);
    // See the docblock: an understated grant list is not a safe degrade here.
    return { kind: "unknown", detail: "grants unreadable" };
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
    kind: "identity",
    identity: {
      userId: user.id,
      email: user.email ?? null,
      grants,
      hasAdminClaim: user.app_metadata?.role === "admin",
    },
  };
});

/**
 * Session or the guide door. For FW pages inside the guarded subtree.
 *
 * `unknown` THROWS rather than redirecting — the B4 rule, made concrete. The throw is
 * caught by the nearest `error.tsx` (Unit 5 adds them), which renders a retry control:
 * the user asks the question again instead of being answered wrongly. Note this
 * renders NO page body, so it is not a fail-open; see `identity-unavailable.ts`.
 */
export async function requireFwSession(): Promise<FwSession> {
  const read = await loadFwSessionRead();
  if (read.kind === "unknown") throw new IdentityUnavailableError("requireFwSession", read.detail);
  if (read.kind === "none") redirect("/fp/fw/sign-in");
  return read.identity;
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
  const db = supabaseAdmin();
  // The session and the cohort are INDEPENDENT reads — `cohortId` is known up
  // front and the cohort row does not depend on who is asking — so they run
  // concurrently rather than serializing a third network hop onto every guide
  // page render and (from Unit 3) every check-in action (performance review).
  // The cost of the parallelism is one wasted cohort read on the session-less
  // path, which the layout's redirect already makes rare.
  const [read, cohort] = await Promise.all([
    loadFwSessionRead(),
    loadFwCohort(db, cohortId),
  ]);
  // UNKNOWN is not `no_session` (B4). `no_session` is terminal for every caller —
  // pages redirect to the guide door, `drainFwQueue` returns a refusal the client
  // shows as "sign in again" — and answering it on an unread session would evict a
  // guide mid-shift over a stalled round trip. Throwing routes page callers to a
  // retry boundary; `drainFwQueue` catches it into its existing UNKNOWN cohort
  // bucket, which retries. Neither one guesses.
  if (read.kind === "unknown") {
    throw new IdentityUnavailableError("resolveFwActorForCohort", read.detail);
  }
  if (read.kind === "none") {
    return {
      session: { userId: "", email: null, grants: [], hasAdminClaim: false },
      cohort: null,
      verdict: { ok: false, reason: "no_session" },
    };
  }
  const session = read.identity;

  // Skip the staff-row read entirely when the claim is absent — the bridge needs
  // both, so a claim-less session can never be promoted by this row. Sequenced
  // after the session by necessity: it is keyed on the session's user id.
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
  | {
      ok: false;
      /**
       * `unavailable` is Unit 5's B4 member and is NOT a refusal about the account —
       * it is "we could not find out". Added to the union rather than folded into
       * `not_staff` so every consumer's exhaustive copy switch is a COMPILE error
       * until it says something different, because "you are not staff" and "we
       * couldn't check" want opposite next actions from the person reading them
       * (stop, versus try again).
       */
      reason: "no_session" | "not_staff" | "unavailable";
    };

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
  const read = await loadFwSessionRead();
  // Returns rather than throws, keeping this file's stated posture: these are Server
  // Actions, and actions return typed refusals. The UNKNOWN is carried in the type
  // (B4) instead of being flattened into `not_staff`, which would tell a staff member
  // their access was revoked because a query was slow.
  if (read.kind === "unknown") return { ok: false, reason: "unavailable" };
  if (read.kind === "none") return { ok: false, reason: "no_session" };
  const session = read.identity;
  if (!session.hasAdminClaim) return { ok: false, reason: "not_staff" };

  // BOUNDED for the same reason as the session read: unguarded, a hung staff-row
  // lookup holds the whole action open. An unreadable row is `unavailable`, never
  // `not_staff` — the row is the ONLY input that can revoke, so failing closed on an
  // unread one is indistinguishable from a genuine revocation to everyone downstream.
  let raced;
  try {
    raced = await withFwTimeout(
      loadStaffRowActive(supabaseAdmin(), session.userId),
      `fw staff row for ${session.userId}`,
      FW_CALL_TIMEOUT_MS
    );
  } catch (e) {
    console.error("[fw/auth] staff row read threw:", e);
    return { ok: false, reason: "unavailable" };
  }
  if (raced.timedOut) return { ok: false, reason: "unavailable" };
  if (!raced.value) return { ok: false, reason: "not_staff" };
  return { ok: true, userId: session.userId };
}

/** Every cohort id this session holds a `guide` grant for — the input
 *  `listFwCohortsForActor` filters against (it re-reads `kind` itself, so a
 *  Path-cohort guide grant here surfaces nothing). */
export function grantedCohortIds(grants: readonly RoleGrant[]): string[] {
  return grants.filter((g) => g.role === "guide" && g.scopeType === "cohort").map((g) => g.scopeId);
}
