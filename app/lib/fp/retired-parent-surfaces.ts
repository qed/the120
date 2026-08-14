/**
 * THE RETIRED THE120 PARENT SURFACES, AND WHERE THEY LAND NOW (fpv04 U8, R7).
 *
 * First Profit's parent surfaces now live in the first-profit repo at
 * firstprofit.school: `/signup` is the account funnel (fpv04 U4/U5a, the same
 * steps `app/start` used to render) and `/parent` is the dashboard (U6b). The
 * two front doors here are therefore replaced by redirects, in the same shape
 * Unit 9 used for the retired v2 deep routes and Unit 10 used for the retired
 * First Profit UI — reused rather than reinvented.
 *
 * ⚠ A URL PREFIX IS NOT A BOUNDARY. `/start` and `/dashboard` each have
 * sub-surfaces that DO NOT retire with their root, and the whole risk of this
 * unit is treating the prefix as the unit of work:
 *
 *   KEPT — `/start/arrival`      Stripe's `success_url`
 *                                (`app/lib/funnel/deposit-core.ts` builds
 *                                `${origin}/start/arrival?child=<id>`). A
 *                                family lands here seconds after being charged.
 *                                A redirect here breaks paid checkout returns,
 *                                and it was already retired once by mistake —
 *                                see v2-deep-routes.ts's own header.
 *   KEPT — `/dashboard/kids/[id]/account`
 *                                the per-child parent CONTROLS: password reset,
 *                                photo consent, take-page-offline. The R21
 *                                site-live safety notice links straight to it
 *                                through `fpParentKidTarget(childId)`, and its
 *                                whole value is how fast a parent reaches the
 *                                control. First Profit's S11 has no per-kid
 *                                controls page yet, so retiring this would mean
 *                                sending a parent to a list and asking them to
 *                                find the right card. It goes when that surface
 *                                exists, not before.
 *   REDIRECTED THROUGH THE ROOT — every retired v2 deep route
 *                                (`/start/next-steps`, `/start/waitlist`,
 *                                `/start/children`, `/start/review`) already
 *                                redirects to `V2_DEEP_ROUTE_TARGET`, which is
 *                                `/dashboard`, which now redirects onward. Two
 *                                hops, and deliberately so: they keep
 *                                delegating to ONE router rather than each
 *                                deriving a destination, which is the property
 *                                v2-deep-routes.ts's header argues for.
 *
 * ── THE ADD-A-KID INTENT SURVIVES THE HOP ──
 * `/start?step=kid` (V3_ADD_KID_HREF) is the dashboard's add-another-kid CTA.
 * First Profit has that exact flow at `/signup?add=1` (fpv04 U6b-iii), so the
 * redirect carries the intent across rather than dropping a parent at step 1 of
 * a signup they have already completed.
 *
 * ── WHY LITERAL URLS AND NOT A CONFIG READ ──
 * These are cross-ORIGIN destinations, not routes in this app. The one that
 * already existed (`FIRST_PROFIT_SIGN_IN_URL`) is a literal for the same
 * reason, and it is imported here rather than re-typed so the domain lives in
 * one place.
 */

import { FIRST_PROFIT_SIGN_IN_URL } from "@/app/lib/v3-signup/flow-rules";

/** `https://firstprofit.school/` with no trailing slash, for joining. */
const FP_ORIGIN = FIRST_PROFIT_SIGN_IN_URL.replace(/\/$/, "");

/** First Profit's parent dashboard (S11) — where `/dashboard` now sends. */
export const FP_PARENT_DASHBOARD_URL = `${FP_ORIGIN}/parent`;

/** First Profit's signup track (S03–S09) — where `/start` now sends. */
export const FP_SIGNUP_URL = `${FP_ORIGIN}/signup`;

/** The same track re-entered to add ANOTHER founder (fpv04 U6b-iii). */
export const FP_ADD_KID_URL = `${FP_ORIGIN}/signup?add=1`;

/**
 * Where `/start` sends a visitor, given the raw `?step=` they arrived with.
 * Pure, so the one interesting case — the add-a-kid intent surviving the
 * retirement — is testable without rendering a page.
 */
export function retiredStartTarget(rawStep: string | null | undefined): string {
  return (rawStep ?? "").trim() === "kid" ? FP_ADD_KID_URL : FP_SIGNUP_URL;
}

/**
 * The surfaces this unit retires, as route-file paths relative to `app/`. The
 * list is what makes "each one still resolves, and resolves onward" checkable
 * instead of remembered — the same device the two earlier retirements use.
 */
export const RETIRED_PARENT_SURFACE_FILES: readonly string[] = [
  "start/page.tsx",
  "dashboard/page.tsx",
];

/**
 * The surfaces that share those prefixes and are DELIBERATELY NOT retired.
 * Named here, and pinned by the unit's test, because the failure mode of this
 * kind of work is a prefix sweep that takes a live machine handshake with it.
 */
export const KEPT_UNDER_RETIRED_PREFIXES: readonly string[] = [
  "start/arrival/page.tsx",
  "dashboard/kids/[id]/account/page.tsx",
];
