"use server";

/**
 * The staff bar's two Server Actions (Staff Front Door Unit 3).
 *
 * WHY THESE ARE ACTIONS AND NOT PROPS. The plan's settled decision: identity and
 * every role-derived branch render CLIENT-side. `/fp/fw` navigations are cached into
 * `path-sw-fw-shell-v1`, and props passed to a client component are serialized into
 * that cached payload — so a bar whose email and staff-ness arrived as props would
 * leave a cached shell that differs between a staff and a non-staff visit, handing
 * the next holder of a shared iPad the previous operator's address and role. A POST
 * to a Server Action is never in that cache. The bar receives from the server only
 * its application and an opaque actor id, which `FwPwa` already passes on the same
 * surfaces and which reveals no role.
 *
 * THE COST THAT BUYS, STATED RATHER THAN HIDDEN. A Server Action is a separate
 * request from the render that preceded it, so React's `cache()` memoization cannot
 * span the two: `requireStaff()`'s Unit-2 memoization saves nothing here, and this
 * action re-pays a session load (and, for staff, a `staff`-row read) that the page's
 * own gate paid moments earlier. That duplication is the price of keeping identity
 * out of the cached shell, and it is accepted deliberately. What is NOT accepted is
 * paying it twice over: `loadFwSession()` already resolves the auth user, so its
 * email is carried on `FwSession` rather than fetched by a second `getUser()`.
 *
 * Both actions read only the CALLER's own session and act only on it, so there is no
 * authorization decision here to get wrong: signed out is the one refusal.
 */

import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { supabaseServer } from "@/app/lib/supabase/server";
import { FW_CALL_TIMEOUT_MS, withFwTimeout } from "@/app/fp/lib/fw-call";
import { grantedCohortIds, loadFwSession, type FwSession } from "@/app/fp/lib/fw-auth";
import { loadStaffRowActive } from "@/app/fp/lib/fw-guide-core";
import {
  narrowStaffBarApplication,
  staffBarSignOutDestination,
  type StaffBarIdentity,
  type StaffBarRoles,
} from "./bar-rules";

export type StaffBarIdentityResult =
  | { ok: true; identity: StaffBarIdentity }
  /** No session, or the read failed. The bar keeps its persisted copy and its
   *  sign-out control either way — R23. */
  | { ok: false };

/**
 * The two role facts, resolved ONCE.
 *
 * Both actions need them and both used to derive them inline, which made this the
 * third hand-written copy of `hasAdminClaim ? loadStaffRowActive(…) : false` in the
 * repo — the exact "two predicates that must agree" shape Unit 1 shipped to remove.
 * If they ever disagreed, the bar would render one account's affordances and sign-out
 * would land at the other's door.
 *
 * The staff-row read is skipped entirely without the claim: the FW-D3 bridge needs
 * both, so a claim-less session can never be promoted by the row (`fw-auth.ts`'s
 * rule, not a second one). BOUNDED, because a hung staff-row read would otherwise
 * leave the bar's sign-out button disabled on "Checking…" indefinitely; a timeout
 * degrades to the least-privileged answer, which is also the fail-closed one.
 */
async function resolveStaffBarRoles(session: FwSession | null): Promise<StaffBarRoles> {
  if (session === null) return { isStaff: false, isFwGuide: false };
  const isFwGuide = grantedCohortIds(session.grants).length > 0;
  if (!session.hasAdminClaim) return { isStaff: false, isFwGuide };

  const raced = await withFwTimeout(
    loadStaffRowActive(supabaseAdmin(), session.userId),
    "staff row read",
    FW_CALL_TIMEOUT_MS
  );
  return { isStaff: raced.timedOut ? false : raced.value, isFwGuide };
}

/**
 * Who is signed in, as the bar needs to say it (R17) — plus the two role facts every
 * other decision in `bar-rules.ts` keys on.
 *
 * `isFwGuide` is load-bearing beyond the chrome: it is the SERVER-KNOWN half of the
 * sign-out evidence gate (B1), the signal that stops a device whose localStorage was
 * evicted from skipping its own queue check. It is computed from grants rather than
 * inferred from anything on the device, which is the entire point.
 */
export async function loadStaffBarIdentity(): Promise<StaffBarIdentityResult> {
  const session = await loadFwSession();
  if (!session?.email) return { ok: false };
  const roles = await resolveStaffBarRoles(session);
  return {
    ok: true,
    identity: { userId: session.userId, email: session.email, ...roles },
  };
}

/**
 * End the session and land the account where R22 says it belongs.
 *
 * The DESTINATION is decided here, server-side, from `staffBarSignOutDestination` —
 * the same pure function the bar renders against. `application` arrives from the
 * client and is therefore untrusted, so it goes through `narrowStaffBarApplication`
 * (pure and tested in `bar-rules.ts`) before use; every value it can take maps to one
 * of two hard-coded paths, so there is no open redirect to construct. It is only a
 * tiebreak anyway: it is consulted just when the account's own roles cannot be
 * resolved.
 *
 * ORDERING NOTE, recorded because a reviewer traced it: the client has already run
 * its local residue clear by the time it calls this. If the sign-out below fails, the
 * operator is still authenticated but their offline roster and shell caches are gone.
 * Nothing is LOST by that — the clear only runs once the queue is verifiably drained,
 * so no capture is at stake, and both caches rebuild on the next online render. The
 * client's failure copy says so rather than implying the device is unchanged.
 *
 * This action REDIRECTS, which Next implements by throwing. Callers must let that
 * throw propagate — see `StaffBar.tsx`'s `isNextRedirect` check.
 */
export async function signOutStaffBar(application: unknown): Promise<void> {
  const surface = narrowStaffBarApplication(application);
  const session = await loadFwSession();
  const destination = staffBarSignOutDestination({
    identity: session === null ? null : await resolveStaffBarRoles(session),
    application: surface,
  });

  // NOT bounded. Everything above degrades safely on a timeout, but this call IS the
  // sign-out: giving up on waiting would hand back a redirect while the session was
  // still alive, which is the one outcome this whole unit exists to prevent.
  await (await supabaseServer()).auth.signOut();
  redirect(destination);
}
