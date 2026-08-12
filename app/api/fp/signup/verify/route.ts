/**
 * /api/fp/signup/verify — CODE-mode verify-completion for the First Profit
 * parent signup (fpv04 Unit 3). The SPA submits {email, password, code} after
 * the parent types the 6-digit code the start door mailed; on success this
 * returns the PARENT SESSION TOKENS in JSON so the cross-origin SPA can
 * `setSession` and make the RLS child-mint call. The LINK-token verify this
 * door used to run is GONE with the retired firstprofit.school/signup/verify
 * screen — the whole flow is start → code → verify, one substrate with the
 * /start Server Actions (v3VerifyCode is the cookie-session twin of the
 * `verifyCodeCompletion` core this wire calls).
 *
 * ── THE DOOR IS EMAIL-KEYED (v3 review FIX 1, design A) ──
 * No attempt id crosses the wire in either direction: the server re-derives
 * the attempt from the typed address, and the CODE is the only secret in the
 * exchange. An address with no live attempt is answered as an ordinary wrong
 * guess, so this door is not an "is a signup in flight?" oracle.
 *
 * ── WHAT LEAVES THIS DOOR ──
 *   200 {ok:true, access_token, refresh_token}       — verified + signed in
 *       (the pre-fpv04 success shape, unchanged).
 *   200 {ok:false, status:"invalid_code",
 *        guessesRemaining}                            — wrong guess, durably
 *       counted on the row (MAX_CODE_GUESSES); strike stands.
 *   200 {ok:false, status:"expired"}                  — the 10-minute window
 *       closed; resend mints a fresh code.
 *   200 {ok:false, status:"locked"}                   — the durable budget is
 *       burned; terminal for this attempt (resend cannot unlock).
 *   200 {ok:false, status:"post_verify_failed"}       — the redeem landed but a
 *       later step failed; the client KEEPS the typed code and re-submits (the
 *       redeem's `already` branch recovers end-to-end; v3 review FIX 5).
 *   401 (one byte-identical body)                     — malformed input,
 *       launch-gate refusal, rate limit, outage.
 * These designed branches mirror the v3 /start verify union — the SPA needs
 * the same wrong/expired/resend UX states the /start screens render, and each
 * disclosure is documented there (app/lib/v3-signup/v3-signup-rules.ts).
 *
 * ── RATE LIMITS: V3_VERIFY_*, NOT THE START LIMITS (fpv04 U3, deliverable 2) ──
 * This door used to reuse SIGNUP_RATE_LIMIT (5/15min) — tighter than the
 * 6-guess durable budget plus resends it must accommodate, so the volumetric
 * backstop would bite BEFORE the durable counter and mask it (and reset itself
 * on cold start, which the counter never does). It now takes the v3 verify
 * budgets: 20/15min per (ip,email) + 100/60min per IP, sized ABOVE
 * MAX_CODE_GUESSES on purpose (V3_VERIFY_RATE_LIMIT's own docblock). The keys
 * stay in this door's own `fp-signup-verify` namespace.
 *
 * ── THE LAUNCH GATE, ASSERTED HERE TOO ──
 * The same fail-closed FP_SIGNUP_TEST_ONLY / FP_SIGNUP_TEST_ALLOWLIST verdict
 * the start door applies: while the gate is closed, a non-allowlisted caller
 * gets the generic 401 even with a fully valid flow — a flag that gates one
 * door gates nothing (the page-vs-endpoint gating learning). NEVER log
 * passwords or codes.
 */

