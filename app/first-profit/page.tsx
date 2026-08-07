import { redirect } from "next/navigation";

import { FP_LANDING_TARGET } from "@/app/lib/fp/retired-ui-routes";

/**
 * Retired First Profit landing (v3 plan Unit 10, R16).
 *
 * This was the group-neutral sixth landing page — the destination for BROAD
 * ads, linked from nowhere inside the site (pinned by
 * `app/lib/__tests__/landing-content.test.ts`). Ad creative already in flight
 * still names it, so it cannot 404; and the thing the ads were selling is now
 * bought at one place, the v3 front door. `/start` it is.
 *
 * The literal lives in `app/lib/fp/retired-ui-routes.ts` alongside the rest of
 * the retired First Profit surface, so the whole set moves together.
 */
export default function RetiredFirstProfitLanding(): never {
  redirect(FP_LANDING_TARGET);
}
