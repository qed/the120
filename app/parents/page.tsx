import type { Metadata } from "next";
import Nav from "@/app/components/Nav";
import Footer from "@/app/components/Footer";
import CtaBand from "@/app/components/CtaBand";

export const metadata: Metadata = {
  title: "Toronto Parents — The 120",
  description:
    "Three Toronto families on the learning platform behind The 120's academics. In their own words.",
};

/**
 * /parents — deep Toronto parent stories (T9). Source: the original testimonials
 * archive in artifacts/. Publish permission for these edited versions confirmed
 * by Peter (Ian Logan, Gordon McKay) 2026-07-14.
 * Attribution honesty: these are experiences on the learning platform behind
 * The 120's academics — never claimed as The 120's own outcomes.
 */

type Story = {
  name: string;
  detail: string;
  paragraphs: (string | { list: string[] })[];
};

const stories: Story[] = [
  {
    name: "Ian Logan",
    detail: "Toronto parent · two boys, ages 7 and 9",
    paragraphs: [
      "My two boys, ages 7 and 9, spent a week learning on the platform behind The 120's academics. They worked on math and reading, and as a parent, I was able to see their progress live throughout the week. The software picked up on where they had gaps, where they were ahead, and then customized the lessons to each child's pace.",
      "The biggest surprise for me was that my boys actually wanted to do extra work. They stayed up late doing more lessons — definitely a first for us!",
      "We'll be using it for the rest of the summer, and the kids are genuinely excited to continue.",
    ],
  },
  {
    name: "Gordon McKay",
    detail: "Toronto parent · twin boys, age 7",
    paragraphs: [
      "Our 7-year-old twin boys tried the same platform, and I can confirm we had a similar experience to Ian's.",
      "We did find that earning XPs for an end reward was very motivating. We're unsure if that would persist over the long term, but were assured that as kids get older, the focus shifts to more sustainable intrinsic motivators (while maintaining the XPs).",
      "We look forward to setting up and testing it for the rest of the summer.",
    ],
  },
  {
    name: "Peter Kuperman",
    detail: "Toronto parent · three kids · founder of The 120",
    paragraphs: [
      "An update on my 3 kids — one who has been using the platform for about 5 weeks, and two others who have dabbled.",
      "In a little over 5 weeks, my middle child Cedric, who just finished Grade 4 and attends a French public school, went from:",
      {
        list: [
          "Grade 3 to Grade 5 in Math",
          "Grade 1 to Grade 5 in Fast Math — a big jump, as he was scared to answer any math questions fast",
          "Grade 4 to Middle School in Science",
          "Grade 2 to Grade 4 in English Language (Grammar)",
          "Grade 3 to Grade 8 in Vocabulary",
          "Grade 4 to Grade 5 in Reading",
          "Steady progress, for the first time in his life, in Cursive Writing",
        ],
      },
      "A bunch of this is catching up and getting used to the learning system, but the academic progression is fast. He can feel it. I can feel it. The progress is palpable.",
      "It was really interesting to see those Grade 1, 2 and 3 placements for my “end of Grade 4” child — and by interesting I mean it made me feel a bunch of strong emotions. But I see that the gaps are being filled, and the academic progression feels quick.",
      "My eldest, Caradoc — the bright, precocious one who just finished Grade 7 at an academically demanding middle school and learned nothing in math for a whole year — used the platform's placement tests to place into:",
      {
        list: [
          "Grade 10 Math",
          "Finished Fast Math (it only goes to Grade 5)",
          "Middle School Science",
          "Grade 10 Language · Grade 12 Vocabulary — one question away from finishing all of K–12 vocabulary",
          "Grade 4 Writing · Grade 5 Reading",
        ],
      },
      "He had to take every placement test from Grade 3 in every subject, so it took a while to get these placements. He asked for a full summer break before starting any actual learning, but is coming back with a clear goal: complete 36 courses in a year — a course being one subject at one grade level — including AP Calc BC and maybe AP Physics before he turns 13. He wants to blank out the platform in 12 months or less: to log in and see zero courses available.",
      "And Cormac, my 5-year-old: he started working 20 minutes a day, made some progress, got distracted, started reading Julia Donaldson books from the “Read With Oxford” series to upgrade his reading skills, and is going to enjoy his summer. He finished Grade 1 math.",
    ],
  },
];

export default function ParentsPage() {
  return (
    <>
      <Nav />
      <main className="flex-1">
        {/* Hero */}
        <div className="mx-auto flex w-full max-w-[860px] flex-col gap-6 px-6 pb-10 pt-[84px] sm:px-8">
          <span className="font-mono text-xs tracking-[0.1em] text-red">TORONTO PARENTS</span>
          <h1 className="display text-4xl sm:text-[56px] sm:leading-[1.06]">
            Real families. <span className="accent">Real progress.</span>
          </h1>
          <p className="max-w-[640px] text-lg leading-relaxed text-ink-soft">
            Three Toronto families on the learning platform behind The 120&rsquo;s academics —
            in their own words.
          </p>
        </div>

        {/* Stories */}
        <div className="mx-auto w-full max-w-[860px] px-6 pb-16 sm:px-8">
          <div className="flex flex-col gap-14">
            {stories.map((s) => (
              <article key={s.name} className="border-t-2 border-ink pt-8">
                <h2 className="font-display text-2xl font-bold tracking-tight text-ink">
                  {s.name}
                </h2>
                <p className="mt-1 font-mono text-[0.7rem] uppercase tracking-[0.1em] text-muted">
                  {s.detail}
                </p>
                <div className="mt-6 flex flex-col gap-4">
                  {s.paragraphs.map((p, i) =>
                    typeof p === "string" ? (
                      <p key={i} className="text-[15px] leading-[1.75] text-ink-soft">
                        {p}
                      </p>
                    ) : (
                      <ul key={i} className="flex flex-col gap-2 rounded-2xl border border-line bg-white p-6">
                        {p.list.map((item) => (
                          <li key={item} className="flex items-baseline gap-3 text-[15px] text-ink">
                            <span className="font-mono text-xs text-red">→</span>
                            {item}
                          </li>
                        ))}
                      </ul>
                    )
                  )}
                </div>
              </article>
            ))}
          </div>

          <p className="mt-12 font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted">
            Shared with permission · Lightly edited for length and clarity · Experiences on
            the learning platform behind The 120&rsquo;s academics
          </p>
        </div>

        <CtaBand
          headline="Your kid could be"
          accent="one of the 120."
          subline="Founding cohort · Fall 2026 · Ages 8–17 · Toronto"
        />
      </main>
      <Footer />
    </>
  );
}
