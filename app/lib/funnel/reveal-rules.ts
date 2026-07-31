/**
 * The Reveal, the first three tasks, and the share card — the pure decision
 * surface (funnel U11; R42–R45, R63). Everything the reveal screens render
 * comes from `revealModel()`'s return value, because `environment: "node"`
 * has no renderer: the tests assert on THIS module, and the components stay
 * layout-only.
 *
 * The register story (the plan's design note): the Reveal is the ONLY screen
 * that mixes both registers on one route — the child's skin for the body,
 * closing into the APPLICATION register strip. That is a NESTED subtree
 * swap: `APPLICATION_REGISTER_CLASSES` at the strip's root, complete
 * literals, inside the skin's subtree.
 */

import { pathSteps } from "@/app/2026-27/data";
import { DEPOSIT_REFUND_DEADLINE_LABEL, type GroupSlug } from "@/app/lib/site";
import type { Skin } from "@/app/lib/funnel/child-rules";
import type { QuizBand } from "@/app/lib/funnel/quiz-rules";
import type { ComposedProject } from "@/app/lib/funnel/compose-rules";
import { capWellFormed } from "@/app/lib/funnel/moderation";

/* ────────────────── the nested register swap (design note) ────────────────── */

/** The application-register strip INSIDE the skin subtree — the site's
 *  paper-and-ink voice. Complete literals (the Tailwind-scanner rule).
 *  `font-display` (Space Grotesk, the site body face) rides along since E2
 *  put `font-path-body` on the skin root — the strip must flip the type
 *  register back, not just the colours. */
export const APPLICATION_REGISTER_CLASSES = "bg-paper text-ink font-display";

/* ─────────────────── the five-phase climb (R43) ─────────────────── */

export type ClimbState = "complete" | "partial" | "projected";

export type ClimbPhase = {
  key: string;
  title: string;
  /** Bar height, 0–100. Partial is a visible half-height bar. */
  percent: number;
  state: ClimbState;
  /** R43: GROW and SCALE render dashed — projected, not achieved. */
  dashed: boolean;
};

/** R43 verbatim: SELL and BUILD complete, VALIDATE partial, GROW and SCALE
 *  dashed. Titles come from the published Path content — one source. The
 *  words are "complete", never "sealed" (R63). */
const CLIMB_STATES: Record<string, { state: ClimbState; percent: number }> = {
  SELL: { state: "complete", percent: 100 },
  BUILD: { state: "complete", percent: 100 },
  VALIDATE: { state: "partial", percent: 45 },
  GROW: { state: "projected", percent: 70 },
  SCALE: { state: "projected", percent: 100 },
};

export function revealClimb(): ClimbPhase[] {
  return pathSteps.map((step) => {
    const s = CLIMB_STATES[step.key] ?? { state: "projected" as const, percent: 50 };
    return {
      key: step.key,
      title: step.title,
      percent: s.percent,
      state: s.state,
      dashed: s.state === "projected",
    };
  });
}

/**
 * U10 fidelity (audit drift 11, E2): the climb's narrative bullets, verbatim
 * from the prototype — heading, then one bullet per phase reached, the
 * VALIDATE line looking forward. Structured (phase + before/after the bold
 * phase name) so the component renders the phase-coloured dot and the bold
 * name without string surgery.
 */
export const CLIMB_HEADING = "Four months from now...";

export type ClimbBullet = {
  /** The phase whose dot colours the bullet and whose name renders bold. */
  phase: "SELL" | "BUILD" | "VALIDATE";
  before: string;
  after: string;
};

export const CLIMB_BULLETS: readonly ClimbBullet[] = [
  { phase: "SELL", before: "In ", after: ", you learned to confidently sell anything." },
  {
    phase: "BUILD",
    before: "In ",
    after:
      ", you built a real product, put it in front of real people, and used feedback to make it better.",
  },
  {
    phase: "VALIDATE",
    before: "Next, in ",
    after:
      ", you'll learn how to prove what customers really want, a timeless, transferable lifelong skill.",
  },
];

