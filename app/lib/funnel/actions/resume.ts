"use server";

/**
 * The return path's Server Actions (funnel U3) — thin wrappers, nothing
 * else. All sequencing and every decision live in
 * `app/lib/funnel/resume-core.ts` (server-only, deps-injectable, tested by
 * execution); these exports exist because a client form can only invoke a
 * `"use server"` function, and because the core's `deps` parameter must
 * never be exposed to the wire — a Server Action's arguments arrive from
 * the client, and the wrapper signature (input only) is what keeps the
 * injection seam server-side.
 */

import {
  redeemResumeTokenCore,
  requestResumeLinkCore,
  resendFromExpiredTokenCore,
  type RedeemResult,
} from "@/app/lib/funnel/resume-core";

export async function requestResumeLinkAction(input: unknown): Promise<{ message: string }> {
  return requestResumeLinkCore(input);
}

export async function resendFromExpiredTokenAction(input: unknown): Promise<{ message: string }> {
  return resendFromExpiredTokenCore(input);
}

export async function redeemResumeTokenAction(input: unknown): Promise<RedeemResult> {
  return redeemResumeTokenCore(input);
}
