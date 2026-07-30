/**
 * The MERGED application ladder (unified-flow Unit 4; R5, R6, R8, R9a, R11)
 * — the step model, landing rule, clamp, lock union, and endings map for the
 * one flow that carries build steps, the R6a seam, the application-form
 * steps, and the next-steps screens. PURE: no React, no server code — the
 * route loads facts, this module decides.
 *
 * ── Why a PARALLEL module and not a longer MINIAPP_STEPS ──
 * `MINIAPP_STEPS` is compile-coupled to R32's percentage ladder
 * (`satisfies readonly ProgressStep[]`), and the form/next-steps ids are not
 * `ProgressStep` members — extending it cannot compile (plan, Key
 * Decisions). So the merged ladder is a UNION over the existing vocabularies
 * plus the seam, with a step→rung mapper reusing the `wizard_1/2/3` +
 * `submitted` rungs exactly as `wizardProgressStep` already does. No ladder
 * recut, no change to `MINIAPP_STEPS` or its coupling.
 *
 * ── The merge flag (LIVE since Unit 9) ──
 * Units 6–8 shipped dark behind `mergeFlagOn`; Unit 9 flipped it in the same
 * change that retired the dashboard wizard and the store's write paths, so
 * the two-owner form-state window (a stale dashboard tab's debounced
 * full-row upsert clobbering per-step action saves) never opened in
 * production. The flag-off arms stay compiled and pinned as the documented
 * fallback shape.
 */

import {
  isEditLocked,
  type ApplicantState,
} from "@/app/lib/funnel/applicant-rules";
import {
  MINIAPP_STEPS,
  initialStepForFacts,
  type MiniAppStep,
} from "@/app/lib/funnel/miniapp-rules";
import { type ProgressStep } from "@/app/lib/funnel/capture-rules";
import {
  navCardForStep,
  navCardIdentityOnly,
  type NavCardModel,
} from "@/app/lib/funnel/nav-card-rules";
import { wizardProgressStep, type WizardStepId } from "@/app/dashboard/wizard-rules";
import { emptyChild, type Child, type SeatStatus } from "@/app/dashboard/data";
import type { Skin } from "@/app/lib/funnel/child-rules";

/* ─────────────────────────────── the merge flag (LIVE since Unit 9) ─────────────────────────────── */

/**
 * THE merge flag (unified-flow Unit 6; FLIPPED by Unit 9, 2026-07-30). While
 * it was `false`, Units 6–8 shipped dark: `/start/child` behaviour stayed
 * byte-identical to the pre-merge mini-app and the two-owner form-state
 * window (a stale dashboard tab's debounced full-row upsert clobbering
 * per-step action saves) never opened in production. Unit 9 flipped it to
 * `true` IN THE SAME CHANGE that retired the dashboard wizard
 * (DossierEditor/DossierPreview/wizard/) and the store's write paths — so
 * `main` never had two owners of form state, and never none.
 *
 * Typed `boolean` deliberately: a `true` literal type would let the compiler
 * prune the flag-off arms as dead code (TS2367 on every dark-path
 * comparison), and the dark arms stay compiled and pinned as the documented
 * fallback shape.
 */
export const MERGED_FLOW_ENABLED: boolean = true;

/* ─────────────────────────────── the merged step union ─────────────────────────────── */

/**
 * The five application-form steps, in walk order. `satisfies readonly
 * WizardStepId[]` pins each id to the wizard vocabulary (a rename there
 * breaks compilation here, not a landing at runtime); the test suite pins
 * that this list IS `stepsForGroup`'s list, in order — exhaustive, not just
 * a subset.
 */
export const MERGED_FORM_STEPS = [
  "basics",
  "group",
  "academics",
  "project",
  "review",
] as const satisfies readonly WizardStepId[];

export type MergedFormStep = (typeof MERGED_FORM_STEPS)[number];

/** R3/R5's "first application-form step" — the fail-open landing. */
export const FIRST_FORM_STEP: MergedFormStep = MERGED_FORM_STEPS[0];

