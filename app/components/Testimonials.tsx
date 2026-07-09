const quotes = [
  {
    quote: "I can learn at my own pace, whether I'm ahead or behind. Nobody tells me to slow down.",
    name: "Chloe",
    detail: "2 Hour Learning student",
  },
  {
    quote: "I'm surrounded by kids who like to work as hard as me. It doesn't feel weird to be into this stuff.",
    name: "Rosie",
    detail: "2 Hour Learning student",
  },
  {
    quote: "I finished a year of math in a few months, then spent the rest building my project. That's the point.",
    name: "Amir",
    detail: "2 Hour Learning student",
  },
];

export default function Testimonials() {
  return (
    <section className="border-b border-line bg-paper">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 lg:py-28">
        <div className="max-w-2xl">
          <p className="eyebrow">The community</p>
          <h2 className="mt-4 font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            An intellectual group, not another activity.
          </h2>
          <p className="mt-4 text-lg leading-8 text-ink-soft">
            The hardest part of being the kid who asks for more is being the only one. In the 120,
            they never are.
          </p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {quotes.map((q) => (
            <figure
              key={q.name}
              className="flex flex-col justify-between rounded-2xl border border-line bg-white p-8 transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-[0_24px_50px_-30px_rgba(19,20,22,0.3)]"
            >
              <blockquote className="font-display text-lg font-medium leading-snug text-ink">
                <span className="text-red">&ldquo;</span>
                {q.quote}
                <span className="text-red">&rdquo;</span>
              </blockquote>
              <figcaption className="mt-6 border-t border-line pt-4">
                <p className="font-display font-semibold text-ink">{q.name}</p>
                <p className="font-mono text-[0.7rem] uppercase tracking-[0.1em] text-muted">
                  {q.detail}
                </p>
              </figcaption>
            </figure>
          ))}
        </div>

        <p className="mt-8 font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted">
          Students from the 2 Hour Learning network — 51+ campuses.
        </p>
      </div>
    </section>
  );
}
