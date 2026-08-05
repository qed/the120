/**
 * THE v2 → v3 REMAP TABLE (plan Unit 8).
 *
 * ONE table, consumed by EVERY producer that decides where a returning family
 * lands: `resolveReentry` / `screenRoute` (app/lib/funnel/session-rules.ts),
 * `childNextScreen`'s consumers (the dashboard cards), `/resume/[token]`
 * redemption, and `/start`'s signed-in self-redirect. Nothing re-derives a
 * destination per surface — that duplication is exactly the drift the funnel's
 * own reconnect units removed once already, and v3 must not reintroduce it.
 *
 * ── IT IS VERDICT→VERDICT, NOT ROUTE→ROUTE ──
 * Two v2 destinations (`link_expired`, `link_used`) are IN-PLACE RENDER STATES:
 * the resume landing draws them without navigating anywhere, and `screenRoute`
 * answers `null` for both. A route→route table cannot express that cell at all
 * — it would have to invent a URL for a screen that has none. So the table maps
 * a v2 VERDICT to a v3 VERDICT, and a separate `v3RemapRoute` turns the
 * navigable subset into URLs. The resume-token outcomes join them: `invalid` /
 * `expired` / `redeemed` / `error` are likewise rendered in place.
 *
 * ── "RECORDS TO MINT" IS A CONTRACT, NOT AN EXECUTOR ──
 * Every cell carries which records the DESTINATION STEP is responsible for
 * minting on entry: the signup `attempt`, the per-kid `consent`, the onboarding
 * `draft`. This module writes NOTHING and must not: a consent record can only
 * be minted alongside a fresh parental affirmation bound to the text the parent
 * just read (`recordConsent`'s echo + refuse-stale rule), so a router that
 * silently minted one would be manufacturing legal evidence. The matrix lives
 * here so the answer is in one place instead of scattered across the steps that
 * perform the writes; `v3AddKid` is the code that actually mints the trio.
 *
 * PURE. No Next, no Supabase, no clock. `import type` only from session-rules,
 * which imports this module's VALUES — the dependency is one-directional at
 * runtime and there is no import cycle.
 */

import type {
  ChildNextVerdict,
  ReentryScreen,
} from "@/app/lib/funnel/session-rules";
import { V3_STEPS, type V3Step } from "./flow-rules";

/* ------------------------------------------------------------- the routes */

/**
 * Where the v3 flow lives TODAY. Unit 9 moves `app/start/v3` to `app/start`;
 * when it does, this constant is the ONE edit, because every producer builds
 * its URL from `v3RemapRoute` rather than from a literal of its own.
 */
export const V3_FLOW_PATH = "/start/v3";

/**
 * The one-time set-password step for a CONVERTED FUNNEL PARENT (see
 * `needsSetPasswordStep`). Its own route rather than a sixth `?step=` value:
 * `V3_STEPS` is a user-visible contract (bookmarks, the launch email's deep
 * links) and a step that only one cohort ever sees does not belong in the
 * ladder every family walks.
 */
export const SET_PASSWORD_PATH = "/set-password";

/** ADD A CHILD, from the dashboard: the v3 kid step. Exported so the dashboard
 *  and the test that pins its href read the SAME string. */
export const V3_ADD_KID_HREF = `${V3_FLOW_PATH}?step=kid`;

/* --------------------------------------------------------- the vocabulary */

/** The v3 destination vocabulary. Symbolic, like `REENTRY_SCREENS`: the four
 *  `link_*` members have no route at all, which is the whole reason this table
 *  is verdict→verdict. */
export type V3RemapVerdict =
  /** Into the v3 onboarding flow at a named step. */
  | { screen: "v3_flow"; step: V3Step }
  /** The family home. */
  | { screen: "dashboard" }
  /** The dashboard's sign-in swap (one route, two screens — as in v2). */
  | { screen: "sign_in" }
  /** The converted-funnel-parent password step (see `needsSetPasswordStep`). */
  | { screen: "set_password" }
  /** IN-PLACE render states. `screenRoute`/`v3RemapRoute` answer null. */
  | { screen: "link_expired" }
  | { screen: "link_used" }
  | { screen: "link_invalid" }
  | { screen: "link_error" };