/**
 * The three next-steps screens, re-homed past review (R10). Ids match the
 * `NEXT_STEPS.swipes` ids in deposit-rules — the shim's target shape.
 */
export const MERGED_NEXT_STEPS = ["progress", "goal", "seat"] as const;

export type MergedNextStep = (typeof MERGED_NEXT_STEPS)[number];

/**
 * Every step the merged flow can stand on. The R6a seam sits between reveal
 * and basics: the explicit hand-the-device-back screen (build cohort only).
 */
export type MergedStep = MiniAppStep | "seam" | MergedFormStep | MergedNextStep;

const ALL_MERGED_STEPS: readonly MergedStep[] = [
  ...MINIAPP_STEPS,
  "seam",
  ...MERGED_FORM_STEPS,
  ...MERGED_NEXT_STEPS,
];

export const isMergedStep = (x: unknown): x is MergedStep =>
  typeof x === "string" && (ALL_MERGED_STEPS as readonly string[]).includes(x);

/** Is this merged step one of the five application-form steps? Exported for
 *  the shell's section dispatch (Unit 6) — the same list the step-list
 *  builder splices, so the two ends cannot drift. */
export const isMergedFormStep = (x: unknown): x is MergedFormStep =>
  typeof x === "string" && (MERGED_FORM_STEPS as readonly string[]).includes(x);

const isFormStep = (x: MergedStep): x is MergedFormStep => isMergedFormStep(x);

/** Is this merged step one of the three next-steps screens? Exported for the
 *  shell's section dispatch (Unit 8) — the same list the step-list builder
 *  appends behind the gate, so the two ends cannot drift. */
export const isMergedNextStep = (x: unknown): x is MergedNextStep =>
  typeof x === "string" && (MERGED_NEXT_STEPS as readonly string[]).includes(x);

const isNextStep = (x: MergedStep): x is MergedNextStep => isMergedNextStep(x);

/* ─────────────────────────────── step → progress rung ─────────────────────────────── */

/**
 * Which rung of R32's ladder a merged step shows — `wizardProgressStep`
 * extended over the whole union. Build steps ARE `ProgressStep` members and
 * map to themselves; the seam shows reveal's rung (it sits on reveal's
 * landing, before any form work exists to count); form steps DELEGATE to
 * `wizardProgressStep` itself (one switch, one owner — never a
 * re-implementation a rename could desync; the test suite pins the
 * delegation with a literal table). Next-steps screens sit PAST the ladder:
 * `null`, the documented past-ladder value — the nav card degrades to
 * identity-only (`navCardIdentityOnly` zone), never a stray 100.
 *
 * `submitted` only lifts the FORM steps: a read-only re-walk of the build
 * steps still shows each step's own rung (the bar narrates where you stand,
 * not what the row's status is — same as the mini-app today).
 */
export function mergedProgressStep(
  step: MergedStep,
  submitted: boolean
): ProgressStep | null {
  if (isNextStep(step)) return null;
  if (step === "seam") return "reveal";
  if (isFormStep(step)) return wizardProgressStep(step, submitted);
  // A MiniAppStep is a ProgressStep by construction (the `satisfies` coupling).
  return step;
}

/**
 * The nav card for a merged step — a pure mapping over the EXISTING
 * nav-card exports, so `NAV_CARD_IDENTITY_STEPS` needs no growth: form steps
 * resolve to the wizard_1/2/3/submitted rungs, which already carry the
 * identity treatment; next-steps (rung null) take the post-ladder
 * identity-only card; build steps keep the bar-only card via their own rung.
 */
export function mergedNavCard(
  step: MergedStep,
  identity: string | null,
  submitted: boolean
): NavCardModel {
  const rung = mergedProgressStep(step, submitted);
  return rung === null ? navCardIdentityOnly(identity) : navCardForStep(rung, identity);
}

/* ─────────────────────────────── the facts the route loads ─────────────────────────────── */

