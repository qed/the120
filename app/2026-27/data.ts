// The 2026-27 program page (/2026-27) — typed, plain content + two-voice COPY module.
//
// This is a PLAIN module (no "use server"): every export is a typed const that
// non-devs can edit without touching page markup. Transcribed from the design
// handoff prototype (artifacts/2026-27 Page Handoff/design_handoff_2026-27_program_page/):
//   - workshopDates / dateNotes / dateNotesKid / pathSteps / pathStepsKid / bookTracks
//     come from program-data.js
//   - COPY (parents + kids voices) comes from the .dc.html logic class's COPY dictionary
//   - groupLines (6 single-voice hero business lines) come from the GROUPS array
//   - SUBNAV (10 anchor sections) come from the NAV array
//
// CONTENT CORRECTIONS applied on transcription (deviations from the prototype):
//   - Ages read "8–17" (the prototype/README prose said 9–16, which is wrong; the
//     shipped site uses 8–17). No age range actually appears in the copy strings,
//     so no string needed changing — the invariant test guards against a regression.
//   - Honesty fix (R9): the workshop cadence lines say "two Saturdays most months"
//     instead of "the 1st and 3rd Saturday of every month" (January meets on the
//     9th/23rd, not the 1st/3rd; September has a single kickoff on the 19th).
//   - Per Peter's recorded decision (see the plan's Resolved section), the
//     "math gate" claims (business work pauses if math falls behind) and the
//     "each workshop runs twice, 9–12 and 12–3, same session" claims are removed;
//     the surrounding copy is otherwise verbatim.

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/** The five Path phases, in order. */
export type PathPhaseKey = "SELL" | "BUILD" | "VALIDATE" | "GROW" | "SCALE";

/** A single workshop-date pill in the schedule strip. */
export interface WorkshopDate {
  /** Short mono label, e.g. "SEP 19". */
  label: string;
  /** The kickoff Saturday (Sep 19) — rendered as a red/white pill with a KICKOFF tag. */
  kickoff?: boolean;
  /** Demo-Day marker glyph ("★"); presence means this is a Demo Day workshop. */
  mark?: string;
  /** The one to-be-scheduled "SPECIAL" session — rendered dashed/muted. */
  tbd?: boolean;
}

/** A book on one of the three reading tracks. */
export interface Book {
  title: string;
  author: string;
}

/** A Path-phase group of four books within a track. */
export interface BookGroup {
  step: PathPhaseKey;
  books: Book[];
}

/** One grade-level reading track (Grades 3–5 / 6–8 / 9–12). */
export interface BookTrack {
  id: string;
  label: string;
  groups: BookGroup[];
}

/** A Path phase (parents/original voice) with its five pass criteria. */
export interface PathStep {
  num: string;
  key: PathPhaseKey;
  title: string;
  subtitle: string;
  principle: string;
  criteria: string[];
  /** The "what parents see" one-liner. */
  parentsSee: string;
}

/**
 * The kid-voice variant of a Path phase. Only the voiced fields differ from
 * {@link PathStep}; num/key/title are shared (read from `pathSteps`).
 */
export interface PathStepKid {
  subtitle: string;
  principle: string;
  parentsSee: string;
  criteria: string[];
}

/** The six hero group selections (single-voice). */
export type GroupKey =
  | "the120"
  | "athletes"
  | "founders"
  | "givers"
  | "makers"
  | "scholars";

/** One entry in the sticky anchor sub-nav. */
export interface SubNavItem {
  /** The target section id (also the URL fragment, without "#"). */
  id: string;
  /** The mono label shown in the sub-nav. */
  label: string;
}

/**
 * Every readable string on the page that has a Kids variant. `COPY.parents` and
 * `COPY.kids` must satisfy this identical shape — the audience toggle relies on
 * both voices exposing exactly the same keys (guarded at runtime by the tests).
 */
export interface AudienceCopy {
  // CTA button labels (nav + red band)
  joinCta: string;
  callCta: string;

  // Hero
  heroKicker: string;
  heroHead: string;
  heroHeadAccent: string;
  heroSub: string;

  // 01 · The Year at a glance
  yearKicker: string;
  yearHeadLead: string;
  yearHeadAccent: string;
  y1label: string;
  y1desc: string;
  y2label: string;
  y2desc: string;
  y3label: string;
  y3desc: string;
  y4label: string;
  y4desc: string;
  y5label: string;
  y5desc: string;
  y6label: string;
  y6desc: string;
  yearNote: string;

  // 02 · Who they become
  becomeKicker: string;
  becomeHeadLead: string;
  becomeHeadAccent: string;
  becomeIntro: string;
  b1k: string;
  b1b: string;
  b2k: string;
  b2b: string;
  b3k: string;
  b3b: string;
  mathCalloutKicker: string;
  mathCalloutBody: string;

  // 03 · Coaching
  coachKicker: string;
  coachHeadLead: string;
  coachHeadAccent: string;
  coachIntro: string;
  cr1l: string;
  cr1b: string;
  cr2l: string;
  cr2b: string;
  cr3l: string;
  cr3b: string;
  cr4l: string;
  cr4b: string;

  // 04 · Read widely
  booksKicker: string;
  booksIntro: string;
  writingKicker: string;
  writingBody: string;

  // 05 · The Schedule
  schedKicker: string;
  yearBlockBody: string;
  monthHome1: string;
  monthHome2: string;
  monthHome3: string;
  weekCloseLead: string;
  weekCloseAccent: string;

  // 06 · The Core Loop
  loopKicker: string;
  loopHeadLead: string;
  loopHeadAccent: string;
  loopIntro: string;
  l1b: string;
  l2b: string;
  l3b: string;
  loopClose: string;

