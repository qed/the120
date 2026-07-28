/**
 * Templates and the quiz (funnel U9; R37, R38, R41) — the content package as
 * data, PURE. Template copy is §8.2's shipping copy, verbatim; the quiz is
 * §8.3's spec: four questions per group producing STRUCTURED fields (they
 * feed U10's compose schema: name, description, offerSketch,
 * firstCustomerHypothesis), each with band-variant phrasing for 3–5, 6–8,
 * 9–12.
 *
 * The two seeding rules that must not blur (plan U9):
 * - A chosen TEMPLATE pre-seeds draft ANSWER VALUES the child edits — that
 *   is the template's whole job (§8.3: "a chosen template pre-fills draft
 *   answers the kid edits").
 * - Per-question SUGGESTIONS are grey PLACEHOLDERS, never pre-typed values —
 *   a pre-typed suggestion is the child's answer as far as every downstream
 *   system is concerned.
 */

import type { GroupSlug } from "@/app/lib/site";
import { ANSWER_MAX_CHARS, capWellFormed } from "@/app/lib/funnel/moderation";

/* ─────────────────────────── quiz bands (§8.3) ─────────────────────────── */

/** Phrasing bands — finer than the two SKINS (3–5 Trail / 6–12 HQ): the quiz
 *  speaks three registers even though the chrome renders two. */
export const QUIZ_BANDS = ["b35", "b68", "b912"] as const;
export type QuizBand = (typeof QUIZ_BANDS)[number];

export function quizBandForGrade(grade: number): QuizBand {
  // Out-of-range grades render the HQ SKIN (skinForGrade's default), so the
  // quiz register must match it — b912, not the parent-assist Trail band.
  if (!Number.isInteger(grade) || grade < 3 || grade > 12) return "b912";
  if (grade <= 5) return "b35";
  if (grade <= 8) return "b68";
  return "b912";
}

/* ─────────────────────────── templates (§8.2, R37) ─────────────────────────── */

export type Template = {
  id: string;
  group: GroupSlug;
  title: string;
  /** §8.2's kid-facing pitch, verbatim. */
  pitch: string;
  /** §8.2's first-customers column, verbatim. */
  firstCustomers: string;
  /** The draft answers this template PRE-SEEDS (editable values). */
  seeds: Partial<Record<QuizFieldId, string>>;
};