/**
 * Everything the landing/clamp/list rules consume, loaded once by the route.
 * Derived facts arrive PRE-COMPUTED by their owning modules — this module
 * never re-derives them, so the two ends of a predicate cannot drift:
 *
 * - `nextStepsReachable`: the deposit-rules predicate VERBATIM (R11) —
 *   pass its result, never a re-implementation.
 * - `formProgress`: `formProgress()` below, over the child's row.
 * - `firstIncompleteFormStep`: `firstIncompleteStep(child)` from
 *   wizard-rules (the R3 resume rule, unchanged — resolves I2's
 *   no-capability-regression requirement).
 * - `doorConfirmed`/`hasProject`: the existing `initialStepForFacts` inputs.
 *
 * "Is this a build-cohort (funnel) child" is DERIVED — `applicantState !==
 * null` — never a second stored fact that could disagree with the column.
 */
export type MergedFlowFacts = {
  applicantState: ApplicantState | null;
  status: SeatStatus;
  doorConfirmed: boolean;
  hasProject: boolean;
  nextStepsReachable: boolean;
  formProgress: boolean;
  firstIncompleteFormStep: MergedFormStep;
  mergeFlagOn: boolean;
};

/* ─────────────────────────────── per-cohort step list ─────────────────────────────── */

/**
 * The steps THIS child's walk contains, in order. Build steps + seam only
 * for funnel children (`applicantState !== null` — a legacy child's list
 * simply lacks them, not greyed, per the scope boundary); form steps for
 * every cohort; next-steps appended only when the gate passes. Flag off (the
 * pre-Unit-9 dark shape, kept compiled) → exactly the pre-merge
 * `MINIAPP_STEPS`.
 */
export function stepListForChild(facts: MergedFlowFacts): readonly MergedStep[] {
  if (!facts.mergeFlagOn) return MINIAPP_STEPS;
  const list: MergedStep[] = [];
  if (facts.applicantState !== null) list.push(...MINIAPP_STEPS, "seam");
  list.push(...MERGED_FORM_STEPS);
  if (facts.nextStepsReachable) list.push(...MERGED_NEXT_STEPS);
  return list;
}

/* ─────────────────────────────── the landing rule (R5) ─────────────────────────────── */

/**
 * ONE state-aware landing rule for every entry point — the plan's bucket
 * table, verbatim:
 *
 * - offered → first form step (R3: "Review application" lands on the form,
 *   Back walks the build) — offered outranks the mid-form resume: the CTA's
 *   promise is "review from the top".
 * - mid-form (`project_created` + form progress) → first incomplete form
 *   step (the R3 resume rule via the wizard's own derivation).
 * - `project_created` + NO form progress → the seam (C3's bucket boundary:
 *   the build just finished; hand the device back, then basics).
 * - pre-application funnel states (`added`) → the furthest build step the
 *   server can prove, via the existing `initialStepForFacts` logic.
 * - submitted / in_review / waitlisted → first form step (read-only walk).
 * - deposited / enrolled → first form step (read-only walk; next-steps are
 *   reachable FORWARD from review, not the landing).
 * - legacy draft (null state, status draft) → `firstIncompleteStep` (I2:
 *   no capability regression on resume).
 * - legacy locked (null state, any non-draft status) → first form step.
 * - unresolvable → first form step, NEVER `handoff` — the fail-open must
 *   not strand a legacy family at a build phase their cohort doesn't have.
 *
 * Dark flag → the existing mini-app landing, untouched.
 */
export function mergedInitialStep(facts: MergedFlowFacts): MergedStep {
  if (!facts.mergeFlagOn) return initialStepForFacts(facts);
  // The RESUME landing is one step BACK from the next-new step (Peter,
  // 2026-07-30): the parent re-lands on the LAST screen they completed —
  // "showing this page a second time is a good thing, it reminds the user
  // where they were" — and the screen's own CTA advances into new
  // territory. First step stays itself; the review-from-the-top cells
  // (submitted+/offered/legacy locked) are untouched.
  const lastCompleted = (next: MergedStep): MergedStep =>
    mergedStepNeighbour(next, "back", facts) ?? next;
  switch (facts.applicantState) {
    case "added":
      return lastCompleted(initialStepForFacts(facts));
    case "project_created":
      return facts.formProgress ? lastCompleted(facts.firstIncompleteFormStep) : "seam";
    case null:
      return facts.status === "draft"
        ? lastCompleted(facts.firstIncompleteFormStep)
        : FIRST_FORM_STEP;
    case "submitted":
    case "in_review":
    case "offered":
    case "waitlisted":
    case "deposited":
    case "enrolled":
      return FIRST_FORM_STEP;
    default:
      // Unreachable for a parsed ApplicantState; the fail-open bucket.
      return FIRST_FORM_STEP;
  }
}

