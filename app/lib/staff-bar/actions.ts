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
 * paying it twice over: `loadFwSessionRead()` already resolves the auth user, so its
 * email is carried on `FwSession` rather than fetched by a second `getUser()`.
 *
 * Both actions read only the CALLER's own session and act only on it, so there is no
 * authorization decision here to get wrong: signed out is the one refusal.
 */

import { redirect } from "next/navigation";
import { z } from "zod";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { supabaseServer } from "@/app/lib/supabase/server";
import { FW_CALL_TIMEOUT_MS, fwWrite, withFwTimeout } from "@/app/fp/lib/fw-call";
import { grantedCohortIds, loadFwSessionRead, type FwSession } from "@/app/fp/lib/fw-auth";
import { loadStaffRowActive } from "@/app/fp/lib/fw-guide-core";
import type { FwResidueBeacon } from "@/app/fp/lib/fw-sync-rules";
import {
  narrowStaffBarApplication,
  staffBarSignOutDestination,
  type StaffBarIdentity,
  type StaffBarRoles,
} from "./bar-rules";

/**
 * The beacon's wire shape. Mirrors `FwResidueBeacon` but is re-declared as a zod
 * schema rather than derived from the type, because this is a `"use server"` boundary:
 * the payload arrives over HTTP from a client that may be running an older bundle, so
 * it is narrowed at the door like every other action's input. `actorUserId` is
 * deliberately ABSENT as an attribution — the session names the sender; the client's
 * claim rides alongside as `claimedActorUserId`. See `sendFwResidueBeacon`.
 */
const residueBeaconSchema = z.object({
  schemaVersion: z.literal(1),
  outcome: z.enum(["queue_preserved", "clear_failed"]),
  queueRemaining: z.number().int().min(0).max(100_000).nullable(),
  application: z.enum(["fw", "crm", "staff"]),
  /**
   * The actor the CLIENT observed the outcome for — carried as a CLAIM, not as the
   * attribution. A handover can complete between the client detecting the outcome
   * and this POST landing, at which point the live session names the NEW holder
   * while the outcome belonged to the old one (frontend-races review). Logging both
   * ids makes that race visible instead of silently mis-attributing; constrained to
   * a uuid so nothing free-text can ride into the log line.
   */
  claimedActorUserId: z.uuid(),
  /**
   * A random, client-persisted device identifier — the field the beacon's own
   * purpose ("which iPad?") requires, since one guide account can hold several
   * devices across a weekend. Not identifying beyond this app's own localStorage;
   * carries no hardware fact.
   */
  deviceId: z.uuid(),
});

/** Compile-time drift tripwire: the schema and the pure payload type must move
 *  together. Narrowing or widening either side turns this assignment red. */
type _BeaconSchemaMatches =
  Omit<z.infer<typeof residueBeaconSchema>, "claimedActorUserId" | "deviceId" | "schemaVersion"> extends Omit<FwResidueBeacon, "actorUserId">
    ? Omit<FwResidueBeacon, "actorUserId"> extends Omit<z.infer<typeof residueBeaconSchema>, "claimedActorUserId" | "deviceId" | "schemaVersion">
      ? true
      : never
    : never;
const _beaconSchemaMatches: _BeaconSchemaMatches = true;
void _beaconSchemaMatches;

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
  // Every non-answer collapses to `{ok:false}` HERE, and that is correct precisely
  // because of what `{ok:false}` means on this one surface: R23 keeps the sign-out
  // control rendered unconditionally and the bar falls back to its persisted copy of
  // the identity string. Nothing is refused and nothing is destroyed — the only
  // casualty is a line of chrome. This is the ONE B4 call site where folding
  // `unknown` into "no answer" is not a guess about the account, and the reason it is
  // safe is a property of the caller, not of the read. Do not copy this collapse to a
  // call site that acts on the result.
  const read = await loadFwSessionRead();
  if (read.kind !== "identity") return { ok: false };
  const session = read.identity;
  // An account with no email cannot satisfy R17 (the bar names the ACCOUNT, and the
  // email is all the schema holds), so it degrades exactly like an unresolved read.
  const email = session.email;
  if (email === null) return { ok: false };
  const roles = await resolveStaffBarRoles(session);
  return {
    ok: true,
    identity: { userId: session.userId, email, ...roles },
  };
}