export const TEMPLATES: readonly Template[] = [
  {
    id: "athletes-sponsorship",
    group: "athletes",
    title: "The Sponsorship Deal",
    pitch:
      "Get real businesses to sponsor your season. You pitch, they pay, you deliver: their logo on your gear, shout-outs, and a season report they'll be proud to show.",
    firstCustomers: "Businesses your family already buys from",
    seeds: {
      what: "Season sponsorships: my season, their logo and shout-outs",
      who: "Businesses my family already buys from",
      offer: "Logo on my gear, shout-outs, and a season report they can show",
    },
  },
  {
    id: "athletes-clinic",
    group: "athletes",
    title: "The Skills Clinic",
    pitch:
      "Run paid mini-clinics teaching younger kids your sport. You design the drills, book the space, coach the session, and get paid to be good at what you love.",
    firstCustomers: "Teammates' younger siblings",
    seeds: {
      what: "Paid mini-clinics teaching younger kids my sport",
      who: "My teammates' younger siblings",
      offer: "A one-hour session of drills I design and coach",
    },
  },
  {
    id: "founders-stand",
    group: "founders",
    title: "The Market Stand",
    pitch:
      "Make something people love — bracelets, baked goods, hot chocolate — and sell it at markets, games, and doorsteps for real money.",
    firstCustomers: "Your neighbours",
    seeds: {
      what: "Something I make that people love, sold at markets and doorsteps",
      who: "My neighbours",
      offer: "A thing they can hold, at a fair price, made by me",
    },
  },
  {
    id: "founders-service",
    group: "founders",
    title: "The Neighbourhood Service",
    pitch:
      "Dog walking, car washing, lawn and leaves, tech help for grandparents. Customers who come back every week — that's the secret.",
    firstCustomers: "Three houses on your street",
    seeds: {
      what: "A weekly neighbourhood service people actually need",
      who: "Three houses on my street",
      offer: "The same job done well, every week, without being asked",
    },
  },
  {
    id: "givers-cause",
    group: "givers",
    title: "The Cause Company",
    pitch:
      "Sell a real product where the profits fund a cause you choose — and every customer knows exactly what their money does.",
    firstCustomers: "People who care about your cause",
    seeds: {
      what: "A real product whose profits fund my cause",
      who: "People who care about my cause",
      offer: "A good product, plus knowing exactly what their money does",
    },
  },
  {
    id: "givers-event",
    group: "givers",
    title: "The Benefit Event",
    pitch:
      "Plan and run a ticketed event — a tournament, a concert, a bake-off — where the profits go to your cause and the whole neighbourhood shows up.",
    firstCustomers: "Local businesses as sponsors, families as ticket-buyers",
    seeds: {
      what: "A ticketed event where the profits go to my cause",
      who: "Local businesses as sponsors, families as ticket-buyers",
      offer: "A real event worth showing up for, for a reason worth funding",
    },
  },
  {
    id: "makers-commission",
    group: "makers",
    title: "The Commission Shop",
    pitch:
      "Take paid commissions for what you already make: portraits, custom builds, beats, edits. Real briefs, real deadlines, real money.",
    firstCustomers: "Friends of your parents",
    seeds: {
      what: "Paid commissions for what I already make",
      who: "Friends of my parents",
      offer: "Custom work to their brief, on a real deadline",
    },
  },
  {
    id: "makers-studio",
    group: "makers",
    title: "The Digital Studio",
    pitch:
      "Sell your creations at scale: sticker packs, prints, a zine, a beat tape. Make it once, sell it many times.",
    firstCustomers: "Your school and team community (parent-approved channels)",
    seeds: {
      what: "My creations sold at scale — make once, sell many times",
      who: "My school and team community, through parent-approved channels",
      offer: "Sticker packs, prints, a zine, a beat tape — mine",
    },
  },
  {
    id: "scholars-grant",
    group: "scholars",
    title: "The Research Grant",
    pitch:
      "Pick a real research question and raise the funding to run the study — micro-grants from local organizations, businesses, and family friends who back your proposal.",
    firstCustomers: "Local organizations and family friends who fund curious kids",
    seeds: {
      what: "A real research question, funded by micro-grants",
      who: "Local organizations and family friends who fund curious kids",
      offer: "A serious proposal, a run study, and the write-up they funded",
    },
  },
  {
    id: "scholars-fund",
    group: "scholars",
    title: "The Scholarship Fund",
    pitch:
      "Build a fund that awards a scholarship you created: raise the donations, set the criteria, and hand it to a winner in public.",
    firstCustomers: "Donors in your community who believe in students",
    seeds: {
      what: "A scholarship fund I created, awarded in public",
      who: "Donors in my community who believe in students",
      offer: "Their name on a scholarship a real student wins",
    },
  },
];

/** The third box behind every door (§8.2's "All" row). Feeds the SAME quiz —
 *  the own-idea path seeds nothing and skips nothing (non-goal §14). */
export const OWN_IDEA = {
  id: "own-idea",
  title: "I've got my own idea",
  pitch:
    "Got something else burning? Tell us in your own words — we'll help you shape it into a real project.",
} as const;

export function templatesForGroup(group: GroupSlug): Template[] {
  return TEMPLATES.filter((t) => t.group === group);
}

/* ─────────────────────────── the quiz (§8.3, R38) ─────────────────────────── */

export const QUIZ_FIELDS = ["what", "who", "offer", "spark"] as const;
export type QuizFieldId = (typeof QUIZ_FIELDS)[number];

export type QuizQuestion = {
  id: QuizFieldId;
  required: boolean;
  /** Band-variant phrasing (§8.3) — three registers, one question. */
  phrasing: Record<QuizBand, string>;
  /** The grey placeholder (NEVER a value). */
  suggestion: Record<QuizBand, string>;
};

/**
 * Four questions per group, produced from one structure with group-specific
 * nouns — the phrasings differ per band, the FIELDS never do, because the
 * fields are U10's compose schema.
 */
