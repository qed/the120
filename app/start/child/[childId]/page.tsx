import { redirect } from "next/navigation";
import { V2_DEEP_ROUTE_TARGET } from "@/app/lib/v3-signup/v2-deep-routes";

/**
 * A RETIRED v2 DEEP ROUTE (plan Unit 9, R17). The flow that lived here is in
 * `archive/new-user-v2/`; this file exists only so a bookmark or a sent email
 * does not 404. See app/lib/v3-signup/v2-deep-routes.ts for why the dashboard
 * is the honest destination rather than a per-route guess.
 *
 * `redirect()` is at the top level and outside any try — a caught NEXT_REDIRECT
 * reports failure on success, which this repo has shipped once.
 */
export default async function RetiredV2Route() {
  redirect(V2_DEEP_ROUTE_TARGET);
}
