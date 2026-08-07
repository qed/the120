/**
 * /api/fp/signup/consent — First Profit VERIFIABLE PARENTAL CONSENT RECORD
 * (Slice B Unit 9 review, FIX 1; R15). The AUTHENTICATED cross-origin POST the
 * SPA makes AFTER the parent has verified their email (so the parent session
 * exists) and BEFORE the child mint. It carries the parent's Bearer access token
 * (from /api/fp/signup/verify, Rev 1), the `attemptId`, and the bind-to-rendered
 * consent echo (echoedVersion + echoedHash + method + childAgeBand + childDob? +
 * jurisdiction), and writes the consent row that /api/fp/signup/child's
 * consentGate later claims. Without this row every real child mint fails
 * `consent_required` — consent is a separate, legally-distinct step from the
 * child create, so it has its own route rather than loosening the child schema.
 *
 * CORS MIRROR of ../child/route.ts (exactly): OPTIONS 204 with the echoed origin,
 * 403 for a bad Origin, one generic 401 for EVERY refusal (the recordConsent
 * reason lives only in the server log — no oracle), no-store, an atomic
 * rate-limit strike before any DB I/O with release-on-outage, force-dynamic.
 * `authorization` is in the allowed request headers (this surface takes the
 * parent Bearer). NEVER log the token or any PII (email, DOB, jurisdiction).
 *
 * ── verdict mapping (recordConsent → wire) ──
 *   ok         → 200 { ok:true, status:"consent_recorded" }.
 *   duplicate  → 200 { ok:true, status:"consent_recorded" } — a retried consent
 *                is idempotent success (the active consent already exists).
 *   outage     → generic 401 AND release the rate-limit strike (our fault).
 *   everything else (missing | stale | version_mismatch | not_verified |
 *                parent_mismatch) → generic 401, strike stands.
 */

import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { supabaseParentToken } from "@/app/lib/supabase/parent-token";
import {
  checkAndRecordRateLimit,
  releaseRateLimitEvent,
} from "@/app/lib/fp/rate-limit-store";
import { z } from "zod";
import {
  buildAllowedOrigins,
  checkOrigin,
  extractClientIp,
  shapeSignupRefusal,
  SIGNUP_IP_RATE_LIMIT,
  SIGNUP_RATE_LIMIT,
} from "../signup-rules";
import { parseConsentAccept } from "../consent-rules";
import { recordConsent } from "../consent-core";

export const dynamic = "force-dynamic";

// attemptId is validated HERE (a UUID, mirroring ../child/route.ts's reasoning:
// a non-UUID would otherwise reach Postgres, error 22P02, be laundered into an
// `outage`, and REFUND the strike). The consent echo fields are validated by the
// STRICT `parseConsentAccept` (consent-rules.ts) — attemptId is split off first
// so that strict schema is fed only the accept fields it knows about, keeping
// its strictness on the rest of the body.
const attemptIdSchema = z.object({ attemptId: z.uuid() });

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
      // `authorization` — this surface takes the parent Bearer token.
      "Access-Control-Allow-Headers": "content-type, authorization",
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
    // The Bearer parent token — proves the caller is the just-verified parent.
    const authz = req.headers.get("authorization") ?? "";
    const token = authz.toLowerCase().startsWith("bearer ") ? authz.slice(7).trim() : "";
    if (!token) return refuse();

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return refuse();
    }

    // Split attemptId off, then hand the REST to the strict accept parser so its
    // strictness governs the consent echo fields (rejecting unknown keys) while
    // attemptId rides alongside.
    const attemptParsed = attemptIdSchema.safeParse(body);
    if (!attemptParsed.success) return refuse();
    const attemptId = attemptParsed.data.attemptId;
    const { attemptId: _drop, ...acceptFields } = body as Record<string, unknown>;
    void _drop;
    const accept = parseConsentAccept(acceptFields);
    if (!accept.ok) return refuse();

    const ip = extractClientIp(req.headers);
    // A `fp-signup-consent` namespace, keyed on (ip, attemptId) + an ip aggregate,
    // distinct from START/verify/child so those budgets never interact. Same configs.
    const attemptKey = `fp-signup-consent:${encodeURIComponent(ip)}:${encodeURIComponent(attemptId)}`;
    const ipKey = `fp-signup-consent-ip:${encodeURIComponent(ip)}`;
    const releaseStrikes = (): void => {
      releaseRateLimitEvent(attemptKey);
      releaseRateLimitEvent(ipKey);
    };

    const attemptCheck = checkAndRecordRateLimit(attemptKey, SIGNUP_RATE_LIMIT);
    const ipCheck = checkAndRecordRateLimit(ipKey, SIGNUP_IP_RATE_LIMIT);
    if (!attemptCheck.allowed || !ipCheck.allowed) return refuse();

    const admin = supabaseAdmin();

    // Resolve the caller's parent id from the Bearer token (getUser verifies the
    // JWT server-side, so an expired/forged token fails here before any write —
    // same as child-core's step 1).
    let parentId: string;
    try {
      const who = await supabaseParentToken(token).auth.getUser();
      if (who.error || !who.data?.user?.id) return refuse();
      parentId = who.data.user.id;
    } catch (err) {
      // Token-free log only (never the token itself).
      console.error(
        `[fp/signup/consent] getUser threw: ${err instanceof Error ? err.message : String(err)}`
      );
      return refuse();
    }

    const result = await recordConsent(admin, {
      attemptId,
      parentId,
      echoedVersion: accept.data.echoedVersion,
      echoedHash: accept.data.echoedHash,
      method: accept.data.method,
      childAgeBand: accept.data.childAgeBand,
      childDob: accept.data.childDob ?? null,
      jurisdiction: accept.data.jurisdiction,
      ip,
      ua: req.headers.get("user-agent") ?? "",
    });

    if (!result.ok) {
      // A retried consent (the active row already exists) is idempotent SUCCESS —
      // the parent already consented; nothing to re-record. Only an `outage` is
      // our fault and releases the strike; every other refusal (missing / stale /
      // version_mismatch / not_verified / parent_mismatch) keeps it, all shaped as
      // the SAME generic 401.
      if (result.reason === "duplicate") {
        return new Response(
          JSON.stringify({ ok: true, status: "consent_recorded" }),
          { status: 200, headers }
        );
      }
      if (result.reason === "outage") releaseStrikes();
      return refuse();
    }

    return new Response(
      JSON.stringify({ ok: true, status: "consent_recorded", consentId: result.consentId }),
      { status: 200, headers }
    );
  } catch (err) {
    console.error(
      `[fp/signup/consent] unexpected error: ${err instanceof Error ? err.message : String(err)}`
    );
    return refuse();
  }
}
