"use server";

/**
 * Parent sign-in (T1 Unit 15) — the parent's door at /path. An enrolled parent
 * already HAS an auth account (public.parents.id references auth.users; the
 * marketing account flow created it with their real email and password), so
 * this is a plain email+password sign-in mirroring signInStudent's posture:
 *
 *   - Unauthenticated by design (it IS a door); rate-limited BEFORE any auth
 *     work, keyed (ip, normalized email) with the same per-IP aggregate bucket
 *     the student door uses — one shared flood budget for the whole sign-in
 *     surface.
 *   - ONE generic failure message — no account enumeration, and no hint
 *     whether an address has a Path grant. A signed-in non-member simply 404s
 *     at requirePathUser, exactly like any other grant-less session.
 *   - On success the cookie-bound @supabase/ssr client writes the session onto
 *     the action response; the client only navigates.
 *
 * "Forgot password?" is NOT built here: the marketing dashboard's existing
 * recovery flow (SignIn.tsx → resetPasswordForEmail → /reset) already serves
 * the same auth account; the form links there.
 */

import { headers } from "next/headers";
import { z } from "zod";
import { supabaseServer } from "@/app/lib/supabase/server";
import { clientIp } from "@/app/fp/lib/client-ip";
import { normalizeEmail } from "@/app/fp/lib/onboarding-rules";
import {
  SIGN_IN_IP_RATE_LIMIT,
  SIGN_IN_RATE_LIMIT,
} from "@/app/fp/lib/rate-limit-rules";
import {
  checkAndRecordRateLimit,
  clearRateLimitBucket,
} from "@/app/fp/lib/rate-limit-store";

const schema = z.object({
  email: z.string().min(3).max(200),
  password: z.string().min(1).max(200),
});

const PARENT_SIGN_IN_FAILED =
  "That email and password don't match. Check both and try again.";
const PARENT_SIGN_IN_RATE_LIMITED =
  "Too many tries for now. Wait a few minutes, then try again.";

export type SignInParentResult = { success: true } | { success: false; error: string };

export async function signInParent(input: unknown): Promise<SignInParentResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { success: false, error: PARENT_SIGN_IN_FAILED };

  const email = normalizeEmail(parsed.data.email);
  if (!email) return { success: false, error: PARENT_SIGN_IN_FAILED };

  const h = await headers();
  const ip = clientIp(h);
  const emailKey = `path-parent-signin:${ip}:${email}`;
  const ipKey = `path-signin-ip:${ip}`; // shared with the student door on purpose

  if (!checkAndRecordRateLimit(emailKey, SIGN_IN_RATE_LIMIT).allowed) {
    return { success: false, error: PARENT_SIGN_IN_RATE_LIMITED };
  }
  if (!checkAndRecordRateLimit(ipKey, SIGN_IN_IP_RATE_LIMIT).allowed) {
    return { success: false, error: PARENT_SIGN_IN_RATE_LIMITED };
  }

  const supabase = await supabaseServer();
  const attempt = await supabase.auth.signInWithPassword({
    email,
    password: parsed.data.password,
  });
  if (attempt.error) {
    return { success: false, error: PARENT_SIGN_IN_FAILED };
  }

  // The account owner proved themselves; residual email strikes serve nothing
  // (the IP aggregate stands — it ages out on its own).
  clearRateLimitBucket(emailKey);
  return { success: true };
}
