/**
 * /api/fp/signup — the First Profit SPA's cross-origin PARENT SIGNUP start
 * (Slice B Unit 2; R9, R10, R11, R16, R17). A hostile-facing public POST, and a
 * heavier one than /api/fp/login: it mints a real parent auth account, tags a
 * CRM family, and sends mail. It is a CORS MIRROR of app/api/fp/login/route.ts —
 * OPTIONS 204 with the echoed origin, no-store, one generic 401 for every
 * refusal, 403 for a bad Origin, an atomic rate-limit strike BEFORE any DB I/O
 * with release-on-outage — plus this surface's own launch gate.
 *
 * Two response shapes leave here, and only two: the one generic refusal, and —
 * deliberately, for R10 — the `existing_account` signal that routes a returning
 * parent to login/attach (the accepted, rate-limited enumeration tradeoff). The
 * CODE-LEVEL LAUNCH GATE (Rev 3) collapses a non-test signup into the SAME
 * generic refusal while test-only mode is on, so the gate is invisible on the
 * wire. NEVER log passwords or tokens.
 *
 * The verify-completion half (which returns the parent session tokens) is a
 * sibling route: ./verify/route.ts.
 */

import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { provisionOrRecognizeAccount } from "@/app/lib/funnel/account";
import {
  checkAndRecordRateLimit,
  releaseRateLimitEvent,
} from "@/app/lib/fp/rate-limit-store";
import {
  buildAllowedOrigins,
  checkOrigin,
  deriveSignupRateLimitKeys,
  extractClientIp,
  launchGateVerdict,
  parseSignupRequest,
  shapeSignupRefusal,
  splitParentName,
  SIGNUP_IP_RATE_LIMIT,
  SIGNUP_RATE_LIMIT,
  type SignupRefusalReason,
} from "./signup-rules";
import { startSignup, type SignupCoreDeps } from "./signup-core";
import { randomBytes } from "node:crypto";

export const dynamic = "force-dynamic";

/**
 * Compile-time exhaustiveness for the `startSignup` result switch below. A new
 * arm on `StartSignupResult` that this route forgets to map becomes a TYPE
 * error here rather than a silent fall-through into the success response. The
 * runtime body is the safe answer for the impossible case.
 */
