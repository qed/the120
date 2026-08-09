/**
 * `POST /api/fp/login-code/request` (fpv03 U3c) — the kid taps "email my
 * parent a code" on firstprofit.school's login screen with only their
 * username. Anonymous, cross-origin, hostile-facing: the login route's twin
 * on the wire (same Origin allowlist, same attested-IP extractor, same
 * limiter-before-work ordering), with ONE deliberate difference:
 *
 * ── THE ANSWER IS ALWAYS THE SAME 200 ──
 * A known username, an unknown one, a suppressed family, the outstanding-cap,
 * a failed send, and an outage all answer LOGIN_CODE_REQUEST_UNIFORM_BODY —
 * one string, serialized once ("If this account exists, we emailed the parent
 * a code."). There is nothing here to grant, so there is nothing to refuse
 * with: a distinct body or status for any branch would be a free username-
 * enumeration oracle. Only a disallowed Origin (403, a fact the sender knows)
 * and a rate-limited/malformed request (the same uniform 200, minus the work)
 * fall out earlier. The internal outcome goes to the server log.
 *
 * Residual timing honesty: a match additionally inserts a row and awaits the
 * mail send. That difference is accepted (see login-code-core's header) — it
 * is bounded by the 3/15min per-username budget, and closing it fully would
 * mean fire-and-forgetting mail on a serverless runtime that may not finish
 * it.
 *
 * NEVER log the code (it exists in plaintext only inside the send call).
 */

import { randomInt } from "node:crypto";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { sendLoginCodeEmail } from "@/app/lib/fp/parent-email/send";
import {
  FP_LOGIN_CODE_REQUEST_IP_RATE_LIMIT,
  FP_LOGIN_CODE_REQUEST_PARENT_RATE_LIMIT,
  FP_LOGIN_CODE_REQUEST_RATE_LIMIT,
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
import { requestLoginCode, type CodeRequestDeps } from "../login-code-core";
import {
  deriveCodeRequestParentRateLimitKey,
  deriveCodeRequestRateLimitKeys,
  formatLoginCode,
  LOGIN_CODE_REQUEST_STATUS,
  LOGIN_CODE_REQUEST_UNIFORM_BODY,
  LOGIN_CODE_LENGTH,
} from "../login-code-rules";

export const dynamic = "force-dynamic";

/** Identical to the login route's CORS posture — never `*`, never credentials. */
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
    console.warn(
      `[fp/login-code] refused origin (403): origin=${JSON.stringify(req.headers.get("origin"))}`
    );
    return new Response(null, {
      status: 403,
      headers: { "Cache-Control": "no-store", Vary: "Origin" },
    });
  }
  const headers = corsJsonHeaders(verdict.origin);
  const uniform = (): Response =>
    new Response(LOGIN_CODE_REQUEST_UNIFORM_BODY, { status: LOGIN_CODE_REQUEST_STATUS, headers });

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      // Malformed JSON reflects only the caller's own input — but the uniform
      // answer is FREE here, so it stays one response for everything.
      return uniform();
    }

    // Derive the rate-limit username segment from the typed identifier the
    // same way the core will (classifyIdentifier's normalization) so "Alex "
    // and "alex" share one budget. A non-classifiable identifier can never
    // resolve; skip the work and answer uniformly.
    const username =
      typeof (body as { username?: unknown })?.username === "string"
        ? ((body as { username: string }).username)
        : "";
    const classified = classifyIdentifier(username);
    if (classified.kind === "refuse") return uniform();

    // Gate FIRST, atomically, both buckets recorded before the verdict (the
    // login route's discipline). A rate-limited request gets the SAME uniform
    // 200 — no status oracle, and no work.
    const ip = extractClientIp(req.headers);
    const { usernameKey, ipKey } = deriveCodeRequestRateLimitKeys(ip, classified.normalized);
    const nameCheck = checkAndRecordRateLimit(usernameKey, FP_LOGIN_CODE_REQUEST_RATE_LIMIT);
    const ipCheck = checkAndRecordRateLimit(ipKey, FP_LOGIN_CODE_REQUEST_IP_RATE_LIMIT);
    if (!nameCheck.allowed || !ipCheck.allowed) return uniform();

    const deps: CodeRequestDeps = {
      db: () => supabaseAdmin(),
      // crypto.randomInt is uniform over [0, 10^6) — never Math.random for a
      // credential, however small.
      mintCode: () => formatLoginCode(randomInt(0, 10 ** LOGIN_CODE_LENGTH)),
      sendCodeEmail: async ({ parentId, childFirstName, code }) => {
        const outcome = await sendLoginCodeEmail(supabaseAdmin(), {
          parentId,
          childFirstName,
          code,
        });
        // The detail (suppressed/no_family/send_failed) is already logged by
        // the send layer; the core only needs sent-or-not.
        return { sent: outcome.status === "sent" };
      },
      // Per-parent-inbox throttle (FIX 2): the resolved parent id is the only
      // key that bounds a mail-bomb across a family's several child usernames.
      // Key derivation is total-encoded and runs inside this route's
      // constant-refusal try/catch, so a crafted identifier can never 500.
      recordParentInboxAttempt: (parentId) =>
        checkAndRecordRateLimit(
          deriveCodeRequestParentRateLimitKey(parentId),
          FP_LOGIN_CODE_REQUEST_PARENT_RATE_LIMIT
        ).allowed,
      releaseParentInboxAttempt: (parentId) =>
        releaseRateLimitEvent(deriveCodeRequestParentRateLimitKey(parentId)),
      now: () => Date.now(),
    };

    const outcome = await requestLoginCode(deps, body);
    if (outcome === "outage") {
      // Our fault, not an attempt — release the provisional strikes so a DB
      // blip never locks a username's tiny budget. Same uniform answer.
      releaseRateLimitEvent(usernameKey);
      releaseRateLimitEvent(ipKey);
    }
    // Every outcome — sent, suppressed, no_child, capped, outage — is the one
    // uniform body. The distinction lives in the server log only.
    return uniform();
  } catch (err) {
    console.error(
      `[fp/login-code] request unexpected error: ${err instanceof Error ? err.message : String(err)}`
    );
    return uniform();
  }
}
