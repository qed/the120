"use server";

/**
 * THE CONSENT WALL's two Server Actions (founder, 2026-08-10).
 *
 * THIN wrappers: every decision and every sequencing step lives in
 * @/app/lib/funnel/consent-wall-core (`server-only`, deps-injected). The core's
 * `deps` parameter must never reach the wire — a Server Action's arguments
 * arrive from the client (docs/solutions/best-practices/shared-db-taking-core-
 * must-not-live-in-a-use-server-file-server-action-boundary-2026-07-17.md).
 *
 * ⚠ EXPORTS ARE ACTIONS ONLY. No `export type`, no `export const` — a type
 * re-export from a `"use server"` file still emits `registerServerReference` and
 * throws at module load (docs/solutions/runtime-errors/use-server-type-reexport-
 * registers-server-reference-referenceerror-2026-07-22.md).
 *
 * ── THE ORDER, AND WHY (the house order) ──
 *   1. SESSION FIRST. `auth.getUser()` verifies the JWT with the auth server;
 *      `getSession()` alone would trust a cookie this process never validated.
 *      Neither action takes a parent id, a child id, or anything else that
 *      names a target — the target is unnameable, which is the strongest form
 *      of "the caller owns what they are touching".
 *   2. RATE LIMIT, keyed on the session-derived parent id, in its OWN scope
 *      (`consent-wall`) — a parent who spent the per-kid consent budget must
 *      still be able to answer the wall that is blocking their whole dashboard.
 *   3. THE CORE.
 *
 * ⚠ NEITHER ACTION CALLS `requireConsentClear`. They are the only two endpoints
 * in the app that a parent who OWES a decision is supposed to reach; gating them
 * on being clear would make the wall unanswerable.
 */

import { headers } from "next/headers";
import { extractClientIp } from "@/app/api/fp/signup/signup-rules";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { V3_KID_RESET_RATE_LIMIT } from "@/app/lib/fp/rate-limit-rules";
import { checkAndRecordRateLimit } from "@/app/lib/fp/rate-limit-store";
import { deriveV3KidResetRateLimitKey } from "@/app/lib/v3-signup/v3-signup-rules";
import {
  consentWallCallerFromSession,
  realConsentWallDeps,
  recordConsentWallAcceptance,
  recordConsentWallDecline,
} from "@/app/lib/funnel/consent-wall-core";
import type { KidCredentialsDeps } from "@/app/lib/v3-signup/kid-credentials-core";

const ACCEPT_REFUSAL =
  "We could not record that just now. Refresh the page and try again.";
const DECLINE_REFUSAL =
  "We could not record that just now. Refresh the page and try again.";

/**
 * The deps `captureLegacyChildConsent` needs. `setUserPassword` is present only
 * because the shared deps bundle carries it; this path must NEVER touch a
 * credential, so it throws rather than being a no-op — a silent no-op would let
 * a future edit call it and notice nothing.
 */
function buildKidDeps(): KidCredentialsDeps {
  return {
    db: () => supabaseAdmin(),
    setUserPassword: async () => {
      throw new Error("the consent wall must never set a password");
    },
    now: () => Date.now(),
    log: (m) => console.error(m),
  };
}

export async function acceptConsentWallAction(): Promise<
  { ok: true } | { ok: false; message: string }
> {
  try {
    const who = await consentWallCallerFromSession();
    if (!who) return { ok: false, message: ACCEPT_REFUSAL };
    const key = deriveV3KidResetRateLimitKey(who.parentId, "consent-wall");
    if (!checkAndRecordRateLimit(key, V3_KID_RESET_RATE_LIMIT).allowed) {
      return { ok: false, message: ACCEPT_REFUSAL };
    }

    const h = await headers();
    const outcome = await recordConsentWallAcceptance(
      buildKidDeps(),
      realConsentWallDeps(),
      {
        parentId: who.parentId,
        // SERVER-DERIVED identity, never the request body — this is a legal
        // evidence record (recordConsent's own rule, same reason).
        parentEmail: who.parentEmail,
        ip: extractClientIp(h),
        ua: h.get("user-agent") ?? "",
      }
    );
    // `nothing_owed` answers OK on purpose: it is what a replay of a successful
    // accept looks like, and an idempotent endpoint reports the state it
    // guarantees, not the rows it happened to write this time.
    if (outcome === "recorded" || outcome === "nothing_owed") return { ok: true };
    return { ok: false, message: ACCEPT_REFUSAL };
  } catch (err) {
    console.error(
      `[fp/consent-wall] accept threw: ${err instanceof Error ? err.message : String(err)}`
    );
    return { ok: false, message: ACCEPT_REFUSAL };
  }
}

/**
 * ⚠ STRICTLY NON-DESTRUCTIVE. See `recordConsentWallDecline`: this deletes
 * nothing, disables nothing and revokes nothing. It records that the parent was
 * asked and refused, and leaves them on the wall with a "contact The 120"
 * message, because the next step is a human conversation and not an automated
 * teardown of a child's work.
 */
export async function declineConsentWallAction(): Promise<
  { ok: true } | { ok: false; message: string }
> {
  try {
    const who = await consentWallCallerFromSession();
    if (!who) return { ok: false, message: DECLINE_REFUSAL };
    const key = deriveV3KidResetRateLimitKey(who.parentId, "consent-wall");
    if (!checkAndRecordRateLimit(key, V3_KID_RESET_RATE_LIMIT).allowed) {
      return { ok: false, message: DECLINE_REFUSAL };
    }

    const outcome = await recordConsentWallDecline(
      realConsentWallDeps(),
      async (userId, patch) => {
        // A MERGE, not a replacement: Supabase merges the supplied
        // app_metadata keys, so no existing stamp (`password_chosen`, `role`,
        // `funnel`) is dropped by recording a refusal.
        const res = await supabaseAdmin().auth.admin.updateUserById(userId, {
          app_metadata: patch,
        });
        if (res.error) {
          console.error(`[fp/consent-wall] decline stamp failed: ${res.error.message}`);
        }
        return { ok: !res.error };
      },
      { parentId: who.parentId }
    );
    if (outcome === "recorded") return { ok: true };
    return { ok: false, message: DECLINE_REFUSAL };
  } catch (err) {
    console.error(
      `[fp/consent-wall] decline threw: ${err instanceof Error ? err.message : String(err)}`
    );
    return { ok: false, message: DECLINE_REFUSAL };
  }
}