/** U10 fidelity (audit drift 11): the mono unit-task caption under the
 *  chart, verbatim ("unit tasks complete" is the R63-mandated idiom). It
 *  sits inside the projection framing — the chart above it is labelled a
 *  projection in the same breath. */
export const CLIMB_CAPTION = "57 of 125 unit tasks complete, every one verified";

/** R43: labelled a projection EVERYWHERE, never presented as achieved. One
 *  string per band so the register fits, all saying the same true thing. */
export const PROJECTION_LABEL: Record<QuizBand, string> = {
  b35: "This is the year ahead, drawn out. You have not climbed it yet, and that is the point.",
  b68: "A projection of your year, not a report card. The climb starts at enrolment.",
  b912: "Projected trajectory. Nothing here is achieved yet; the program is where it becomes real.",
};

/* ─────────────────── the progress examples strip ─────────────────── */

export type RevealStat = {
  value: string;
  label: string;
};

/** The sub-headline over the strip (Peter, 2026-07-30) — a little smaller
 *  than the main headline. */
export const PROGRESS_HEADING = "Examples of progress so far";

/** The strip is ILLUSTRATIVE (Peter, 2026-07-30): examples of progress so
 *  far, replacing the earlier criterion-cited stats. */
export function statStrip(): RevealStat[] {
  return [
    { value: "65", label: "a 60 second pitch, perfected" },
    { value: "37", label: "outreach attempts to non-family" },
    { value: "23", label: "nos received, logged and learned from" },
  ];
}

/* ─────────────────── the first three tasks (R42) ─────────────────── */

export type TaskBubble = {
  /** Mono-rendered task id (R63). */
  id: string;
  title: string;
  /** The ONE project-customised sentence. */
  line: string;
};

/**
 * Three bubbles ONLY, mapped to SELL's first three pass criteria. Step 2 is
 * STRICTLY first product plus collecting payment from one person (R42) — not
 * revenue talk, not a target, one person paying once.
 */
export function firstTasks(project: ComposedProject): TaskBubble[] {
  // Trailing sentence punctuation on a legitimate name ("K.C. Dog Walking
  // Co.") would double up against the template's own full stop.
  const name = project.name.trim().replace(/[.!?]+$/, "") || "your project";
  return [
    {
      // U10 fidelity (audit drift 9): titles per the handoff CRIT list.
      id: "T1",
      title: "Pitch a product in 60 seconds",
      line: `Pitch ${name} to an adult who isn't family, without notes.`,
    },
    {
      id: "T2",
      title: "Make your first real sale",
      line: `The first version of ${name}, and one person paying real money for it.`,
    },
    {
      id: "T3",
      title: `Hear "no" three times`,
      line: `Three nos, written down, each one teaching you something about ${name}.`,
    },
  ];
}

/* ─────────────────── the close (R44) ─────────────────── */

export const REVEAL_CTA = "Continue Application →";

export type FaqRow = {
  q: string;
  a: string;
  /** R44: closed by default — all four of them. */
  defaultOpen: false;
};

/**
 * U10 fidelity, escalation E3 (Peter, 2026-07-29): the dollar figures come
 * back per the handoff: the cost row states $3,000 membership · $15,000
 * full core verbatim, and the "How long until $10K?" row is restored. The
 * first two rows are the shipped post-rebrand copy the E4 ruling keeps
 * (the spec's "What is The 120?" / task-gate rows describe the prototype's
 * gate mechanics, not the shipped admissions review). The deadline rides
 * `DEPOSIT_REFUND_DEADLINE_LABEL` so this file cannot disagree with
 * site.ts about the date (spec text: "September 30, 2026").
 */
