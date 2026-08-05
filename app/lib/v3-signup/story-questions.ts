/**
 * The six OPTIONAL story questions of the v3 onboarding flow's page 1, VERBATIM
 * from the design prototype (`artifacts/New Login Flow Aug 2026/src/data/
 * storyQuestions.ts`). Copy is the designer's; the ids are stable keys that the
 * draft row's `answers` jsonb is written under, so an editorial copy tweak must
 * KEEP the id and a meaning change must mint a new one.
 *
 * A plain data module with no imports so it is safely shared by the client step
 * component, the server core (which validates the keys it stores), and the
 * credential rules (which read `matters`/`intro` first when extracting the
 * password word).
 *
 * ── WHY IT LIVES IN app/lib AND NOT NEXT TO THE SCREEN (review FIX 9b) ──
 * It was authored in `app/start/v3/`, which made a `server-only` core in
 * `app/lib` import from a ROUTE folder — an inverted dependency the two
 * consumers then disagreed about (`v3-onboarding-core.ts` imported the ids while
 * `credentials-rules.ts` DUPLICATED them to avoid the coupling, so the two could
 * silently drift). One place, both importers, no route dependency: plan Unit 9's
 * `app/start/v3` → `app/start` move now touches nothing here.
 *
 * The prototype's `sample` text doubles as the textarea PLACEHOLDER. It is never
 * pre-typed into the field: a pre-filled answer is the child's answer to every
 * downstream system, which is the same rule the funnel's quiz already follows.
 */

export type StoryQuestion = {
  id: string;
  question: string;
  hint?: string;
  sample: string;
  rows: number;
};

export const STORY_QUESTIONS: readonly StoryQuestion[] = [
  {
    id: "intro",
    question: "Who are you and what are 3 things you like to do?",
    sample:
      "My name is Remi Newal, and I am nine years old. I like playing soccer, hanging out with my friends, going on vacations, and learning about stocks and businesses.",
    rows: 4,
  },
  {
    id: "why",
    question: "Why do you want to start a business?",
    hint: "Including any ideas you have or businesses you have previously worked on.",
    sample:
      "I want to start a business because I think making a business is fun. I like talking about stocks, companies, and how businesses work.\n\nI started a leaf-raking business in our neighbourhood and ran it for about a month. I made some money, but I also learned that starting a business is fun and rewarding. When you work hard, it can really pay off.",
    rows: 6,
  },
  {
    id: "start",
    question: "If you did start or have started a business, how did it start?",
    hint: "Give me the first few things you did.",
    sample:
      "We started on Silver Birch Avenue by knocking on a few doors and asking people if they needed their leaves raked. We got a few customers, and our very first customer paid us $14 for raking 12 bags of leaves.\n\nWe used some of the money we earned to buy more bags and supplies so we could keep raking and grow the business.",
    rows: 6,
  },
  {
    id: "inspires",
    question: "Who inspires you?",
    sample:
      "My dad inspires me because he started and runs a company. Watching him has helped me learn more about how businesses work and has made me want to create a company of my own one day.",
    rows: 4,
  },
  {
    id: "idea",
    question: "What kind of business would you like to start?",
    sample:
      "That is a hard question because I have a few ideas!\n\nOne idea would be selling things like ice cream or lemonade. Another idea would be starting a small service company and creating a website so people could find my services online.",
    rows: 5,
  },
  {
    id: "matters",
    question: "What matters most to you?",
    hint: "Sports, job when you grow up, activities, etc.",
    sample:
      "Soccer matters a lot to me, and one day I would love to become a soccer player.\n\nI would also love to have a secret undercover job as a geologist!",
    rows: 5,
  },
];

/** The stable answer keys, in render order. The core stores only these. */
export const STORY_QUESTION_IDS: readonly string[] = STORY_QUESTIONS.map((q) => q.id);

/** Per-answer character cap. Generous (these are whole paragraphs) but bounded,
 *  so a paste bomb cannot land in the draft's jsonb. */
export const STORY_ANSWER_MAX_CHARS = 2000;
