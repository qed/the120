/**
 * Dashboard + dossier data model (brief §13.3–13.5).
 * V1 is local (localStorage); this shape mirrors the future Supabase tables:
 *   parents → children → subject_picks / workshop_selections / project_pitch → dossier(status)
 */

export type SeatStatus =
  | "draft"
  | "submitted"
  | "in_review"
  | "invited"
  | "offered"
  | "member";

export const STATUS_FLOW: { id: SeatStatus; label: string; short: string }[] = [
  { id: "draft", label: "Draft", short: "Building the dossier" },
  { id: "submitted", label: "Submitted", short: "Sent for review" },
  { id: "in_review", label: "In review", short: "The 120 team is reviewing" },
  { id: "invited", label: "Invited to assessment", short: "Assessment + call scheduled" },
  { id: "offered", label: "Offered a seat", short: "A seat is offered" },
  { id: "member", label: "Member of the 120", short: "Welcome to the network" },
];

export const statusIndex = (s: SeatStatus) => STATUS_FLOW.findIndex((x) => x.id === s);
export const statusMeta = (s: SeatStatus) => STATUS_FLOW[statusIndex(s)];

export const GRADES = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

/**
 * Structured academics entry (replaces the legacy `subjects` list — R7–R9b).
 * `subject` is free text: the 7 standard subjects come from ACADEMIC_SUBJECTS
 * but an "Other" custom subject is allowed (R9b).
 */
export type Academic = {
  subject: string;
  plan: "catch-up" | "reach-ahead" | "get-solid" | "";
  goal: string;
};

export const ACADEMIC_SUBJECTS = [
  "Fast Math",
  "Math",
  "Science",
  "Reading",
  "Writing",
  "Language",
  "Vocabulary",
] as const;

export const ACADEMIC_PLANS: { id: Exclude<Academic["plan"], "">; label: string; blurb: string }[] = [
  { id: "catch-up", label: "Catch-Up", blurb: "Close the gaps and get back to grade level." },
  { id: "reach-ahead", label: "Reach Ahead", blurb: "Accelerate past grade level — mastery with no ceiling." },
  { id: "get-solid", label: "Get Solid", blurb: "Lock in the fundamentals until they're automatic." },
];

/** Display label for a plan id — "" for unknown/unset (shared by the parent
 *  preview and the CRM dossier pane so they can never drift). */
export function planLabel(plan: string): string {
  return ACADEMIC_PLANS.find((p) => p.id === plan)?.label ?? "";
}

/**
 * Tolerant per-element parse of the `academics` jsonb column: non-objects are
 * dropped, subject/goal coerce to strings, plan coerces to one of the three
 * plan ids or "". DB rows are never trusted to match `Academic[]`.
 */
export function parseAcademics(value: unknown): Academic[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((a): a is Record<string, unknown> => typeof a === "object" && a !== null)
    .map((a) => ({
      subject: typeof a.subject === "string" ? a.subject : "",
      plan: ACADEMIC_PLANS.some((p) => p.id === a.plan)
        ? (a.plan as Academic["plan"])
        : "",
      goal: typeof a.goal === "string" ? a.goal : "",
    }));
}

/** An academics entry counts toward completeness only when subject AND plan
 *  are set. Structurally typed so the CRM's tolerant-parsed entries (plan as
 *  plain string) can share the exact same predicate. */
export const academicComplete = (a: { subject: string; plan: string }) =>
  a.subject.trim() !== "" && a.plan !== "";

export type Workshop = {
  id: string;
  title: string;
  advisor: string;
  track: string;
  grades: string;
  length: string;
  description: string;
  /** Competition workshops require an audition (GT Fall 2026 roster). */
  audition?: boolean;
};

/** Real GT advisor roster (from the design handoff gt-workshops.json). */
export type Advisor = { id: string; name: string; bio: string };

