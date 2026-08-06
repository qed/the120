/**
 * Image Lab — the SHELL's copy and the decisions over it
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 3; requirements in first-profit repo:
 * docs/brainstorms/2026-08-05-image-lab-requirements.md, R1 and R14).
 *
 * PLAIN module — no next/supabase/react imports — because this repo runs
 * `environment: "node"` with no jsdom: a decision written inline in a `page.tsx`
 * is a decision CI cannot see. The `app/staff/lib/hub-rules.ts` precedent, one
 * route deeper. The pages read the flag, call these, and render.
 *
 * Copy and rules live together on purpose. The strings here exist to serve the
 * two decisions below, and holding them in a second module only meant every nav
 * label hopped through a constant on its way into the one array that uses it.
 *
 * ── THE TWO RULES THIS MODULE EXISTS TO ENFORCE ────────────────────────────
 * 1. What the bench says about generation and what the `/staff` card says about
 *    it are the SAME fact on two surfaces, and they must never disagree. Held
 *    as two inline ternaries, a card reading "generation is on" ends up linking
 *    to a bench that refuses to generate.
 * 2. An empty surface must SAY it is empty and say what would fill it. A blank
 *    div is indistinguishable from a broken query — and this shell ships BEFORE
 *    the queries do (Units 4–6 own the data), so for a while "empty" is the only
 *    state these pages have, and it is the whole product a staff member sees.
 */

// ── Navigation ───────────────────────────────────────────────────────────────

/** The three top-level Lab surfaces. */
export type ImageLabSegment = "bench" | "history" | "kit";

export type ImageLabNavLink = {
  readonly segment: ImageLabSegment;
  readonly href: string;
  readonly label: string;
};

/**
 * The nav table, KEYED BY SEGMENT so it is TOTAL.
 *
 * A `Record` over the union rather than an array: a fourth segment added to
 * {@link ImageLabSegment} without a nav entry is a compile error here, which is
 * the difference between the claim "every segment has a link" being enforced and
 * being merely tested. Declaration order is the launch order and is preserved by
 * `Object.entries` for string keys, so this one structure carries both facts.
 */
const NAV_ENTRIES: Readonly<
  Record<ImageLabSegment, { readonly href: string; readonly label: string }>
> = {
  bench: { href: "/staff/image-lab", label: "Bench" },
  history: { href: "/staff/image-lab/history", label: "History" },
  kit: { href: "/staff/image-lab/kit", label: "Kit" },
};

/**
 * The nav, as an ordered list for rendering.
 *
 * PLAIN LINKS, no client tab state. A tab component holding "which section" in
 * React state loses it on every full render — and this subtree renders fresh on
 * every hard navigation, an error-boundary retry, and any future server action
 * that revalidates. A URL cannot be lost, and it can also be bookmarked, shared
 * into a review thread, and gated per-route, which client tabs cannot.
 */
export const IMAGE_LAB_NAV: readonly ImageLabNavLink[] = Object.entries(
  NAV_ENTRIES
  // `Object.entries` widens the key to `string`; the source object is typed
  // Record<ImageLabSegment, …>, so this narrowing is sound by construction.
).map(([segment, entry]) => ({ segment: segment as ImageLabSegment, ...entry }));

// ── Copy ─────────────────────────────────────────────────────────────────────

/** The card on `/staff`. Staff read this BEFORE navigating in. */
export const IMAGE_LAB_HUB_COPY = {
  title: "Image Lab",
  blurb: "Prompt-to-image bench: compare models, keep what works.",
  /**
   * Two lines, one per flag state, and BOTH are stated. A card that says nothing
   * when generation is off is a card that lets a staff member walk into a dead
   * bench and discover it there.
   */
  generationOn: "Generation is on.",
  generationOff: "Generation is off — the bench opens, but nothing is sent to a model.",
} as const;

/** The shell chrome: the heading and the nav label, on every Lab surface. */
export const IMAGE_LAB_SHELL_COPY = {
  title: "Image Lab",
  subtitle:
    "A staff bench for prompt-to-image drills across the three launch models.",
  navLabel: "Image Lab sections",
} as const;