import { createClient } from "@supabase/supabase-js";
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
import { parseV3Verify } from "@/app/lib/v3-signup/v3-signup-rules";
import { classifyAuthError } from "../../login/login-rules";
import { verifyCodeCompletion, type SignupCoreDeps } from "../signup-core";

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
    const parsed = parseV3Verify(body);
    if (!parsed.ok) return refuse();

    const ip = extractClientIp(req.headers);
    const email = parsed.data.email.trim().toLowerCase();
    const { emailKey, ipKey } = deriveVerifyRateLimitKeys(ip, email);
    const releaseStrikes = (): void => {
      releaseRateLimitEvent(emailKey);
      releaseRateLimitEvent(ipKey);
    };

    // The v3 verify budgets (deliverable 2's whole point) — recorded atomically
    // BEFORE the gate and any DB I/O, both buckets before either verdict.
    const emailCheck = checkAndRecordRateLimit(emailKey, V3_VERIFY_RATE_LIMIT);
    const ipCheck = checkAndRecordRateLimit(ipKey, V3_VERIFY_IP_RATE_LIMIT);
    if (!emailCheck.allowed || !ipCheck.allowed) return refuse();

    // The launch gate, same verdict as the start door: identity-scoped,
    // fail-closed, invisible on the wire. The strike stands.
    const gate = launchGateVerdict(email, {
      FP_SIGNUP_TEST_ONLY: process.env.FP_SIGNUP_TEST_ONLY,
      FP_SIGNUP_TEST_ALLOWLIST: process.env.FP_SIGNUP_TEST_ALLOWLIST,
    });
    if (!gate.allowed) return refuse();

    const admin = supabaseAdmin();
    const deps: SignupCoreDeps = {
      db: admin,
      provisionAccount: async () => ({ kind: "failed", reason: "exception" }), // unused
      // The parent's chosen password is set HERE, only after inbox proof (P0).
      setParentPassword: async (userId, password) => {
        const res = await admin.auth.admin.updateUserById(userId, { password });
        if (res.error) console.error(`[fp/signup/verify] set password failed: ${res.error.message}`);
        return { ok: !res.error };
      },
      cleanupAccount: async () => ({ ok: true }), // unused
      signInParent: async (signInEmail, password) => {
        // Stateless client (no cookies), forwarding the attested client IP so
        // Supabase's own /token limits attribute to the parent's network.
        const authClient = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          {
            auth: { persistSession: false, autoRefreshToken: false },
            global: { headers: { "x-forwarded-for": ip } },
          }
        );
        try {
          const res = await authClient.auth.signInWithPassword({
            email: signInEmail,
            password,
          });
          if (res.error || !res.data.session) {
            return { ok: false, outage: res.error ? classifyAuthError(res.error) === "outage" : false };
          }
          return {
            ok: true,
            accessToken: res.data.session.access_token,
            refreshToken: res.data.session.refresh_token,
          };
        } catch (err) {
          console.error(
            `[fp/signup/verify] sign-in threw: ${err instanceof Error ? err.message : String(err)}`
          );
          return { ok: false, outage: classifyAuthError(err) === "outage" };
        }
      },
      sendMail: (await import("@/app/lib/email")).sendEmail, // unused
      mintToken: () => "", // unused
      mintCode: () => "", // unused (verify-completion mints no secret)
      now: () => Date.now(),
    };

    const result = await verifyCodeCompletion(deps, {
      email,
      password: parsed.data.password,
      code: parsed.data.code,
    });

    if (result.ok) {
      // The parent proved inbox control AND account ownership.
      releaseStrikes();
      return answer({
        ok: true,
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
      });
    }

    switch (result.reason) {
      case "invalid_code":
        // A real guess: the strike stands, the durable counter already moved.
        return answer({
          ok: false,
          status: "invalid_code",
          guessesRemaining: result.guessesRemaining,
        });
      case "expired":
        return answer({ ok: false, status: "expired" });
      case "locked":
        // Never released: a locked answer is caused by guessing (v3 FIX 3).
        return answer({ ok: false, status: "locked" });
      case "post_verify_failed":
        // Our fault after the redeem — hand the strike back so the recovery
        // re-submit is not spent on our outage.
        releaseStrikes();
        return answer({ ok: false, status: "post_verify_failed" });
      case "outage":
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
      `[fp/signup/verify] unexpected error: ${err instanceof Error ? err.message : String(err)}`
    );
    return refuse();
  }
}
