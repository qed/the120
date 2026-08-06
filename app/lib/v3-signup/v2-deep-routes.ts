/**
 * THE RETIRED v2 DEEP ROUTES, AND WHERE THEY LAND NOW (plan Unit 9, R17).
 *
 * `app/start/*` moved to `archive/new-user-v2/` and v3 took `/start`. Five v2
 * URLs went with it (six route files — the child walk has a `/review` leg), and
 * every one of them is in somebody's browser history, in a sent email, or both:
 *
 *   /start/children          the add-a-child grid
 *   /start/child/[childId]   the merged application walk (and its /review leg,
 *                            which `app/lib/funnel/actions/full-core.ts` puts
 *                            in staff mail verbatim)
 *   /start/review            the application review landing
 *   /start/next-steps        the offer email's front door (app/crm/lib/offer-rules.ts)
 *   /start/waitlist          where a closed checkout sends a family
 *                            (app/api/checkout/route.ts)
 *
 * A 404 for any of them is the one outcome the plan's success criterion ("no
 * family stranded") forbids, so each keeps a page whose whole body is a
 * redirect.
 *
 * ── THE ONE THAT IS NOT ON THIS LIST: /start/arrival ──
 * It was, for one release, and that was a mistake worth naming here. That URL is
 * not a bookmark from a retired flow: it is Stripe's `success_url`
 * (`app/lib/funnel/deposit-core.ts`), and deposit checkout is LIVE — the
 * dashboard's reserve buttons open it today. A family lands on it seconds after
 * being charged, normally BEFORE the webhook has committed, so a redirect sent
 * them to a dashboard that could not yet show their payment, with no pending
 * state and no explanation. It is a REAL v3 route again
 * (`app/start/arrival/page.tsx` + `ArrivalWatch`), carrying the webhook-race
 * poll the archived v2 flow existed to provide.
 *
 * ── WHY THEY ALL POINT AT THE DASHBOARD, AND WHY THAT IS *NOT* A SHRUG ──
 * The obvious alternative — resolve the family's v2 verdict here and send them
 * at the v3 step the remap table names — would make each of these files a
 * SEVENTH producer of destinations, re-deriving per route exactly the way Unit
 * 8's review found the dashboard card and the session gate disagreeing. The
 * dashboard IS the remap's consumer: `dashboardGateVerdict` loads the family,
 * asks `childNextRoute`, and forwards them onward. So "redirect to the
 * dashboard" is not a fallback destination, it is a delegation to the one
 * router — and it is the same answer the table itself gives for every v2 cell
 * these URLs correspond to, except the cells that owe unfinished work on a kid
 * (the two `mini_app` ones, the dossier and the waitlisted), which the dashboard
 * then offers the kid step on the family's behalf.
 *
 * The target is READ FROM the table (`v3RemapRoute`) rather than typed as a
 * literal, so if the dashboard ever moves, all of these move with it.
 */

import { v3RemapRoute } from "./remap-rules";

/** Where every retired v2 deep route sends a visitor. */
export const V2_DEEP_ROUTE_TARGET: string = v3RemapRoute({ screen: "dashboard" }) ?? "/dashboard";

/**
 * The retired URLs, as route-file paths relative to `app/`. Exported for the
 * test that pins one redirect page per entry — the list is what makes "all of
 * them still resolve" checkable instead of remembered. `start/arrival/page.tsx`
 * is deliberately absent: it is a live route (see the header).
 */
export const RETIRED_V2_ROUTE_FILES: readonly string[] = [
  "start/children/page.tsx",
  "start/child/[childId]/page.tsx",
  "start/child/[childId]/review/page.tsx",
  "start/review/page.tsx",
  "start/next-steps/page.tsx",
  "start/waitlist/page.tsx",
];
