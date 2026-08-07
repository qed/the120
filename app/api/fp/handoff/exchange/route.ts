/**
 * `POST /api/fp/handoff/exchange` — the second half of the v3 sign-in handoff
 * (New User Flow v3, Unit 5). firstprofit.school's `/auth/enter` landing (plan
 * Unit 6) posts the one-time code it read out of its URL fragment and receives
 * the SAME token pair `/api/fp/login` returns, so the FP client adopts a handoff
 * session through its existing session-adoption path with no new branch.
 *
 * A THIN wire over ../handoff-core.ts (deps-injected) and ../handoff-rules.ts
 * (pure). This file owns only the wire concerns.
 *
 * ── DEPLOYABLE BEFORE THE FP SIDE EXISTS ──
 * Nothing calls this endpoint until Unit 6 ships, and an endpoint nobody calls
 * mints nothing: it needs a code, and codes only exist once a parent clicks
 * "Keep building". Shipping it first is what lets the two repos deploy in the
 * plan's order (The120, then first-profit).
 *
 * ── THE ORDER, AND WHY (the login route's, deliberately) ──
 *   1. ORIGIN. Cheapest possible check, no I/O, and refusals carry NO CORS allow
 *      header — the browser correctly blocks the reader. It constrains
 *      browser-embedded misuse only (curl sends any Origin it likes); the
 *      limiter and the code's entropy carry the real load.
 *   2. RATE LIMIT, atomic check-and-record on the ATTESTED client IP, BEFORE any
 *      work. There is no identity in this request to key on — only a code — so
 *      the IP bucket is the one thing that bounds a flood before a DB round
 *      trip. Released ONLY for refusals on the explicit
 *      `HANDOFF_REFUNDED_REFUSALS` allowlist.
 *   3. THE CORE. Parse, then ONE conditional UPDATE that both checks and claims.
 *
 * ── ONE REFUSAL ──
 * Every failure is the same 401 with a byte-identical body (403 only for a
 * disallowed Origin, which the sender already knows). An unknown code, a
 * consumed one and an expired one are indistinguishable on the wire; the
 * difference is recorded in the server log as a replay signal.
 */

import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { assertNoAuthMailToFwStudent } from "@/app/fp/lib/fw-provision-rules";
import { V3_HANDOFF_RATE_LIMIT } from "@/app/fp/lib/rate-limit-rules";
import {
  checkAndRecordRateLimit,
  releaseRateLimitEvent,
} from "@/app/fp/lib/rate-limit-store";
import {
  buildAllowedOrigins,
  checkOrigin,
  extractClientIp,
} from "@/app/api/fp/login/login-rules";
import { exchangeHandoffCode, type HandoffExchangeDeps } from "../handoff-core";
import {
  deriveHandoffRateLimitKey,
  isHandoffInfraFailure,
  shapeHandoffRefusal,
  type HandoffRefusalReason,
} from "../handoff-rules";

export const dynamic = "force-dynamic";

/** Headers for responses to an allowed origin. Never `*`, never credentials —
 *  identical to the login route's, because the two are one surface as far as an
 *  FP client is concerned. */
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

function buildDeps(clientIp: string): HandoffExchangeDeps {
  return {
    // A FACTORY: `supabaseAdmin()` is not called until the core has a
    // well-formed request. fp_handoff_codes is RLS-on with ZERO policies
    // (service-role only) — see the migration header.
    db: () => supabaseAdmin(),
    mintSession: async ({ email }) => {
      // The guard sits WITH the mail-capable call, never one file away (the
      // resume-store learning: extracting the call away from its guard is one
      // refactor from having no guard). A derived student address is
      // `.invalid` and cannot receive mail at all, so this can only ever pass —
      // which is the point: the day someone changes the address scheme, this
      // throws instead of quietly mailing a minor.
      assertNoAuthMailToFwStudent(email, "fp/handoff exchange");
      const admin = supabaseAdmin();
      // generateLink DOES NOT SEND for type "magiclink" — it returns the
      // properties and leaves delivery to the caller. Ours never leaves this
      // process: it is verified in-band immediately below. This is the shape
      // app/lib/funnel/resume-store.ts already ships, and it is chosen over the
      // password path for the same reason: it touches no credential, so a
      // handoff can never destroy the password the family was just shown.
      const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
      if (link.error || !link.data.properties) {
        console.error(`[fp/handoff] generateLink failed: ${link.error?.message ?? "no properties"}`);
        return { ok: false };
      }
      // STATELESS, like the login route's auth client: no cookies, no
      // persistence, and the attested client IP forwarded so Supabase's own
      // /token limits attribute to the family's network rather than to Vercel's
      // egress IP.
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
        console.error(`[fp/handoff] verifyOtp failed: ${otp.error?.message ?? "no session"}`);
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
      // SCOPED, never global: a global sign-out would let this public endpoint
      // be used as a remote force-logout of every device (the login route's
      // rule). Truly best-effort — signOut can reject, and the caller has
      // already decided to refuse.
      try {
        const { error } = await supabaseAdmin().auth.admin.signOut(accessToken, "local");
        if (error) console.error(`[fp/handoff] scoped session revoke failed: ${error.message}`);
      } catch (err) {
        console.error(
          `[fp/handoff] scoped session revoke threw: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    },
    now: () => Date.now(),
  };
}

export async function POST(req: Request): Promise<Response> {
  // 1. ORIGIN — before anything else, and free. A refusal carries no CORS allow
  //    header, so a hostile page cannot read it either.
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
  const refuse = (reason: HandoffRefusalReason): Response => {
    const shaped = shapeHandoffRefusal(reason);
    return new Response(shaped.body, { status: shaped.status, headers });
  };

  // 2. RATE LIMIT — atomic check-and-record on the platform-attested IP (the
  //    login route's strict extractor: x-vercel-forwarded-for first, else the
  //    RIGHTMOST x-forwarded-for hop, never the spoofable leftmost), before any
  //    work at all.
  const ip = extractClientIp(req.headers);
  const key = deriveHandoffRateLimitKey(ip);
  if (!checkAndRecordRateLimit(key, V3_HANDOFF_RATE_LIMIT).allowed) {
    // The same generic 401, never a 429 — no status oracle, and the strike
    // stands (a rate-limited request is a real attempt).
    return refuse("rate_limited");
  }

  const settle = (reason: HandoffRefusalReason): Response => {
    // ONLY the explicit allowlist refunds. `invalid_code` — what a code-guessing
    // flood produces — deliberately keeps its strike.
    if (isHandoffInfraFailure(reason)) releaseRateLimitEvent(key);
    return refuse(reason);
  };

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return settle("malformed_request");
    }

    const result = await exchangeHandoffCode(buildDeps(ip), body, {
      ip,
      ua: req.headers.get("user-agent") ?? "",
    });
    if (!result.ok) return settle(result.reason);

    return new Response(JSON.stringify(result.body), { status: 200, headers });
  } catch (err) {
    // An unhandled throw is a DIFFERENT response shape, and a difference is an
    // oracle. Collapse it into the one refusal.
    console.error(
      `[fp/handoff] unexpected error: ${err instanceof Error ? err.message : String(err)}`
    );
    return settle("outage");
  }
}
