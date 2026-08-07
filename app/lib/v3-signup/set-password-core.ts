import "server-only";

/**
 * THE CONVERTED-FUNNEL-PARENT SET-PASSWORD CORE (plan Unit 8; review FIX 4/5a).
 *
 * `server-only`, deps-injected, deliberately NOT `"use server"` — a core with a
 * `deps` parameter may never live in a file whose every export is
 * client-callable (docs/solutions/best-practices/shared-db-taking-core-must-not-
 * live-in-a-use-server-file-server-action-boundary-2026-07-17.md). The thin
 * action lives in ./actions/set-password.ts, mirroring kid-credentials-core.ts.
 *
 * ── WHY THERE IS NO USER ID PARAMETER ──
 * The caller's id arrives in `ctx`, read from the verified session by the
 * action. There is nothing in `input` that names an account, which is the
 * strongest form of "verify the caller owns the target": make the target
 * unnameable.
 *
 * ── ⚠ THE ELIGIBILITY CHECK IS HERE, NOT ONLY ON THE PAGE (review FIX 4) ──
 * `/set-password`'s page gate is a routing courtesy. A Server Action is a
 * separately-addressable POST endpoint and no page render stands in front of
 * it, so before this fix an ALREADY-CONVERTED parent — including every
 * beta-cohort parent, who chose a real password at `verifyCompletion` long
 * before the `password_chosen` stamp existed — could call the action directly
 * and silently overwrite their own working password. No cross-account harm, but
 * a self-inflicted lockout is still a lockout.
 *
 * The scope is `needsSetPasswordStep` — the SAME predicate the remap and the
 * page use, not a weaker echo of it. `!passwordChosen` alone would NOT have
 * closed the beta-cohort hole, because that cohort predates the stamp; it is
 * the `hasFpChild` disjunct that recognizes them. One predicate, three callers.
 *
 * This is a ONE-TIME CONVERSION STEP, not a general "change my password"
 * feature. If self-service password change is wanted it is a product decision
 * with its own requirements (current-password re-authentication, a session
 * sweep, notification mail) and it does not belong on this endpoint.
 */

import {
  hasChosenPassword,
  isFunnelProvisioned,
  PASSWORD_CHOSEN_METADATA_KEY,
} from "@/app/lib/funnel/resume-rules";
import { needsSetPasswordStep } from "./remap-rules";

/** Same floor the v3 parent step's own password field enforces (zod min 8). */
export const MIN_PARENT_PASSWORD = 8;
/** The upper bound every password field in this codebase carries: long enough
 *  for any passphrase, short enough that a hash is never a DoS. */
export const MAX_PARENT_PASSWORD = 200;

export type SetPasswordOutcome =
  | "set"
  /** Not a string, or outside the length bounds. */
  | "weak_password"
  /** The caller does not need this one-time step (review FIX 4). */
  | "not_eligible"
  /** Our side failed — the metadata read or the write. */
  | "outage";

/**
 * WHICH OUTCOMES HAND THE RATE-LIMIT STRIKE BACK — an ALLOWLIST asserted as a
 * whole set, the same idiom as `KID_CREDENTIALS_REFUNDED_OUTCOMES`,
 * `COVER_REFUNDED_REFUSALS` and `HANDOFF_REFUNDED_REFUSALS` (review FIX 3).
 * Only our faults. A too-short password and a call from a parent who does not
 * need this step are both real attempts and keep their strike.
 */
export const SET_PASSWORD_OUTCOMES: readonly SetPasswordOutcome[] = [
  "set",
  "weak_password",
  "not_eligible",
  "outage",
];

export const SET_PASSWORD_REFUNDED_OUTCOMES: readonly SetPasswordOutcome[] = ["outage"];

export const refundsSetPasswordStrike = (outcome: SetPasswordOutcome): boolean =>
  SET_PASSWORD_REFUNDED_OUTCOMES.includes(outcome);

export type SetPasswordDeps = {
  /**
   * Does ANY child of this parent hold a First Profit account? The third
   * `needsSetPasswordStep` condition, and the one that recognizes the beta
   * cohort. `null` = the read failed, which must NOT be read as "no FP child":
   * that would admit precisely the cohort this check protects. It is an
   * `outage`.
   */
  familyHasFpChild: (parentId: string) => Promise<boolean | null>;
  /** `auth.admin.updateUserById` — the password and the durable stamp written
   *  in ONE call, so the flag can never claim a password that was not set. */
  setPasswordAndStamp: (
    userId: string,
    password: string,
    stampKey: string
  ) => Promise<{ ok: boolean }>;
  log: (message: string) => void;
};

export type SetPasswordCaller = {
  userId: string;
  /** The session user's `app_metadata`, verbatim. */
  appMetadata: Record<string, unknown> | null;
};

export async function setParentPassword(
  deps: SetPasswordDeps,
  input: unknown,
  ctx: SetPasswordCaller
): Promise<SetPasswordOutcome> {
  const password = (input as { password?: unknown } | null)?.password;
  // Validate BEFORE the eligibility read: a malformed body must cost no
  // database round-trip, and refusing it reveals nothing (the caller already
  // knows what they sent).
  if (
    typeof password !== "string" ||
    password.length < MIN_PARENT_PASSWORD ||
    password.length > MAX_PARENT_PASSWORD
  ) {
    return "weak_password";
  }

  const funnelStamped = isFunnelProvisioned(ctx.appMetadata);
  const passwordChosen = hasChosenPassword(ctx.appMetadata);
  // Short-circuit the read when the metadata alone already settles it: a parent
  // who has chosen a password, or who was never funnel-provisioned, is
  // ineligible whatever their roster says.
  if (!funnelStamped || passwordChosen) return "not_eligible";

  const hasFpChild = await deps.familyHasFpChild(ctx.userId);
  if (hasFpChild === null) {
    deps.log(`[fp/set-password] fp-child read failed for ${ctx.userId} — refusing`);
    return "outage";
  }
  if (!needsSetPasswordStep({ funnelStamped, passwordChosen, hasFpChild })) {
    return "not_eligible";
  }

  const written = await deps.setPasswordAndStamp(
    ctx.userId,
    password,
    PASSWORD_CHOSEN_METADATA_KEY
  );
  // A FAILED WRITE IS NEVER REPORTED AS SUCCESS. The family would navigate on
  // and meet a sign-in form for a password that was never set — the exact
  // lockout this whole step exists to prevent (the reported-success-vs-verified-
  // outcome learning, 2026-07-24).
  if (!written.ok) return "outage";
  return "set";
}