/** Which records the DESTINATION STEP must mint on entry. Never minted here. */
export type RecordsToMint = {
  /** A fresh `fp_signup_attempts` row (per kid — `consentGate` binds one active
   *  consent to one child PER ATTEMPT). */
  attempt: boolean;
  /** A fresh `fp_parental_consent` row, captured with a live affirmation. */
  consent: boolean;
  /** An `fp_onboarding_drafts` row — the flow's resume anchor. */
  draft: boolean;
};

const MINT_NOTHING: RecordsToMint = { attempt: false, consent: false, draft: false };
/** The kid step's trio: attempt → consent → draft, in that order (v3AddKid). */
const MINT_KID_TRIO: RecordsToMint = { attempt: true, consent: true, draft: true };
/** The parent step mints its own attempt inside `startSignup`; no kid records
 *  exist yet, so nothing else is owed. */
const MINT_PARENT_ATTEMPT: RecordsToMint = { attempt: true, consent: false, draft: false };

export type V3RemapCell = { verdict: V3RemapVerdict; mint: RecordsToMint };

/* ----------------------------------------------------------- the v2 keys */

/**
 * Every cell of `childNextScreen`, as a stable key. The plan enumerates TEN
 * (`legacy`, `mini_app resume/compose`, `dossier`, `status_only
 * submitted/in_review/waitlisted`, `next_steps reserve/re_reserve`, `arrival`).
 *
 * ⚠ JUDGMENT CALL: this list carries TWO more, deliberately.
 *  - `dashboard.enrolled` is a real `ChildNextVerdict` cell the plan's prose
 *    omits. Leaving it out would make `childNextVerdictKey` partial, and a
 *    partial key function over an exhaustive union is precisely the silent
 *    `undefined` this table exists to prevent.
 *  - `first_profit.keep_building` is the NEW v3 cell (see `childNextScreen`'s
 *    `fpProvisioned` axis). It is not a v2 verdict, but it must have a row so
 *    the key function stays total and so a producer handed an already-v3
 *    verdict gets the right answer instead of a lookup miss.
 */
export type ChildNextKey =
  | "dashboard.legacy"
  | "dashboard.dossier"
  | "dashboard.enrolled"
  | "mini_app.resume"
  | "mini_app.compose"
  | "status_only.submitted"
  | "status_only.in_review"
  | "status_only.waitlisted"
  | "next_steps.reserve"
  | "next_steps.re_reserve"
  | "arrival.arrival"
  | "first_profit.keep_building";

/** The `/resume/[token]` redemption outcomes that are NOT a success. */
export type ResumeTokenState = "invalid" | "expired" | "redeemed" | "error";

export type V2VerdictKey =
  | `child:${ChildNextKey}`
  | `reentry:${ReentryScreen}`
  | `resume:${ResumeTokenState}`;

/** One `ChildNextVerdict` → its table key. Total by construction: the union's
 *  own `surface`/`intent` pair IS the key. */
export function childNextVerdictKey(v: ChildNextVerdict): ChildNextKey {
  return `${v.surface}.${v.intent}` as ChildNextKey;
}

/* ------------------------------------------------------------- THE TABLE */

/**
 * THE TABLE. Every enumerated v2 verdict maps to EXACTLY ONE v3 verdict plus
 * the records its destination owes.
 *
 * ── WHY SO MANY CELLS COLLAPSE ONTO `dashboard` ──
 * v3 has no application, no review queue, no waitlist and no seat deposit: a
 * family either has kids playing First Profit or is adding one. So every v2
 * cell that described a POSITION IN A REVIEW PIPELINE (`submitted`,
 * `in_review`, `waitlisted`, `offered`/`reserve`, `re_reserve`, `arrival`,
 * `enrolled`, the composed-dossier cell) has no v3 analogue to resume INTO, and
 * its family's honest destination is the dashboard, where their existing kids
 * and the "add a child" entry live. This is the plan's hard-launch decision
 * ("v3 is also a hard launch for ALL families"), stated as data.
 *
 * `waitlisted` is worth naming explicitly: it must land on the dashboard like
 * everyone else. Under v2 a waitlisted family's old resume link led to a
 * status page; if the remap sent them at a retired route they would get a 404,
 * which is the one outcome the success criterion ("no family stranded")
 * forbids.
 *
 * ── WHY THE TWO `mini_app` CELLS BECOME THE KID STEP ──
 * They are the only v2 cells whose family owes UNFINISHED WORK on a child. The
 * work itself (the v2 application) is retired, so the equivalent v3 obligation
 * is "give this kid a First Profit account" — the kid step — and that step
 * mints the whole trio because a v2 child carries no attempt, no v3-era
 * consent and no draft.
 */
