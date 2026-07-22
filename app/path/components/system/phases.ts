/**
 * The Path — phase display metadata for the design system (T1 Unit 13).
 *
 * The five phases are the spine of the whole product; mechanics are constant and
 * only Trail-vs-HQ rendering differs. `PhaseKey` is the canonical domain type
 * from the content package (`app/path/content/types.ts`, uppercase "SELL"…) — it
 * is imported, never redefined. The presentational labels below (taglines, Trail
 * territory metaphors) belong to the design layer; the authoritative curriculum
 * data lives in the content package and the surfaces (Unit 14) resolve real phase
 * names through `getProgram`. Kept as a plain constants module so it never pulls
 * the generated content (125 tasks of prose) into a client bundle.
 */

import type { PhaseKey } from "@/app/path/content/types";

export interface PhaseMeta {
  /** Canonical phase key, e.g. "SELL". */
  key: PhaseKey;
  /** 1-based position, rendered zero-padded as "01".."05". */
  index: number;
  /** Display name (same glyphs as the key). */
  name: string;
  /** The phase's one-verb promise. */
  tagline: string;
  /** The Trail world metaphor for this phase. */
  territory: string;
}

export const PHASES: readonly PhaseMeta[] = [
  {
    key: "SELL",
    index: 1,
    name: "SELL",
    tagline: "Learn to confidently sell anything.",
    territory: "The Market Town",
  },
  {
    key: "BUILD",
    index: 2,
    name: "BUILD",
    tagline: "Make a real product with AI.",
    territory: "The Workshop Quarter",
  },
  {
    key: "VALIDATE",
    index: 3,
    name: "VALIDATE",
    tagline: "Test ideas like a scientist.",
    territory: "The Observatory",
  },
  {
    key: "GROW",
    index: 4,
    name: "GROW",
    tagline: "Turn a validated idea into a running business.",
    territory: "The Growing High Street",
  },
  {
    key: "SCALE",
    index: 5,
    name: "SCALE",
    tagline: "Build systems so the business runs beyond them.",
    territory: "The Summit City",
  },
] as const;

const BY_KEY = Object.fromEntries(PHASES.map((p) => [p.key, p])) as Record<
  PhaseKey,
  PhaseMeta
>;

export const phaseByKey = (key: PhaseKey): PhaseMeta => BY_KEY[key];

/**
 * CSS custom-property reference per phase, for inline styles. The channels
 * themselves live in `app/globals.css` (`:root`), authored as HSL triplets so
 * alpha can be composed at runtime.
 */
const PHASE_CHANNEL: Record<PhaseKey, string> = {
  SELL: "var(--phase-sell)",
  BUILD: "var(--phase-build)",
  VALIDATE: "var(--phase-validate)",
  GROW: "var(--phase-grow)",
  SCALE: "var(--phase-scale)",
};

/** A full opaque color for the phase — inline styles, SVG fills, gradients. */
export const phaseColor = (key: PhaseKey): string => `hsl(${PHASE_CHANNEL[key]})`;

/**
 * The phase color at an alpha in [0, 1] — glows, tints, rings, soft fills.
 * Replaces the prototype's `` `${hexColor}22` `` hex-append, which is invalid
 * once the color is an `hsl()` value rather than a 6-digit hex string.
 */
export const phaseColorAlpha = (key: PhaseKey, alpha: number): string =>
  `hsl(${PHASE_CHANNEL[key]} / ${alpha})`;