const GROUP_NOUNS: Record<GroupSlug, { thing: string; scene: string }> = {
  athletes: { thing: "your sport", scene: "your season" },
  founders: { thing: "your product or service", scene: "your neighbourhood" },
  givers: { thing: "your cause", scene: "your community" },
  makers: { thing: "what you make", scene: "your audience" },
  scholars: { thing: "your question", scene: "your community" },
};

export function quizForGroup(group: GroupSlug): QuizQuestion[] {
  const n = GROUP_NOUNS[group];
  return [
    {
      id: "what",
      required: true,
      phrasing: {
        b35: `What's your big idea with ${n.thing}? Say it like you'd tell a friend.`,
        b68: `What are you building around ${n.thing}? One or two sentences.`,
        b912: `Define the venture: what is it, built around ${n.thing}?`,
      },
      suggestion: {
        b35: "Like: I want to teach little kids to skate…",
        b68: "e.g. paid skating clinics for beginners on Saturdays",
        b912: "e.g. weekend skills clinics, $15 a session, my drills",
      },
    },
    {
      id: "who",
      required: true,
      phrasing: {
        b35: `Who would want it first? Think of real people in ${n.scene}.`,
        b68: `Who's your very first customer — a real person in ${n.scene}?`,
        b912: `First customer hypothesis: who in ${n.scene} pays first, and why them?`,
      },
      suggestion: {
        b35: "Like: the kids next door, my cousins…",
        b68: "e.g. my teammates' younger siblings",
        b912: "e.g. families at my rink who already ask for help",
      },
    },
    {
      id: "offer",
      required: true,
      phrasing: {
        b35: "What do they get from you? What's the deal?",
        b68: "What exactly do they get, and what does it cost?",
        b912: "Sketch the offer: what they get, for how much, and why it's fair.",
      },
      suggestion: {
        b35: "Like: one hour of skating fun for $10…",
        b68: "e.g. a one-hour session for $15, gear included",
        b912: "e.g. 60-minute session, $15, capped at 6 kids",
      },
    },
    {
      id: "spark",
      required: false,
      phrasing: {
        b35: "Why do YOU want to do this one?",
        b68: "Why this — what makes it yours?",
        b912: "What's the edge only you bring to this?",
      },
      suggestion: {
        b35: "Like: because I love it and I'm good at it…",
        b68: "e.g. I've done it for free for a year already",
        b912: "e.g. three years of race results nobody else at my rink has",
      },
    },
  ];
}

/**
 * Trail bands get the parent-assist flag, and it NAMES the group (the plan's
 * scenario). HQ bands do not — the device is the kid's by then.
 */
export function parentAssist(group: GroupSlug, band: QuizBand): string | null {
  if (band !== "b35") return null;
  return `Parents: read along and type if it helps — the ideas should be your ${group.slice(0, -1)}'s.`;
}

export type QuizAnswers = Partial<Record<QuizFieldId, string>>;

/**
 * Progression gate: every REQUIRED question answered. The copy avoids
 * "failed" — an unanswered question is an unanswered question.
 */
export function quizBlockers(answers: QuizAnswers, questions: QuizQuestion[]): QuizFieldId[] {
  return questions
    .filter((q) => q.required && (answers[q.id] ?? "").trim().length === 0)
    .map((q) => q.id);
}

export const QUIZ_BLOCKER_COPY = "A couple of answers are still empty — fill those in and keep going.";

/** A chosen template's seeds become editable DRAFT VALUES; own-idea seeds
 *  only the `what` field with the child's own text, capped to the ANSWER
 *  limit (the own-idea box allows more room than a quiz field holds — an
 *  uncapped seed would be `too_long` at compose without the child typing
 *  a character). A valid templateId wins over own-idea text. */
export function seedAnswers(
  templateId: string | null,
  ownIdeaText: string | null
): QuizAnswers {
  if (templateId) {
    const t = TEMPLATES.find((x) => x.id === templateId);
    if (t) return { ...t.seeds };
  }
  if (ownIdeaText && ownIdeaText.trim().length > 0) {
    return { what: capWellFormed(ownIdeaText.trim(), ANSWER_MAX_CHARS) };
  }
  return {};
}
