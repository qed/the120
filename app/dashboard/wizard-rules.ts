/**
 * Pure step-derivation + prefill rules for the dossier wizard (Units 3/6;
 * rewired by funnel U12 — the Workshops step is REMOVED, R46). No React in
 * here — everything is unit-testable in the node vitest env.
 */

import { checklist, type Child } from "./data";
import type { ProgressStep } from "@/app/lib/funnel/capture-rules";

/* ---------- steps ---------- */

export type WizardStepId = "basics" | "group" | "academics" | "project" | "review";

export const STEP_LABELS: Record<WizardStepId, string> = {
  basics: "Basics",
  group: "Group",
  academics: "Academics",
  project: "Project & Interests",
  review: "Review & Submit",
};

/**
 * ONE list for every group since the Workshops removal (funnel U12, R46).
 * The group parameter stays in the signature: every caller already threads
 * it, and a future group-specific step has its seam without a re-plumb.
 */
export function stepsForGroup(groupSlug: string): WizardStepId[] {
  void groupSlug;
  return ["basics", "group", "academics", "project", "review"];
}

/**
 * Map a checklist item (by its label — the three lockstep mirrors share
 * these strings) to the wizard step that owns it, for Review deep-links
 * and resume. Unknown labels fall through to "review" so a renamed
 * checklist item degrades to "stay on review" rather than a crash;
 * the test suite asserts every current label maps to a real step.
 */
export function stepForChecklistLabel(label: string): WizardStepId {
  switch (label) {
    case "Name":
    case "Grade":
    case "Birth year":
    case "Current school":
      return "basics";
    case "A group":
      return "group";
    case "Academics (a subject + plan)":
      return "academics";
    case "The kid's interests":
    case "A project pitch":
      return "project";
    default:
      return "review";
  }
}

/**
 * Resume rule (R3): reopening a draft lands on the first incomplete step,
 * derived from checklist item order (which matches step order). A complete
 * draft lands on Review.
 */
export function firstIncompleteStep(c: Child): WizardStepId {
  const steps = stepsForGroup(c.groupSlug);
  for (const item of checklist(c)) {
    if (!item.done) {
      const step = stepForChecklistLabel(item.label);
      return steps.includes(step) ? step : "review";
    }
  }
  return "review";
}

/**
 * Where to land when a stored/stale step id no longer exists. Accepts a raw
 * STRING deliberately: pre-U12 sessions and resume state can still say
 * "workshops", and that step's successor was Project & Interests — the same
 * fallback covers any other unknown id.
 */
export function resolveStep(current: string, groupSlug: string): WizardStepId {
  const steps = stepsForGroup(groupSlug);
  return (steps as string[]).includes(current) ? (current as WizardStepId) : "project";
}

/* ---------- funnel prefill (U12; R46, R47) ---------- */

/**
 * R47: birth year auto-calculates from the grade and stays editable. NOTE:
 * R47's literal text says "2026 − 11 + grade", which INCREASES with grade
 * and yields the future (grade 12 → 2027) — both reviewers executed it. The
 * requirement's evident intent is its own worked example (a grade-6 child
 * aged 11 → 2015), which is `2021 − grade`: grade 3 → 2018, grade 12 →
 * 2009. Implemented as intended; the wording flagged to Peter.
 */
export function birthYearForGrade(grade: number | ""): string {
  if (grade === "" || !Number.isInteger(grade)) return "";
  return String(2021 - grade);
}

/** The funnel project fields the prefill needs — a subset of the projects
 *  row, so the caller can pass whatever loader shape it has. */
export type FunnelProjectSeed = { name: string; description: string };

/**
 * R46/R47: the wizard receives the funnel's work pre-done. Applied
 * IN-MEMORY at load, never as an eager write (the sanitize pattern): the
 * prefilled values persist through the next normal save, and both stay
 * fully editable. Never overwrites what a family already typed.
 */
export function prefillDraft(c: Child, project: FunnelProjectSeed | null): Child {
  const birthYear =
    c.birthYear.trim() === "" ? birthYearForGrade(c.grade) : c.birthYear;
  // The composed pitch must be a REAL pitch: both halves present and the
  // result past the checklist's own 10-char threshold — a partial projects
  // row must not persist ":" or "Name:" as the family's pitch (reviewer, by
  // execution).
  const composed = project
    ? `${project.name.trim()}: ${project.description.trim()}`
    : "";
  const projectPitch =
    c.projectPitch.trim() === "" &&
    project &&
    project.name.trim().length > 0 &&
    project.description.trim().length > 0 &&
    composed.length >= 10
      ? composed
      : c.projectPitch;
  if (birthYear === c.birthYear && projectPitch === c.projectPitch) return c;
  return { ...c, birthYear, projectPitch };
}

/* ---------- nav card progress (U10 fidelity, X1/X2) ---------- */

/**
 * Which rung of R32's ladder the wizard's nav card shows (the 80/90/96/100
 * values that were defined-but-unconsumed — audit item 11f/X2). The handoff's
 * wizard was three steps (Basics → Academics → Review, Group + Project
 * pre-done from the funnel); the live wizard visits five. Mapping: the two
 * funnel-pre-done steps ride WITH their spec neighbour — basics/group → 80,
 * academics/project → 90, review → 96 — so the bar stays monotone through a
 * straight walk and submitted always reads 100.
 */
export function wizardProgressStep(step: WizardStepId, submitted: boolean): ProgressStep {
  if (submitted) return "submitted";
  switch (step) {
    case "basics":
    case "group":
      return "wizard_1";
    case "academics":
    case "project":
      return "wizard_2";
    case "review":
      return "wizard_3";
  }
}

/* ---------- child email (U12, R48) ---------- */

/** R48: "Don't have one" records the FLAG without an address. The pair is
 *  mutually exclusive; ticking the flag clears any typed address. */
export function childEmailPatch(
  input: { email?: string; none?: boolean },
  current: Pick<Child, "childEmail" | "childEmailNone">
): Pick<Child, "childEmail" | "childEmailNone"> {
  if (input.none !== undefined) {
    return input.none
      ? { childEmail: "", childEmailNone: true }
      : { childEmail: current.childEmail, childEmailNone: false };
  }
  const email = (input.email ?? "").slice(0, 254);
  // A whitespace-only "address" is no address: store empty, keep the flag —
  // otherwise a stray space stores a non-empty child_email alongside
  // childEmailNone=true, breaking the pair's mutual exclusivity (reviewer).
  if (email.trim().length === 0) {
    return { childEmail: "", childEmailNone: current.childEmailNone };
  }
  return { childEmail: email, childEmailNone: false };
}
