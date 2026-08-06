"use server";

/**
 * The dashboard's per-kid credentials + consent Server Actions (plan Unit 8).
 * THIN wrappers: every decision and every sequencing step lives in
 * ../kid-credentials-core.ts (`server-only`, deps-injected). The core's `deps`
 * parameter must never reach the wire — a Server Action's arguments arrive from
 * the client — which is why the injection seam stays in the core module
 * (docs/solutions/best-practices/shared-db-taking-core-must-not-live-in-a-use-
 * server-file-server-action-boundary-2026-07-17.md).
 *
 * ⚠ EXPORTS ARE ACTIONS ONLY. No `export type`, no `export const` — a type
 * re-export from a `"use server"` file still emits `registerServerReference` and
 * throws at module load (docs/solutions/runtime-errors/use-server-type-reexport-
 * registers-server-reference-referenceerror-2026-07-22.md).
 *
 * ── THE ORDER, AND WHY ──
 *   1. SESSION FIRST. `auth.getUser()` verifies the JWT with the auth server;
 *      `getSession()` alone would trust a cookie this process never validated.
 *      A caller with no session is refused before anything else happens — no
 *      rate-limit strike, no privileged client, no read.
 *   2. RATE LIMIT, keyed on the session-derived parent id, recorded atomically.
 *      After authentication because there IS an identity to key on here (unlike
 *      the public cover route, which limits first precisely because there is
 *      not).
 *   3. THE CORE, which proves ownership with a WHERE-clause predicate before it
 *      constructs the service-role client.
 * The `childId` in the argument is an identifier and authorizes nothing. It is
 * never compared against a fetched row — it goes into the WHERE clause beside
 * the session's parent id, so a foreign child returns no row at all.
 *
 * ── THE REFUND RULE (the branch's allowlist idiom) ──
 * Only OUR faults hand the strike back: `outage`, and nothing else. A refused
 * foreign child, a weak password and a malformed body are all real attempts, and
 * refunding a foreign-child probe would make probing free (the
 * refunded-strike-refunds-the-attacker learning, 2026-08-05).
 *
 * ⚠ THE RULE IS NOT WRITTEN HERE THREE TIMES. It is
 * `refundsKidCredentialsStrike`, an EXPLICIT ALLOWLIST in the core (review FIX
 * 3), asserted as a whole set by its test — so an outcome added later is
 * non-refundable by default rather than by whoever remembers to check. Every
 * action below calls that one predicate and none of them names `outage`.
 *
 * ── ONE BUDGET PER ACTION (review FIX 6) ──
 * The three actions carry DISTINCT rate-limit scopes. Sharing one bucket meant
 * looping the password reset also exhausted the withdraw-consent button — and a
 * parent exercising a privacy right must not be refused because of unrelated
 * activity on their own account. See `V3KidActionScope`.
 */

import { headers } from "next/headers";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { supabaseServer } from "@/app/lib/supabase/server";
import { extractClientIp } from "@/app/api/fp/signup/signup-rules";
import { V3_KID_RESET_RATE_LIMIT } from "@/app/lib/fp/rate-limit-rules";
import {
  checkAndRecordRateLimit,
  releaseRateLimitEvent,
} from "@/app/lib/fp/rate-limit-store";
import { deriveV3KidResetRateLimitKey } from "@/app/lib/v3-signup/v3-signup-rules";
import {
  captureLegacyChildConsent,
  KID_RESET_REFUSAL,
  refundsKidCredentialsStrike,
  resetKidPassword,
  revokeChildPhotoConsent,
  type KidCredentialsDeps,
} from "@/app/lib/v3-signup/kid-credentials-core";
import { validateStudentPassword } from "@/app/lib/fp/provision-rules";

function buildDeps(): KidCredentialsDeps {
  return {
    // A FACTORY, not a client: nothing privileged is constructed until the core
    // has a named caller and a well-formed request.
    db: () => supabaseAdmin(),
    setUserPassword: async (userId, password) => {
      const res = await supabaseAdmin().auth.admin.updateUserById(userId, { password });
      if (res.error) {
        console.error(`[fp/kid-reset] updateUserById failed: ${res.error.message}`);
      }
      return { ok: !res.error };
    },
    now: () => Date.now(),
    log: (m) => console.error(m),
  };
}

/** The session-derived caller. Null means "no verified session" — refuse. */
async function caller(): Promise<{ parentId: string; parentEmail: string } | null> {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  const user = data?.user;
  if (!user?.id) return null;
  return { parentId: user.id, parentEmail: user.email ?? "" };
}

