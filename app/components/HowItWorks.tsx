/**
 * The three steps, restated for the funnel (R18, and the U1 applicant ladder:
 * added → project_created → submitted → in_review → offered → deposited).
 *
 * The old step 02 was "Book a call", which R18 removes from the logged-out
 * site — and which described a process that no longer runs: a family now
 * starts by building, and admissions review happens on the dossier the
 * building produced. Copy is Peter's call; this keeps it truthful in the
 * meantime rather than advertising a step that is gone.
 */
const steps = [
  {
    n: "STEP 01",
    strong: "Your child builds something real.",
    rest: "Ten minutes: they pick a direction, design a business around it, and end up with a project that's theirs.",
  },
  {
    n: "STEP 02",
    strong: "Finish the dossier together.",
    rest: "Their group, their interests, and the project they just built — in their own words. Then admissions reviews it.",
  },
  {
    n: "STEP 03",
    strong: "Join the group.",
    rest: "A seat, a Tin Can with the Address Book inside, a mentor, and a year-long project that ships.",
  },
];

/** Handoff: white band, two columns — heading left, three hairline step rows right. */
export default function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-24 border-y border-line bg-white">
      <div className="mx-auto grid w-full max-w-[1240px] grid-cols-1 items-start gap-10 px-6 py-20 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:gap-14">
        <div className="flex flex-col gap-4">
          <span className="font-mono text-xs tracking-[0.1em] text-red">HOW IT WORKS</span>
          <h2 className="display text-3xl sm:text-[40px] sm:leading-[1.12]">Joining the 120</h2>
          <p className="text-[15px] leading-[1.65] text-ink-soft">
            Build something, then join the group. That&rsquo;s the heart of it. Each group
            qualifies its members its own way.
          </p>
        </div>
        <div className="flex flex-col">
          {steps.map((s, i) => (
            <div
              key={s.n}
              className={`grid grid-cols-1 gap-2 border-t border-line py-[22px] sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-7 ${
                i === steps.length - 1 ? "border-b" : ""
              }`}
            >
              <span className="font-mono text-xs tracking-[0.1em] text-red">{s.n}</span>
              <span className="text-[15px] leading-relaxed text-ink">
                <strong>{s.strong}</strong> {s.rest}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
