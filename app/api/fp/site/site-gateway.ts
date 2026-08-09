/**
 * Impure request gateway shared by the four /api/fp/site/* routes (self-read,
 * availability, claim, publish) — ONE implementation of the CORS +
 * child-session discipline so four sibling endpoints can never drift apart on
 * it. NOTE (review-pinned honesty): this is a MANUALLY-MAINTAINED PARALLEL
 * implementation of the discipline /api/fp/login and /api/fp/grade each carry
 * inline — not a shared abstraction those routes consume. Anyone changing the
 * CORS/refusal contract here MUST check login/grade for the same change (and
 * vice versa); unifying all three behind one gateway is deliberately deferred.
 * The discipline itself:
 *
 *   - OPTIONS 204 with the echoed origin; 403 for a bad/missing Origin
 *     (exact-match allowlist, never `*`); Cache-Control no-store; Vary:
 *     Origin. `authorization` allowed — this surface takes the child's Bearer
 *     session token, no cookies (CSRF-resistant by construction).
 *   - ONE generic 401 for every refusal (byte-identical body via
 *     shapeSiteRefusal; the reason lives only in the server log — no oracle).
 *   - Attested-IP extraction (login-rules extractClientIp), atomic rate-limit
 *     strike BEFORE any DB I/O with release-on-outage.
 *   - Token verification via auth.getUser() on a per-request bearer-bound
 *     client, THEN the FP child gate: the session must resolve to an existing
 *     fp_player_profiles row (resolveFpChild). Identity flows only from the
 *     verified token — a smuggled profile id in a body does not exist as a
 *     concept here (R24).
 *   - FEATURE GATE (claim/availability/publish; the self-read is deliberately
 *     ungated — it is the child's own read-back and answers `none` while the
 *     feature is dark): checked AFTER the strike (no timing oracle), refused
 *     as the same generic 401 (the signup launch-gate precedent).
 *   - Everything past the Origin gate is wrapped: an unhandled throw surfaces
 *     as the SAME 401, never Next's error page. A throw fails closed (strikes
 *     stand); each I/O site releases explicitly.
 */

import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { supabaseParentToken } from "@/app/lib/supabase/parent-token";
import {
  checkAndRecordRateLimit,
  releaseRateLimitEvent,
} from "@/app/lib/fp/rate-limit-store";
import type { RateLimitConfig } from "@/app/lib/fp/rate-limit-rules";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildAllowedOrigins,
  checkOrigin,
  extractClientIp,
} from "../login/login-rules";
import { extractBearerToken, unverifiedJwtSub } from "../grade/grade-rules";
import {
  deriveSiteRateLimitKeys,
  shapeSiteRefusal,
  siteGateVerdict,
  SITE_IP_RATE_LIMIT,
  type SiteRefusalReason,
} from "./site-rules";
import { resolveFpChild, type SiteCoreDeps } from "./site-core";
import { sendEmail } from "@/app/lib/email";
import { fpParentKidTarget } from "@/app/lib/fp/retired-ui-routes";
import { SITE_URL } from "@/app/lib/site";
import type { SiteContent, SiteProduct } from "@/app/lib/fp/fp-public-site-rules";

/**
 * The real SiteCoreDeps the claim/publish routes hand the cores. Content
 * extraction goes through the SHARED SQL function via RPC (service role;
 * EXECUTE granted in 20260908120000) so the doc→projection mapping has ONE
 * source of truth with the trigger; an RPC failure degrades to the NULL
 * sentinel (nothing extractable — publish repeats the sync next time), never
 * a hard failure.
 */
export function buildSiteCoreDeps(admin: SupabaseClient): SiteCoreDeps {
  return {
    db: admin,
    extractContent: async (doc: unknown): Promise<SiteContent | null> => {
      try {
        const res = await admin.rpc("fp_public_site_content", { p_doc: doc ?? {} });
        if (res.error) {
          console.error(`[fp/site] extraction rpc failed: ${res.error.message}`);
          return null;
        }
        const row = (Array.isArray(res.data) ? res.data[0] : res.data) as
          | { headline?: unknown; one_liner?: unknown; products?: unknown }
          | null
          | undefined;
        return {
          headline: typeof row?.headline === "string" ? row.headline : null,
          oneLiner: typeof row?.one_liner === "string" ? row.one_liner : null,
          // The extraction's NULL sentinel (ideas absent/not an array) arrives
          // as SQL null; anything else is the sanitized array (possibly []).
          products: Array.isArray(row?.products) ? (row.products as SiteProduct[]) : null,
        };
      } catch (err) {
        console.error(
          `[fp/site] extraction rpc threw: ${err instanceof Error ? err.message : String(err)}`
        );
        return null;
      }
    },
    sendMail: (input) => sendEmail(input),
    // Was `/fp/family` — the First Profit parent page, retired in v3 plan
    // Unit 10. The dashboard is where a parent's kids live now. `/dashboard`
    // itself is only the kid LIST, and the kid's portal is the KID's apps, so
    // this resolves per child to that child's ACCOUNT page — the one that
    // actually mounts the take-offline control the R21 mail promises. The path
    // lives in fpParentKidTarget, which moves whenever the control does.
    manageUrl: (childId: string) => `${SITE_URL}${fpParentKidTarget(childId)}`,
  };
}

