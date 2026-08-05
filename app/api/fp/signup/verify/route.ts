/**
 * /api/fp/signup/verify — verify-completion for the First Profit parent signup
 * (Slice B Unit 2; R9, R11, Rev 1). The SPA re-submits {token, email, password}
 * (or {email, password} for an is_test family) AFTER the parent clicks the
 * verification link; on success this returns the PARENT SESSION tokens in JSON
 * so the cross-origin SPA can `setSession` and make the RLS child-mint call
 * (Unit 4). Same CORS/refusal discipline as ../route.ts and /api/fp/login: one
 * generic 401 for every failure, 403 for a bad Origin, an atomic rate-limit
 * strike before any DB I/O with release-on-outage. NEVER log passwords/tokens.
 *
 * The password proves account ownership and the token proves inbox control;
 * neither alone yields a session. Obtaining the session is idempotent (a lost
 * response can be retried — R10), while the token's verified_at flip is
 * single-use (the redeem CAS in verify-store).
 */

import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import {
  checkAndRecordRateLimit,
  releaseRateLimitEvent,
} from "@/app/fp/lib/rate-limit-store";
import { z } from "zod";
import {
  buildAllowedOrigins,
  checkOrigin,
  deriveVerifyRateLimitKeys,
  extractClientIp,
  shapeSignupRefusal,
  SIGNUP_IP_RATE_LIMIT,
  SIGNUP_RATE_LIMIT,
} from "../signup-rules";
import { classifyAuthError } from "../../login/login-rules";
import { verifyCompletion, type SignupCoreDeps } from "../signup-core";

export const dynamic = "force-dynamic";

// token optional (is_test tokenless path); email+password always required.
const verifySchema = z
  .object({
    token: z.string().min(20).max(400).optional(),
    email: z.email().max(200),
    password: z.string().min(1).max(200),
  })
  .strict();

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

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return refuse();
    }
    const parsed = verifySchema.safeParse(body);
    if (!parsed.success) return refuse();

    const ip = extractClientIp(req.headers);
    const email = parsed.data.email.trim().toLowerCase();
    const { emailKey, ipKey } = deriveVerifyRateLimitKeys(ip, email);
    const releaseStrikes = (): void => {
      releaseRateLimitEvent(emailKey);
      releaseRateLimitEvent(ipKey);
    };

    const emailCheck = checkAndRecordRateLimit(emailKey, SIGNUP_RATE_LIMIT);
    const ipCheck = checkAndRecordRateLimit(ipKey, SIGNUP_IP_RATE_LIMIT);
    if (!emailCheck.allowed || !ipCheck.allowed) return refuse();

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
          // A wrong password / unconfirmed account is a genuine failed attempt
          // (strike stands); a 429/5xx/network fault is an outage (release the
          // strike), mirroring /api/fp/login's classifyAuthError-driven release.
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

    const result = await verifyCompletion(deps, {
      token: parsed.data.token,
      email,
      password: parsed.data.password,
    });
    if (!result.ok) {
      // An outage (redeem/DB fault or a 5xx/429 sign-in) is not a real attempt —
      // hand the strike back, mirroring /api/fp/login. A wrong password / bad or
      // expired token is a genuine failed attempt: the strike stands.
      if (result.reason === "outage") releaseStrikes();
      return refuse();
    }

    // The parent proved inbox control AND account ownership.
    releaseStrikes();
    return new Response(
      JSON.stringify({
        ok: true,
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
      }),
      { status: 200, headers }
    );
  } catch (err) {
    console.error(
      `[fp/signup/verify] unexpected error: ${err instanceof Error ? err.message : String(err)}`
    );
    return refuse();
  }
}