  // 07 · The Skill Track
  skillsKicker: string;
  skillsIntro: string;
  lvl1desc: string;
  lvl2desc: string;
  lvl3desc: string;
  lvl4desc: string;

  // 08 · The Path
  pathKicker: string;
  pathHeadLead: string;
  pathHeadAccent: string;
  pathIntro: string;
  pc1b: string;
  pc2b: string;
  pc3b: string;
  pathSeeLabel: string;

  // 09 · The Foundation / Math
  mathKicker: string;
  mathP1: string;
  mathP2: string;
  mathP3: string;
  mathCurDesc: string;
  mathSpeedDesc: string;

  // 10 · End of Year
  endKicker: string;
  endHeadLead: string;
  endHeadAccent: string;
  endIntro: string;
  e1: string;
  e2: string;
  e3: string;
  e4: string;
  e5: string;
  e6: string;
  endClose: string;

  // CTA band
  ctaSub1: string;
  ctaSub2: string;
}

/** The two-voice copy dictionary keyed by audience. */
export interface Copy {
  parents: AudienceCopy;
  kids: AudienceCopy;
}

/* -------------------------------------------------------------------------- */
/* Workshop dates (19 dated + 1 TBD)                                           */
/* -------------------------------------------------------------------------- */

export const workshopDates: WorkshopDate[] = [
  { label: "SEP 19", kickoff: true },
  { label: "OCT 3" },
  { label: "OCT 17" },
  { label: "NOV 7", mark: "★" },
  { label: "NOV 21" },
  { label: "DEC 5" },
  { label: "DEC 19" },
  { label: "JAN 9" },
  { label: "JAN 23" },
  { label: "FEB 6" },
  { label: "FEB 20" },
  { label: "MAR 6", mark: "★" },
  { label: "MAR 20" },
  { label: "APR 3" },
  { label: "APR 17" },
  { label: "MAY 1" },
  { label: "MAY 15" },
  { label: "JUN 5", mark: "★" },
  { label: "JUN 19", mark: "★" },
  { label: "SPECIAL", tbd: true },
];

export const dateNotes: string[] = [
  "★ Demo Day Workshops, where kids present their businesses on stage for the cohort and parents.",
  "The year kicks off Saturday, September 19, and pauses over the winter holidays, resuming January 9.",
  "Plus one special session to be added later as the year progresses.",
];

export const dateNotesKid: string[] = [
  "★ Demo Day Workshops — you present your business on stage for the cohort and parents.",
  "The year kicks off Saturday, September 19, takes a break for the winter holidays, and is back January 9.",
  "Plus one surprise session added later as the year goes on.",
];

/* -------------------------------------------------------------------------- */
/* The Path — five phases, five pass criteria each (parents/original voice)     */
/* -------------------------------------------------------------------------- */

export const pathSteps: PathStep[] = [
  {
    num: "01",
    key: "SELL",
    title: "Sell",
    subtitle: "Learn to confidently sell anything.",
    principle:
      "Entrepreneurship starts with a stranger saying yes. Before your child builds anything, they learn to sell something.",
    criteria: [
      "Pitch a product in 60 seconds to an adult who isn't family, without notes.",
      "Make a real sale: a real customer who isn't family, real money changing hands (could be a donation for a charity).",
      "Hear “no” at least three times and log what each no taught them.",
      "Explain cost, price, and profit for a product created by them, on one page.",
      "Complete 25 supervised outreach attempts: a booth, door to door, calls, or messages.",
    ],
    parentsSee:
      "Your child pitches you, then pitches strangers. The first sale usually happens faster than either of you expect.",
  },
  {
    num: "02",
    key: "BUILD",
    title: "Build",
    subtitle: "Make a real product with AI.",
    principle:
      "Your child stops being a user of technology and becomes a builder with it.",
    criteria: [
      "Ship a working product, site, or offer built with AI tools, with a live URL, pricing, and instructions on how to use the product.",
      "Explain in a 1-page brief how you connected your product to a gap you identified in an area you know something about (domain expertise).",
      "Contacted 40 potential customers. Launched one piece of marketing with metrics on how it worked.",
      "Ship a v2 that responds to feedback from at least three real users.",
      "Presented a 3-5 minute live demo, results from your build and what you learned about building a product.",
    ],
    parentsSee:
      "A link you can open. A thing that works. Built by your kid, with an AI co-founder, in days not months.",
  },
  {
    num: "03",
    key: "VALIDATE",
    title: "Validate",
    subtitle: "Test ideas like a scientist.",
    principle:
      "Most business ideas are wrong. The skill is finding out fast and cheap.",
    criteria: [
      "Ran at least 2 validation loops. Each one documents a hypothesis, runs a test and produces an outcome for each.",
      "Delivered a pricing experiment with documented price points, margin math and feedback from two groups of potential customers.",
      "Submitted an AI-tool audit showing selection, rationale, and outcome for at least 3 new tools adopted since Day 1 of The 120.",
      "Without any adult help, choose your own validation path. Present the reasoning and outcome on a Saturday.",
      "Publish two pieces of content (maybe through your parents' accounts) that attract external engagement: comments, shares, inbound, or citations and reposts.",
    ],
    parentsSee:
      "Your child stops defending ideas and starts testing them. This is the step where they learn to love being wrong quickly.",
  },
  {
    num: "04",
    key: "GROW",
    title: "Grow",
    subtitle: "Turn a validated idea into a running business.",
    principle: "One sale is a story. Repeat sales are a business.",
    criteria: [
      "10 sales or 3 repeat customers.",
      "Track a simple profit and loss statement for four consecutive weeks of active business activity.",
      "Create one daily or weekly repeating AI process, via Claude Cowork or an AI agent, that supports your business.",
      "Closed at least one real negotiation with documented terms.",
      "Present their financials to the cohort the way a founder presents to a board.",
    ],
    parentsSee:
      "A kid who can read their own P&L and tell you which week was best and why. Most adults can't.",
  },
  {
    num: "05",
    key: "SCALE",
    title: "Scale",
    subtitle: "Build systems so the business runs beyond them.",
    principle:
      "The final step is the founder's step: making the business bigger than one person's hours.",
    criteria: [
      "Automate one real part of the business with an AI agent or automation, and show it running.",
      "Delegate a task, to a friend, a sibling, or an AI agent, with written instructions that worked.",
      "Keep the business serving customers through a week they took off.",
      "Write the one-page playbook someone else could use to run it.",
      "Pitch what the business becomes next year, on stage, at an intensive.",
    ],
    parentsSee:
      "The end state of finishing The Path 1.0: a child who owns a small machine, not a chore. That's the founder's mindset, at whatever size.",
  },
];