export const REVEAL_FAQ: readonly FaqRow[] = [
  {
    q: "Is this project locked in?",
    a: "No. Every word stays editable, and projects can change direction inside the program. This is a starting line.",
    defaultOpen: false,
  },
  {
    q: "What happens after we apply?",
    a: "A real person reads the application and comes back to you. Seats are offered through the admissions review, not first-come-first-served.",
    defaultOpen: false,
  },
  // The bottom two rows are Peter's 2026-07-30 copy, verbatim (the deadline
  // still rides DEPOSIT_REFUND_DEADLINE_LABEL — one source for the date).
  {
    q: "How long until profits are earned?",
    a: "The goal is to learn how to run a business. Maybe in year 1 you do $2,000 in revenue and $10 in profit. Maybe in year 2 you do $4,000 in revenue and $1,000 in profit. Maybe you go a lot faster. The goal is to earn $10,000 in lifetime profits and to build muscle in the areas of financial literacy and entrepreneurship.",
    defaultOpen: false,
  },
  {
    q: "What does it cost?",
    a:
      "Membership is $3,000 for the year. " +
      `The seat deposit is $250 and fully refundable until ${DEPOSIT_REFUND_DEADLINE_LABEL}. ` +
      "This gives you access to all workshops and the software to help you reach sustainable ongoing profit.",
    defaultOpen: false,
  },
];

/** U16 ships the event pipe; this is the named seam it wires (R44: opening a
 *  row emits an event). */
export const FAQ_OPEN_EVENT = "reveal_faq_opened";

/* ─────────────────── the share card (R45, R40b) ─────────────────── */

export type ShareCrest = {
  /** The SELL criterion number the crest marks (1-based, as published). */
  numeral: string;
};

export type ShareCard = {
  /** R45: parent-only, consistent with nothing-is-public. */
  audience: "parent";
  /** Capped for the card's 600px canvas — SVG <text> does not wrap. */
  name: string;
  group: GroupSlug;
  stats: RevealStat[];
  /** R45's crests: the heraldic criterion badges for the cited criteria. */
  crests: ShareCrest[];
  excerpt: string;
};

/** Which SELL criterion (1-based) each strip stat cites, for its crest. */
const STAT_CRITERION_NUMBERS = ["1", "3", "5"];

export function shareCardModel(project: ComposedProject, group: GroupSlug): ShareCard {
  return {
    audience: "parent",
    name: capWellFormed(project.name, 36),
    group,
    stats: statStrip(),
    crests: STAT_CRITERION_NUMBERS.map((numeral) => ({ numeral })),
    excerpt: capWellFormed(project.description, 140),
  };
}

