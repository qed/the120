/**
 * The re-entry matrix (R9a): where any returning visitor lands, as ONE pure
 * decision table — not conditionals scattered across screens.
 *
 * R9a fixes the axes. Rows are entry situations: live cookie, dead cookie,
 * expired link, second click (used token), different device (valid link, no
 * cookie), family already holds a password, family already enrolled. Columns
 * are child counts: one child, several children at different stages (zero is
 * covered too — a family can capture and bounce before Add a Child). Every
 * cell names a destination screen; the table-driven test in
 * `app/lib/__tests__/funnel-session-rules.test.ts` asserts no cell is
 * undefined.
 *
 * PURE. `environment: "node"`, no jsdom — callers (U3's resume landing, U6's
 * capture, U8's shell) hand in a `ReentryContext` and route on the verdict.
 * The `enrolled` and `hasPassword` bits are INPUTS, computed by the caller
 * from deposits / auth metadata: this module decides destinations, it does
 * not re-derive facts other modules own.
 */

import {
  APPLICANT_STATES,
  type ApplicantState,
} from "@/app/lib/funnel/applicant-rules";

/**
 * The destination vocabulary. Symbolic ids, not routes: U5–U8 own the routes
 * and some screens (link_expired, link_used) are states the resume landing
 * renders in place rather than navigations. `screenRoute` maps the navigable
 * ones; re-pointing a route later is a one-line change that cannot touch the
 * decision table.
 */
export const REENTRY_SCREENS = [
  "capture", //        /start — the explainer + email capture (U6)
  "children_grid", //  /start/children — Add a Child / pick a child (U7)
  "child_resume", //   /start/child/[childId] — the mini-app seam (U8)
  "sign_in", //        the existing dashboard sign-in (R9: unchanged)
  "dashboard", //      /dashboard — the pre-existing family home
  "link_expired", //   rendered by the resume landing (U3): resend affordance
  "link_used", //      rendered by the resume landing (U3): single-use spent
] as const;

export type ReentryScreen = (typeof REENTRY_SCREENS)[number];

/**
 * The rule that fired, carried on every destination so an operator (or a
 * later staff tool) can see WHY a family landed where they did without
 * replaying the priority chain by hand (agent-native review).
 */
export type ReentryReason =
  | "enrolled"
  | "password_family"
  | "resume"
  | "link_expired"
  | "link_used"
  | "cold";

/**
 * Per-screen union: `childId` exists ONLY on child_resume, and there it is
 * REQUIRED — `{ screen: "capture", childId: … }` is a compile error, and a
 * child_resume without a child cannot be constructed (kieran-typescript
 * review; the first draft's optional `childId?` on every screen let both
 * mistakes through).
 */
export type ReentryDestination =
  | { screen: "child_resume"; childId: string; reason: ReentryReason }
  | { screen: Exclude<ReentryScreen, "child_resume">; reason: ReentryReason };

/** The resume-link state a visitor arrived with. `none` = typed a URL / ad. */
export type ReentryLinkState = "none" | "valid" | "expired" | "used";

/** One child, reduced to what re-entry resolution needs. */
export type ReentryChild = {
  id: string;
  /** NULL for a child that has never entered the funnel. */
  applicantState: ApplicantState | null;
  /** ISO timestamp — the deterministic tie-break. */
  createdAt: string;
};

/**
 * CONTRACT: every field describes ONE family — the family the caller has
 * already resolved this entry to. A session for family A arriving with a
 * valid link for family B is a reconciliation problem the matrix cannot see
 * and must never be handed: U3's redemption resolves the link's family
 * server-side and decides which identity wins BEFORE building this context
 * (adversarial review). `hasPassword` and `enrolled` are caller-computed
 * facts; the enrolled rule keeps a valid link usable precisely so a stale
 * bit cannot strand a family (see rule 1).
 */
export type ReentryContext = {
  /** A live authenticated session (cookie still valid). */
  hasSession: boolean;
  link: ReentryLinkState;
  /** The family signs in with a password today (pre-funnel family). R9: their
   *  access does not change. */
  hasPassword: boolean;
  /** Any child deposited/enrolled — computed by the caller from deposits. */
  enrolled: boolean;
  children: ReentryChild[];
  /** The explicit active child (R32's selector, U7). Undefined until set. */
  activeChildId?: string;
};