export const V2_TO_V3_REMAP: Readonly<Record<V2VerdictKey, V3RemapCell>> = {
  /* ── the per-child cells ── */
  // A pre-funnel child. Nothing to resume; the dashboard shows their card.
  "child:dashboard.legacy": { verdict: { screen: "dashboard" }, mint: MINT_NOTHING },
  // A composed v2 dossier. The dossier editor is retired with the flow.
  "child:dashboard.dossier": { verdict: { screen: "dashboard" }, mint: MINT_NOTHING },
  "child:dashboard.enrolled": { verdict: { screen: "dashboard" }, mint: MINT_NOTHING },
  // The two cells that owed real work — see the docblock.
  "child:mini_app.resume": { verdict: { screen: "v3_flow", step: "kid" }, mint: MINT_KID_TRIO },
  "child:mini_app.compose": { verdict: { screen: "v3_flow", step: "kid" }, mint: MINT_KID_TRIO },
  // Review-pipeline positions with no v3 analogue.
  "child:status_only.submitted": { verdict: { screen: "dashboard" }, mint: MINT_NOTHING },
  "child:status_only.in_review": { verdict: { screen: "dashboard" }, mint: MINT_NOTHING },
  "child:status_only.waitlisted": { verdict: { screen: "dashboard" }, mint: MINT_NOTHING },
  "child:next_steps.reserve": { verdict: { screen: "dashboard" }, mint: MINT_NOTHING },
  "child:next_steps.re_reserve": { verdict: { screen: "dashboard" }, mint: MINT_NOTHING },
  "child:arrival.arrival": { verdict: { screen: "dashboard" }, mint: MINT_NOTHING },
  // Already a v3 cell (an FP child): their home is the dashboard's Path card.
  "child:first_profit.keep_building": { verdict: { screen: "dashboard" }, mint: MINT_NOTHING },

  /* ── the re-entry cells ── */
  // Cold entry: v2's email-capture explainer becomes v3's parent step, which
  // mints its own attempt inside `startSignup`.
  "reentry:capture": {
    verdict: { screen: "v3_flow", step: "parent" },
    mint: MINT_PARENT_ATTEMPT,
  },
  // A signed-in family with no child yet: v2 sent them to the add-a-child grid.
  "reentry:children_grid": { verdict: { screen: "v3_flow", step: "kid" }, mint: MINT_KID_TRIO },
  // The v2 mini-app seam. Same reasoning as the two `mini_app` cells above.
  "reentry:child_resume": { verdict: { screen: "v3_flow", step: "kid" }, mint: MINT_KID_TRIO },
  "reentry:sign_in": { verdict: { screen: "sign_in" }, mint: MINT_NOTHING },
  "reentry:dashboard": { verdict: { screen: "dashboard" }, mint: MINT_NOTHING },
  // IN-PLACE render states — carried across unchanged, route still null.
  "reentry:link_expired": { verdict: { screen: "link_expired" }, mint: MINT_NOTHING },
  "reentry:link_used": { verdict: { screen: "link_used" }, mint: MINT_NOTHING },

  /* ── the resume-token outcomes (rendered in place by the landing) ── */
  "resume:invalid": { verdict: { screen: "link_invalid" }, mint: MINT_NOTHING },
  "resume:expired": { verdict: { screen: "link_expired" }, mint: MINT_NOTHING },
  "resume:redeemed": { verdict: { screen: "link_used" }, mint: MINT_NOTHING },
  "resume:error": { verdict: { screen: "link_error" }, mint: MINT_NOTHING },
};

/* ------------------------------------------------- the contextual override */

