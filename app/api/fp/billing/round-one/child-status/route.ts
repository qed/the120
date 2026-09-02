/**
 * GET /api/fp/billing/round-one/child-status
 *
 * Task-runner access read. The child id is never accepted from the caller;
 * verified child JWT → fp_player_profiles → children derives both child and
 * parent, then the same entitlement read model as the parent endpoint answers.
 */

import { readRoundOneStatus } from "../round-one-core";
import { buildRoundOneCoreDeps } from "../round-one-store";
import {
  roundOneProductVersionFromEnv,
  ROUND_ONE_PRODUCT_KEY,
} from "../round-one-rules";
import {
  roundOneOptions,
  withRoundOneChild,
} from "../round-one-gateway";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function OPTIONS(req: Request): Promise<Response> {
  return roundOneOptions(req, "GET, OPTIONS");
}

export async function GET(req: Request): Promise<Response> {
  return withRoundOneChild(req, async (ctx) => {
    const productVersion = roundOneProductVersionFromEnv(
      process.env.FP_ROUND_ONE_PRODUCT_VERSION
    );
    if (!productVersion) {
      ctx.releaseStrikes();
      return ctx.unavailable();
    }
    const result = await readRoundOneStatus(buildRoundOneCoreDeps(ctx.admin), {
      parentId: ctx.parentId,
      childId: ctx.childId,
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
  });
}
