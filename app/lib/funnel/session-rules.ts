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
 * The `hasPassword` bit is an INPUT, computed by the caller from auth
 * metadata (`isFunnelProvisioned`); `enrolled` is derived by THIS module's
 * `deriveEnrolled` — it used to be caller-computed, and the two callers had
 * drifted (one knew about legacy `status = "member"` families, the other
 * did not), which is exactly the bug centralizing here closes before the
 * dashboard becomes a third caller (reconnect U1).
 *
 * This file also owns the PER-CHILD mapping (`childNextScreen`): given one
 * child's applicant state plus the two facts the state alone cannot carry
 * (live deposit, composed project), which surface serves that child next.
 * Four surfaces consume it — dashboard cards, the dashboard redirect gate,
 * `/start` re-entry, and resume redemption — so the mapping lives here ONCE,
 * never re-derived per surface (reconnect R3).
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
  /**
   * Does the child hold a composed (active) project? Only rule 3's landing
   * consults it — a `project_created` child WITH a project belongs on the
   * dashboard, one WITHOUT (the state U8's invalidation manufactures) still
   * owes a compose and belongs in the mini-app. Optional so contexts built
   * before reconnect U1 keep compiling; absent reads as "no project", which
   * degrades toward the mini-app — a wrong dashboard landing strands nobody,
   * but this default cannot even produce one.
   */
  hasComposedProject?: boolean;
};

/**
 * CONTRACT: every field describes ONE family — the family the caller has
 * already resolved this entry to. A session for family A arriving with a
 * valid link for family B is a reconciliation problem the matrix cannot see
 * and must never be handed: U3's redemption resolves the link's family
 * server-side and decides which identity wins BEFORE building this context
 * (adversarial review). `hasPassword` is a caller-computed fact; `enrolled`
 * comes from `deriveEnrolled` below (one derivation, every caller); the
 * enrolled rule keeps a valid link usable precisely so a stale bit cannot
 * strand a family (see rule 1).
 */
export type ReentryContext = {
  /** A live authenticated session (cookie still valid). */
  hasSession: boolean;
  link: ReentryLinkState;
  /** The family signs in with a password today (pre-funnel family). R9: their
   *  access does not change. */
  hasPassword: boolean;
  /** Any child deposited/enrolled, or a legacy member — see `deriveEnrolled`. */
  enrolled: boolean;
  children: ReentryChild[];
  /** The explicit active child (R32's selector, U7). Undefined until set. */
  activeChildId?: string;
};

/**
 * The ONE `enrolled` derivation (reconnect U1). Before this existed, the two
 * callers each derived the bit by hand and disagreed: resume redemption knew
 * a legacy `children.status = "member"` family is enrolled-shaped (their home
 * is the dashboard even though no child ever climbed the applicant ladder),
 * `/start` did not. The superset rule wins — a member family offered the
 * funnel's capture-or-resume treatment would be routed at their own children
 * as if they were mid-application.
 *
 * `applicant_state ∈ {deposited, enrolled}` deliberately ignores the LIVE
 * deposit fact: a refunded family keeps their dashboard home (rule 1 sends
 * them there, and the dashboard's own card mapping owns the re-reserve CTA —
 * `childNextScreen` below). `status` is the legacy column, passed through as
 * `unknown` because this module refuses to own its vocabulary — only the one
 * literal `"member"` is consulted.
 */
export function deriveEnrolled(
  children: readonly {
    applicantState: ApplicantState | null;
    /** Legacy `children.status`, when the caller has it. */
    status?: unknown;
  }[]
): boolean {
  return children.some(
    (c) =>
      c.applicantState === "deposited" ||
      c.applicantState === "enrolled" ||
      c.status === "member"
  );
}

/* ────────────────── the per-child mapping (reconnect U1, R1–R3) ────────────────── */

/**
 * Which surface serves ONE child next. Discriminated on `surface`; `intent`
 * narrows within it. Symbolic like `REENTRY_SCREENS` — routes stay with the
 * consumers (`screenRoute` for family landings; the dashboard verdicts have
 * no URL at all: `DashboardApp` consumes the `dossier` intent client-side to
 * open the editor for the child, per the wizard-targeting decision).
 */
