const pillars = [
  {
    id: "network",
    n: "01",
    name: "The Network",
    lede: "A bat phone to 119 kids like yours.",
    body: "Every member gets a Tin Can and The 120 Address Book — a screen-free, parent-approved line straight to their intellectual peers across the city. No feeds, no screens. Just the network, plus virtual cohorts and community events.",
    tags: ["Tin Can device included", "The 120 Address Book", "Screen-free by design"],
  },
  {
    id: "project",
    n: "02",
    name: "The Project",
    lede: "One super interesting project, shipped.",
    body: "Each member takes on a single year-long project — mentored, with milestones every quarter, and demoed live at the quarterly Toronto intensives. Real mentorship, real work, real shipping.",
    tags: ["Year-long", "Mentored", "Demoed at intensives"],
  },
  {
    id: "subject",
    n: "03",
    name: "The Subject",
    lede: "Get super advanced in one subject. Or two.",
    body: "AI-adaptive, mastery-based acceleration, paired with a bi-weekly 30 min 1:1 from an expert Academic Advisor. No ceiling — members move exactly as fast as their mastery allows.",
    tags: ["AI-adaptive platform", "Academic Advisor 1:1s", "Mastery before progression"],
  },
];

export default function ProductPillars() {
  return (
    <section className="bg-paper">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 lg:py-28">
        <div className="max-w-2xl">
          <p className="eyebrow">What a family joins</p>
          <h2 className="mt-4 font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            Three things, one membership.
          </h2>
          <p className="mt-4 text-lg leading-8 text-ink-soft">
            Not a tutoring service. Not an enrichment class. A network and a body of real work &mdash;
            for kids who ask for more.
          </p>
        </div>

        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          {pillars.map((p) => (
            <div
              key={p.id}
              id={p.id === "subject" ? undefined : p.id}
              className="scroll-mt-24 rounded-2xl border border-line bg-white p-8 transition-all duration-300 ease-out hover:-translate-y-1 hover:border-line-strong hover:shadow-[0_24px_50px_-30px_rgba(19,20,22,0.35)]"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs uppercase tracking-[0.18em] text-red">
                  {p.name}
                </span>
                <span className="font-display text-2xl font-bold text-muted">{p.n}</span>
              </div>

              <p className="mt-6 font-display text-xl font-bold leading-snug tracking-tight text-ink">
                {p.lede}
              </p>
              <p className="mt-3 text-sm leading-6 text-ink-soft">{p.body}</p>

              <ul className="mt-6 space-y-2 border-t border-line pt-5">
                {p.tags.map((t) => (
                  <li
                    key={t}
                    className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink-soft"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-red" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