function assertNever(value: never): Response {
  console.error(`[fp/signup] unmapped start result: ${JSON.stringify(value)}`);
  return new Response(null, { status: 500, headers: { "Cache-Control": "no-store" } });
}

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
  const refuse = (reason: SignupRefusalReason): Response => {
    const shaped = shapeSignupRefusal(reason);
    return new Response(shaped.body, { status: shaped.status, headers });
  };

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return refuse("malformed_request");
    }
    const parsed = parseSignupRequest(body);
    if (!parsed.ok) return refuse("malformed_request");
    const data = parsed.data;

    const ip = extractClientIp(req.headers);
    const email = data.parentEmail.trim().toLowerCase();
    const { emailKey, ipKey } = deriveSignupRateLimitKeys(ip, email);

    const releaseStrikes = (): void => {
      releaseRateLimitEvent(emailKey);
      releaseRateLimitEvent(ipKey);
    };

    // Rate-limit FIRST — atomically, BEFORE the launch gate and any DB I/O
    // (review P2). Recording the strike before the gate check bounds gate
    // probing (a gate-refused request is still counted) and removes the
    // gate-allowed-vs-refused timing gap as a cheap test-allowlist oracle. Both
    // buckets record before either verdict (a short-circuit would freeze the IP
    // backstop). Refusal is the SAME generic 401, never a 429.
    const emailCheck = checkAndRecordRateLimit(emailKey, SIGNUP_RATE_LIMIT);
    const ipCheck = checkAndRecordRateLimit(ipKey, SIGNUP_IP_RATE_LIMIT);
    if (!emailCheck.allowed || !ipCheck.allowed) {
      return refuse("rate_limited");
    }

    // CODE-LEVEL LAUNCH GATE (Rev 3, P0). A refused non-test signup is the SAME
    // generic refusal as any other — no gate oracle. The strike above stands
    // (gate-refused is a real, bounded attempt). is_test rides through to the
    // attempt row (server-side determination, never client input).
    const gate = launchGateVerdict(data.parentEmail, {
      FP_SIGNUP_TEST_ONLY: process.env.FP_SIGNUP_TEST_ONLY,
      FP_SIGNUP_TEST_ALLOWLIST: process.env.FP_SIGNUP_TEST_ALLOWLIST,
    });
    if (!gate.allowed) return refuse("gate_refused");

    const admin = supabaseAdmin();
    const { firstName, lastName } = splitParentName(data.parentName);

    const deps: SignupCoreDeps = {
      db: admin,
      // Cross-origin adaptation of provisionOrRecognizeAccount: skip the cookie
      // session mint (assertCookiesWritable + signInWithPassword no-op) because
      // the parent session is delivered as JSON tokens at verify time (Rev 1),
      // not as a same-origin cookie. Account + parents creation and the
      // email_exists→existing_account contract are reused unchanged.
      provisionAccount: (pInput) =>
        provisionOrRecognizeAccount(pInput, {
          admin: supabaseAdmin,
          assertCookiesWritable: async () => {},
          server: async () => ({
            auth: { signInWithPassword: async () => ({ error: null }) },
          }),
        }),
      // Unused on the start path — the parent's chosen password is set only at
      // verify-completion, after inbox proof (review P0).
      setParentPassword: async () => ({ ok: false }),
      cleanupAccount: async (userId) => {
        const del = await admin.auth.admin.deleteUser(userId);
        if (del.error) {
          console.error(`[fp/signup] cleanup deleteUser failed for ${userId}: ${del.error.message}`);
        }
        return { ok: !del.error };
      },
      signInParent: async () => ({ ok: false, outage: false }), // unused on the start path
      sendMail: (await import("@/app/lib/email")).sendEmail,
      mintToken: () => randomBytes(32).toString("base64url"),
      // Unused on the LINK path — this door always starts in `link` mode. The
      // 6-digit code belongs to the v3 /start Server Actions.
      mintCode: () => "",
      now: () => Date.now(),
    };

    const result = await startSignup(deps, {
      parentEmail: email,
      parentFirstName: firstName,
      parentLastName: lastName,
      parentName: data.parentName,
      parentPassword: data.parentPassword,
      isTest: gate.isTest,
      ip,
      ua: req.headers.get("user-agent") ?? "",
      originBase: verdict.origin,
    });

    // EXHAUSTIVE over StartSignupResult, ending in assertNever (review FIX 6).
    // This union is shared with the v3 code-mode door and has grown twice
    // already; an if-cascade would let the NEXT widening fall through into the
    // success response — which reads `result.attemptId` and would answer
    // `verification_pending` for an outcome that never started anything. The
    // switch makes that a COMPILE error instead.
    switch (result.kind) {
      case "existing_account":
        // Deliberate, documented enumeration signal (R10). Distinct from the
        // generic refusal so the SPA can route to login/attach. 200/no-store.
        return new Response(JSON.stringify({ ok: false, status: "existing_account" }), {
          status: 200,
          headers,
        });
      case "locked":
      case "pending_elsewhere":
      case "retryable":
        // All three are CODE-mode outcomes and this route always starts in link
        // mode, so all three are unreachable here. Mapped explicitly onto the
        // existing generic refusal, which keeps this door's WIRE CONTRACT
        // byte-identical to what firstprofit.school ships today.
        return refuse("outage");
      case "failed":
        // A failure here is our fault, not a bad guess — hand the strikes back.
        releaseStrikes();
        return refuse("outage");
      case "started":
        // Return the attempt id so the cross-origin SPA can carry it through the
        // email-verify wait to the authenticated child-mint call (Unit 9); it is
        // an opaque handle on THIS door (the child-mint route re-checks that the
        // attempt is 'verified' and owned by the Bearer parent). The v3 door
        // deliberately does NOT surface it — see v3-signup-core's FIX 1 header.
        return new Response(
          JSON.stringify({
            ok: true,
            status: "verification_pending",
            attemptId: result.attemptId,
          }),
          { status: 200, headers }
        );
      default:
        return assertNever(result);
    }
  } catch (err) {
    console.error(
      `[fp/signup] unexpected error: ${err instanceof Error ? err.message : String(err)}`
    );
    return refuse("outage");
  }
}
