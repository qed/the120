"use server";

/**
 * The reset forms' Server Actions (funnel U15 / W12) — thin wrappers.
 * Every decision lives in `app/lib/auth/reset-core.ts`; these exports
 * exist because a client form can only invoke a `"use server"` function,
 * and because the core's `deps` parameter must never reach the wire.
 *
 * Both surfaces answer `{ ok: true }` for every outcome — sent, refused by
 * the guard, or a downstream send failure. Any variation would confirm
 * whether an address has an account. The request path does no admin work
 * and takes the same steps either way, so it leaks nothing by timing.
 */

import { createClient } from "@supabase/supabase-js";
import { SITE_URL } from "@/app/lib/site";
import { requestPasswordReset, type ResetDeps, type ResetSurface } from "@/app/lib/auth/reset-core";

export type ResetResult = { ok: true };

function deps(): ResetDeps {
  return {
    sendReset: async (email, redirectTo) => {
      // ANON key, deliberately, even though this runs server-side: reset
      // needs no elevated rights, and the service-role client would step
      // around Supabase's own per-IP reset throttling — the protection
      // this flow used to get for free when it ran in the browser.
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false } }
      );
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw new Error(error.message);
    },
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