export const ADVISORS: Advisor[] = [
  { id: "am", name: "Andreea Musat", bio: "A certified NLP coach and artist with 5 years running workshops and art classes for kids. She blends creative instinct with structured thinking, helping students find their footing, take creative risks, and discover they're capable of more than they imagined." },
  { id: "aj", name: "Anjelina Belakovskaia", bio: "A 3-Time U.S. Women’s Chess Champion, Woman Grandmaster, finance professor, and former derivatives trader. Trained at the Botvinnik-Kasparov Chess Academy, she helps students develop critical thinking, creativity, confidence, and resilience through chess." },
  { id: "cr", name: "Craig Lundberg", bio: "An educator, former principal, coach, and learning designer with 15+ years of experience helping students discover their potential. Craig believes the best learning happens when students are challenged to solve real problems, ask big questions, and work together. His GT Anywhere workshops combine hands-on experiences with meaningful challenges that inspire curiosity, confidence, and lifelong learning." },
  { id: "dz", name: "David Zook", bio: "Has coached robotics teams (winning multiple world championships), taught cars to drive themselves at Tesla, founded a high school, and raised two genuinely gifted kids who keep him appropriately humble. He's spent his career in rooms full of smart people trying to do hard things. When he's not at GT, he's probably on a plane, at a table with exceptional food, or recruiting another smart person into his orbit." },
  { id: "mm", name: "Melissa Muir", bio: "M.A.T. — a bilingual educator with 15+ years across public, private, online, and homeschool classrooms, raising four trilingual kids in Quito. She takes every opportunity to get kids reading and surprising themselves with what they can do." },
  { id: "nt", name: "Norberto Troncoso", bio: "A coach of hundreds of national and state champions, international keynote speaker, and creator of the P.O.W.E.R. Framework, Norberto teaches students that courage isn't the absence of fear, it's doing it scared. He helps kids build fearless communication, emotional intelligence, and leadership identity so they speak up, lead themselves, and rise to any room they walk into." },
  { id: "ru", name: "Ruchi Shukla", bio: "An educator for 15 years, working in school systems around the world. She builds workshops that help kids learn about important global issues through hands-on play and activities." },
  { id: "sl", name: "Sarah Langdon", bio: "An educator, advisor, and learning designer who believes students rise to the level of authentic challenge. She creates GT Anywhere workshops that blend academic rigor with real-world projects, helping kids discover they're capable of more than they imagined." },
  { id: "p1783114067812", name: "Yash Mehta", bio: "International Olympiad Medallist, with a decade of experience selecting, training, and mentoring national teams to top ranks at International Olympiads. He coaches with the philosophy that problem-solving is the most fundamental skill one must be equipped with." },
];

/** The 120's workshop roster — forked from GT's Fall 2026 offerings and
 *  curated for The 120 community (last diffed against the live
 *  community.gt.school/workshops 2026-07-14: +5 K–2 workshops, audition
 *  flags on Competition, Lawrence Bernstein leading recreational chess). */
