/**
 * POST /api/fp/site/publish — the explicit go-live call (real-public-site
 * plan, Unit 2; the Key Technical Decision: "go live" is NEVER inferred from
 * save-doc writes). Idempotent via first_published_at; before flipping it
 * re-syncs headline/one_liner from the current save doc and first_name from
 * the roster (publish is the authoritative content refresh), and writes
 * content + published + first_published_at in ONE statement (the
 * published-implies-stamped CHECK requires the stamp to ride along). The
 * parent notification (R21) goes out on every hidden→visible transition —
 * first publish AND a republish after a parent takedown; a publish while
 * operator-locked writes nothing, sends nothing, and answers the locked/
 * offline state; a missing parent email or failed send NEVER blocks the
 * publish — it flags loudly for operator attention.
 *
 * No request body. Contract for the FP client (Unit 4), all 200:
 *   {ok:true,  status:"published", firstPublish: boolean, parentNotified: boolean}
 *   {ok:false, reason:"no-site"}
 *   {ok:false, reason:"locked", status:"offline"}
 *   {ok:false, reason:"outage"}
 * Every auth/gate refusal is the one generic 401.
 */

import { withFpChild, siteOptions, buildSiteCoreDeps } from "./../site-gateway";
import { publishSite } from "./../site-core";
import { SITE_PUBLISH_RATE_LIMIT } from "./../site-rules";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: Request): Promise<Response> {
  return siteOptions(req, "POST, OPTIONS");
}

export async function POST(req: Request): Promise<Response> {
  return withFpChild(
    req,
    { endpoint: "publish", limit: SITE_PUBLISH_RATE_LIMIT, gated: true },
    async ({ admin, profileId, childId, headers, releaseStrikes }) => {
      const result = await publishSite(buildSiteCoreDeps(admin), { profileId, childId });
      // A DB outage rides the STRUCTURED 200 shape the contract above promises
      // (server-wide state, no per-account oracle); the strikes are released
      // because an outage is not the caller's spend.
      if (!result.ok && result.reason === "outage") releaseStrikes();
      return new Response(JSON.stringify(result), { status: 200, headers });
    }
  );
}
