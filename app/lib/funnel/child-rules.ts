/**
 * Add a Child (funnel U7; R31, R32) — grade → band and skin, the grade guard,
 * and the active-child rules the funnel has never had.
 *
 * PURE. Reuses `Skin` from `app/lib/fp/skin-tokens.ts` rather than declaring a
 * parallel `"hq" | "trail"`: the two-register seam is one concept, and a
 * second copy of the union is how the funnel's skin and First Profit's drift.
 */

import type { Skin } from "@/app/lib/fp/skin-tokens";
import { GRADES } from "@/app/dashboard/data";
import { APPLICANT_STATES, isApplicantState } from "@/app/lib/funnel/applicant-rules";

export type { Skin };

/**
 * The two bands. `Trail` is the younger register (parent-assist copy, gentler
 * pacing); `HQ` is the founder register. R31 fixes the split at grade 6.
 */
export const BANDS = ["trail", "hq"] as const;
export type Band = (typeof BANDS)[number];

/** R31's boundaries, stated once. `GRADES` (3–12) is the dashboard's own. */
export const TRAIL_GRADES = [3, 4, 5] as const;
export const HQ_GRADE_MIN = 6;

export type GradeVerdict =
  | { ok: true; grade: number; band: Band; skin: Skin }
  | { ok: false; reason: "out_of_range" | "not_a_grade" };

/**
 * Grade → band and skin, or a REFUSAL.
 *
 * A grade outside 3–12 is refused, never clamped (R31's test scenario says so
 * explicitly). Clamping a 2nd-grader to 3 enrols a child the program does not
 * serve and tells their parent nothing; the refusal is the honest answer and
 * the copy below is what they read.
 *
 * Band and skin are 1:1 today and deliberately kept as separate fields: the
 * band is a *product* fact (which register the child is in) and the skin is a
 * *presentation* fact (which token namespace renders). U8's two-register seam
 * swaps on the skin; U9's quiz phrasing branches on the band. Collapsing them
 * would make a future "HQ band, Trail skin for the first screen" unexpressible.
 */
export function gradeVerdict(raw: unknown): GradeVerdict {
  // Strict, not parseInt: `Number.parseInt("7abc")` is 7 and `"4.5"` truncates
  // to 4 — silently COERCING garbage, which is worse than the clamping R31
  // forbids. A grade string is legal only when it is nothing but digits
  // (review finding, 0.85 confidence, with the exact inputs the first test
  // sweep failed to imagine).
  let grade: number;
  if (typeof raw === "number") {
    grade = raw;
  } else if (typeof raw === "string" && /^\s*\d+\s*$/.test(raw)) {
    grade = Number.parseInt(raw.trim(), 10);
  } else {
    return { ok: false, reason: "not_a_grade" };
  }
  if (!Number.isInteger(grade)) return { ok: false, reason: "not_a_grade" };
  if (!(GRADES as readonly number[]).includes(grade)) {
    return { ok: false, reason: "out_of_range" };
  }
  const band: Band = (TRAIL_GRADES as readonly number[]).includes(grade) ? "trail" : "hq";
  return { ok: true, grade, band, skin: band };
}

export const GRADE_REFUSAL_COPY: Record<
  Extract<GradeVerdict, { ok: false }>["reason"],
  string
> = {
  // Never "invalid grade" — a parent whose child is in grade 2 has learned
  // nothing from that, and the real answer is a fact about the program.
  out_of_range: "The 120 runs grades 3 through 12. Pick the grade your child is in now.",
  not_a_grade: "Pick your child's grade.",
};

/* ─────────────────────────── the add-a-child form (R31) ─────────────────────────── */

export type ChildDraft = { firstName: string; grade: unknown };
export type ChildFieldError = "first_name" | "grade";

export function childDraftErrors(draft: ChildDraft): ChildFieldError[] {
  const errors: ChildFieldError[] = [];
  if (String(draft.firstName ?? "").trim().length === 0) errors.push("first_name");
  if (!gradeVerdict(draft.grade).ok) errors.push("grade");
  return errors;
}

export const CHILD_FIELD_MESSAGES: Record<ChildFieldError, string> = {
  first_name: "Add your child's first name.",
  grade: GRADE_REFUSAL_COPY.out_of_range,
};

/* ─────────────────────────── the active child (R32) ─────────────────────────── */

/**
 * One child, reduced to what the grid and the selector need.
 * `applicantState` is the U1 ladder; `createdAt` is the deterministic
 * tie-break, never array order.
 */
export type FunnelChild = {
  id: string;
  firstName: string;
  grade: number;
  applicantState: string | null;
  createdAt: string;
};

/**
 * Which child is active, given the explicit selection and what exists.
 *
 * The repo has never had this: today the dashboard's selection is ephemeral
 * React state and a refresh drops to the grid. R32's progress bar is per-child,
 * so without a durable answer the bar has nothing to describe — and, worse,
 * ADDING a sibling would silently move it.
 *
 * Precedence: an explicit, still-valid selection wins; otherwise the
 * furthest-progressed child; ties break on earliest `createdAt`. A stale
 * selection (child removed) falls through rather than dangling — the same
 * shape `resolveResumeChild` uses in `session-rules.ts`, deliberately, because
 * two different answers to "which child" is how a progress bar and a resume
 * link end up pointing at different children.
 */
export function resolveActiveChild(
  children: readonly FunnelChild[],
  selectedId?: string | null
): FunnelChild | null {
  if (children.length === 0) return null;
  if (selectedId) {
    const chosen = children.find((c) => c.id === selectedId);
    if (chosen) return chosen;
    // Stale selection (child removed): fall through to the furthest, never
    // return a dangling id and never throw.
  }
  const rung = (c: FunnelChild) =>
    isApplicantState(c.applicantState) ? APPLICANT_STATES.indexOf(c.applicantState) : -1;
  return [...children].sort(
    (a, b) => rung(b) - rung(a) || a.createdAt.localeCompare(b.createdAt)
  )[0];
}

/**
 * ADDING a child must not move the active one (R31's "adding a second child
 * leaves the first child's state and progress untouched").
 *
 * Returns the selection to persist AFTER an add. The new child becomes active
 * only when there was no active child before — i.e. the first one. A parent
 * who adds a sibling mid-run is not asking to abandon the run they are in.
 */
export function activeChildAfterAdd(
  previousSelectedId: string | null,
  addedChildId: string
): string {
  return previousSelectedId ?? addedChildId;
}

/* ─────────────────────────── seats (R31 integration) ─────────────────────────── */

/**
 * Each child occupies its own seat, so a family adding three children is
 * asking for three of 120. Surfaced at Add a Child, not discovered at
 * checkout — the plan's integration scenario ("three children means three
 * seats; the seats implication is surfaced").
 */
export function seatsNeeded(childCount: number): number {
  return Math.max(0, childCount);
}

export function seatsCopy(childCount: number): string | null {
  if (childCount <= 1) return null;
  return `${childCount} children means ${childCount} of the 120 seats — one each.`;
}
