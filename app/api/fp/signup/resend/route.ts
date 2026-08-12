/**
 * /api/fp/signup/resend — CODE-mode resend for the First Profit parent signup
 * (fpv04 Unit 3). The SPA submits {email}; the server re-derives the live
 * attempt from the address (email-keyed, v3 review FIX 1 — no attempt id ever
 * crosses the wire) and rotates the 6-digit code through the SAME core the
 * /start Server Actions run (`v3ResendCode`), so the two wires cannot drift:
 * the 60s cooldown is a CAS predicate (two racing clicks mint ONE code), a
 * locked attempt can never rotate, and the durable guess counter is untouched
 * by construction.
 *
 * CORS/refusal discipline mirrors the sibling doors: OPTIONS 204 with the
 * echoed origin, no-store, 403 for a bad Origin, one byte-identical 401 for
 * everything that is not a designed branch.
 *
 * ── WHAT LEAVES THIS DOOR ──
 *   200 {ok:true,  status:"sent"}     — a fresh code is on its way.
 *   200 {ok:false, status:"cooldown"} — too soon since the last code (ALSO the
 *       answer for an address with nothing to resend — the branch that costs a
 *       strike and discloses nothing, so resend is not a "does a signup
 *       exist?" probe; v3ResendCode's own posture).
 *   200 {ok:false, status:"locked"}   — the durable guess budget is burned.
 *   401 (one byte-identical body)     — malformed input, launch-gate refusal,
 *       rate limit, outage.
 *
 * Rate limits: resend SHARES the verify budget (V3_VERIFY_*) on the same
 * (ip,email)+ip keys, exactly as the /start actions share it — both act on one
 * attempt, and a separate budget would be a second lever on the same row.
 *
 * The launch gate (FP_SIGNUP_TEST_ONLY / FP_SIGNUP_TEST_ALLOWLIST) is asserted
 * here too, fail-closed and identity-scoped — every signup door carries the
 * same verdict. NEVER log the code.
 */

import { randomInt } from "node:crypto";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import {
  checkAndRecordRateLimit,
  releaseRateLimitEvent,
} from "@/app/lib/fp/rate-limit-store";
import {
  V3_VERIFY_IP_RATE_LIMIT,
  V3_VERIFY_RATE_LIMIT,
} from "@/app/lib/fp/rate-limit-rules";
import {
  buildAllowedOrigins,
  checkOrigin,
  deriveVerifyRateLimitKeys,
  extractClientIp,
  launchGateVerdict,
  shapeSignupRefusal,
} from "../signup-rules";
import {
  formatVerificationCode,
  parseV3Resend,
  VERIFICATION_CODE_SPACE,
} from "@/app/lib/v3-signup/v3-signup-rules";
import { v3ResendCode, type V3SignupDeps } from "@/app/lib/v3-signup/v3-signup-core";
import type { SignupCoreDeps } from "../signup-core";

export const dynamic = "force-dynamic";

function corsJsonHeaders(origin: string): Record<string, string> {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  };
}

export async function OPTIONS(req: Request): Promise<Response> {
  const verdict = checkOrigin(
    req.headers.get("origin"),
    buildAllowedOrigins(process.env.FP_PREVIEW_ORIGIN)
  );
  if (!verdict.ok) {
    return new Response(null, {
      status: 403,
      headers: { "Cache-Control": "no-store", Vary: "Origin" },
    });
  }
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": verdict.origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Max-Age": "86400",
      "Cache-Control": "no-store",
      Vary: "Origin",
    },
  });
}

export async function POST(req: Request): Promise<Response> {
  const verdict = checkOrigin(
    req.headers.get("origin"),
    buildAllowedOrigins(process.env.FP_PREVIEW_ORIGIN)
  );
  if (!verdict.ok) {
    return new Response(null, {
      status: 403,
      headers: { "Cache-Control": "no-store", Vary: "Origin" },
    });
  }
  const headers = corsJsonHeaders(verdict.origin);
  const refuse = (): Response => {
    const shaped = shapeSignupRefusal("outage");
    return new Response(shaped.body, { status: shaped.status, headers });
  };
  const answer = (body: Record<string, unknown>): Response =>
    new Response(JSON.stringify(body), { status: 200, headers });

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return refuse();
    }
    const parsed = parseV3Resend(body);
    if (!parsed.ok) return refuse();

    const ip = extractClientIp(req.headers);
    const email = parsed.data.email.trim().toLowerCase();
    const { emailKey, ipKey } = deriveVerifyRateLimitKeys(ip, email);
    const releaseStrikes = (): void => {
      releaseRateLimitEvent(emailKey);
      releaseRateLimitEvent(ipKey);
    };

    const emailCheck = checkAndRecordRateLimit(emailKey, V3_VERIFY_RATE_LIMIT);
    const ipCheck = checkAndRecordRateLimit(ipKey, V3_VERIFY_IP_RATE_LIMIT);
    if (!emailCheck.allowed || !ipCheck.allowed) return refuse();

    // The launch gate, same verdict as the start/verify doors: identity-scoped,
    // fail-closed, invisible on the wire. The strike stands.
    const gate = launchGateVerdict(email, {
      FP_SIGNUP_TEST_ONLY: process.env.FP_SIGNUP_TEST_ONLY,
      FP_SIGNUP_TEST_ALLOWLIST: process.env.FP_SIGNUP_TEST_ALLOWLIST,
    });
    if (!gate.allowed) return refuse();

    const admin = supabaseAdmin();
    const signup: SignupCoreDeps = {
      db: admin,
      provisionAccount: async () => ({ kind: "failed", reason: "exception" }), // unused
      setParentPassword: async () => ({ ok: false }), // unused
      cleanupAccount: async () => ({ ok: true }), // unused
      signInParent: async () => ({ ok: false, outage: false }), // unused
      sendMail: (await import("@/app/lib/email")).sendEmail,
      mintToken: () => "", // unused
      mintCode: () => formatVerificationCode(randomInt(0, VERIFICATION_CODE_SPACE)),
      now: () => Date.now(),
    };
    // v3ResendCode reads only the signup bundle — the cookie effects belong to
    // the /start verify path and are stubbed exactly as unused deps always are.
    const deps: V3SignupDeps = {
      signup,
      assertCookiesWritable: async () => {},
      signInCookieSession: async () => ({ ok: false }),
      env: { FP_SIGNUP_TEST_ALLOWLIST: process.env.FP_SIGNUP_TEST_ALLOWLIST },
    };

    const result = await v3ResendCode(deps, { email });
    switch (result.kind) {
      case "sent":
        return answer({ ok: true, status: "sent" });
      case "cooldown":
        return answer({ ok: false, status: "cooldown" });
      case "locked":
        return answer({ ok: false, status: "locked" });
      case "failed":
        // Our fault (store or mail), not a real attempt — hand the strikes back.
        releaseStrikes();
        return refuse();
      default: {
        const _exhaustive: never = result;
        void _exhaustive;
        return refuse();
      }
    }
  } catch (err) {
    console.error(
      `[fp/signup/resend] unexpected error: ${err instanceof Error ? err.message : String(err)}`
    );
    return refuse();
  }
}
