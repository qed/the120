/**
 * Pure step-derivation + filter rules for the dossier wizard (Units 3/6).
 * No React in here — everything is unit-testable in the node vitest env.
 */

import { checklist, workshopGradeRange, type Child, type Workshop } from "./data";

/* ---------- steps ---------- */

export type WizardStepId =
  | "basics"
  | "group"
  | "academics"
  | "workshops"
  | "project"
  | "review";

export const STEP_LABELS: Record<WizardStepId, string> = {
  basics: "Basics",
  group: "Group",
  academics: "Academics",
  workshops: "Workshops",
  project: "Project & Interests",
  review: "Review & Submit",
};

/**
 * The wizard's step list is group-aware: the Workshops explore exists only
 * for The Scholars (R6). An unset group ("") is treated as non-Scholars
 * until picked.
 */
export function stepsForGroup(groupSlug: string): WizardStepId[] {
  return groupSlug === "scholars"
    ? ["basics", "group", "academics", "workshops", "project", "review"]
    : ["basics", "group", "academics", "project", "review"];
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
    case "A workshop of interest":
      return "workshops";
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
 * Where to land when the current step no longer exists after the step list
 * re-derives (R6): the only step that can vanish is Workshops (switching
 * away from Scholars), whose successor is Project & Interests.
 */
export function resolveStep(current: WizardStepId, groupSlug: string): WizardStepId {
  return stepsForGroup(groupSlug).includes(current) ? current : "project";
}

/* ---------- workshops filter (Unit 6) ---------- */

export type TrackFilter = "all" | "Sciences" | "Humanities" | "Competition";
export type GradeBandId = "all" | "k-2" | "3-5" | "6-8";

export const TRACK_FILTERS: { id: TrackFilter; label: string }[] = [
  { id: "all", label: "All tracks" },
  { id: "Sciences", label: "Sciences" },
  { id: "Humanities", label: "Humanities" },
  { id: "Competition", label: "Competition" },
];

/** Filter bands mirror GT's. A workshop matches a band when its parsed
 *  [gradeMin, gradeMax] range overlaps the band's range (K = 0, "8+" = 12). */
export const GRADE_BANDS: { id: GradeBandId; label: string; min: number; max: number }[] = [
  { id: "all", label: "All grades", min: 0, max: 12 },
  { id: "k-2", label: "K–2", min: 0, max: 2 },
  { id: "3-5", label: "3–5", min: 3, max: 5 },
  { id: "6-8", label: "6–8", min: 6, max: 8 },
];

export function workshopMatches(w: Workshop, track: TrackFilter, band: GradeBandId): boolean {
  if (track !== "all" && w.track !== track) return false;
  const b = GRADE_BANDS.find((x) => x.id === band);
  if (!b) return false;
  const { gradeMin, gradeMax } = workshopGradeRange(w);
  return gradeMin <= b.max && gradeMax >= b.min;
}

export const filterWorkshops = (
  workshops: Workshop[],
  track: TrackFilter,
  band: GradeBandId
): Workshop[] => workshops.filter((w) => workshopMatches(w, track, band));
