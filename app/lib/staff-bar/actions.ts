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
 * Both actions read only the CALLER's own session and act only on it, so there is no
 * authorization decision here to get wrong: signed out is the one refusal.
 */

import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { supabaseServer } from "@/app/lib/supabase/server";
import { grantedCohortIds, loadFwSession } from "@/app/fp/lib/fw-auth";
import { loadStaffRowActive } from "@/app/fp/lib/fw-guide-core";
import {
  STAFF_BAR_APPLICATIONS,
  staffBarSignOutDestination,
  type StaffBarApplication,
  type StaffBarIdentity,
} from "./bar-rules";

export type StaffBarIdentityResult =
  | { ok: true; identity: StaffBarIdentity }
  /** No session, or the read failed. The bar keeps its persisted copy and its
   *  sign-out control either way — R23. */
  | { ok: false };

/**
 * Who is signed in, as the bar needs to say it (R17) — plus the two role facts every
 * other decision in `bar-rules.ts` keys on.
 *
 * `isFwGuide` is load-bearing beyond the chrome: it is the SERVER-KNOWN half of the
 * sign-out evidence gate (B1), the signal that stops a device whose localStorage was
 * evicted from skipping its own queue check. It is computed from grants rather than
 * inferred from anything on the device, which is the entire point.
 *
 * `loadFwSession()` is reused rather than re-querying: it already resolves the user,
 * the grants and the admin claim, it is request-memoized, and a second grant-shape
 * parser here would be the "two predicates that must agree" defect Unit 1 shipped to
 * remove. It does not carry the email, so that comes from the auth user it read.
 */
export async function loadStaffBarIdentity(): Promise<StaffBarIdentityResult> {
  const session = await loadFwSession();
  if (!session) return { ok: false };

  const {
    data: { user },
  } = await (await supabaseServer()).auth.getUser();
  const email = user?.email ?? null;
  if (!email) return { ok: false };

  // Skipped entirely without the claim — the staff bridge needs both, so a
  // claim-less session can never be promoted by the row (`resolveFwActorForCohort`'s
  // rule, not a second one).
  const isStaff = session.hasAdminClaim
    ? await loadStaffRowActive(supabaseAdmin(), session.userId)
    : false;

  return {
    ok: true,
    identity: {
      userId: session.userId,
      email,
      isStaff,
      isFwGuide: grantedCohortIds(session.grants).length > 0,
    },
  };
}

/**
 * End the session and land the account where R22 says it belongs.
 *
 * The DESTINATION is decided here, server-side, from `staffBarSignOutDestination` —
 * the same pure function the bar renders against. `application` arrives from the
 * client and is therefore untrusted, so it is narrowed to the literal union before
 * use; every value it can take maps to one of two hard-coded paths, so there is no
 * open redirect to construct. It is only a tiebreak anyway: it is consulted just when
 * the account's own roles cannot be resolved.
 *
 * This action REDIRECTS, which Next implements by throwing. Callers must let that
 * throw propagate — see `StaffBar.tsx`'s `isNextRedirect` check.
 */
export async function signOutStaffBar(application: unknown): Promise<void> {
  const surface = narrowStaffBarApplication(application);
  const session = await loadFwSession();
  const isStaff =
    session?.hasAdminClaim === true
      ? await loadStaffRowActive(supabaseAdmin(), session.userId)
      : false;

  const destination = staffBarSignOutDestination({
    identity:
      session === null
        ? null
        : { isStaff, isFwGuide: grantedCohortIds(session.grants).length > 0 },
    application: surface,
  });

  await (await supabaseServer()).auth.signOut();
  redirect(destination);
}

/** Narrow an untrusted surface hint, defaulting to the hub — the safest of the three,
 *  because it is the one that gates hardest on the way back in. */
function narrowStaffBarApplication(value: unknown): StaffBarApplication {
  return STAFF_BAR_APPLICATIONS.includes(value as StaffBarApplication)
    ? (value as StaffBarApplication)
    : "staff";
}
