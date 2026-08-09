/**
 * `POST /api/fp/login-code/redeem` (fpv03 U3c) — `{username, code}` in, the
 * SAME FpSessionBody as `/api/fp/login` out. The THIRD sign-in door, and it
 * takes the other two doors' posture exactly:
 *
 *   - ONE refusal: every failure (wrong code, expired, consumed, locked, no
 *     such account, rate-limited, outage) is the same 401 with the SAME
 *     byte-identical body the login route and the handoff exchange return
 *     (FP_SIGN_IN_REFUSAL_BODY via shapeLoginCodeRefusal). 403 only for a
 *     disallowed Origin.
 *   - Limiter BEFORE work, atomic, (ip,username) + ip buckets; only the
 *     `outage` allowlist refunds a strike (invalid_code — the guess flood's
 *     product — keeps its strike AND durably bumps the row counter).
 *   - Session mint: admin generateLink("magiclink") + in-band verifyOtp
 *     against the child's derived `.invalid` address — the exchange route's
 *     shape, guard included (assertNoAuthMailToFwStudent sits WITH the
 *     mail-capable call).
 *
 * The core (../login-code-core.ts) owns sequencing; the pure rules own every
 * decision. NEVER log the code or the tokens.
 */

import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { assertNoAuthMailToFwStudent } from "@/app/lib/fp/fw-provision-rules";
import {
  FP_LOGIN_CODE_REDEEM_IP_RATE_LIMIT,
  FP_LOGIN_CODE_REDEEM_RATE_LIMIT,
} from "@/app/lib/fp/rate-limit-rules";
import {
  checkAndRecordRateLimit,
  releaseRateLimitEvent,
} from "@/app/lib/fp/rate-limit-store";
import {
  buildAllowedOrigins,
  checkOrigin,
  classifyIdentifier,
  extractClientIp,
} from "@/app/api/fp/login/login-rules";
import { redeemLoginCode, type CodeRedeemDeps } from "../login-code-core";
import {
  deriveCodeRedeemIpKey,
  deriveCodeRedeemRateLimitKeys,
  isLoginCodeInfraFailure,
  shapeLoginCodeRefusal,
  type LoginCodeRefusalReason,
} from "../login-code-rules";

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

/** The stateless mint + scoped revoke — byte-for-byte the exchange route's
 *  deps, pointed at the login-code core. */
function buildDeps(clientIp: string): CodeRedeemDeps {
  return {
    db: () => supabaseAdmin(),
    mintSession: async ({ email }) => {
      // The guard sits WITH the mail-capable call (the resume-store learning).
      // A derived student address is `.invalid` and cannot receive mail; the
      // day the address scheme changes, this throws instead of mailing a minor.
      assertNoAuthMailToFwStudent(email, "fp/login-code redeem");
      const admin = supabaseAdmin();
      // generateLink does NOT send for type "magiclink"; the token is verified
      // in-band immediately below and never leaves this process.
      const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
      if (link.error || !link.data.properties) {
        console.error(
          `[fp/login-code] generateLink failed: ${link.error?.message ?? "no properties"}`
        );
        return { ok: false };
      }
      const auth = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { "x-forwarded-for": clientIp } },
        }
      );
      const otp = await auth.auth.verifyOtp({
        type: "email",
        token_hash: link.data.properties.hashed_token,
      });
      if (otp.error || !otp.data.session || !otp.data.user) {
        console.error(`[fp/login-code] verifyOtp failed: ${otp.error?.message ?? "no session"}`);
        return { ok: false };
      }
      // NEVER log the tokens.
      return {
        ok: true,
        accessToken: otp.data.session.access_token,
        refreshToken: otp.data.session.refresh_token,
        userId: otp.data.user.id,
      };
    },
    revokeSession: async (accessToken) => {
      // SCOPED, never global (the login route's rule). Best-effort.
      try {
        const { error } = await supabaseAdmin().auth.admin.signOut(accessToken, "local");
        if (error) console.error(`[fp/login-code] scoped session revoke failed: ${error.message}`);
      } catch (err) {
        console.error(
          `[fp/login-code] scoped session revoke threw: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    },
    now: () => Date.now(),
  };
}

export async function POST(req: Request): Promise<Response> {
  const verdict = checkOrigin(
    req.headers.get("origin"),
    buildAllowedOrigins(process.env.FP_PREVIEW_ORIGIN)
  );
  if (!verdict.ok) {
    console.warn(
      `[fp/login-code] refused origin (403): origin=${JSON.stringify(req.headers.get("origin"))}`
    );
    return new Response(null, {
      status: 403,
      headers: { "Cache-Control": "no-store", Vary: "Origin" },
    });
  }
  const headers = corsJsonHeaders(verdict.origin);
  const refuse = (reason: LoginCodeRefusalReason): Response => {
    const shaped = shapeLoginCodeRefusal(reason);
    return new Response(shaped.body, { status: shaped.status, headers });
  };

  try {
    // Record the per-IP strike FIRST — before the body parse / classify early
    // returns (fpv03 U3c review, FIX 1) — so a malformed-request flood from one
    // source still burns the per-IP budget instead of being free. The IP key
    // needs no request body, and the encoder is total (a crafted x-forwarded-for
    // cannot throw here).
    const ip = extractClientIp(req.headers);
    const ipKey = deriveCodeRedeemIpKey(ip);
    const ipCheck = checkAndRecordRateLimit(ipKey, FP_LOGIN_CODE_REDEEM_IP_RATE_LIMIT);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return refuse("malformed_request");
    }

    // Normalize the username for the bucket key exactly as the core will; an
    // unclassifiable identifier refuses generically before any I/O (scoped
    // honesty — it reflects only the caller's own input).
    const username =
      typeof (body as { username?: unknown })?.username === "string"
        ? (body as { username: string }).username
        : "";
    const classified = classifyIdentifier(username);
    if (classified.kind === "refuse") return refuse("malformed_request");

    // The per-(ip,username) bucket is the load-bearing brute-force bound (FIX 1);
    // record it before any DB work and evaluate both verdicts together.
    const { usernameKey } = deriveCodeRedeemRateLimitKeys(ip, classified.normalized);
    const nameCheck = checkAndRecordRateLimit(usernameKey, FP_LOGIN_CODE_REDEEM_RATE_LIMIT);
    if (!nameCheck.allowed || !ipCheck.allowed) return refuse("rate_limited");

    const settle = (reason: LoginCodeRefusalReason): Response => {
      // Only the explicit `outage` allowlist refunds; invalid_code keeps its
      // strike (a refunded strike refunds the attacker — the handoff's rule).
      if (isLoginCodeInfraFailure(reason)) {
        releaseRateLimitEvent(usernameKey);
        releaseRateLimitEvent(ipKey);
      }
      return refuse(reason);
    };

    const result = await redeemLoginCode(buildDeps(ip), body, {
      ip,
      ua: req.headers.get("user-agent") ?? "",
    });
    if (!result.ok) return settle(result.reason);

    return new Response(JSON.stringify(result.body), { status: 200, headers });
  } catch (err) {
    // A different response SHAPE is an oracle — collapse every throw into the
    // one refusal. Strikes stand (fail closed).
    console.error(
      `[fp/login-code] redeem unexpected error: ${err instanceof Error ? err.message : String(err)}`
    );
    return refuse("outage");
  }
}