/**
 * The ONE resolution rule for "what step is this request on" — the merged
 * `resolveStep`, plus the CLAMP (flow-analysis C2): a `?step=` naming
 * anything outside THIS child's resolved list — garbage, an ungated
 * next-step, a build step on a legacy child, anything demotion revoked —
 * resolves exactly as if no `?step=` were present. One rule closes
 * deep-link abuse, mid-walk demotion refresh, and the valid-but-absent
 * case; the silent re-landing matches today's invalid-step behaviour.
 *
 * ONE softened arm: a NEXT-STEPS id on a LOCKED walk whose list lacks the
 * screens is the demotion-mid-walk shape (yesterday: offered, standing on
 * goal; today: staff pulled the offer back). Re-landing that family on
 * bare basics would strand them with no explanation — resolve to "review"
 * instead, whose terminal arm narrates the state (under-review/waitlist
 * copy). Garbage steps and unlocked children keep the plain clamp.
 */
export function resolveMergedStep(
  rawStep: string | null,
  facts: MergedFlowFacts
): MergedStep {
  const list = stepListForChild(facts);
  if (rawStep !== null && (list as readonly string[]).includes(rawStep)) {
    return rawStep as MergedStep;
  }
  if (
    facts.mergeFlagOn &&
    isMergedNextStep(rawStep) &&
    mergedLockVerdict(facts)
  ) {
    return "review";
  }
  return mergedInitialStep(facts);
}

/* ─────────────────────────────── form progress (R5's new fact axis) ─────────────────────────────── */

/**
 * Has a family done ANY form work on this child? Owned here per the plan
 * ("Unit 4 OWNS this decision"). The predicate keys ONLY on fields no
 * automated path writes — audited against the seeders:
 *
 * - capture / add-child seeds `first_name` + `grade` → both EXCLUDED.
 * - the doors step writes `group_slug` → EXCLUDED.
 * - `prefillDraft` (the trap: it PERSISTS through the store on every
 *   dashboard load of a draft) seeds `birth_year` (from grade) and
 *   `project_pitch` (from the composed project) → both EXCLUDED.
 *
 * What remains is family-typed residue only: `last_name` (add-child asks
 * for the first name alone), `current_school`, a non-empty `academics`
 * array, `interests`, `portfolio_links`, and the child-email pair (R48 —
 * `child_email_none` is a deliberate answer, so the flag counts). If this
 * residue proves too thin against production rows, the named fallback is a
 * real form-progress column (Management API playbook) — not a widened
 * predicate.
 */
export function formProgress(fields: {
  lastName: string;
  currentSchool: string;
  academics: readonly unknown[];
  interests: string;
  portfolioLinks: string;
  childEmail: string;
  childEmailNone: boolean;
}): boolean {
  return (
    fields.lastName.trim().length > 0 ||
    fields.currentSchool.trim().length > 0 ||
    fields.academics.length > 0 ||
    fields.interests.trim().length > 0 ||
    fields.portfolioLinks.trim().length > 0 ||
    fields.childEmail.trim().length > 0 ||
    fields.childEmailNone === true
  );
}

/* ─────────────────────────────── the lock union (R8) ─────────────────────────────── */