/** Headers for responses to an allowed origin. Never `*`, never credentials. */
export function corsJsonHeaders(origin: string): Record<string, string> {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  };
}

/** Shared OPTIONS handler; `methods` names the route's own verbs. */
export function siteOptions(req: Request, methods: string): Response {
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
      "Access-Control-Allow-Methods": methods,
      "Access-Control-Allow-Headers": "content-type, authorization",
      "Access-Control-Max-Age": "86400",
      "Cache-Control": "no-store",
      Vary: "Origin",
    },
  });
}

export type SiteRequestContext = {
  admin: SupabaseClient;
  profileId: string;
  childId: string;
  headers: Record<string, string>;
  refuse: (reason: SiteRefusalReason) => Response;
  releaseStrikes: () => void;
};

/**
 * Run `handler` behind the full gateway. `endpoint` picks the rate-limit
 * bucket + budget; `gated: true` applies the feature gate after the child
 * resolution (the allowlist is keyed on children.fp_username).
 */
export async function withFpChild(
  req: Request,
  opts: { endpoint: "read" | "availability" | "claim" | "publish"; limit: RateLimitConfig; gated: boolean },
  handler: (ctx: SiteRequestContext) => Promise<Response>
): Promise<Response> {
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
  const refuse = (reason: SiteRefusalReason): Response => {
    const shaped = shapeSiteRefusal(reason);
    return new Response(shaped.body, { status: shaped.status, headers });
  };

  try {
    const token = extractBearerToken(req.headers);
    if (!token) return refuse("missing_token");
    const sub = unverifiedJwtSub(token);
    if (!sub) return refuse("invalid_token");

    const ip = extractClientIp(req.headers);
    const { userKey, ipKey } = deriveSiteRateLimitKeys(opts.endpoint, ip, sub);
    const releaseStrikes = (): void => {
      releaseRateLimitEvent(userKey);
      releaseRateLimitEvent(ipKey);
    };

    // Gate FIRST — atomically, before any DB I/O (house limiter discipline).
    // Record BOTH buckets before the verdict; the refusal is the SAME generic
    // 401, never a 429.
    const userCheck = checkAndRecordRateLimit(userKey, opts.limit);
    const ipCheck = checkAndRecordRateLimit(ipKey, SITE_IP_RATE_LIMIT);
    if (!userCheck.allowed || !ipCheck.allowed) return refuse("rate_limited");

    // Verify the token (genuine + unexpired); a network throw is an outage,
    // not a guess.
    let userId: string;
    try {
      const who = await supabaseParentToken(token).auth.getUser();
      if (who.error || !who.data?.user) return refuse("invalid_token");
      userId = who.data.user.id;
    } catch (err) {
      console.error(
        `[fp/site] token verification threw: ${err instanceof Error ? err.message : String(err)}`
      );
      releaseStrikes();
      return refuse("outage");
    }

    const admin = supabaseAdmin();
    const child = await resolveFpChild(admin, userId);
    if (!child.ok) {
      if (child.reason === "outage") {
        releaseStrikes();
        return refuse("outage");
      }
      return refuse("not_child");
    }

    if (opts.gated) {
      const gate = siteGateVerdict(child.fpUsername, {
        FP_SITE_TEST_ONLY: process.env.FP_SITE_TEST_ONLY,
        FP_SITE_TEST_ALLOWLIST: process.env.FP_SITE_TEST_ALLOWLIST,
      });
      if (!gate.allowed) return refuse("gate_refused");
    }

    return await handler({
      admin,
      profileId: child.profileId,
      childId: child.childId,
      headers,
      refuse,
      releaseStrikes,
    });
  } catch (err) {
    console.error(
      `[fp/site] unexpected error (${opts.endpoint}): ${err instanceof Error ? err.message : String(err)}`
    );
    return refuse("outage");
  }
}