/**
 * THE CONVERTED-FUNNEL-PARENT PROBLEM, AND THE ONE CELL IT OVERRIDES.
 *
 * A v2 funnel-provisioned parent holds a RANDOM, NEVER-DISCLOSED password: the
 * capture flow minted their account and their only working door has always been
 * a resume link. `deriveHasPassword` (session-rules) flips them to
 * `hasPassword: true` the moment they acquire an FP child, because the per-child
 * `fp_username` discriminator says "this is a First Profit family". If nothing
 * intervened, the remap would walk them into the v3 flow, provision a kid, and
 * then route every future visit at a sign-in form whose password they have
 * never been told — a self-inflicted lockout, produced by the very fix that
 * unbounces them.
 *
 * So the remap INSERTS A ONE-TIME SET-PASSWORD STEP before their first v3
 * provisioning. Three conditions, each doing distinct work:
 *
 *  1. `funnelStamped` — `app_metadata.funnel === true`. Only accounts the
 *     provisioner created are candidates at all.
 *  2. `passwordChosen === false` — the durable stamp v3's verify writes when the
 *     parent's OWN chosen password is set. This is what keeps a brand-new v3
 *     parent (funnel-stamped, zero children, having just typed a password
 *     thirty seconds ago) from being asked for another one.
 *  3. `hasFpChild === false` — the beta cohort and anyone else provisioned
 *     through the FP HTTP door already chose a real password at
 *     `verifyCompletion`; they predate the stamp, and their FP children say so.
 *     Asking them to set a password they already have would be a false alarm.
 *
 * The override applies ONLY to cells that enter the v3 flow past the parent
 * step. The parent step itself is where a password is chosen, so overriding it
 * would be circular, and no non-flow cell provisions anything.
 */
export type RemapContext = {
  /** `isFunnelProvisioned(app_metadata)`. */
  funnelStamped: boolean;
  /** The durable "this parent set their own password" stamp. */
  passwordChosen: boolean;
  /** Any child of this family carries a non-null `fp_username`. */
  hasFpChild: boolean;
};

export function needsSetPasswordStep(ctx: RemapContext): boolean {
  return ctx.funnelStamped && !ctx.passwordChosen && !ctx.hasFpChild;
}

/**
 * THE lookup. `ctx` is optional: producers that have no user record (the resume
 * landing rendering an expired link) legitimately cannot compute it, and every
 * cell they can reach is override-immune anyway.
 */
export function remapV2Verdict(key: V2VerdictKey, ctx?: RemapContext): V3RemapCell {
  const cell = V2_TO_V3_REMAP[key];
  if (!ctx || !needsSetPasswordStep(ctx)) return cell;
  // Only flow entries PAST the parent step are diverted (see the docblock).
  if (cell.verdict.screen !== "v3_flow" || cell.verdict.step === "parent") return cell;
  // The step still owes its records once the password is set — the diversion
  // postpones the destination, it does not cancel what that destination mints.
  return { verdict: { screen: "set_password" }, mint: cell.mint };
}

/* ------------------------------------------------------------- the routes */

/**
 * Routes for the NAVIGABLE v3 verdicts. The four `link_*` states answer `null`
 * — asking for their route is a caller bug, answered with the landing's own
 * null rather than a throw (the same contract v2's `screenRoute` had).
 */
export function v3RemapRoute(verdict: V3RemapVerdict): string | null {
  switch (verdict.screen) {
    case "v3_flow":
      return `${V3_FLOW_PATH}?step=${verdict.step}`;
    case "sign_in":
    case "dashboard":
      // The dashboard renders SignIn when logged out — one route, two screens.
      return "/dashboard";
    case "set_password":
      return SET_PASSWORD_PATH;
    case "link_expired":
    case "link_used":
    case "link_invalid":
    case "link_error":
      return null;
    default: {
      const exhaustive: never = verdict;
      return exhaustive;
    }
  }
}

/** Guard: every `v3_flow` cell names a real step. Cheap, and it makes a typo in
 *  the table a test failure rather than a `?step=` the resolver silently
 *  clamps. */
export const isKnownV3Step = (s: string): s is V3Step =>
  (V3_STEPS as readonly string[]).includes(s);