/**
 * The furthest-progressed child, with the explicit active child taking
 * precedence (the plan's scenario: two children at different stages resolve
 * to the EXPLICIT active child, not the first by insertion; without one, a
 * live session resolves to the furthest-progressed).
 *
 * Ladder position comes from APPLICANT_STATES order; NULL (never entered the
 * funnel) sorts below every rung. Ties break on earliest createdAt — stable
 * and deterministic, never insertion order of the array.
 */
export function resolveResumeChild(
  children: readonly ReentryChild[],
  activeChildId?: string
): ReentryChild | null {
  if (children.length === 0) return null;
  if (activeChildId) {
    const active = children.find((c) => c.id === activeChildId);
    if (active) return active;
    // A stale active id (child removed) falls through to furthest — never a
    // dead pointer, never a throw.
  }
  const rung = (c: ReentryChild) =>
    c.applicantState === null ? -1 : APPLICANT_STATES.indexOf(c.applicantState);
  return [...children].sort(
    (a, b) => rung(b) - rung(a) || a.createdAt.localeCompare(b.createdAt)
  )[0];
}

/**
 * The matrix. Rules apply in priority order; each is a whole R9a row.
 *
 * 1. Enrolled family → their home is the dashboard, and an ad link must never
 *    route them toward a second deposit: session → dashboard; a VALID resume
 *    link also → dashboard (redemption mints the session, then this is where
 *    it lands) — a funnel-enrolled family has NO password, so the link is
 *    their only working door, and sending them to sign_in would strand them
 *    behind a form they cannot pass even when the `enrolled` bit is stale
 *    (adversarial review); anything else → sign_in.
 * 2. Password family (R9: signs in exactly as today) → session → dashboard,
 *    else sign_in — including when they arrive holding a funnel resume link
 *    in any state; the password door is strictly better than a resend loop.
 * 3. Funnel family with a live session → resume by children, whatever link
 *    they clicked to get here (a second click of an already-redeemed link
 *    with the session it minted still standing must not dead-end — the first
 *    click won, the second inherits it).
 * 4. No session, valid link → resume by children. (The redemption POST is
 *    U3's; this names where redemption lands.)
 * 5. No session, expired link → link_expired (resend affordance, R7).
 * 6. No session, used link → link_used (single-use spent; offer a fresh one).
 * 7. No session, no link (dead cookie, cold ad entry) → capture. Capture's
 *    own provision-or-recognize turns a known email into the resume branch
 *    (R9b: never a second account, never a merge on an unverified address).
 */
export function resolveReentry(ctx: ReentryContext): ReentryDestination {
  if (ctx.enrolled) {
    if (ctx.hasSession || ctx.link === "valid")
      return { screen: "dashboard", reason: "enrolled" };
    return { screen: "sign_in", reason: "enrolled" };
  }
  if (ctx.hasPassword) {
    return {
      screen: ctx.hasSession ? "dashboard" : "sign_in",
      reason: "password_family",
    };
  }

  if (ctx.hasSession || ctx.link === "valid") {
    const child = resolveResumeChild(ctx.children, ctx.activeChildId);
    return child
      ? { screen: "child_resume", childId: child.id, reason: "resume" }
      : { screen: "children_grid", reason: "resume" };
  }
  if (ctx.link === "expired") return { screen: "link_expired", reason: "link_expired" };
  if (ctx.link === "used") return { screen: "link_used", reason: "link_used" };
  return { screen: "capture", reason: "cold" };
}

/**
 * Routes for the navigable screens. `link_expired` / `link_used` are states
 * the resume landing renders in place — asking for their route is a caller
 * bug, answered with the landing's own null rather than a throw.
 *
 * These literals are the funnel's route plan as of U2; the units that build
 * each route (U5–U8) adjust HERE if reality lands elsewhere — one mapper,
 * not per-screen literals scattered across callers. The `never` guard makes
 * vocabulary growth a compile error, not a silent `undefined` return.
 */
export function screenRoute(dest: ReentryDestination): string | null {
  switch (dest.screen) {
    case "capture":
      return "/start";
    case "children_grid":
      return "/start/children";
    case "child_resume":
      return `/start/child/${dest.childId}`;
    case "sign_in":
    case "dashboard":
      // The dashboard renders SignIn when logged out — one route, two screens.
      return "/dashboard";
    case "link_expired":
    case "link_used":
      return null;
    default: {
      const exhaustive: never = dest;
      return exhaustive;
    }
  }
}
