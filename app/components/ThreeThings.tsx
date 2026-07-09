const things = [
  {
    kicker: "01 · THE NETWORK",
    title: "A Tin Can + the Address Book",
    body: "Every member gets a screen-free Tin Can with the 120 Address Book inside: a bat phone to 119 kids building interesting lives, across all five groups.",
  },
  {
    kicker: "02 · THE PROJECT",
    title: "One year-long project, shipped",
    body: "A year-long project connected to their group: a season record, a company, a body of work, a research study, a service program. Mentored, milestone-driven, demoed live at the quarterly Toronto intensives.",
  },
  {
    kicker: "03 · THE SUBJECT",
    title: "Get super advanced in one subject. Or two.",
    body: "Personalized content acceleration on 1 of 2 academic platforms paired with regular calls to keep you on track. Mastery-based, no ceiling. Members routinely learn at 3X the pace of a traditional classroom in the chosen subject.",
  },
];

/** Handoff: "Membership is 3 things" — three columns topped with 2px ink borders. */
export default function ThreeThings() {
  return (
    <section className="mx-auto flex w-full max-w-[1240px] flex-col gap-11 px-6 py-24 sm:px-8">
      <h2 className="display max-w-[720px] text-3xl sm:text-[42px] sm:leading-[1.1]">
        Membership is <span className="accent">3 things</span>
      </h2>
      <div className="grid grid-cols-1 gap-10 md:grid-cols-3">
        {things.map((t) => (
          <div key={t.kicker} className="flex flex-col gap-2.5 border-t-2 border-ink pt-5">
            <span className="font-mono text-[11px] tracking-[0.1em] text-red">{t.kicker}</span>
            <span className="text-[21px] font-semibold">{t.title}</span>
            <span className="text-[15px] leading-relaxed text-ink-soft">{t.body}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