/** `/staff/image-lab` — the bench. */
export const IMAGE_LAB_BENCH_COPY = {
  heading: "Bench",
  intro:
    "Compose a prompt, pick a model (or several), and generate candidates. Every run is kept — prompt, slots, model, cost, and verdict.",
  /**
   * The generation-state notice. Rendered in BOTH states, deliberately: an
   * indicator that only appears when something is wrong teaches nobody what
   * "right" looks like, and a staff member cannot tell "off" from "not yet
   * checked".
   */
  generationOff: {
    headline: "Generation is off.",
    /**
     * "not set to 1 or true", NOT "not set". `isImageLabLive` is a strict
     * ALLOWLIST, so this branch is also what an operator gets from
     * `IMAGE_LAB_LIVE=on`, `=yes`, `=enabled`, or a value that kept its quotes —
     * the variable IS set, and a notice claiming otherwise sends them to chase
     * env propagation instead of the value they typed. The only actionable
     * diagnostic on the page has to be true of the whole false branch.
     */
    body:
      "IMAGE_LAB_LIVE is not set to 1 or true in this environment, so the bench will not call a model and nothing will be billed. The composer, history, and kit still work; set IMAGE_LAB_LIVE=1 to switch generation on.",
  },
  generationOn: {
    headline: "Generation is on.",
    body:
      "IMAGE_LAB_LIVE is set, so runs from this bench call the real models and are billed to the project.",
  },
  /** The composer is Unit 5; this is what stands in for it until then. */
  composerPending: {
    headline: "The composer is not built yet.",
    body:
      "The reference library below is live — upload a character sheet or style sample now and it will be waiting. The prompt composer and result grid land with the run flow.",
  },
  emptyRuns: {
    headline: "No runs yet.",
    body:
      "Nothing has been generated from this bench. Your first run will appear here and in History the moment it is created — before any model is called.",
  },
} as const;

/** `/staff/image-lab/history` — every run, ever. */
export const IMAGE_LAB_HISTORY_COPY = {
  heading: "History",
  intro:
    "Every run this bench has made, newest first: prompt template, slot values, model, per-image outcome, verdict, and cost.",
  emptyRuns: {
    headline: "No runs to show.",
    body:
      "History is complete by design — nothing is ever pruned — so an empty list means no run has been created yet, not that older runs expired. Make a run on the Bench and it will appear here.",
  },
} as const;

/** `/staff/image-lab/kit` — the kept results, and the templates behind them. */
export const IMAGE_LAB_KIT_COPY = {
  heading: "Kit",
  intro:
    "Results you marked keep, with the {{slot}} template behind each one — the prompts the panel engine inherits.",
  emptyKept: {
    headline: "Nothing kept yet.",
    body:
      "The Kit collects results you mark keep in History. Judge a few runs first and the templates that earned their keep will collect here, ready to copy.",
  },
} as const;

// ── Generation state ─────────────────────────────────────────────────────────

export type ImageLabGenerationNotice = {
  /** `off` is not an error tone — an unset flag is the deliberate default. */
  readonly tone: "off" | "on";
  readonly headline: string;
  readonly body: string;
};

/**
 * What the bench says about generation.
 *
 * RETURNS A NOTICE IN BOTH STATES, never null. An indicator that appears only in
 * the off state cannot be told apart from an indicator that failed to render, and
 * it teaches nobody what "on" looks like — so a staff member about to spend
 * $0.8824 on a twelve-cell compare (the real ceiling: 4×$0.053 + 4×$0.134 +
 * 4×$0.0336, derived in `run-rules.test.ts` from `maxFanCostUsd` rather than
 * asserted here) has no confirmation that they are about to spend anything at
 * all. Both states are stated, and the tone carries the difference.
 *
 * Takes the resolved boolean rather than reading `process.env` itself: the flag
 * reader (`isImageLabLive`, in `./image-lab-rules`) is the ONE place that decides
 * what the env var means, and a second reader here would be a second answer to
 * "is the bench live".
 */
export function imageLabGenerationNotice(
  isLive: boolean
): ImageLabGenerationNotice {
  return isLive
    ? { tone: "on", ...IMAGE_LAB_BENCH_COPY.generationOn }
    : { tone: "off", ...IMAGE_LAB_BENCH_COPY.generationOff };
}

/**
 * The hub card's status line — the SAME fact, one surface earlier.
 *
 * Its whole job is that staff learn generation is off BEFORE they navigate in,
 * so it is derived from the same boolean the bench notice is. The `crmCardLine`
 * shape from `app/staff/lib/hub-rules.ts`: one pure function, one string, no
 * liveness claim the caller cannot back up.
 */
export function imageLabCardLine(isLive: boolean): string {
  return isLive
    ? IMAGE_LAB_HUB_COPY.generationOn
    : IMAGE_LAB_HUB_COPY.generationOff;
}
