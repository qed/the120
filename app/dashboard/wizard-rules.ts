/**
 * Pure step-derivation + filter rules for the dossier wizard (Units 3/6).
 * No React in here — everything is unit-testable in the node vitest env.
 */

import { WORKSHOPS, checklist, type Child, type Workshop } from "./data";

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

/* ---------- workshops filter + selection rules (Unit 6, R5–R9) ---------- */

/** One track always active — "All tracks" was removed (R7) so the list stays
 *  short; grade filtering is gone entirely (R6, The 120 runs grades 3+). */
export type TrackFilter = "Sciences" | "Humanities" | "Competition";

export const TRACK_FILTERS: { id: TrackFilter; label: string }[] = [
  { id: "Sciences", label: "Sciences" },
  { id: "Humanities", label: "Humanities" },
  { id: "Competition", label: "Competition" },
];

export const DEFAULT_TRACK: TrackFilter = "Sciences";

export const filterWorkshops = (workshops: Workshop[], track: TrackFilter): Workshop[] =>
  workshops.filter((w) => w.track === track);

/** Interest-gathering cap (R8): pick up to 3. A UI/selection constraint only —
 *  deliberately NOT a checklist/completeness rule (the three lockstep mirrors
 *  keep their ≥1 minimum; raising it there would break parity). */
export const WORKSHOP_MAX = 3;

/**
 * Sanitize a stored selection against the live catalog (R5/R8): drop ids that
 * no longer exist in WORKSHOPS (retired K–2 entries, junk) and trim to the
 * cap. Applied in-memory where the selection is editable — never as an eager
 * write on load; the sanitized set persists through the next normal save.
 */
export function sanitizeWorkshopSelection(ids: string[]): string[] {
  const live = new Set(WORKSHOPS.map((w) => w.id));
  return ids.filter((id) => live.has(id)).slice(0, WORKSHOP_MAX);
}
