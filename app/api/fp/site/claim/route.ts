/**
 * POST /api/fp/site/claim — the atomic handle claim (real-public-site plan,
 * Unit 2; R3, R24). The ARBITER is the fp_public_sites handle UNIQUE
 * constraint hit by a single INSERT (see site-core's header — never
 * select-then-insert as a gate, never an upsert); a unique-violation is the
 * DESIGNED `taken` branch with fresh suggestions. The claim binds to the
 * SESSION's profile — a smuggled profile id in the body does not survive
 * parsing, let alone reach the insert (R24). Re-claiming your own handle is
 * idempotent success; a second, different handle answers `already-claimed`
 * (no renames in v1). The inserted row is born content-complete: first_name
 * snapshotted from the roster, headline/one_liner backfilled from the current
 * save doc via the shared SQL extraction, blocklist-enforced (offending
 * strings stored empty).
 *
 * Contract for the FP client (Unit 4), all 200:
 *   {ok:true,  handle, status: "claimed"|"published"|"offline"}
 *   {ok:false, reason:"invalid"}
 *   {ok:false, reason:"taken", suggestions: string[]}
 *   {ok:false, reason:"already-claimed", handle}
 *   {ok:false, reason:"outage"}
 * Every auth/gate refusal is the one generic 401.
 */

import { withFpChild, siteOptions, buildSiteCoreDeps } from "./../site-gateway";
import { claimSite } from "./../site-core";
import { parseHandleRequest, SITE_CLAIM_RATE_LIMIT } from "./../site-rules";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: Request): Promise<Response> {
  return siteOptions(req, "POST, OPTIONS");
}

export async function POST(req: Request): Promise<Response> {
  return withFpChild(
    req,
    { endpoint: "claim", limit: SITE_CLAIM_RATE_LIMIT, gated: true },
    async ({ admin, profileId, childId, headers, refuse, releaseStrikes }) => {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return refuse("malformed_request");
      }
      const parsed = parseHandleRequest(body);
      if (!parsed.ok) return refuse("malformed_request");

      const result = await claimSite(buildSiteCoreDeps(admin), {
        profileId,
        childId,
        rawHandle: parsed.handle,
      });
      // A DB outage rides the STRUCTURED 200 shape the contract above promises
      // (server-wide state, no per-account oracle); the strikes are released
      // because an outage is not the caller's spend.
      if (!result.ok && result.reason === "outage") releaseStrikes();
      return new Response(JSON.stringify(result), { status: 200, headers });
    }
  );
}
