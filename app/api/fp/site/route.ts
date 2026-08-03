/**
 * GET /api/fp/site — the First Profit SPA's public-site SELF-READ
 * (real-public-site plan, Unit 2): the account's own registry-row status,
 * `{ok, handle, status: none|claimed|published|offline, projected}`. This is the
 * split-storage READ-BACK the FP hydrate and Your-Site-room-open consume; the
 * anon RPC cannot serve it (the client does not know its handle at hydrate,
 * and never-published rows are deliberately invisible there). `offline`
 * covers parent-unpublished AND operator-locked WITHOUT distinguishing them
 * to the child.
 *
 * Deliberately UNGATED by the feature flag: it reads only the caller's own
 * row and answers `none` while the feature is dark — hydrate stays simple and
 * nothing is revealed. Claim/availability/publish are the gated surfaces.
 *
 * Thin wrapper over ./site-gateway (CORS mirror + child gate + rate limit)
 * and ./site-core readSiteStatus. Contract for the FP client (first-profit
 * Unit 4): 200 {ok:true, handle: string|null, status, projected:
 * {headline: string, oneLiner: string} | null} on success — `projected` is
 * the OWN row's server-sanitized public content (null when no row), so the
 * FP room can show honestly what the public page renders (a blocklisted
 * string is stored empty; Unit 7 review, cross-repo divergence fix); a DB
 * outage is the structured 200 {ok:false, reason:"outage"} (server-wide
 * state — no per-account oracle; the strikes are released). Every AUTH
 * refusal is the one generic 401.
 */

import { withFpChild, siteOptions } from "./site-gateway";
import { readSiteStatus } from "./site-core";
import { SITE_READ_RATE_LIMIT } from "./site-rules";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: Request): Promise<Response> {
  return siteOptions(req, "GET, OPTIONS");
}

export async function GET(req: Request): Promise<Response> {
  return withFpChild(
    req,
    { endpoint: "read", limit: SITE_READ_RATE_LIMIT, gated: false },
    async ({ admin, profileId, headers, releaseStrikes }) => {
      const status = await readSiteStatus(admin, profileId);
      if (!status.ok) {
        releaseStrikes();
        return new Response(JSON.stringify({ ok: false, reason: "outage" }), {
          status: 200,
          headers,
        });
      }
      return new Response(
        JSON.stringify({
          ok: true,
          handle: status.handle,
          status: status.status,
          projected: status.projected,
        }),
        { status: 200, headers }
      );
    }
  );
}