export async function resetKidPasswordAction(
  input: unknown
): Promise<{ ok: true } | { ok: false; message: string }> {
  const refusal = { ok: false as const, message: KID_RESET_REFUSAL };
  try {
    const who = await caller();
    if (!who) return refusal;
    const key = deriveV3KidResetRateLimitKey(who.parentId, "password");
    if (!checkAndRecordRateLimit(key, V3_KID_RESET_RATE_LIMIT).allowed) return refusal;

    const outcome = await resetKidPassword(buildDeps(), input, { parentId: who.parentId });
    if (refundsKidCredentialsStrike(outcome)) releaseRateLimitEvent(key);
    if (outcome === "reset") return { ok: true };
    if (outcome === "weak_password") {
      // The ONE refusal that carries a specific message: it is about a value the
      // parent just typed and can fix. Re-derived here WITHOUT the child's name,
      // so this branch cannot become an oracle for whose child it is — the
      // name-overlap rule already ran (and refused) inside the core.
      const password = (input as { password?: unknown } | null)?.password;
      const verdict = validateStudentPassword(
        typeof password === "string" ? password : "",
        {}
      );
      return {
        ok: false,
        message: verdict.ok
          ? "Please choose a password that isn't the child's own name."
          : verdict.error,
      };
    }
    return refusal;
  } catch (err) {
    console.error(
      `[fp/kid-reset] threw: ${err instanceof Error ? err.message : String(err)}`
    );
    return refusal;
  }
}

export async function captureChildConsentAction(
  input: unknown
): Promise<{ ok: true } | { ok: false; message: string }> {
  const refusal = {
    ok: false as const,
    message: "We could not record that just now. Refresh the page and try again.",
  };
  try {
    const who = await caller();
    if (!who) return refusal;
    const key = deriveV3KidResetRateLimitKey(who.parentId, "consent");
    if (!checkAndRecordRateLimit(key, V3_KID_RESET_RATE_LIMIT).allowed) return refusal;

    const body = (input ?? {}) as Record<string, unknown>;
    const childId = body.childId;
    const echoedVersion = body.consentVersion;
    const echoedHash = body.consentHash;
    const band = body.childAgeBand;
    if (
      typeof childId !== "string" ||
      typeof echoedVersion !== "string" ||
      typeof echoedHash !== "string" ||
      (band !== "under_13" && band !== "13_to_15" && band !== "16_plus")
    ) {
      return refusal;
    }

    const h = await headers();
    const outcome = await captureLegacyChildConsent(
      buildDeps(),
      {
        childId,
        echoedVersion,
        echoedHash,
        childAgeBand: band,
        // SERVER-DERIVED identity, never the request body — this is a legal
        // evidence record (recordConsent's own rule, same reason).
        parentEmail: who.parentEmail,
        ip: extractClientIp(h),
        ua: h.get("user-agent") ?? "",
      },
      { parentId: who.parentId }
    );
    if (refundsKidCredentialsStrike(outcome)) releaseRateLimitEvent(key);
    if (outcome === "recorded") return { ok: true };
    if (outcome === "stale_policy") {
      return {
        ok: false,
        message: "The consent notice was updated since this page loaded. Please refresh and read the current version.",
      };
    }
    return refusal;
  } catch (err) {
    console.error(
      `[fp/legacy-consent] threw: ${err instanceof Error ? err.message : String(err)}`
    );
    return refusal;
  }
}

export async function revokeChildConsentAction(
  input: unknown
): Promise<{ ok: true } | { ok: false; message: string }> {
  const refusal = {
    ok: false as const,
    message: "We could not withdraw that just now. Refresh the page and try again.",
  };
  try {
    const who = await caller();
    if (!who) return refusal;
    const key = deriveV3KidResetRateLimitKey(who.parentId, "revoke");
    if (!checkAndRecordRateLimit(key, V3_KID_RESET_RATE_LIMIT).allowed) return refusal;

    const outcome = await revokeChildPhotoConsent(buildDeps(), input, {
      parentId: who.parentId,
    });
    if (refundsKidCredentialsStrike(outcome)) releaseRateLimitEvent(key);
    if (outcome === "revoked") return { ok: true };
    return refusal;
  } catch (err) {
    console.error(
      `[fp/consent-revoke] threw: ${err instanceof Error ? err.message : String(err)}`
    );
    return refusal;
  }
}
