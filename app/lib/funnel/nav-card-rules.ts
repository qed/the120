/**
 * The floating nav progress card (U10 fidelity, audit X1/X2 — the handoff's
 * Interactions rule). PURE: `environment: "node"` has no renderer, so which
 * variant renders on which surface, the percent, and the label format all
 * live here as return values, and `ProgressNavCard` reads them.
 *
 * The handoff fixes three right-hand treatments for the card:
 * - explainer → reveal: the 4px red bar on `#eceae5` + "APPLICATION · n%".
 * - the wizard onward (wizard_1/2/3, submitted): bar + short "n%" +
 *   "NAME · SIGN OUT".
 * - next steps / arrival: name + SIGN OUT only, no bar (the ladder ended at
 *   submitted 100; there is no percent left to show).
 *
 * Every percent comes from `progressPercent` (R32's one ladder) — this
 * module decides PRESENTATION, never numbers.
 */

import { progressPercent, type ProgressStep } from "./capture-rules";

export type NavCardModel =
  | { kind: "progress"; percent: number; label: string }
  | { kind: "progress_identity"; percent: number; label: string; identity: string | null }
  | { kind: "identity"; identity: string | null };

/** The steps from which the card carries NAME · SIGN OUT beside the bar. */
export const NAV_CARD_IDENTITY_STEPS: readonly ProgressStep[] = [
  "wizard_1",
  "wizard_2",
  "wizard_3",
  "submitted",
];

/** The full label, pre-wizard (the prototype's `flowPctLabel`). */
export const navCardLabel = (percent: number): string => `APPLICATION · ${percent}%`;

/** The short label beside an identity (the prototype's `flowPctShort`). */
export const navCardShortLabel = (percent: number): string => `${percent}%`;

/**
 * The identity string the card shows: the parent's full name, uppercased —
 * the prototype's `dashUser`. Null when nothing usable was captured, so the
 * card can degrade to SIGN OUT alone rather than render a stray "·".
 */
export function navCardIdentityName(firstName: string, lastName: string): string | null {
  const full = `${firstName.trim()} ${lastName.trim()}`.trim();
  return full === "" ? null : full.toUpperCase();
}

/**
 * The card model for any step on R32's ladder. `identity` is only consulted
 * inside the wizard zone — passing a name on an earlier step must not leak
 * it onto a surface the spec renders bar-only.
 */
export function navCardForStep(step: ProgressStep, identity: string | null): NavCardModel {
  const percent = progressPercent(step);
  if (NAV_CARD_IDENTITY_STEPS.includes(step)) {
    return {
      kind: "progress_identity",
      percent,
      label: navCardShortLabel(percent),
      identity,
    };
  }
  return { kind: "progress", percent, label: navCardLabel(percent) };
}

/** Next steps / arrival: name + SIGN OUT only — the post-ladder card. */
export function navCardIdentityOnly(identity: string | null): NavCardModel {
  return { kind: "identity", identity };
}
