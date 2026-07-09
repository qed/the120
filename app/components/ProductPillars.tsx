import { proofStats } from "@/app/lib/site";

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
    body: "AI-adaptive acceleration on the GT / TimeBack platform, paired with a weekly 1:1 from a PhD-level Academic Advisor. Mastery-based, no ceiling — members routinely learn at 3x the pace of a traditional classroom.",
    tags: ["TimeBack platform", "PhD-level advisor", "Mastery before progression"],
  },
];

export default function ProductPillars() {
  return (
    <section className="border-b border-line bg-paper">
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
                <span className="font-display text-2xl font-bold text-line-strong">{p.n}</span>
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

        {/* Network outcomes — attributed, never claimed as The 120's own (brief §9) */}
        <div className="mt-16 rounded-2xl border border-line bg-ink px-8 py-10 text-paper">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {proofStats.map((s) => (
              <div key={s.label}>
                <p className="font-display text-4xl font-bold tracking-tight text-white">
                  {s.value}
                </p>
                <p className="mt-2 text-sm leading-5 text-muted">{s.label}</p>
              </div>
            ))}
          </div>
          <p className="mt-8 font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted">
            Results from the GT School / 2 Hour Learning network — 13+ campuses. Not yet claimed as
            The 120&rsquo;s own outcomes.
          </p>
        </div>
      </div>
    </section>
  );
}
