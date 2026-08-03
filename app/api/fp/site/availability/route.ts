/**
 * POST /api/fp/site/availability — handle availability for the claim flow
 * (real-public-site plan, Unit 2). Normalizes, runs the FULL server pipeline
 * (format → reserved → blocklist), answers `available | taken | yours |
 * invalid` — `yours` = this account's own handle; a taken handle NEVER
 * identifies its owner. Suggestions ride only the `taken` verdict, are
 * bounded, and pass the IDENTICAL validation pipeline + a DB taken-check
 * before being returned.
 *
 * FEATURE-GATED (with claim/publish): availability is the enumeration-shaped
 * surface, so it opens only with the rest of the claim flow. Roomy per-user
 * budget (a learner cycling suggestions must never be locked out of
 * onboarding).
 *
 * Contract for the FP client (Unit 4): 200 {ok:true, verdict, suggestions:
 * string[]} on success; a DB outage is the structured 200
 * {ok:false, reason:"outage"} (server-wide state — no per-account oracle; the
 * strikes are released). Every AUTH/gate refusal is the one generic 401.
 */

import { withFpChild, siteOptions } from "./../site-gateway";
import { checkAvailability } from "./../site-core";
import { parseHandleRequest, SITE_AVAILABILITY_RATE_LIMIT } from "./../site-rules";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: Request): Promise<Response> {
  return siteOptions(req, "POST, OPTIONS");
}

export async function POST(req: Request): Promise<Response> {
  return withFpChild(
    req,
    { endpoint: "availability", limit: SITE_AVAILABILITY_RATE_LIMIT, gated: true },
    async ({ admin, profileId, headers, refuse, releaseStrikes }) => {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return refuse("malformed_request");
      }
      const parsed = parseHandleRequest(body);
      if (!parsed.ok) return refuse("malformed_request");

      const result = await checkAvailability(admin, { profileId, rawHandle: parsed.handle });
      if (!result.ok) {
        releaseStrikes();
        return new Response(JSON.stringify({ ok: false, reason: "outage" }), {
          status: 200,
          headers,
        });
      }
      return new Response(
        JSON.stringify({ ok: true, verdict: result.verdict, suggestions: result.suggestions }),
        { status: 200, headers }
      );
    }
  );
}