export type ChildNextVerdict =
  /** The mini-app owns the next step: `resume` = walk the flow from wherever
   *  the shell resolves (`added`); `compose` = a `project_created` child with
   *  NO composed project (U8's invalidation manufactures this cell) — the
   *  re-compose obligation lives in the mini-app, the one deliberate
   *  exception to "post-compose means dashboard". */
  | { surface: "mini_app"; intent: "resume" | "compose" }
  /** The dashboard owns it: `dossier` = open the dossier editor for this
   *  child (`project_created` with a project); `enrolled` = the family home;
   *  `legacy` = NULL applicant_state, a pre-funnel child — today's card,
   *  NO funnel CTA. */
  | { surface: "dashboard"; intent: "dossier" | "enrolled" | "legacy" }
  /** The reserve/next-steps surface: `reserve` = a staff offer opened the
   *  deposit; `re_reserve` = `deposited` with no LIVE deposit (refunded) —
   *  they may pay again (`canReserveSeatForChild` semantics), and routing
   *  them to arrival instead would bounce off its no-live-deposit redirect
   *  forever (the loop bug this axis exists to prevent). */
  | { surface: "next_steps"; intent: "reserve" | "re_reserve" }
  /** Arrival — only ever with a LIVE paid deposit. */
  | { surface: "arrival"; intent: "arrival" }
  /** A status line and nothing actionable. `waitlisted` is here on purpose:
   *  F7 closes checkout at zero seats, so it must never yield a payment CTA. */
  | { surface: "status_only"; intent: "submitted" | "in_review" | "waitlisted" };

/**
 * The per-child applicant-state → next-surface mapping (reconnect R3): ONE
 * pure function consumed by dashboard cards, the dashboard redirect gate,
 * `/start` re-entry and resume redemption — never a parallel state machine
 * per surface.
 *
 * The two boolean axes carry what the state alone cannot:
 *  - `liveDeposit` — `paid AND refunded_at IS NULL`, the PAIR (mirroring the
 *    arrival route); `deposited` without it is a refunded family who may
 *    reserve again, never an arrival visitor.
 *  - `hasComposedProject` — an active `projects` row; `project_created`
 *    without one still owes a compose (see `ChildNextVerdict`).
 *
 * Unknown state strings never reach here: callers read the column through
 * `parseApplicantState`, which fail-closes to NULL — the legacy verdict,
 * which every downstream treats conservatively.
 */
export function childNextScreen(facts: {
  applicantState: ApplicantState | null;
  liveDeposit: boolean;
  hasComposedProject: boolean;
}): ChildNextVerdict {
  const { applicantState, liveDeposit, hasComposedProject } = facts;
  if (applicantState === null) return { surface: "dashboard", intent: "legacy" };
  switch (applicantState) {
    case "added":
      return { surface: "mini_app", intent: "resume" };
    case "project_created":
      return hasComposedProject
        ? { surface: "dashboard", intent: "dossier" }
        : { surface: "mini_app", intent: "compose" };
    case "submitted":
      return { surface: "status_only", intent: "submitted" };
    case "in_review":
      return { surface: "status_only", intent: "in_review" };
    case "waitlisted":
      return { surface: "status_only", intent: "waitlisted" };
    case "offered":
      return { surface: "next_steps", intent: "reserve" };
    case "deposited":
      return liveDeposit
        ? { surface: "arrival", intent: "arrival" }
        : { surface: "next_steps", intent: "re_reserve" };
    case "enrolled":
      return { surface: "dashboard", intent: "enrolled" };
    default: {
      const exhaustive: never = applicantState;
      return exhaustive;
    }
  }
}

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
 * 3. Funnel family with a live session → the RESOLVED CHILD'S state decides
 *    (uniform landing, reconnect U1 — user-approved change from the old
 *    always-child_resume): a `mini_app` verdict from `childNextScreen`
 *    (`added`, or `project_created` still owing its compose) resumes into
 *    the mini-app; anything later lands on the dashboard, where the card
 *    mapping serves the same verdict as a CTA. Whatever link they clicked to
 *    get here (a second click of an already-redeemed link with the session
 *    it minted still standing must not dead-end — the first click won, the
 *    second inherits it).
 * 4. No session, valid link → same resolved-child rule. (The redemption POST
 *    is U3's; this names where redemption lands.)
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
    if (!child) return { screen: "children_grid", reason: "resume" };
    const next = childNextScreen({
      applicantState: child.applicantState,
      // Family-level only: any deposited/enrolled child makes `enrolled` true
      // (deriveEnrolled) and rule 1 owns the family before this line, so the
      // live-deposit axis cannot influence THIS verdict — false is not a
      // guess, it is unreachable input. Per-child surfaces (cards, arrival)
      // load the real pair.
      liveDeposit: false,
      hasComposedProject: child.hasComposedProject ?? false,
    });
    return next.surface === "mini_app"
      ? { screen: "child_resume", childId: child.id, reason: "resume" }
      : { screen: "dashboard", reason: "resume" };
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