/* -------------------------------------------------------------------------- */
/* The Path — kid-voice variants (used by the Kids "KID VOICE" sub-toggle)      */
/* -------------------------------------------------------------------------- */

export const pathStepsKid: PathStepKid[] = [
  {
    subtitle: "Learn to sell anything, to anyone.",
    principle:
      "It all starts with a stranger saying yes. Before you build anything, you learn to sell something.",
    parentsSee:
      "You'll pitch your parents, then pitch strangers. Your first real sale usually happens faster than you'd think.",
    criteria: [
      "Pitch a product in 60 seconds to an adult who isn't family, no notes.",
      "Make a real sale to a real customer who isn't family, for real money (a charity donation counts).",
      "Hear “no” at least three times and write down what each no taught you.",
      "Explain the cost, price, and profit of something you made, on one page.",
      "Do 25 supervised outreach tries: a booth, door to door, calls, or messages.",
    ],
  },
  {
    subtitle: "Build something real with AI.",
    principle: "You stop just using technology and start building with it.",
    parentsSee:
      "A link you can open. A thing that actually works. Built by you, with an AI co-founder, in days not months.",
    criteria: [
      "Ship a working product, site, or offer built with AI tools, with a live URL, pricing, and how-to-use instructions.",
      "In a 1-page brief, explain how your product fills a gap you spotted in something you actually know about.",
      "Contact 40 possible customers. Launch one piece of marketing and track how it did.",
      "Ship a v2 that responds to feedback from at least three real users.",
      "Give a 3-5 minute live demo: your results and what you learned about building.",
    ],
  },
  {
    subtitle: "Test your ideas like a scientist.",
    principle:
      "Most business ideas are wrong. The skill is finding out fast and cheap.",
    parentsSee:
      "You stop defending your ideas and start testing them. This is where you learn to love being wrong fast.",
    criteria: [
      "Run at least 2 validation loops. Each one has a guess, a test, and an outcome.",
      "Run a pricing experiment with real price points, the margin math, and feedback from two groups of customers.",
      "Turn in an AI-tool audit: which tools you picked, why, and how they worked, for at least 3 new tools since Day 1.",
      "With zero adult help, pick your own way to test an idea. Present your thinking and result on a Saturday.",
      "Publish two pieces of content (your parents' accounts are fine) that get real engagement: comments, shares, DMs, or reposts.",
    ],
  },
  {
    subtitle: "Turn a working idea into a real business.",
    principle: "One sale is a story. Repeat sales are a business.",
    parentsSee:
      "You'll read your own P&L and know which week was your best and why. Most adults can't do that.",
    criteria: [
      "Hit 10 sales or 3 repeat customers.",
      "Track a simple profit and loss sheet for four weeks straight of real business activity.",
      "Set up one daily or weekly repeating AI process (Claude Cowork or an AI agent) that helps your business.",
      "Close at least one real negotiation with the terms written down.",
      "Present your financials to the cohort the way a founder presents to a board.",
    ],
  },
  {
    subtitle: "Set it up so the business runs without you glued to it.",
    principle:
      "The last phase is the founder's move: making the business bigger than your own hours.",
    parentsSee:
      "The end state of finishing The Path 1.0: you own a small machine, not a chore. That's the founder's mindset, at any size.",
    criteria: [
      "Automate one real part of your business with an AI agent or automation, and show it running.",
      "Delegate a task, to a friend, a sibling, or an AI agent, with written instructions that actually worked.",
      "Keep the business serving customers through a week you took off.",
      "Write the one-page playbook someone else could use to run it.",
      "Pitch what your business becomes next year, on stage, at an intensive.",
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* Read Widely — three grade tracks × five phase-groups × four books           */
/* -------------------------------------------------------------------------- */

export const bookTracks: BookTrack[] = [
  {
    id: "3-5",
    label: "GRADES 3–5",
    groups: [
      {
        step: "SELL",
        books: [
          { title: "The Lemonade War", author: "Jacqueline Davies" },
          { title: "Lunch Money", author: "Andrew Clements" },
          { title: "Charlotte's Web", author: "E.B. White" },
          { title: "Swindle", author: "Gordon Korman" },
        ],
      },
      {
        step: "BUILD",
        books: [
          { title: "The Toothpaste Millionaire", author: "Jean Merrill" },
          {
            title: "The Boy Who Harnessed the Wind (Young Readers)",
            author: "William Kamkwamba",
          },
          { title: "Frindle", author: "Andrew Clements" },
          { title: "The Wild Robot", author: "Peter Brown" },
        ],
      },
      {
        step: "VALIDATE",
        books: [
          { title: "Mistakes That Worked", author: "Charlotte Foltz Jones" },
          { title: "What Do You Do with an Idea?", author: "Kobi Yamada" },
          { title: "The Westing Game", author: "Ellen Raskin" },
          { title: "Hatchet", author: "Gary Paulsen" },
        ],
      },
      {
        step: "GROW",
        books: [
          {
            title: "How to Turn $100 into $1,000,000",
            author: "McKenna, Glista, Fontaine",
          },
          { title: "Kid Start-Up", author: "Mark Cuban" },
          { title: "Matilda", author: "Roald Dahl" },
          { title: "Holes", author: "Louis Sachar" },
        ],
      },
      {
        step: "SCALE",
        books: [
          { title: "The Phantom Tollbooth", author: "Norton Juster" },
          { title: "Wonder", author: "R.J. Palacio" },
          { title: "Charlie and the Chocolate Factory", author: "Roald Dahl" },
          { title: "Danny the Champion of the World", author: "Roald Dahl" },
        ],
      },
    ],
  },
  {
    id: "6-8",
    label: "GRADES 6–8",
    groups: [
      {
        step: "SELL",
        books: [
          {
            title: "How to Win Friends and Influence People",
            author: "Dale Carnegie",
          },
          { title: "The Go-Giver", author: "Bob Burg & John David Mann" },
          { title: "Rich Dad Poor Dad for Teens", author: "Robert Kiyosaki" },
          {
            title: "Better Than a Lemonade Stand",
            author: "Daryl Bernstein",
          },
        ],
      },
      {
        step: "BUILD",
        books: [
          {
            title: "Steve Jobs: The Man Who Thought Different",
            author: "Karen Blumenthal",
          },
          {
            title: "The Boy Who Harnessed the Wind",
            author: "William Kamkwamba",
          },
          {
            title:
              "Elon Musk and the Quest for a Fantastic Future (Young Readers)",
            author: "Ashlee Vance",
          },
          { title: "A Wrinkle in Time", author: "Madeleine L'Engle" },
        ],
      },
      {
        step: "VALIDATE",
        books: [
          { title: "The Martian (Classroom Edition)", author: "Andy Weir" },
          { title: "Atomic Habits", author: "James Clear" },
          { title: "Who Moved My Cheese?", author: "Spencer Johnson" },
          {
            title: "Chew On This",
            author: "Eric Schlosser & Charles Wilson",
          },
        ],
      },
      {
        step: "GROW",
        books: [
          { title: "Lawn Boy", author: "Gary Paulsen" },
          { title: "Shoe Dog (Young Readers)", author: "Phil Knight" },
          { title: "Start Something That Matters", author: "Blake Mycoskie" },
          {
            title: "The 7 Habits of Highly Effective Teens",
            author: "Sean Covey",
          },
        ],
      },
      {
        step: "SCALE",
        books: [
          { title: "Ender's Game", author: "Orson Scott Card" },
          { title: "The Giver", author: "Lois Lowry" },
          { title: "Animal Farm", author: "George Orwell" },
          { title: "The Alchemist", author: "Paulo Coelho" },
        ],
      },
    ],
  },
  {
    id: "9-12",
    label: "GRADES 9–12",
    groups: [
      {
        step: "SELL",
        books: [
          { title: "Never Split the Difference", author: "Chris Voss" },
          { title: "Meditations", author: "Marcus Aurelius" },
          { title: "The War of Art", author: "Steven Pressfield" },
          {
            title: "Letters from a Self-Made Merchant to His Son",
            author: "George Horace Lorimer",
          },
        ],
      },
      {
        step: "BUILD",
        books: [
          { title: "Zero to One", author: "Peter Thiel" },
          { title: "Shoe Dog", author: "Phil Knight" },
          { title: "Steve Jobs", author: "Walter Isaacson" },
          { title: "Anything You Want", author: "Derek Sivers" },
        ],
      },
      {
        step: "VALIDATE",
        books: [
          { title: "The Lean Startup", author: "Eric Ries" },
          { title: "Thinking in Bets", author: "Annie Duke" },
          { title: "The Goal", author: "Eliyahu Goldratt" },
          { title: "The Richest Man in Babylon", author: "George S. Clason" },
        ],
      },
      {
        step: "GROW",
        books: [
          { title: "The Psychology of Money", author: "Morgan Housel" },
          {
            title: "Rework",
            author: "Jason Fried & David Heinemeier Hansson",
          },
          { title: "Man's Search for Meaning", author: "Viktor Frankl" },
          { title: "The E-Myth Revisited", author: "Michael E. Gerber" },
        ],
      },
      {
        step: "SCALE",
        books: [
          { title: "The Prince", author: "Niccolò Machiavelli" },
          {
            title: "The Autobiography of Benjamin Franklin",
            author: "Benjamin Franklin",
          },
          {
            title: "The Almanack of Naval Ravikant",
            author: "Eric Jorgenson",
          },
          { title: "Sapiens", author: "Yuval Noah Harari" },
        ],
      },
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* Hero group selector — six single-voice business lines                        */
/* (these do NOT change with the Parents/Kids toggle)                           */
/* -------------------------------------------------------------------------- */

export const groupLines: Record<GroupKey, string> = {
  the120:
    "Athletes, Founders, Givers, Makers and Scholars each build a business: NIL brands, startups, service ventures, shows, research. Same program, your business.",
  athletes:
    "Athletes build an NIL business: your name, image, and likeness turned into a personal brand and real sponsorships.",
  founders:
    "Founders build a real startup: a product built with AI, real paying customers, and real revenue that grows month over month.",
  givers:
    "Givers build a service venture: raising real money and real awareness for a cause in their community, and rallying people to turn up.",
  makers:
    "Makers build a showcase business: an art exhibition, a theatre production, or a concert that puts their work in front of an audience.",
  scholars:
    "Scholars build a research venture: finding funding for a science project and building a following for their scholarly work.",
};

/* -------------------------------------------------------------------------- */
/* Sticky anchor sub-nav — the 10 numbered sections                            */
/* -------------------------------------------------------------------------- */

export const SUBNAV: SubNavItem[] = [
  { id: "year", label: "THE YEAR" },
  { id: "become", label: "WHO THEY BECOME" },
  { id: "coaching", label: "COACHING" },
  { id: "books", label: "BOOKS" },
  { id: "schedule", label: "SCHEDULE" },
  { id: "loop", label: "THE LOOP" },
  { id: "skills", label: "SKILLS" },
  { id: "path", label: "THE PATH" },
  { id: "math", label: "MATH" },
  { id: "end", label: "END OF YEAR" },
];

/* -------------------------------------------------------------------------- */
/* COPY — the two-voice dictionary. parents/kids share an identical key set.     */
/* -------------------------------------------------------------------------- */

export const COPY: Copy = {
  parents: {
    joinCta: "Join the 120",
    callCta: "Book a call",

    heroKicker: "THE 2026-27 YEAR · FOUNDING COHORT · TORONTO",
    heroHead: "The foundation to become",
    heroHeadAccent: "an entrepreneur.",
    heroSub:
      "In one year your child takes real steps toward becoming an entrepreneur: one who reads widely, thinks deeply, builds with AI, and runs a real business. This is the start of the path to founding their own company one day.",

    yearKicker: "01 · THE YEAR AT A GLANCE",
    yearHeadLead: "One year.",
    yearHeadAccent: "At a glance.",
    y1label: "Weekend workshops",
    y1desc:
      "In-person workshops on two Saturdays most months, September 2026 to June 2027. The year starts Saturday, September 19.",
    y2label: "The Path",
    y2desc:
      "Sell, then Build, then Validate, then Grow, then Scale. Every child moves through the same five phases, at their own pace.",
    y3label: "Pass to move on",
    y3desc:
      "Each phase has five criteria a child must demonstrate before moving to the next. No seat time, no shortcuts. Proof or you stay.",
    y4label: "Three reading tracks",
    y4desc:
      "A curated year of reading at your child's level: one track for Grades 3–5, one for 6–8, one for 9–12.",
    y5label: "The writing habit",
    y5desc:
      "Optional but encouraged: one published paragraph a week on what they're reading and building. The start of a personal brand.",
    y6label: "Learn math to run the numbers",
    y6desc:
      "Knowing math means you know the health of your business. Catch up, reach ahead, or get solid through Math Academy and The Gauntlet.",
    yearNote:
      "20 Saturdays, 20 books, one real business. Book a call or join today.",

    becomeKicker: "02 · WHO THEY BECOME",
    becomeHeadLead: "Thoughtful,",
    becomeHeadAccent: "tech-native leaders.",
    becomeIntro:
      "The next generation of entrepreneurs will need to think deeply and be native with the latest tools. The 2026-27 year is designed to produce both, without letting either crowd out the other.",
    b1k: "01 · WELL-GROUNDED ENTREPRENEUR",
    b1b: "By June your child can sell. They can build with AI. They can read a profit and loss statement. They can run a loop to validate a business idea. And they have enough math and financial literacy under them to set the stage for everything that comes next.",
    b2k: "02 · DEEP THINKER",
    b2b: "They've read up to 20 books chosen to make them think about life, business, and entrepreneurship at their level. If they've taken on the writing habit, they've published a paragraph or more every week on what they've read and built. They can hold a real discussion, a real one, for their age, about ethics, technology, and the shape of the world.",
    b3k: "03 · AI EXPERT",
    b3b: "Outside their schoolwork, they treat AI as a co-founder. They've shipped products in days, deployed agents and automations, and used AI on every part of building a business: research, writing, selling, operating. They will never work the old way, because they never learned it.",
    mathCalloutKicker: "NO COMPROMISE ON MATH",
    mathCalloutBody:
      "You can't build a sustainable business without a core understanding of math. So the deal is simple: the same math they'd learn in school, at 2X, 3X, 4X the pace, running right alongside the business work all year.",

    coachKicker: "03 · COACHING",
    coachHeadLead: "An entrepreneur in their corner.",
    coachHeadAccent: "A room full of them.",
    coachIntro:
      "Every Saturday workshop is run by working entrepreneurs, not lecturers. Coaches are available to your child wherever they are on The Path: to listen to a pitch, to make plans to complete the next tasks, and to ask the questions a real investor would ask, gently, and then less gently as your child levels up.",
    cr1l: "YOUR CHILD'S COACH",
    cr1b: "A working operator who knows your child's business by name. Feedback is specific and tied to their progress down The Path, for example: 'What did you hear across your 8 sales that you think made them say yes?', never generic praise.",
    cr2l: "GUEST FOUNDERS",
    cr2b: "Throughout the year, founders and builders from the Toronto community and beyond join workshops to demo, tell the truth about their failures, and take questions. Kids get comfortable in rooms with real operators.",
    cr3l: "THE ADVISOR BENCH",
    cr3b: "Behind the coaches sits The 120's advisor network. When a child's progress down The Path needs something specific, we'll find someone who has done it before to help.",
    cr4l: "PARENTS IN THE LOOP",
    cr4b: "You're not guessing. You see The Path map, you know which criteria your child has passed, and twice a year you watch them present at an intensive.",

    booksKicker: "04 · READ WIDELY",
    booksIntro:
      "Reading is half of thinking deeply. Every child reads roughly a book every two weeks, drawn from a track matched to their reading level, not just their grade. Each track follows the path: four books per phase, mixing business, ingenuity, and the kind of stories that make a kid think about how the world works. Parents get the final list in September.",
    writingKicker: "40 WRITING EFFORTS · OPTIONAL",
    writingBody:
      "Write and publish one paragraph or more a week on what they're reading and building. Forty by June. It's optional, and it's the single best predictor of the kids who go furthest: the habit of thinking in public is the habit of building a brand. Coaches read everything and the best paragraphs get read aloud at workshops.",

    schedKicker: "05 · THE SCHEDULE",
    yearBlockBody:
      "The year kicks off Saturday, September 19. Nineteen in-person workshops run through to June 2027, on two Saturdays most months, plus one special session added later as the year progresses. Plus the Toronto intensives, where kids demo their businesses on stage.",
    monthHome1: "The business runs, day to day",
    monthHome2: "Parents are first customers, chauffeurs, and board",
    monthHome3: "Math keeps moving at 2X, 3X, 4X pace",
    weekCloseLead: "Be warned: it's so engaging that ",
    weekCloseAccent: "kids will stop calling it homework.",

    loopKicker: "06 · THE CORE LOOP · EXPERTISE → AUDIENCE → PRODUCT",
    loopHeadLead: "The loop that",
    loopHeadAccent: "compounds.",
    loopIntro:
      "Every lasting entrepreneur runs the same loop, whether they're 11 or 40. Get genuinely good at something. Share what you're learning until people pay attention. Build what those people ask for. Then go around again, one level up. Most adults never learn this loop. Your child will run it all year.",
    l1b: "The loop starts with knowing something worth knowing. Your child picks a domain they already care about, sneakers, baking, Minecraft servers, dog training, it truly doesn't matter, and goes deep: the reading track, the math, and the workshops all feed it. Kids don't need credentials to become experts. They need obsession plus structure, and they have more spare obsession than any adult you know.",
    l2b: "This is what the writing habit is really for. One published paragraph a week on what they're learning isn't a school assignment, it's how a young person earns trust: people believe the kid who teaches what they know. Their first audience is small and safe, the cohort, the neighbours, your own network. It grows from there, at your pace and with your supervision.",
    l3b: "Here's the secret most first-time founders miss: when you know a subject and people already listen to you about it, you don't have to guess what to build. The audience tells you. Products built this way sell easier, because the trust arrived before the pitch did. This is where The Path shines, teaching you the easier way to build.",
    loopClose:
      "Around the loop again, and again. Each pass makes the next one easier: deeper expertise, a warmer audience, a better product. This is why reading, writing, math and business aren't four separate subjects at The 120. They're one loop, and it's the same loop that will protect your child's career in the age of AI: knowledge that's theirs, people who trust them, and real things they've built to prove it.",

    skillsKicker: "07 · THE SKILL TRACK",
    skillsIntro:
      "Underneath The Path, software, parents and coaches track fifteen skills in three pillars. Every child, at every phase, is developing all fifteen; The Path just changes which ones are under the spotlight. Parents celebrate skill map progress on Demo Days.",
    lvl1desc: "Aware of the skill, first attempts.",
    lvl2desc: "Applying it with a coach's support.",
    lvl3desc: "Delivers consistently without help.",
    lvl4desc: "Coaches other kids. The bar.",

    pathKicker: "08 · THE PATH · SELL → BUILD → VALIDATE → GROW → SCALE",
    pathHeadLead: "Five Phases.",
    pathHeadAccent: "At your child's pace.",
    pathIntro:
      "Every member of The 120 grows through the same five phases, each with a clear focus and exit standard. Every member goes at their own pace. They advance by proving the work, not sitting through it. One kid masters Validate by winter, another hits Build by spring. Both are winning.",
    pc1b: "Each phase has five pass criteria. Your child demonstrates each one to their coach at a Saturday workshop. Five checks, and they step forward.",
    pc2b: "Some criteria take one Saturday. Some take five. Coaches work with whatever phase each child is on, every session. Nobody is left behind and nobody is held back.",
    pc3b: "A child who completes all five phases before June doesn't stop. They run their business at Scale, mentor kids earlier on The Path, and preview what next year holds.",
    pathSeeLabel: "WHAT PARENTS SEE",

    mathKicker: "09 · THE FOUNDATION",
    mathP1:
      "Your child may want to build their business, but academics are foundational and core to their future success. The 120 focuses on math because as your child builds their business, they need to know and run the numbers to make it healthy.",
    mathP2:
      "Math at The 120 is mastery-based so nothing is skipped and no holes exist. It's the math you learn in school, but our system allows you to make way faster progress than in school or after school.",
    mathP3:
      "Math and the business work move together all year. In practice, kids protect their math hours fiercely, because the workshops are what they refuse to miss.",
    mathCurDesc:
      "Adaptive, mastery-based math that moves exactly as fast as your child does. The engine behind the 2X to 4X pace.",
    mathSpeedDesc:
      "The 120's own fast-math game: Grade 3 to 12 fact fluency as boss battles and leaderboards. Where math facts get automatic, so the hard stuff gets easier.",

    endKicker: "10 · END OF YEAR",
    endHeadLead: "By June,",
    endHeadAccent: "they've actually done it.",
    endIntro:
      "Not “learned about.” Done. Wherever your child lands on The Path by June 2027, here is what's true of every single kid who does the year:",
    e1: "To a real customer, real money. Every child clears this in the Sell phase.",
    e2: "Built with AI, shipped, demoed live, improved from feedback.",
    e3: "Weeks of their own P&L data they can read and explain.",
    e4: "Read and discussed, at their level, chosen to make them think.",
    e5: "At least one intensive demo in front of the cohort and parents.",
    e6: "At least one idea they killed themselves, with evidence, and were proud of it.",
    endClose:
      "The Path doesn't reset in June. Wherever your child finishes, year two of The 120 picks up exactly there: a child mid-Validate resumes at Validate; a child who reached Scale starts the year running a real business and mentoring the next cohort. Progress is the only currency.",

    ctaSub1: "The founding cohort kicks off September 19, 2026.",
    ctaSub2: "Only 120 seats, and they're going.",
  },
  kids: {
    joinCta: "Get my seat",
    callCta: "Show my parents",

    heroKicker: "THE 2026-27 YEAR · FIRST-EVER COHORT · TORONTO",
    heroHead: "This is the year you become",
    heroHeadAccent: "a founder.",
    heroSub:
      "In one year you learn to sell, build real things with AI, run your own business, and read like a legend. This is where you stop doing worksheets and start building stuff that actually exists.",

    yearKicker: "01 · YOUR YEAR, QUICK VERSION",
    yearHeadLead: "One year.",
    yearHeadAccent: "Here's the deal.",
    y1label: "Saturday workshops",
    y1desc:
      "You show up on two Saturdays most months, September to June. In person, in Toronto. The year starts Saturday, September 19.",
    y2label: "The Path",
    y2desc:
      "Sell, Build, Validate, Grow, Scale. Five phases every founder runs. You go at your own speed.",
    y3label: "Prove it to level up",
    y3desc:
      "Every phase has five things you have to actually pull off before you level up. No sitting still, no shortcuts. Prove it or stay.",
    y4label: "Three reading tracks",
    y4desc:
      "20 books picked for your reading level, not just your grade. Three tracks to choose from.",
    y5label: "The writing habit",
    y5desc:
      "Optional: post one paragraph a week about what you're reading and building. This is how you start your name.",
    y6label: "Learn math to run the numbers",
    y6desc:
      "Knowing math means you know the health of your business. Catch up, reach ahead, or get solid through Math Academy and The Gauntlet.",
    yearNote: "20 Saturdays. 20 books. One real business that's yours. Ready?",

    becomeKicker: "02 · WHO YOU BECOME",
    becomeHeadLead: "A sharp,",
    becomeHeadAccent: "tech-native builder.",
    becomeIntro:
      "The best founders think deeply AND use the newest tools. This year builds both in you, without letting one crush the other.",
    b1k: "01 · A REAL FOUNDER",
    b1b: "By June you can sell. You can build with AI. You can read a profit and loss sheet. You can test a business idea like a scientist. And you've got the math to back it all up.",
    b2k: "02 · DEEP THINKER",
    b2b: "You've read up to 20 books that make you think about life, business, and how the world really works. If you took the writing habit, you've posted every week. You can hold a real conversation about the big stuff: ethics, tech, the future.",
    b3k: "03 · AI EXPERT",
    b3b: "You treat AI like a co-founder. You've shipped products in days, run agents and automations, and used AI for research, writing, selling, everything. You'll never build the slow way, because you never learned it.",
    mathCalloutKicker: "NO SKIPPING MATH",
    mathCalloutBody:
      "You can't run a real business without real math. So here's the deal: the same math as school, but at 2X, 3X, 4X speed, running right alongside the business work all year.",

    coachKicker: "03 · YOUR COACHES",
    coachHeadLead: "A founder in your corner.",
    coachHeadAccent: "A whole room of them.",
    coachIntro:
      "Every Saturday workshop is run by real entrepreneurs, not teachers reading slides. Coaches sit with you wherever you are on The Path: to hear your pitch, help you plan your next moves, and ask the questions a real investor would, nicely at first, then tougher as you level up.",
    cr1l: "YOUR COACH",
    cr1b: "A real operator who knows your business by name. Feedback is specific and tied to your progress on The Path, like 'what did you hear across your 8 sales that made them say yes?' Never fake praise.",
    cr2l: "GUEST FOUNDERS",
    cr2b: "All year, real founders and builders from Toronto and beyond drop into workshops to demo, tell the truth about their fails, and take your questions. You get comfortable in rooms with real operators.",
    cr3l: "THE ADVISOR BENCH",
    cr3b: "Behind your coaches is The 120's advisor network. When your progress on The Path needs something specific, we find someone who's done it before to help.",
    cr4l: "YOUR PARENTS, IN THE LOOP",
    cr4b: "Your parents aren't guessing. They see your Path map, they know which criteria you've passed, and twice a year they watch you present on stage.",

    booksKicker: "04 · READ WIDELY",
    booksIntro:
      "Reading is half of thinking sharp. You read about a book every two weeks, from a track matched to your reading level, not just your grade. Each track follows The Path: four books per phase, mixing business, wild ideas, and stories that make you think. You get the final list in September.",
    writingKicker: "40 WRITING EFFORTS · OPTIONAL",
    writingBody:
      "Write and post one paragraph or more a week about what you're reading and building. Forty by June. It's optional, and it's the best predictor of who goes furthest: thinking in public is how you build your name. Coaches read everything, and the best ones get read out loud at workshops.",

    schedKicker: "05 · THE SCHEDULE",
    yearBlockBody:
      "The year kicks off Saturday, September 19. Nineteen Saturday workshops run through June 2027, on two Saturdays most months, plus one surprise session added later. Plus the Toronto intensives, where you demo your business on stage.",
    monthHome1: "You run the business, day to day",
    monthHome2: "Your parents are your first customers, drivers, and board",
    monthHome3: "Math keeps moving at 2X, 3X, 4X speed",
    weekCloseLead: "Fair warning: it's so much fun that ",
    weekCloseAccent: "you'll stop calling it homework.",

    loopKicker: "06 · THE CORE LOOP · EXPERTISE → AUDIENCE → PRODUCT",
    loopHeadLead: "The loop that",
    loopHeadAccent: "stacks up.",
    loopIntro:
      "Every great founder runs the same loop, whether they're 11 or 40. Get really good at something. Share what you're learning until people pay attention. Build what those people ask for. Then go again, one level up. Most grown-ups never learn this. You'll run it all year.",
    l1b: "It starts with knowing something worth knowing. Pick something you already love, sneakers, baking, Minecraft servers, dog training, it really doesn't matter, and go deep. The reading, the math, and the workshops all feed it. You don't need a diploma to be an expert. You need obsession plus structure, and you've got way more spare obsession than any adult.",
    l2b: "This is what the writing habit is really for. One paragraph a week about what you're learning isn't homework, it's how you earn trust: people believe the kid who teaches what they know. Your first audience is small and safe, your cohort, your neighbours, your family. It grows from there, at your pace, with your parents' help.",
    l3b: "Here's the secret most first-time founders miss: when you know your subject and people already listen to you, you don't have to guess what to build. Your audience tells you. Stuff built this way sells easier, because the trust showed up before the pitch. This is where The Path shines, showing you the easier way to build.",
    loopClose:
      "Around the loop again, and again. Each lap makes the next one easier: deeper skills, a warmer audience, a better product. That's why reading, writing, math, and business aren't four separate subjects at The 120. They're one loop. And it's the same loop that will protect you in the age of AI: knowledge that's yours, people who trust you, and real things you've built to prove it.",

    skillsKicker: "07 · THE SKILL TRACK",
    skillsIntro:
      "Underneath The Path, software, your parents, and your coaches track fifteen skills in three areas. At every phase you're building all fifteen; The Path just changes which ones are in the spotlight. Your parents celebrate your skill map on Demo Days.",
    lvl1desc: "You know it exists, first tries.",
    lvl2desc: "You do it with a coach's help.",
    lvl3desc: "You deliver it on your own.",
    lvl4desc: "You can teach other kids. The bar.",

    pathKicker: "08 · THE PATH · SELL → BUILD → VALIDATE → GROW → SCALE",
    pathHeadLead: "Five Phases.",
    pathHeadAccent: "At your pace.",
    pathIntro:
      "Every member of The 120 grows through the same five phases, each with a clear focus and a bar you have to clear. Everyone goes at their own speed. You move up by proving the work, not by sitting through it. One kid nails Validate by winter, another hits Build by spring. Both are winning.",
    pc1b: "Each phase has five things to prove. You show each one to your coach at a Saturday workshop. Five checks, and you step forward.",
    pc2b: "Some things take one Saturday. Some take five. Coaches meet you at whatever phase you're on, every time. Nobody gets left behind, nobody gets held back.",
    pc3b: "Finish all five phases before June? You don't stop. You run your business at Scale, mentor kids earlier on The Path, and get a sneak peek at next year.",
    pathSeeLabel: "WHAT YOU'LL PULL OFF",

    mathKicker: "09 · THE FOUNDATION",
    mathP1:
      "You might be here to build a business, but school smarts are the foundation of everything next. The 120 zeroes in on math because to keep your business healthy, you have to know and run your numbers.",
    mathP2:
      "Math here is mastery-based, so nothing gets skipped and no gaps sneak in. It's the same math as school, but our system lets you move way faster than school or after-school ever could.",
    mathP3:
      "Math and the business work move together all year. Truth is, kids guard their math hours hard, because missing a workshop is the last thing they want.",
    mathCurDesc:
      "Adaptive, mastery-based math that moves exactly as fast as you do. The engine behind your 2X to 4X pace.",
    mathSpeedDesc:
      "The 120's own fast-math game: Grade 3 to 12 fact fluency as boss battles and leaderboards. Where your math facts get automatic, so the hard stuff feels easy.",

    endKicker: "10 · END OF YEAR",
    endHeadLead: "By June,",
    endHeadAccent: "you've actually done it.",
    endIntro:
      "Not “learned about.” Done. Wherever you land on The Path by June 2027, here's what's true of every single kid who does the year:",
    e1: "To a real customer, real money. You clear this in the Sell phase.",
    e2: "Built with AI, shipped, demoed live, improved from feedback.",
    e3: "Weeks of your own P&L data you can read and explain.",
    e4: "Read and discussed, at your level, chosen to make you think.",
    e5: "At least one demo on stage in front of the cohort and parents.",
    e6: "At least one idea you killed yourself, with proof, and were proud of it.",
    endClose:
      "The Path doesn't reset in June. Wherever you finish, year two of The 120 picks up right there: mid-Validate? You resume at Validate. Reached Scale? You start year two running a real business and mentoring the next cohort. Progress is the only currency.",

    ctaSub1: "The first cohort kicks off September 19, 2026.",
    ctaSub2: "There are only 120 seats, and they're going.",
  },
};
