"use server";

/**
 * The reset forms' Server Actions (funnel U15 / W12) — thin wrappers.
 * Every decision lives in `app/lib/auth/reset-core.ts`; these exports
 * exist because a client form can only invoke a `"use server"` function,
 * and because the core's `deps` parameter must never reach the wire.
 *
 * Both surfaces answer `{ ok: true }` for every outcome — sent, refused by
 * the guard, or a downstream send failure. Any variation would confirm
 * whether an address has an account.
 */

import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { notifyOps } from "@/app/lib/ops-alert";
import { SITE_URL } from "@/app/lib/site";
import { requestPasswordReset, type ResetDeps, type ResetResult, type ResetSurface } from "@/app/lib/auth/reset-core";

function deps(): ResetDeps {
  return {
    sendReset: async (email, redirectTo) => {
      const { error } = await supabaseAdmin().auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw new Error(error.message);
    },
    userExists: async (email) => {
      // Admin lookup, used only to decide whether a refusal deserves an
      // ops page (see the core). Never influences the response.
      const { data, error } = await supabaseAdmin().auth.admin.listUsers();
      if (error || !data) return false;
      const target = email.trim().toLowerCase();
      return data.users.some((u) => (u.email ?? "").toLowerCase() === target);
    },
    notify: notifyOps,
    log: (message) => console.error(message),
    siteUrl: SITE_URL,
  };
}

async function run(surface: ResetSurface, email: unknown): Promise<ResetResult> {
  await requestPasswordReset(deps(), surface, email);
  return { ok: true };
}

export async function requestParentPasswordResetAction(email: unknown): Promise<ResetResult> {
  return run("parent", email);
}

export async function requestStaffPasswordResetAction(email: unknown): Promise<ResetResult> {
  return run("staff", email);
}
