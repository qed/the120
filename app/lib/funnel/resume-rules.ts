/**
 * Resume-link decisions (funnel U3; R6, R7, R7a–R7d) — every judgment the
 * return path makes, pure and tested. The action (`actions/resume.ts`) is a
 * thin shell over these; `environment: "node"` means anything living in the
 * action is untestable.
 */

/**
 * Token TTL: 60 minutes. "Short" (R7) but wide enough for mail delivery lag
 * and a cross-device hop (open on the phone, finish on the laptop). An
 * expired landing renders a resend affordance, not a dead end, so the cost
 * of expiry is one click.
 */
export const RESUME_TOKEN_TTL_MS = 60 * 60_000;

/**
 * R7d bounds. Keys are `${ip}:${email}` for the precise limit and `${ip}`
 * for the coarse backstop (varying the email every request would otherwise
 * mint a fresh bucket each time — the documented bucket-eviction shape).
 * Values follow the fp sign-in precedent: tight per-target, generous per-IP
 * so a family behind one NAT never trips it.
 */
export type FunnelRateLimit = { windowMs: number; limit: number };
export const RESUME_REQUEST_RATE_LIMIT: FunnelRateLimit = { windowMs: 15 * 60_000, limit: 3 };
export const RESUME_REQUEST_IP_RATE_LIMIT: FunnelRateLimit = { windowMs: 15 * 60_000, limit: 20 };

/**
 * INSERT-THEN-COUNT verdict: the caller records its attempt row FIRST, then
 * counts the window INCLUDING its own row. Denied once the count EXCEEDS the
 * limit — with limit 3, the 4th in-window attempt sees count 4 > 3 and is
 * refused. Two concurrent racers at the boundary each count the other's
 * committed row: both see over-limit and both fail closed — the
 * count-then-insert TOCTOU (both see 2, both pass) cannot happen. A
 * non-positive limit denies everything (fail closed on bad config).
 */
export function rateCountVerdict(countIncludingSelf: number, cfg: FunnelRateLimit): boolean {
  if (cfg.limit <= 0) return false;
  return countIncludingSelf <= cfg.limit;
}

/**
 * R7c: the request-a-link response is BYTE-IDENTICAL whether the address
 * exists, does not exist, or was rate-limited — an enumeration oracle here
 * leaks which families have applied to a program for children. One constant,
 * exported so the action and its tests assert identity, not resemblance.
 */
export const REQUEST_LINK_RESPONSE =
  "If that address has an application with us, a sign-in link is on its way. It lasts an hour.";

/** One stored token row, reduced to what the verdict needs. */
export type ResumeTokenRecord = {
  expiresAt: string; // ISO
  redeemedAt: string | null;
};

export type ResumeVerdict =
  | { ok: true }
  | { ok: false; reason: "not_found" | "expired" | "redeemed" };

/**
 * Validity of a presented token. Order matters and is pinned by test:
 * `redeemed` is checked before `expired`, so a link that was used and then
 * aged past its TTL still reports the truthful "already used" — telling a
 * family their link expired when it was in fact redeemed (possibly not by
 * them) would hide the one signal worth surfacing.
 */
export function resumeVerdict(row: ResumeTokenRecord | null, nowMs: number): ResumeVerdict {
  if (!row) return { ok: false, reason: "not_found" };
  if (row.redeemedAt !== null) return { ok: false, reason: "redeemed" };
  if (nowMs >= Date.parse(row.expiresAt)) return { ok: false, reason: "expired" };
  return { ok: true };
}

/**
 * The matrix's `hasPassword` bit, from the redeemed session's user record.
 * `account.ts` stamps `app_metadata.funnel = true` on every account IT
 * creates; anything without the stamp (AccountModal signups, invite.ts
 * parents, staff) chose its own password. Reading the flag — not guessing
 * from children shapes — keeps the bit truthful for a password family that
 * later enters the funnel.
 */
export function isFunnelProvisioned(appMetadata: Record<string, unknown> | null | undefined): boolean {
  return appMetadata?.funnel === true;
}

/** The app_metadata key v3 stamps when a parent's OWN chosen password is set. */
export const PASSWORD_CHOSEN_METADATA_KEY = "password_chosen";

/**
 * Did this parent ever type a password we then set on their account? (plan Unit
 * 8, the converted-funnel-parent step.)
 *
 * A DURABLE STAMP, not an inference. `isFunnelProvisioned` cannot answer this:
 * it is true for a v2 capture account holding a random never-disclosed password
 * AND for a v3 parent who typed one at the verify step thirty seconds ago. The
 * stamp is written by v3's `setParentPassword` in the same call that sets the
 * password, so it can never claim a password that was not set.
 *
 * Absent means "we do not know", and every consumer treats that conservatively:
 * `needsSetPasswordStep` additionally requires the family to have NO First
 * Profit child, which excludes the pre-stamp cohorts (the beta families and
 * anyone provisioned through the FP HTTP door, who all chose real passwords at
 * `verifyCompletion`) from being asked for a password they already have.
 */
export function hasChosenPassword(
  appMetadata: Record<string, unknown> | null | undefined
): boolean {
  return appMetadata?.[PASSWORD_CHOSEN_METADATA_KEY] === true;
}
