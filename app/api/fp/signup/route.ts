/**
 * /api/fp/signup — the First Profit SPA's cross-origin PARENT SIGNUP start,
 * CODE MODE since fpv04 Unit 3 (plan: first-profit
 * docs/plans/2026-08-12-001-feat-fpv04-onboarding-rebuild-plan.md).
 *
 * This door used to run LINK mode: it emailed a link to
 * firstprofit.school/signup/verify — a screen the fpv03 retirement removed, so
 * every such mail was a dead link. The LINK mail path is KILLED at this wire:
 * the door now runs the SAME code-mode substrate the /start Server Actions run
 * (app/start/actions.ts → v3StartSignup → startSignup mode:"code"), against the
 * SAME `fp_signup_attempts` verify-store (hashed 6-digit code, 10-min TTL,
 * durable 6-guess CAS cap, 60s resend cooldown). One substrate, two wires — the
 * Server Actions are untouched and keep working unchanged.
 *
 * A hostile-facing public POST, CORS MIRROR of app/api/fp/login/route.ts —
 * OPTIONS 204 with the echoed origin, no-store, one generic 401 for every
 * refusal, 403 for a bad Origin, an atomic rate-limit strike BEFORE any DB I/O
 * with release-on-outage — plus this surface's launch gate.
 *
 * ── WHAT LEAVES THIS DOOR (every branch a deliberate disclosure, mirroring
 *    the v3 start union documented in app/lib/v3-signup/v3-signup-rules.ts) ──
 *   200 {ok:true,  status:"code_sent"}          — a code is on its way. NO
 *       attempt id: the verify/resend doors are EMAIL-KEYED (v3 review FIX 1,
 *       design A) — the server re-derives the attempt from the typed address,
 *       and the typed CODE is the only secret in the exchange. This replaces
 *       the link door's attemptId disclosure.
 *   200 {ok:false, status:"existing_account"}   — the documented R10 signal,
 *       byte-identical to what this door has always shipped: a returning
 *       parent is routed to sign-in, never dead-ended (accepted, rate-limited
 *       enumeration tradeoff).
 *   200 {ok:false, status:"locked"}             — a prior attempt burned its
 *       durable guess budget; the account holder must learn this or retries
 *       forever.
 *   200 {ok:false, status:"pending_elsewhere"}  — a live LINK attempt from the
 *       pre-fpv04 door still holds this address: check the inbox, don't
 *       sign in (v3 review FIX 4).
 *   200 {ok:false, status:"retryable"}          — a re-issue onto an existing
 *       attempt failed; "try again", never "go sign in" (v3 review FIX 2).
 *   401 (one byte-identical body)               — everything else: malformed
 *       input, launch-gate refusal, rate limit, outage.
 *
 * ── THE LAUNCH GATE (fail-closed, FOUNDER-SCOPED test path) ──
 * `FP_SIGNUP_TEST_ONLY` unset/anything-but-off means the gate is CLOSED to the
 * public: only a caller whose parent email is on `FP_SIGNUP_TEST_ALLOWLIST`
 * (or under the guarded `@test.the120.invalid` domain) passes, and their
 * attempts ride the existing `is_test` plumbing. Every other caller gets the
 * SAME generic 401 even with a fully valid flow — the gate is IDENTITY-scoped,
 * never a global test mode, and invisible on the wire. The verify and resend
 * sibling doors assert the SAME verdict (a flag that gates one endpoint gates
 * nothing). NEVER log passwords or codes.
 */

import { randomInt } from "node:crypto";
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
  shapeSignupRefusal,
  splitParentName,
  SIGNUP_IP_RATE_LIMIT,
  SIGNUP_RATE_LIMIT,
  type SignupRefusalReason,
} from "./signup-rules";
import {
  formatVerificationCode,
  parseV3Start,
  VERIFICATION_CODE_SPACE,
} from "@/app/lib/v3-signup/v3-signup-rules";
import { startSignup, type SignupCoreDeps } from "./signup-core";

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
  const answer = (body: Record<string, unknown>): Response =>
    new Response(JSON.stringify(body), { status: 200, headers });

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return refuse("malformed_request");
    }
    // The SAME step-1 schema the /start Server Actions parse (parentName,
    // parentEmail, parentPassword, consentAccepted:true — strict): one shape
    // for one flow, and the terms affirmation is a PARSE failure, not a branch.
    const parsed = parseV3Start(body);
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

    // CODE-LEVEL LAUNCH GATE (Rev 3, P0; fpv04 U3 founder-scoped test path). A
    // refused non-test signup is the SAME generic refusal as any other — no
    // gate oracle. The strike above stands (gate-refused is a real, bounded
    // attempt). is_test rides through to the attempt row (server-side
    // determination, never client input).
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
      // Unused in CODE mode — no link token is ever minted at this door again.
      mintToken: () => "",
      // Uniform over the whole 10^6 space: randomInt is rejection-sampled by
      // node, and formatVerificationCode zero-pads rather than re-rolling.
      mintCode: () => formatVerificationCode(randomInt(0, VERIFICATION_CODE_SPACE)),
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
      // Code mode sends no link, so there is no origin to return the parent to.
      originBase: "",
      mode: "code",
    });

    // EXHAUSTIVE over StartSignupResult, ending in assertNever (review FIX 6):
    // a widened union falls out as a COMPILE error, never a silent success.
    switch (result.kind) {
      case "existing_account":
        // Deliberate, documented enumeration signal (R10) — byte-identical to
        // what this door has always shipped. 200/no-store.
        return answer({ ok: false, status: "existing_account" });
      case "locked":
        return answer({ ok: false, status: "locked" });
      case "pending_elsewhere":
        return answer({ ok: false, status: "pending_elsewhere" });
      case "retryable":
        return answer({ ok: false, status: "retryable" });
      case "failed":
        // A failure here is our fault, not a bad guess — hand the strikes back.
        releaseStrikes();
        return refuse("outage");
      case "started":
        // NO attemptId (v3 review FIX 1, design A): the verify/resend doors are
        // email-keyed, so nothing that identifies a row crosses to the client.
        return answer({ ok: true, status: "code_sent" });
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