export const WORKSHOPS: Workshop[] = [
  {
    id: "become-the-character",
    title: "Become the Character",
    advisor: "Norberto Troncoso",
    track: "Competition",
    grades: "6–8+",
    length: "Year-long",
    description: "Cut a published script to a solo 10-minute dramatic interpretation and perform live for theater pros (NSDA criteria).",
    audition: true,
  },
  {
    id: "botball-robotics",
    title: "Botball Robotics Team: Become a Founding Member",
    advisor: "David Zook",
    track: "Competition",
    grades: "5–8+",
    length: "Year-long",
    description: "Found GT's first competition robotics team — fully autonomous robots, building toward the Botball World Championship.",
    audition: true,
  },
  {
    id: "competitive-chess",
    title: "Competitive Chess",
    advisor: "Anjelina Belakovskaia",
    track: "Competition",
    grades: "K–8+",
    length: "Year-long",
    description: "USCF-rated competitive chess across five levels — Rookies, Intermediate, Advanced, National, Grandmaster — matched to each player’s rating.",
    audition: true,
  },
  {
    id: "history-on-trial",
    title: "History on Trial",
    advisor: "Craig Lundberg",
    track: "Competition",
    grades: "3–8+",
    length: "Year-long",
    description: "Research a historical topic you love using primary sources and present at the National History Day competition.",
    audition: true,
  },
  {
    id: "i-said-what-i-said",
    title: "I Said What I Said",
    advisor: "Norberto Troncoso",
    track: "Competition",
    grades: "4–5",
    length: "Year-long",
    description: "Pick a side, say it clearly with the Point-Reason frame, and hold your ground when a peer pushes back.",
    audition: true,
  },
  {
    id: "math-competitor-academy",
    title: "Math Competitor Academy",
    advisor: "Yash Mehta",
    track: "Competition",
    grades: "4–8+",
    length: "Year-long",
    description: "Students train like math athletes, mastering competition strategies, tackling challenging problems, and competing in AMC 8, MOEMS, Math Kangaroo, and MathCounts.",
    audition: true,
  },
  {
    id: "math-elite-academy",
    title: "Math Elite Academy",
    advisor: "Yash Mehta",
    track: "Competition",
    grades: "4–8+",
    length: "Year-long",
    description: "Students tackle advanced competition mathematics, train for AMC 8, MathCounts, AMC 10, and AIME pathways, and prove their skills in nationally recognized contests.",
    audition: true,
  },
  {
    id: "the-verdict",
    title: "The Verdict",
    advisor: "Norberto Troncoso",
    track: "Competition",
    grades: "6–8+",
    length: "Year-long",
    description: "Build a real case, cross-examine witnesses, and argue before outside judges who deliver a binding verdict.",
    audition: true,
  },
  {
    id: "change-makers",
    title: "Change Makers",
    advisor: "Sarah Langdon",
    track: "Humanities",
    grades: "6–8+",
    length: "60 min · 2×/week",
    description: "Write an evidence-based policy letter to your council member, then defend it in live testimony under expert Q&A.",
  },
  {
    id: "chess-foundations",
    title: "Chess Foundations",
    advisor: "Anjelina Belakovskaia",
    track: "Humanities",
    grades: "K–8+",
    length: "60 min · 2×/week",
    description: "Recreational chess for beginners: rules, piece movement, and core tactics in a fun, low-pressure setting. Led by Lawrence Bernstein.",
  },
  {
    id: "chess-mastery",
    title: "Chess Mastery",
    advisor: "Anjelina Belakovskaia",
    track: "Humanities",
    grades: "K–8+",
    length: "60 min · 2×/week",
    description: "Advanced recreational players deepen positional understanding and competitive skill. Led by Lawrence Bernstein.",
  },
  {
    id: "codebreakers",
    title: "Codebreakers",
    advisor: "Melissa Muir",
    track: "Humanities",
    grades: "2–5",
    length: "60 min · 2×/week",
    description: "Crack secret codes that get harder every week — including a final one no one has ever solved.",
  },
  {
    id: "glitch-and-grow",
    title: "Glitch and Grow",
    advisor: "Craig Lundberg",
    track: "Humanities",
    grades: "3–5",
    length: "60 min · 2×/week",
    description: "Choose a difficult skill, document every failure, and prove measurable improvement through deliberate practice.",
  },
  {
    id: "global-host-challenge",
    title: "Global Host Challenge",
    advisor: "Ruchi Shukla",
    track: "Humanities",
    grades: "5–8+",
    length: "60 min · 2×/week",
    description: "Investigate cultural norms, interview people from other backgrounds, and design a cultural experience.",
  },
  {
    id: "going-viral",
    title: "Going Viral",
    advisor: "Craig Lundberg",
    track: "Humanities",
    grades: "3–5",
    length: "60 min · 2×/week",
    description: "Create original content, use AI feedback to improve it, and learn how creators capture attention.",
  },
  {
    id: "the-peace-table",
    title: "The Peace Table",
    advisor: "Andreea Musat",
    track: "Humanities",
    grades: "K–2",
    length: "45 min · 2×/week",
    description: "Learn to work together and resolve conflicts — listen, understand both sides, and earn a Peace-Maker badge.",
  },
  {
    id: "hidden-stories",
    title: "Hidden Stories",
    advisor: "Andreea Musat",
    track: "Humanities",
    grades: "3–5",
    length: "60 min · 2×/week",
    description: "Become a documentary filmmaker: find a story, shoot and edit it, and premiere it at a real film festival.",
  },
  {
    id: "japanese-black-belt",
    title: "Japanese Black Belt: Reverse-Engineering a Language",
    advisor: "David Zook",
    track: "Humanities",
    grades: "5–8+",
    length: "60 min · 2×/week",
    description: "Reverse-engineer how Japanese verbs work so you can predict words you've never seen — drills, partner talk, rapid-fire.",
  },
  {
    id: "literary-league",
    title: "Literary League",
    advisor: "Melissa Muir",
    track: "Humanities",
    grades: "6–8+",
    length: "60 min · 2×/week",
    description: "Divisions, standings, and real bragging rights for reading bravely and hitting your number.",
  },
  {
    id: "on-the-record",
    title: "On the Record",
    advisor: "Sarah Langdon",
    track: "Humanities",
    grades: "6–8+",
    length: "60 min · 2×/week",
    description: "Report, interview, and produce a real podcast episode, then publish it to a live audience.",
  },
  {
    id: "one-idea",
    title: "One Idea",
    advisor: "Norberto Troncoso",
    track: "Humanities",
    grades: "6–8+",
    length: "45 min · 2×/week",
    description: "Find one original idea you believe in, build a TEDx-style talk around it, and deliver it live.",
  },
  {
    id: "page-turners",
    title: "Page Turners",
    advisor: "Melissa Muir",
    track: "Humanities",
    grades: "2–5",
    length: "45 min · 2×/week",
    description: "Read what you love, score points for going bold into new genres, and climb the leaderboard.",
  },
  {
    id: "rewrite-history",
    title: "Rewrite History",
    advisor: "Sarah Langdon",
    track: "Humanities",
    grades: "6–8+",
    length: "60 min · 2×/week",
    description: "Become a real historical figure and fight to change how history ends — winning the room with primary-source arguments.",
  },
  {
    id: "say-that-again",
    title: "Say That Again",
    advisor: "Norberto Troncoso",
    track: "Humanities",
    grades: "6–8+",
    length: "45 min · 2×/week",
    description: "Draw a random topic cold, take a clear position, and defend it under live challenge. No notes. No prep.",
  },
  {
    id: "sky-tower-challenge",
    title: "Sky Tower Challenge",
    advisor: "Ruchi Shukla",
    track: "Humanities",
    grades: "5–8+",
    length: "60 min · 2×/week",
    description: "Design, test, and rebuild towers — balancing height, strength, and stability like a real engineer.",
  },
  {
    id: "sold",
    title: "Sold!",
    advisor: "Andreea Musat",
    track: "Humanities",
    grades: "2–5",
    length: "60 min · 2×/week",
    description: "Write, shoot, and edit a real commercial, then screen it to a live audience who decide: would we buy it?",
  },
  {
    id: "soy-un-experto",
    title: "Soy un Experto",
    advisor: "Melissa Muir",
    track: "Humanities",
    grades: "3–8+",
    length: "60 min · 2×/week",
    description: "Become the expert on Ecuadorian food and give a live tour — all in Spanish. The best guides earn a trip to Quito.",
  },
  {
    id: "strategic-chess",
    title: "Strategic Chess",
    advisor: "Anjelina Belakovskaia",
    track: "Humanities",
    grades: "K–8+",
    length: "60 min · 2×/week",
    description: "Developing players sharpen strategy, tactics, and game planning. Led by Lawrence Bernstein.",
  },
  {
    id: "the-deal",
    title: "The Deal",
    advisor: "Norberto Troncoso",
    track: "Humanities",
    grades: "6–8+",
    length: "45 min · 2×/week",
    description: "Master the Ackerman negotiation model used by FBI negotiators and close a real deal at a local business.",
  },
  {
    id: "the-greenlight",
    title: "The Greenlight",
    advisor: "Craig Lundberg",
    track: "Humanities",
    grades: "3–5",
    length: "60 min · 2×/week",
    description: "Write a professional script, create an AI-animated short film, and pitch it to a real film-industry pro.",
  },
  {
    id: "venture-lab",
    title: "Venture Lab",
    advisor: "Craig Lundberg",
    track: "Humanities",
    grades: "3–5",
    length: "60 min · 2×/week",
    description: "Launch a real digital business, earn revenue, and pitch your venture to adult judges.",
  },
  {
    id: "young-inventors-challenge",
    title: "Young Inventors Challenge",
    advisor: "Ruchi Shukla",
    track: "Humanities",
    grades: "5–8+",
    length: "60 min · 2×/week",
    description: "Invent, prototype, test, and pitch creative solutions using recycled materials — real design thinking.",
  },
  {
    id: "ai-robot-coach-academy",
    title: "AI Robot Coach Academy",
    advisor: "David Zook",
    track: "Sciences",
    grades: "3–8+",
    length: "60 min · 2×/week",
    description: "Coach robots through complex VEX VR challenges using Claude and ChatGPT, documented in an Engineering Notebook.",
  },
  {
    id: "attractions-in-action",
    title: "Attractions in Action",
    advisor: "Sarah Langdon",
    track: "Sciences",
    grades: "6–8+",
    length: "60 min · 2×/week",
    description: "Design an original attraction, prove the guest-flow and budget math, and field-test it on an earned Disney trip.",
  },
  {
    id: "board-game-masters",
    title: "Board Game Masters",
    advisor: "Ruchi Shukla",
    track: "Sciences",
    grades: "K–2",
    length: "45 min · 2×/week",
    description: "Build strategic thinking and confidence through learning, practicing, and improving at board games.",
  },
  {
    id: "food-lab-challenge",
    title: "Food Lab Challenge",
    advisor: "Ruchi Shukla",
    track: "Humanities",
    grades: "K–2",
    length: "45 min · 2×/week",
    description: "Become a food scientist and recipe creator — explore flavor, nutrition, kitchen skills, and food science.",
  },
  {
    id: "passport-mission",
    title: "Passport Mission",
    advisor: "Ruchi Shukla",
    track: "Humanities",
    grades: "K–2",
    length: "45 min · 2×/week",
    description: "Explore countries through hands-on cultural experiences, building global awareness and curiosity.",
  },
  {
    id: "toy-inventors",
    title: "Toy Inventors",
    advisor: "Ruchi Shukla",
    track: "Humanities",
    grades: "K–2",
    length: "45 min · 2×/week",
    description: "Turn recycled materials into playable toys while learning to invent, test, and improve ideas.",
  },
  {
    id: "board-game-designer",
    title: "Board Game Designer",
    advisor: "Ruchi Shukla",
    track: "Sciences",
    grades: "3–8+",
    length: "45 min · 2×/week",
    description: "Design, playtest, refine, and pitch an original board game while learning strategy and game-design thinking.",
  },
  {
    id: "deep-time",
    title: "Deep Time",
    advisor: "Sarah Langdon",
    track: "Sciences",
    grades: "6–8+",
    length: "60 min · 2×/week",
    description: "Learn to read a mountain like a book, then read a never-before-seen rock face aloud to a working geologist.",
  },
  {
    id: "future-champion-lab",
    title: "Future Champion Lab",
    advisor: "David Zook",
    track: "Sciences",
    grades: "5–8+",
    length: "60 min · 2×/week",
    description: "Become a competitive analyst — study how champion teams win, and identify the patterns that produce winners.",
  },
  {
    id: "mind-lab",
    title: "Mind Lab",
    advisor: "Sarah Langdon",
    track: "Sciences",
    grades: "6–8+",
    length: "60 min · 2×/week",
    description: "Design and run an original behavioral-science experiment on real people, then defend it to a working psychologist.",
  },
  {
    id: "sound-the-alarm",
    title: "Sound the Alarm",
    advisor: "Andreea Musat",
    track: "Sciences",
    grades: "3–5",
    length: "60 min · 2×/week",
    description: "Build a real AI agent that listens, recognizes a signal, and sends alerts.",
  },
  {
    id: "the-caldera",
    title: "The Caldera",
    advisor: "Craig Lundberg",
    track: "Sciences",
    grades: "3–5",
    length: "60 min · 2×/week",
    description: "Become a Yellowstone field scientist and investigate real wildlife, geothermal, or volcanic data.",
  },
  {
    id: "unbuyable-product-lab",
    title: "The Unbuyable Product Lab",
    advisor: "Melissa Muir",
    track: "Sciences",
    grades: "3–8+",
    length: "60 min · 2×/week",
    description: "Invent a product that doesn't exist, 3D-print it, and pitch it to builders from Apple, Google, and SayMake.",
  },
  {
    id: "think-like-a-scientist",
    title: "Think like a Scientist",
    advisor: "Andreea Musat",
    track: "Sciences",
    grades: "K–4",
    length: "45 min · 2×/week",
    description: "Run real chemistry experiments at home until results are clean and repeatable — then prove it to a real scientist live.",
  },
  {
    id: "vex-all-stars",
    title: "VEX All-Stars: Rebuild the Legends",
    advisor: "David Zook",
    track: "Sciences",
    grades: "5–8+",
    length: "60 min · 2×/week",
    description: "A virtual robotics challenge: compete on legendary VEX fields with Claude as your AI engineering partner.",
  },
];

