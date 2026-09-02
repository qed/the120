/**
 * GET /api/fp/billing/round-one/status?childId=<uuid>
 *
 * The parent-safe read model for the Let’s Go gate and returning devices.
 * `access.granted` derives only from the durable entitlement row written by a
 * signed webhook or the service-role comp/grandfather seam.
 */

import { readRoundOneStatus } from "../round-one-core";
import { buildRoundOneCoreDeps } from "../round-one-store";
import {
  parseRoundOneStatusChildId,
  roundOneProductVersionFromEnv,
  ROUND_ONE_PRODUCT_KEY,
  ROUND_ONE_STATUS_RATE_LIMIT,
} from "../round-one-rules";
import {
  roundOneOptions,
  withRoundOneParent,
} from "../round-one-gateway";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function OPTIONS(req: Request): Promise<Response> {
  return roundOneOptions(req, "GET, OPTIONS");
}

export async function GET(req: Request): Promise<Response> {
  return withRoundOneParent(
    req,
    { endpoint: "status", limit: ROUND_ONE_STATUS_RATE_LIMIT },
    async (ctx) => {
      const childId = parseRoundOneStatusChildId(new URL(req.url).searchParams.get("childId"));
      const productVersion = roundOneProductVersionFromEnv(
        process.env.FP_ROUND_ONE_PRODUCT_VERSION
      );
      if (!childId || !productVersion) {
        return new Response(JSON.stringify({ ok: false, error: "Invalid request." }), {
          status: 400,
          headers: ctx.headers,
        });
      }
      const result = await readRoundOneStatus(buildRoundOneCoreDeps(ctx.admin), {
        parentId: ctx.parentId,
        childId,
        productKey: ROUND_ONE_PRODUCT_KEY,
        productVersion,
      });
      if (result.kind === "refused") return ctx.refuse();
      if (result.kind === "unavailable") {
        ctx.releaseStrikes();
        return ctx.unavailable();
      }
      return new Response(JSON.stringify(result.body), {
        status: 200,
        headers: ctx.headers,
      });
    }
  );
}