/**
 * Report, OFF-DEVICE, that this iPad finished a handover (or was refused mid-sign-out)
 * still holding
 * work — Staff Front Door Unit 5, Peter's decision of 2026-07-27.
 *
 * ── Why this exists
 *
 * Unit 4 stopped a departed guide's un-landed captures from refusing an unrelated
 * person's sign-out, and Unit 5 did the same for records this build cannot read. Both
 * were right, and both removed the same accidental safeguard: a refusal forced a HUMAN
 * to notice. What remains on-device is the bar's queue chip — one device, one viewer,
 * after identity resolves. Nothing at a desk could answer "which iPads are holding
 * check-ins that never reached us?"
 *
 * ⚠️ WHAT THIS IS AND IS NOT, IN ONE LINE EACH.
 *   - It is a structured server-side LOG LINE, greppable by `[fw/residue]`.
 *   - It is NOT a table, and cannot be this unit: writing one needs a migration, Lane
 *     A does not hold the migration lock (`supabase/MIGRATION-LOCK.md` names Lane B),
 *     and this repo's standing rule is that authoring a migration IS applying it to
 *     production. The persistent store is carried to Unit 6, which is the migration
 *     unit. Until then "a place to read it" means the deployment's runtime logs.
 *   - It is NOT recovery. The captures still cannot be shipped by anyone but the
 *     account that made them. This locates the device; a human does the rest.
 *
 * ── Why it is fire-and-forget and cannot fail a sign-out
 *
 * Every caller invokes it with `void` and it swallows its own errors. A beacon that
 * could reject would be a new way for a sign-out to fail on venue wifi — adding a
 * failure mode to the sequence whose failure modes this whole unit exists to reduce.
 * Bounded for the same reason: it runs on the client's path, and an unbounded await
 * would hold the sign-out open on a stalled link.
 *
 * The PAYLOAD DECISION is `fwResidueBeacon` (pure, tested), not this function. This
 * one is the transport, and re-derives nothing but the authenticated sender.
 */
export async function sendFwResidueBeacon(input: unknown): Promise<void> {
  const parsed = residueBeaconSchema.safeParse(input);
  if (!parsed.success) {
    console.error("[fw/residue] refused a malformed beacon");
    return;
  }
  // The AUTHENTICATED identity — one bounded getUser(), NOT the full session read.
  // The grants query that loadFwSessionRead also makes exists to compute isFwGuide,
  // which nothing in a log line needs; paying a second Supabase round trip per
  // beacon on the COMMON handover path was the performance review's finding.
  let raced;
  try {
    raced = await withFwTimeout((await supabaseServer()).auth.getUser(), "residue beacon getUser", FW_CALL_TIMEOUT_MS);
  } catch (e) {
    console.error("[fw/residue] dropped a beacon: getUser threw:", e);
    return;
  }
  const sessionUser = raced.timedOut ? null : raced.value.data.user;
  if (sessionUser === null) {
    // No resolvable session, nothing safe to attribute. The CLAIMED id alone is not
    // enough — an unauthenticated endpoint that records whatever account id it is
    // handed is an invitation to attribute residue to an arbitrary account.
    console.error("[fw/residue] dropped a beacon with no resolvable session");
    return;
  }
  // THE DURABLE ROW (Unit 6 — the table Peter approved once Lane A held the lock).
  // Written through `fwWrite` (bounded + throw-guarded), and NON-FATAL on failure:
  // the log line below is the Unit 5 fallback and still always emits, so an insert
  // that fails degrades to exactly the pre-table behaviour rather than costing the
  // report entirely. The insert failure is logged with its own prefix so a broken
  // table is visible without breaking a single sign-out.
  const inserted = await fwWrite(
    () =>
      supabaseAdmin()
        .from("path_fw_residue_reports")
        .insert({
          schema_version: parsed.data.schemaVersion,
          outcome: parsed.data.outcome,
          queue_remaining: parsed.data.queueRemaining,
          session_user_id: sessionUser.id,
          claimed_actor_user_id: parsed.data.claimedActorUserId,
          device_id: parsed.data.deviceId,
          application: parsed.data.application,
        })
        .select("id")
        .maybeSingle(),
    "residue report insert"
  );
  if (inserted.error) {
    console.error(`[fw/residue] durable insert failed (log line still emitted): ${inserted.error.message}`);
  }

  // ONE LINE, one JSON object, stable keys — parseable, not prose. `sessionUserId`
  // is WHO SENT THIS (authenticated); `claimedActorUserId` is who the device says
  // the outcome happened under. They differ exactly when a handover raced the POST,
  // and logging both is what makes that race a visible fact instead of a silent
  // misattribution (frontend-races review). console.log, not console.error: this is
  // routine telemetry on a successful path, and error-level would teach every
  // severity-based alert to ignore the [fw/residue] prefix (agent-native review).
  console.log(
    `[fw/residue] ${JSON.stringify({
      schemaVersion: parsed.data.schemaVersion,
      outcome: parsed.data.outcome,
      queueRemaining: parsed.data.queueRemaining,
      sessionUserId: sessionUser.id,
      claimedActorUserId: parsed.data.claimedActorUserId,
      deviceId: parsed.data.deviceId,
      application: parsed.data.application,
      at: new Date().toISOString(),
    })}`
  );
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
  // An unreadable session degrades to the application tiebreak, exactly as a
  // session-less one does. NOT a B4 exception: sign-out is the action that must never
  // be blocked by a slow read (R23), and the only thing the session buys here is which
  // of two hard-coded doors to land on. Failing to resolve it picks the door by the
  // surface the operator was standing on — which is where they came from.
  const read = await loadFwSessionRead();
  const destination = staffBarSignOutDestination({
    identity: read.kind === "identity" ? await resolveStaffBarRoles(read.identity) : null,
    application: surface,
  });

  // NOT bounded. Everything above degrades safely on a timeout, but this call IS the
  // sign-out: giving up on waiting would hand back a redirect while the session was
  // still alive, which is the one outcome this whole unit exists to prevent.
  await (await supabaseServer()).auth.signOut();
  redirect(destination);
}