export const workshopById = (id: string) => WORKSHOPS.find((w) => w.id === id);

/**
 * Parse a catalog `grades` display string ("K–2", "3–5", "K–8+") into a
 * numeric range for the wizard's grade filter. K = 0; a trailing "+" means
 * "and up" (max 12). Derived from the display string at module load rather
 * than hand-annotated per entry, so the two can never drift. The catalog
 * uses an en-dash (–); a plain hyphen is tolerated too.
 */
export function parseGradeRange(grades: string): { gradeMin: number; gradeMax: number } {
  const parts = grades.split(/[–-]/);
  const num = (s: string) => (s.trim().toUpperCase().startsWith("K") ? 0 : parseInt(s, 10));
  const last = parts[parts.length - 1].trim();
  return {
    gradeMin: num(parts[0]),
    gradeMax: last.endsWith("+") ? 12 : num(last),
  };
}

/** Precomputed once at module load — one parse per catalog entry. */
const GRADE_RANGES = new Map(WORKSHOPS.map((w) => [w.id, parseGradeRange(w.grades)]));

export const workshopGradeRange = (w: Workshop) =>
  GRADE_RANGES.get(w.id) ?? parseGradeRange(w.grades);

export type Child = {
  id: string;
  // Basics
  firstName: string;
  lastName: string;
  grade: number | "";
  birthYear: string;
  currentSchool: string;
  photo?: string; // data URL (V1); real uploads → Supabase storage (V2)
  // Group pick ("" until chosen; athletes/founders/makers/scholars/givers)
  groupSlug: string;
  // Structured academics (max 2 entries); replaces `subjects`
  academics: Academic[];
  // Legacy subject picks — read-only fallback, no longer written (cutover)
  subjects: string[];
  testScores: string;
  // Workshop selections
  workshopIds: string[];
  // Project pitch & interests
  interests: string;
  projectPitch: string;
  portfolioLinks: string;
  // Dossier status
  status: SeatStatus;
  submittedAt?: string;
};

