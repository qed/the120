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
import { isFunnelProvisioned } from "@/app/lib/funnel/resume-rules";
import {
  childNextVerdictKey,
  remapV2Verdict,
  v3RemapRoute,
  type RemapContext,
} from "@/app/lib/v3-signup/remap-rules";

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
  /**
   * `children.fp_username` — the per-child FP discriminator (plan Unit 8).
   * Non-null iff this child holds a First Profit account. FP signup is its ONLY
   * writer (service-role, trigger-guarded by migration 20260831120000, already
   * backfilled for the beta cohort), which is what makes it trustworthy as an
   * authorization-adjacent fact rather than a heuristic. Optional so contexts
   * built before this unit keep compiling; absent reads as "not FP".
   */
  fpUsername?: string | null;
};

/* ─────────────────── the FP-family derivations (plan Unit 8) ─────────────────── */

/** Does this ONE child hold a First Profit account? */
export const isFpChild = (c: { fpUsername?: string | null }): boolean =>
  typeof c.fpUsername === "string" && c.fpUsername.length > 0;

/** Does ANY child in this family? Null (read failed / signed out) is `false`:
 *  the derivations below all fail toward the pre-unit behaviour. */
export const familyHasFpChild = (
  children: readonly { fpUsername?: string | null }[] | null | undefined
): boolean => (children ?? []).some(isFpChild);

/**
 * THE `hasPassword` DERIVATION, FIXED AT ITS SOURCE (plan Unit 8).
 *
 * `isFunnelProvisioned` reads `app_metadata.funnel === true`, the stamp
 * `account.ts` puts on every account IT creates. That stamp is SEMANTICALLY
 * STALE for a First Profit parent: the FP signup path (`verifyCompletion`, and
 * v3's code redeem) sets a password the parent CHOSE and typed, yet the account
 * still carries the funnel stamp — so every consumer of the bit concluded "this
 * family has no password, route them at a resume link" and, for the dashboard
 * gate, "bounce them into the v2 mini-app". That is the confirmed misroute.
 *
 * ONE derivation change routes FP parents as password families everywhere at
 * once, because every producer takes `hasPassword` as an INPUT computed by its
 * caller — so there is exactly one shape of caller to fix, not one branch per
 * surface.
 *
 * ⚠ WHY THIS CANNOT WIDEN TO A GENUINE v2 FUNNEL PARENT. The second disjunct is
 * not "looks like a First Profit family" — it is `children.fp_username IS NOT
 * NULL` on at least one row. That column has exactly one writer: `createChild`,
 * through the service-role admin client, behind a DB trigger that raises on any
 * non-service-role write (migration 20260831120000). A v2 funnel family's
 * children were inserted by the funnel's own parent-token path, which cannot
 * set the column even if it tried, so every one of their rows is NULL, the
 * disjunct is false, `hasPassword` stays false, and they keep routing to
 * sign_in — where a resume link, not a password form, is still their door.
 * There is no state a v2 funnel family can reach that sets an `fp_username`
 * without also giving them a First Profit account with a chosen password.
 */