/**
 * Is this child's walk read-only? The DUAL-VOCABULARY union — the funnel's
 * edit horizon (`isEditLocked`, submitted-and-past on the applicant ladder)
 * OR the legacy status lock (a null-state child whose `children.status`
 * left draft: the wizard's own read-only rule, which never consulted the
 * ladder because legacy children aren't on it). Passing both columns keeps
 * the overlap trap closed (`submitted`/`in_review`/`offered` are members of
 * BOTH vocabularies — see `canReserveSeatForChild`'s named-fields note).
 *
 * PRESENTATION at the call sites that disable inputs; the guarantee stays
 * the write path (server-side dual check + the DB group-lock guard).
 */
export function mergedLockVerdict(
  facts: Pick<MergedFlowFacts, "applicantState" | "status">
): boolean {
  if (isEditLocked(facts.applicantState)) return true;
  return facts.applicantState === null && facts.status !== "draft";
}

/**
 * Per-step editability inside a walk. A locked walk is read-only EXCEPT:
 *
 * - `group` stays editable until a PAID deposit exists (R8's decided
 *   semantics: post-submit group change is a direct write behind the
 *   deposit-keyed group-lock guard, project intact — in BOTH vocabularies,
 *   because the verdict already unions them). The fact must be a PROVEN
 *   `false`: `null` means the deposits read failed, and an unknown deposit
 *   fails CLOSED on a locked walk — rendering the step editable on a guess
 *   would offer an edit `writeGroup` then refuses (a false affordance).
 *   Pre-submit walks are unaffected: group is editable there via the
 *   not-locked path, whatever the deposit fact says.
 * - `goal` is ALWAYS writable: the field sits outside the edit horizon by
 *   design (R10's named write exception; M1 decided it stays writable even
 *   post-deposit), and the step only exists in next-steps-reachable lists,
 *   so the gate has already run by the time anyone stands on it.
 *
 * Everything else: editable iff not locked.
 */
export function stepEditableInWalk(
  step: MergedStep,
  lockVerdict: boolean,
  depositPaid: boolean | null
): boolean {
  if (step === "goal") return true;
  if (!lockVerdict) return true;
  return step === "group" && depositPaid === false;
}

/* ─────────────────────────────── the endings map (R9/R9a) ─────────────────────────────── */

/**
 * What the flow's END looks like for this child — the review step's mode
 * and everything past it. One closed vocabulary so no cohort can reach a
 * pressable control that does nothing (Unit 7's verification).
 */
export type TerminalTreatment =
  | "submit" // pre-submit, project composed: review submits (R9)
  | "finish_build" // pre-submit funnel child WITHOUT a composed project:
  //                  `added → submitted` has no legal edge (C1), so review
  //                  points to the furthest build step instead of a submit
  | "under_review" // submitted-not-offered: status terminal, explicit
  //                  dashboard control, NO forward (R9a)
  | "waitlisted" // the waitlist branch's own copy
  | "next_steps"; // the walk continues into progress/goal/seat (R10/R11)

/**
 * The endings map, exhaustive over BOTH vocabularies (I1). The next-steps
 * gate outranks everything — it is the R11 predicate verbatim, and it
 * already spans both columns (offered/deposited/enrolled on the ladder;
 * offered/member on the status). Funnel children then map through the
 * ladder; legacy children (null state) through the SeatStatus vocabulary,
 * `invited` included (a rung the ladder never had). Legacy draft keeps the
 * wizard's status-vocabulary submit exactly as today (C1's second half).
 */
export function terminalTreatment(
  facts: Pick<MergedFlowFacts, "applicantState" | "status" | "nextStepsReachable">
): TerminalTreatment {
  if (facts.nextStepsReachable) return "next_steps";
  switch (facts.applicantState) {
    case "added":
      // The LADDER is the gate, not the project row: `added → submitted`
      // has no legal edge whatever a stray projects row says (C1). Compose
      // moves the ladder to `project_created` in the same transaction that
      // creates the row, so the two facts cannot legitimately disagree.
      return "finish_build";
    case "project_created":
      return "submit";
    case "submitted":
    case "in_review":
      return "under_review";
    case "waitlisted":
      return "waitlisted";
    case "offered":
    case "deposited":
    case "enrolled":
      // Unreachable in practice — each passes the next-steps gate above —
      // but the map stays total rather than trusting the gate's coverage.
      return "next_steps";
    case null: {
      switch (facts.status) {
        case "draft":
          return "submit";
        case "submitted":
        case "in_review":
        case "invited":
          return "under_review";
        case "waitlisted":
          return "waitlisted";
        case "offered":
        case "member":
          return "next_steps";
      }
    }
  }
  // Unreachable for parsed inputs; the conservative default for a widened
  // string is the no-controls terminal, never a submit.
  return "under_review";
}