export type Parent = {
  firstName: string;
  lastName: string;
  email: string;
};

export type DashboardState = {
  parent: Parent | null;
  children: Child[];
};

export function emptyChild(id: string): Child {
  return {
    id,
    firstName: "",
    lastName: "",
    grade: "",
    birthYear: "",
    currentSchool: "",
    groupSlug: "",
    academics: [],
    subjects: [],
    testScores: "",
    workshopIds: [],
    interests: "",
    projectPitch: "",
    portfolioLinks: "",
    status: "draft",
  };
}

/**
 * Dossier checklist drives the per-child completeness meter (§13.3.2).
 * Group-aware (R14): 8 items for everyone, plus a Scholars-only workshops
 * item (9 total). The academics item keeps a legacy fallback on `subjects`
 * so pre-cutover drafts don't lose credit.
 *
 * LOCKSTEP MIRRORS (R14): this definition is duplicated in
 * `app/lib/nurture/rules.ts` (dossierCompleteness — stall nudge) and
 * `app/crm/lib/reviews-rules.ts` (dossierChecklist — CRM queue). Change
 * all three together or the parent meter, nudge, and queue % disagree.
 */
export function checklist(c: Child): { label: string; done: boolean }[] {
  const items = [
    { label: "Name", done: !!c.firstName.trim() && !!c.lastName.trim() },
    { label: "Grade", done: c.grade !== "" },
    { label: "Birth year", done: /^\d{4}$/.test(c.birthYear.trim()) },
    { label: "Current school", done: !!c.currentSchool.trim() },
    { label: "A group", done: c.groupSlug !== "" },
    {
      label: "Academics (a subject + plan)",
      done: c.academics.some(academicComplete) || c.subjects.length >= 1,
    },
  ];
  if (c.groupSlug === "scholars") {
    items.push({ label: "A workshop of interest", done: c.workshopIds.length >= 1 });
  }
  items.push(
    { label: "The kid's interests", done: c.interests.trim().length >= 3 },
    { label: "A project pitch", done: c.projectPitch.trim().length >= 10 }
  );
  return items;
}

export function completeness(c: Child): number {
  const items = checklist(c);
  return Math.round((items.filter((i) => i.done).length / items.length) * 100);
}

export function childName(c: Child): string {
  const n = `${c.firstName} ${c.lastName}`.trim();
  return n || "New child";
}