const escapeXml = (s: string) =>
  s
    // XML 1.0 forbids C0 controls (except tab/LF/CR) in ANY form — escaped
    // or raw. A BEL smuggled in via a crafted edit would make the whole
    // downloaded file unparseable, so strip them first.
    .replace(/[ --]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/** ~52 chars per line fits 520px at font-size 15 serif. */
function excerptLines(excerpt: string): string[] {
  const words = excerpt.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > 52) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = (line + " " + word).trim();
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

/** The heraldic crest as SVG markup — the same shield/chevron/numeral
 *  template as `app/fp/components/system/Crest.tsx`, monochrome red for the
 *  paper card. Pure string, no React. */
function crestSvg(numeral: string, x: number, y: number, size: number): string {
  const s = size / 100;
  return [
    `<g transform="translate(${x},${y}) scale(${s})">`,
    `<path d="M50 6 L86 18 V50 C86 74 68 88 50 95 C32 88 14 74 14 50 V18 Z" fill="#f7f6f3" stroke="#d92632" stroke-width="4" stroke-linejoin="round"/>`,
    `<path d="M22 44 L50 30 L78 44" fill="none" stroke="#d92632" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>`,
    `<text x="50" y="72" text-anchor="middle" font-family="Georgia, serif" font-size="30" font-weight="700" fill="#d92632">${escapeXml(numeral)}</text>`,
    `</g>`,
  ].join("");
}

/**
 * The downloadable card as an SVG string (the client wraps it in a blob URL).
 * Project fields are AI/family text: ESCAPED at this render surface (R40b —
 * this repo has shipped an HTML injection through unescaped child names
 * before). Pure and testable, which is the point of building it as a string.
 */
export function shareCardSvg(card: ShareCard): string {
  const excerpt = excerptLines(card.excerpt)
    .map(
      (line, i) =>
        `<text x="40" y="${168 + i * 22}" font-family="Georgia, serif" font-size="15" fill="#55585e">${escapeXml(line)}</text>`
    )
    .join("");
  const crests = card.crests
    .map((c, i) => crestSvg(c.numeral, 40 + i * 64, 250, 52))
    .join("");
  const stats = card.stats
    .map(
      (s, i) =>
        `<text x="40" y="${350 + i * 26}" font-family="monospace" font-size="13" fill="#131416">${escapeXml(`${s.value} ${s.label}`)}</text>`
    )
    .join("");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="440" viewBox="0 0 600 440">`,
    `<rect width="600" height="440" fill="#f7f6f3"/>`,
    `<rect x="0" y="0" width="600" height="8" fill="#d92632"/>`,
    `<text x="40" y="70" font-family="monospace" font-size="12" fill="#55585e">THE 120 · FIRST PROFIT · ${escapeXml(card.group.toUpperCase())}</text>`,
    `<text x="40" y="126" font-family="Georgia, serif" font-size="26" fill="#131416">${escapeXml(card.name)}</text>`,
    excerpt,
    `<text x="40" y="240" font-family="monospace" font-size="11" fill="#d92632">THE YEAR AHEAD, PROJECTED</text>`,
    crests,
    stats,
    `</svg>`,
  ].join("");
}

/* ─────────────────── the whole model ─────────────────── */

export type RevealModel =
  | {
      kind: "ok";
      climb: ClimbPhase[];
      projectionLabel: string;
      stats: RevealStat[];
      tasks: TaskBubble[];
      cta: string;
      faq: readonly FaqRow[];
      shareCard: ShareCard;
    }
  | { kind: "no_project" };

/**
 * The one entry point. Refuses a child with no composed project rather than
 * returning a partial model (the plan's error path) — the reveal has nothing
 * true to say before compose.
 */
export function revealModel(input: {
  project: ComposedProject | null;
  band: QuizBand;
  skin: Skin;
  group: GroupSlug;
}): RevealModel {
  if (!input.project) return { kind: "no_project" };
  return {
    kind: "ok",
    climb: revealClimb(),
    projectionLabel: PROJECTION_LABEL[input.band],
    stats: statStrip(),
    tasks: firstTasks(input.project),
    cta: REVEAL_CTA,
    faq: REVEAL_FAQ,
    shareCard: shareCardModel(input.project, input.group),
  };
}

/** The step chrome's copy lives HERE, not as JSX literals, so the R63 sweep
 *  covers what actually renders — JSX literals dodge `emittedCopy` by
 *  construction (both U11 reviewers caught an em dash doing exactly that). */
export const REVEAL_UI_COPY = {
  gateLine: "Your project page comes first. One tap and it's built.",
  gateButton: "← Make my page",
  /* U10 fidelity (audit drift 9): the tasks screen carries the compose
     header ("YOUR PROJECT" eyebrow + the project name), so the heading is
     the project's, not a fixed line. Intro, footer, and CTA are the
     handoff's, byte for byte ("4–6" is the spec's en dash, the same range
     idiom WHAT_IS_THE_120 shipped with; the rule bans the em dash only). */
  tasksEyebrow: "Your project",
  tasksIntro: "Every founder starts the same way: pitch it, sell it, learn from the no's.",
  tasksFooter: "In the app, each step is broken down into 4–6 unit tasks. First Profit helps you win.",
  tasksNext: "See where this leads →",
} as const;

/** Every user-facing string the model emits, flattened — the copy-rules test
 *  (R63) sweeps THIS, so new copy cannot dodge the sweep. */
export function emittedCopy(model: RevealModel): string[] {
  const chrome = [
    ...Object.values(REVEAL_UI_COPY),
    CLIMB_HEADING,
    CLIMB_CAPTION,
    PROGRESS_HEADING,
    ...CLIMB_BULLETS.map((b) => `${b.before}${b.phase}${b.after}`),
  ];
  if (model.kind !== "ok") return [...chrome];
  return [
    ...chrome,
    model.projectionLabel,
    model.cta,
    ...model.stats.map((s) => `${s.value} ${s.label}`),
    ...model.tasks.flatMap((t) => [t.id, t.title, t.line]),
    ...model.faq.flatMap((f) => [f.q, f.a]),
    ...model.climb.map((c) => c.title),
  ];
}