/* ─────────────────────────────── walk neighbours (Unit 6) ─────────────────────────────── */

/**
 * One rung forward/back through THIS child's resolved list — the merged
 * `stepNeighbour`. Ends return null (the shell's Back slot renders its
 * per-cohort backward terminal on null: "← ALL CHILDREN" never reaches here
 * because handoff is special-cased first; a legacy list's first form step
 * gets "← Dashboard"). A step outside the list returns null too — the clamp
 * already re-lands such a request before any neighbour is asked for.
 */
export function mergedStepNeighbour(
  step: MergedStep,
  direction: "back" | "next",
  facts: MergedFlowFacts
): MergedStep | null {
  const list = stepListForChild(facts);
  const i = list.indexOf(step);
  if (i === -1) return null;
  const j = direction === "next" ? i + 1 : i - 1;
  return j >= 0 && j < list.length ? list[j] : null;
}

/* ─────────────────────────────── the R6a seam copy ─────────────────────────────── */

/**
 * R6a: the explicit hand-BACK seam between reveal and basics, build cohort
 * only. The handoff step's device-passing idiom, mirrored: this side is
 * addressed to the CHILD handing the device back to the parent, one CTA
 * advancing to basics, never an auto-advance. One template so the copy
 * cannot drift per call site (the handoffCopy precedent). Copy rules: no em
 * dashes, nothing scary.
 */
export type SeamCopy = {
  eyebrow: string;
  title: string;
  body: string;
  parentLine: string;
  cta: string;
};

export function seamCopy(firstName: string, skin: Skin): SeamCopy {
  const name = firstName.trim() || "founder";
  return skin === "trail"
    ? {
        eyebrow: "Hand it back",
        title: `${name}, hand the device back to your parent.`,
        body: "Your business is built and saved. The next part is grown-up paperwork. Hand the device back to your parent.",
        parentLine: "Parents: the application questions are yours from here.",
        cta: "It's back with a parent",
      }
    : {
        eyebrow: "Hand the device back",
        title: `${name}, hand the device back to your parent.`,
        body: "Your build is done and saved. The application questions are for your parent now. Hand the device back.",
        parentLine: "Parents: from here it's the application. Five short steps.",
        cta: "I have the device, continue",
      };
}

/* ─────────────────────────────── checklist assembly (Unit 6) ─────────────────────────────── */

/**
 * The merged flow's loaded fields assembled into the dashboard's `Child`
 * shape, so `checklist`/`firstIncompleteStep` read the SAME definition the
 * meter renders (data.ts is the one checklist; its lockstep mirrors are
 * nurture + CRM). Assembled over server-persisted content only — unsaved
 * keystrokes can never fake completeness. Mirrors the submit core's
 * assembly; the fields subset is structural so both the loader shape and
 * the core's row shape fit.
 */
export function checklistChildForFields(f: {
  id: string;
  firstName: string;
  lastName: string;
  grade: number | null;
  birthYear: string;
  currentSchool: string;
  groupSlug: string | null;
  academics: Child["academics"];
  subjects: string[];
  interests: string;
  projectPitch: string;
  portfolioLinks: string;
}): Child {
  return {
    ...emptyChild(f.id),
    firstName: f.firstName,
    lastName: f.lastName,
    grade: f.grade ?? "",
    birthYear: f.birthYear,
    currentSchool: f.currentSchool,
    groupSlug: f.groupSlug ?? "",
    academics: f.academics,
    subjects: f.subjects,
    interests: f.interests,
    projectPitch: f.projectPitch,
    portfolioLinks: f.portfolioLinks,
  };
}
