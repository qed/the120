"use server";

/**
 * THE CONVERTED-FUNNEL-PARENT SET-PASSWORD STEP (plan Unit 8).
 *
 * A v2 funnel-provisioned parent holds a random, never-disclosed password; a
 * resume link has always been their only door. `deriveHasPassword` flips them to
 * a password family the moment they acquire a First Profit child, so without
 * this step the remap would walk them into the v3 flow, provision a kid, and
 * then route every later visit at a sign-in form they cannot pass. The remap
 * (`needsSetPasswordStep`) diverts them HERE first; this action is what makes
 * the divert terminate.
 *
 * THIN WRAPPER. Every decision lives in ../set-password-core.ts (`server-only`,
 * deps-injected) — the same split as the kid-credentials pair, and for the same
 * reason: a core with a `deps` parameter may never live in a file whose every
 * export is client-callable (docs/solutions/best-practices/shared-db-taking-
 * core-must-not-live-in-a-use-server-file-server-action-boundary-2026-07-17.md).
 *
 * ⚠ EXPORTS ARE ACTIONS ONLY. No `export type`, no `export const` — a type
 * re-export from a `"use server"` file still emits `registerServerReference` and
 * throws at module load (docs/solutions/runtime-errors/use-server-type-reexport-
 * registers-server-reference-referenceerror-2026-07-22.md).
 *
 * ⚠ THE ONLY ACCOUNT IT CAN TOUCH IS THE CALLER'S OWN. The user id comes from
 * `auth.getUser()` — the verified session — and there is no id parameter at all.
 * There is nothing a caller could send that would aim this at someone else,
 * which is the strongest form of "verify the caller owns the target": make the
 * target unnameable.
 *
 * ⚠ AND IT IS SCOPED TO THE ONE-TIME CONVERSION (review FIX 4). The core
 * re-checks `needsSetPasswordStep` against the session's own metadata and
 * roster, so an already-converted parent — a beta-cohort parent above all —
 * cannot overwrite their own working password by calling this endpoint
 * directly. The page gate was never the security control.
 *
 * The `password_chosen` stamp is written in the SAME call that sets the
 * password, so the flag can never claim a password that was not set. That stamp
 * is precisely what stops this step from re-offering itself forever.
 *
 * ── THE ORDER, AND WHY ──
 * SESSION FIRST (no session ⇒ no strike, no privileged client, no read), THEN
 * the rate limit keyed on the session-derived id, THEN the core. The refund
 * rule is `refundsSetPasswordStrike`, an explicit allowlist in the core, not an
 * `if` written here (review FIX 3).
 */

import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { supabaseServer } from "@/app/lib/supabase/server";
import { V3_KID_RESET_RATE_LIMIT } from "@/app/fp/lib/rate-limit-rules";
import {
  checkAndRecordRateLimit,
  releaseRateLimitEvent,
} from "@/app/fp/lib/rate-limit-store";
import { deriveV3KidResetRateLimitKey } from "@/app/lib/v3-signup/v3-signup-rules";
import {
  MIN_PARENT_PASSWORD,
  refundsSetPasswordStrike,
  setParentPassword,
  type SetPasswordDeps,
} from "@/app/lib/v3-signup/set-password-core";

function buildDeps(): SetPasswordDeps {
  return {
    familyHasFpChild: async (parentId) => {
      // SERVICE-ROLE, with the session-derived parent id in the WHERE clause:
      // `children.fp_username` is service-role-write-only (trigger, migration
      // 20260831120000) and this read must succeed for a parent whose session
      // client may not yet see a freshly-minted row.
      const res = await supabaseAdmin()
        .from("children")
        .select("id")
        .eq("parent_id", parentId)
        .not("fp_username", "is", null)
        .limit(1);
      if (res.error) return null;
      return ((res.data as unknown[] | null) ?? []).length > 0;
    },
    setPasswordAndStamp: async (userId, password, stampKey) => {
      const res = await supabaseAdmin().auth.admin.updateUserById(userId, {
        password,
        app_metadata: { [stampKey]: true },
      });
      if (res.error) {
        console.error(`[fp/set-password] updateUserById failed: ${res.error.message}`);
      }
      return { ok: !res.error };
    },
    log: (m) => console.error(m),
  };
}

export async function setParentPasswordAction(
  input: unknown
): Promise<{ ok: true } | { ok: false; message: string }> {
  const refusal = {
    ok: false as const,
    message: "We could not set that password just now. Refresh the page and try again.",
  };
  try {
    // 1. SESSION FIRST — before the rate limit, before any privileged client.
    const supabase = await supabaseServer();
    const { data } = await supabase.auth.getUser();
    const user = data?.user;
    if (!user?.id) return refusal;

    // 2. RATE LIMIT, in its OWN scope (review FIX 6): a parent looping the
    //    per-kid reset must not spend the budget for this one-time step.
    const key = deriveV3KidResetRateLimitKey(user.id, "set-parent-password");
    if (!checkAndRecordRateLimit(key, V3_KID_RESET_RATE_LIMIT).allowed) return refusal;

    const outcome = await setParentPassword(buildDeps(), input, {
      userId: user.id,
      appMetadata: user.app_metadata ?? {},
    });
    if (refundsSetPasswordStrike(outcome)) releaseRateLimitEvent(key);
    if (outcome === "set") return { ok: true };
    if (outcome === "weak_password") {
      // The ONE refusal that carries a specific message: it is about a value
      // the parent just typed and can fix.
      return {
        ok: false,
        message: `Use at least ${MIN_PARENT_PASSWORD} characters — a few unrelated words work well.`,
      };
    }
    // `not_eligible` deliberately shares the generic refusal. Telling a caller
    // "you already have a password" is a fact about an account, and this
    // endpoint has no reason to confirm one.
    return refusal;
  } catch (err) {
    console.error(
      `[fp/set-password] threw: ${err instanceof Error ? err.message : String(err)}`
    );
    return refusal;
  }
}
