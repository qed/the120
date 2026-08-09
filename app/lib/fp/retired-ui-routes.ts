/**
 * THE RETIRED FIRST PROFIT UI ROUTES, AND WHERE THEY LAND NOW (v3 plan Unit 10, R16).
 *
 * The120 no longer renders First Profit. The learner app lives in its own
 * codebase at firstprofit.school; The120 keeps only the account front door
 * (`/start`, `/dashboard`) and the backend (`app/api/fp/*`) that the SPA calls.
 * The UI trees that used to serve `/fp/*` and `/first-profit` are gone.
 *
 * Every URL below was reachable in production, and this repo has 10 real
 * families / 17 real children live with the nurture sequence still running, so
 * a 404 is not an available outcome. Each keeps a page whose whole body is a
 * redirect — the same shape Unit 9 used for the retired v2 deep routes
 * (`app/lib/v3-signup/v2-deep-routes.ts`), reused rather than reinvented.
 *
 * ── TWO DESTINATIONS, AND THE SPLIT IS ABOUT WHO IS HOLDING THE URL ──
 * A KID's URL (the app itself, a task, a criterion, the sign-in door) belongs
 * at firstprofit.school: that is where their account, their progress and their
 * password now work. Sending them to The120's dashboard would be a dead end —
 * they have no parent session and nothing there is theirs.
 *
 * A PARENT's URL (the family page, the review queue, an old parent invite)
 * belongs at The120's `/dashboard`: firstprofit.school has no parent surface at
 * all, so "the honest destination" for a parent is the120's dashboard, which is
 * exactly where their kids, their credentials and their add-a-kid flow are.
 *
 * ── THE ONE THAT IS A LIVE SENDER, NOT A BOOKMARK ──
 * `/fp/review` is still built by `app/lib/fp/notify/template.ts`
 * (`REVIEW_QUEUE_URL`) and mailed by the `/api/cron/path-notifications` cron,
 * which runs every 10 minutes (`vercel.json`). The cron is not retired by this
 * unit, so that URL has a LIVE producer and the pairing is asserted in
 * `app/lib/__tests__/fp-ui-retirement.test.ts` rather than left to memory: the
 * producer still names it, so the route it names must still resolve.
 *
 * ── WHAT IS DELIBERATELY *NOT* HERE ──
 *  - `/fp/fw/*` — Founders Weekend, a staff/guide tool that only shares the URL
 *    prefix. It is NOT First Profit's learner UI, it has no counterpart in the
 *    first-profit repo to redirect to, and its `invite/[token]` and
 *    `board/[token]` routes are token handshakes a redirect would destroy
 *    (docs/solutions/logic-errors/a-retired-route-that-a-machine-calls-back-…).
 *    It stays whole; retiring it is its own unit.
 *  - `/api/fp/*` — the backend firstprofit.school talks to. Untouched.
 */

import { FIRST_PROFIT_SIGN_IN_URL } from "@/app/lib/v3-signup/flow-rules";
import { v3RemapRoute } from "@/app/lib/v3-signup/remap-rules";

/**
 * Where a KID's retired First Profit URL goes: the app, in its own codebase.
 * The SAME constant the account-ready screen and the dashboard already send
 * families to — a second literal here would be a second thing to move the day
 * the domain changes.
 */
export const FP_APP_URL: string = FIRST_PROFIT_SIGN_IN_URL;

/**
 * Where a PARENT's retired First Profit URL goes. Read FROM the remap table
 * rather than typed as a literal, exactly as `V2_DEEP_ROUTE_TARGET` is, so if
 * the dashboard ever moves these move with it.
 */
export const FP_PARENT_TARGET: string = v3RemapRoute({ screen: "dashboard" }) ?? "/dashboard";

/**
 * Where ONE child's controls live: the per-kid portal under the parent target.
 *
 * The parent-dashboard restructure split `/dashboard` into a kid LIST and a
 * per-kid portal, and the take-offline control went with the portal. A mail
 * about ONE child must therefore link to THAT child's page, not the list — the
 * R21 site-live notice is a transactional safety notice whose whole value is
 * how fast a parent can reach the control, and "find the right card among N"
 * is not fast. Built from FP_PARENT_TARGET rather than a second literal so the
 * two move together if the dashboard ever moves again.
 */
export function fpParentKidTarget(childId: string): string {
  return `${FP_PARENT_TARGET}/kids/${childId}`;
}

/**
 * Where the retired `/first-profit` ad landing goes: the front door the ads
 * were selling. Named here rather than typed in the page so the whole retired
 * surface reads from one table.
 */
export const FP_LANDING_TARGET = "/start";

/**
 * The retired URLs, as route-file paths relative to `app/`, each with the
 * destination its holder should land on. The list is what makes "all of them
 * still resolve" checkable instead of remembered.
 */
export const RETIRED_FP_UI_ROUTES: readonly { readonly file: string; readonly target: string }[] =
  [
    // The kid's app.
    { file: "fp/page.tsx", target: FP_APP_URL },
    { file: "fp/now/page.tsx", target: FP_APP_URL },
    { file: "fp/task/[taskId]/page.tsx", target: FP_APP_URL },
    { file: "fp/criterion/[criterionId]/page.tsx", target: FP_APP_URL },
    { file: "fp/onboarding/page.tsx", target: FP_APP_URL },
    { file: "fp/notifications/page.tsx", target: FP_APP_URL },
    { file: "fp/sign-in/page.tsx", target: FP_APP_URL },
    // The parent's surfaces.
    { file: "fp/family/page.tsx", target: FP_PARENT_TARGET },
    { file: "fp/review/page.tsx", target: FP_PARENT_TARGET },
    { file: "fp/invite/[token]/page.tsx", target: FP_PARENT_TARGET },
    // The group-neutral ad landing. Broad ads pointed at it and may still be
    // in flight, so it goes to the front door the ads were selling: `/start`.
    { file: "first-profit/page.tsx", target: FP_LANDING_TARGET },
  ];