export function deriveHasPassword(input: {
  /** The session user's `app_metadata`; null when there is no session. */
  appMetadata: Record<string, unknown> | null | undefined;
  /** The family's children; null = the read failed. */
  children: readonly { fpUsername?: string | null }[] | null | undefined;
}): boolean {
  if (!isFunnelProvisioned(input.appMetadata)) return true;
  return familyHasFpChild(input.children);
}

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
  | { surface: "status_only"; intent: "submitted" | "in_review" | "waitlisted" }
  /** THE v3 CELL (plan Unit 8). A First Profit child — one whose
   *  `children.fp_username` is set — has an account and is playing. They are
   *  NOT mid-application, whatever `applicant_state` says: FP signup leaves
   *  every child it mints on `added` with `arrived_at` NULL, which is exactly
   *  the shape v2 reads as "owes a mini-app resume". This cell is how that
   *  collision is resolved once, in the shared mapping, so no surface can
   *  answer differently. */
  | { surface: "first_profit"; intent: "keep_building" };

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
  /**
   * THE PER-CHILD FP DISCRIMINATOR (plan Unit 8): `children.fp_username IS NOT
   * NULL`. It is checked FIRST and it outranks every applicant state, because
   * an FP child's `applicant_state` is meaningless — `createChild` stamps the
   * entry rung (`added`) on every child it mints and never advances it, so the
   * v2 ladder reads a playing First Profit kid as a family who abandoned an
   * application on step one. No FP child may ever owe a `mini_app` verdict; the
   * guarantee lives HERE rather than in each consumer so a surface cannot
   * outrun it. Optional so contexts built before this unit keep compiling;
   * absent reads as "not FP", which is the pre-unit behaviour.
   */
  fpProvisioned?: boolean;
}): ChildNextVerdict {
  const { applicantState, liveDeposit, hasComposedProject } = facts;
  if (facts.fpProvisioned) return { surface: "first_profit", intent: "keep_building" };
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
      // The FP discriminator rides along so an FP child can never resolve to
      // the mini-app here either (plan Unit 8) — the guarantee is the mapping's,
      // and every call site must hand it the fact.
      fpProvisioned: isFpChild(child),
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

/* ──────────────── the dashboard gate (reconnect U2, R2) ──────────────── */

/** One child as the dashboard gate reads it: a `ReentryChild` plus the legacy
 *  `status` column, which only `deriveEnrolled` consults (the `"member"`
 *  literal — see its docblock), plus the sticky arrival fact (U11 — only
 *  `dashboardRegister` consults it). */
export type DashboardGateChild = ReentryChild & {
  status?: unknown;
  /** `children.arrived_at` — non-null iff this child has EVER completed
   *  arrival (the provisioning claim landed `complete`). Monotonic: set
   *  once, never cleared; refund/suspension flips the CLAIM, not this. */
  arrivedAt?: string | null;
};

export type DashboardGateVerdict =
  | { action: "render" }
  | { action: "redirect"; childId: string; route: string };

/**
 * Should `/dashboard` render, or server-redirect this family into the
 * mini-app? PURE — `app/dashboard/page.tsx` wires server-read facts in and
 * calls `redirect()` on the verdict; the decision itself never touches a
 * client or a cookie, so Vitest's node env covers every row.
 *
 * The redirect cohort is deliberately NARROW (reconnect R2): a
 * funnel-provisioned (`hasPassword: false`), non-enrolled family whose
 * RESOLVED child (`resolveResumeChild` — explicit active wins, else furthest
 * rung, ties on earliest createdAt) yields a `mini_app` verdict from
 * `childNextScreen` — i.e. `added`, or `project_created` still owing its
 * compose (U8's invalidation manufactures that cell). Everyone else — signed
 * out, password families, enrolled families, post-compose families — sees the
 * dashboard exactly as today.
 *
 * Two escape hatches, both fail-OPEN to the hub:
 *  - `stay` — an in-flow link to the dashboard carries an explicit stay
 *    parameter; honoring it here is the loop prevention (a mini-app screen
 *    linking "back to dashboard" must not bounce straight back in).
 *  - `children: null` — ANY server read failure. A wrongly rendered dashboard
 *    strands nobody; a broken redirect into the mini-app could.
 */
export function dashboardGateVerdict(facts: {
  hasSession: boolean;
  /** `!isFunnelProvisioned(user.app_metadata)` — same bit the matrix takes. */
  hasPassword: boolean;
  /** null = the read failed; the gate fails open and renders. */
  children: readonly DashboardGateChild[] | null;
  /** An explicit stay parameter was present on the URL (any value). */
  stay: boolean;
  /**
   * The converted-funnel-parent facts (`needsSetPasswordStep`), so this gate's
   * redirect goes through the SAME remap table every other producer reads.
   * Optional: absent means "no override", the un-diverted destination.
   */
  remapCtx?: RemapContext;
}): DashboardGateVerdict {
  const { hasSession, hasPassword, children, stay } = facts;
  if (!hasSession) return { action: "render" }; // SignIn swap stays client-side
  if (stay) return { action: "render" };
  if (children === null) return { action: "render" }; // read failed — fail open
  if (hasPassword) return { action: "render" }; // matrix rule 2: R9 access unchanged
  if (deriveEnrolled(children)) return { action: "render" }; // matrix rule 1: home
  const child = resolveResumeChild(children);
  if (!child) return { action: "render" };
  const next = childNextScreen({
    applicantState: child.applicantState,
    // BELT AND BRACES (plan Unit 8). `deriveHasPassword` already renders every
    // FP family above, so in practice no FP child reaches this line. The axis
    // is passed anyway because this is THE redirect that misrouted them, and a
    // gate whose safety depends on an upstream derivation staying correct is one
    // refactor away from being no gate at all.
    fpProvisioned: isFpChild(child),
    // Unreachable for this cohort: any deposited/enrolled child makes
    // `deriveEnrolled` true and the family rendered above, so no child the
    // live-deposit axis could influence ever reaches this call — false is
    // not a guess, same as rule 3's landing.
    liveDeposit: false,
    hasComposedProject: child.hasComposedProject ?? false,
  });
  if (next.surface !== "mini_app") return { action: "render" };
  // THE DESTINATION COMES FROM THE REMAP TABLE (v3 Unit 8 review, FIX 1). This
  // line used to build the v2 literal `/start/child/<id>` — a SECOND producer,
  // and the loudest one: it server-redirects the whole page, so a
  // mid-application v2 family never even reached the card whose CTA the review
  // caught. Both are now the one table.
  const route = childNextRoute(next, facts.remapCtx);
  // Defensive, not decorative: a redirect to the dashboard FROM the dashboard
  // is an infinite loop. No `mini_app` cell remaps there today (they answer the
  // kid step, or the set-password divert), and this guard is what keeps that
  // true if a cell is ever re-pointed.
  if (!route || route === "/dashboard") return { action: "render" };
  return { action: "redirect", childId: child.id, route };
}

/* ─────────────── the register flip (reconnect U11, R12 flip tier) ─────────────── */

/**
 * Which REGISTER the whole dashboard renders in (R12, later tier): once ANY
 * child in the family has EVER completed arrival, the dashboard is the Path
 * register (screen-16 skeleton) — for every child, including pre-submission
 * siblings, whose cards render inside the Path shell. The two registers
 * never mix on one screen.
 *
 * The fact is `children.arrived_at` — a sticky, monotonic COLUMN stamped in
 * the same landing path that marks the provisioning claim `complete`, never
 * cleared — NOT the current claim state (a later refund or mailbox
 * suspension must never un-flip a family's dashboard) and NOT the
 * best-effort `student_account_created` telemetry row (swallowed failures,
 * admin-only table — the plan's "sticky arrival fact is a column" decision).
 *
 * `null` children (the gate's read-failed / signed-out shape) and legacy
 * families whose children all carry NULL `arrived_at` render the
 * application register — indefinitely, for families that never enter the
 * funnel. Evaluated per page-load, server-side; an open tab flips on next
 * navigation, not live.
 */
/**
 * THE PATH-REGISTER PREDICATE, EXPORTED (plan Unit 8).
 *
 * ⚠ THIS PREDICATE AND `dashboard-gate-core`'s `verifiedTaskCounts` LOAD
 * CONDITION ARE ONE THING, AND THEY ARE COUPLED. The counts read is made only
 * for a path-register family; widening the register without widening the load
 * gives every v3 family a permanent 0 floor on the bars the register exists to
 * show, and widening the load without the register does pointless work. The
 * coupling is not maintained by remembering it: the gate core calls
 * `dashboardRegister(children) === "path"` — this same function, over the same
 * mapped rows — so there is literally one predicate and the pair cannot drift.
 *
 * v3 widens it by one disjunct. `arrivedAt` is the v2 sticky arrival fact (a
 * funnel child who completed the arrival flow); `fpUsername` is the v3 fact (a
 * child who HAS a First Profit account). An FP child never arrives through the
 * funnel — `arrived_at` stays NULL forever — so without this disjunct a v3
 * family would sit in the APPLICATION register, which renders "Continue
 * application" and a live $250 reserve CTA at people who are already playing.
 */
export const isPathRegisterChild = (
  c: Pick<DashboardGateChild, "arrivedAt"> & { fpUsername?: string | null }
): boolean => c.arrivedAt != null || isFpChild(c);

export function dashboardRegister(
  children: readonly (Pick<DashboardGateChild, "arrivedAt"> & {
    fpUsername?: string | null;
  })[] | null
): "application" | "path" {
  if (!children) return "application";
  return children.some(isPathRegisterChild) ? "path" : "application";
}

/**
 * Routes for the navigable screens — SINCE v3 UNIT 8, THROUGH THE REMAP TABLE.
 *
 * The v2 literals (`/start`, `/start/children`, `/start/child/<id>`) are gone
 * from this function, and that is the point: every producer that asks "where
 * does this destination go" now reads `app/lib/v3-signup/remap-rules.ts`, so a
 * v2 verdict resolves to a v3 route in ONE place instead of six. `link_expired`
 * / `link_used` still answer `null` — they are states the resume landing draws
 * in place, which is why the table is verdict→verdict rather than route→route.
 *
 * `ctx` is optional and carries the converted-funnel-parent facts (see
 * `needsSetPasswordStep`). Producers that hold a user record should pass it;
 * those that do not (a logged-out resume landing) reach only override-immune
 * cells anyway.
 */
export function screenRoute(dest: ReentryDestination, ctx?: RemapContext): string | null {
  const cell = remapV2Verdict(`reentry:${dest.screen}`, ctx);
  return v3RemapRoute(cell.verdict);
}

/**
 * The per-child route, through the same table: what a dashboard card's CTA or a
 * per-child landing should link at. `childNextScreen`'s verdict in, v3 URL out.
 */
export function childNextRoute(
  verdict: ChildNextVerdict,
  ctx?: RemapContext
): string | null {
  return v3RemapRoute(remapV2Verdict(`child:${childNextVerdictKey(verdict)}`, ctx).verdict);
}
