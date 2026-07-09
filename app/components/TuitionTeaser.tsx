import Cta from "./Cta";

/** Handoff: "Two prices. Two ways in." teaser row linking to /tuition. */
export default function TuitionTeaser() {
  return (
    <section className="mx-auto flex w-full max-w-[1240px] flex-col justify-between gap-8 px-6 py-[88px] sm:px-8 md:flex-row md:items-center">
      <div className="flex flex-col gap-2.5">
        <span className="font-mono text-xs tracking-[0.1em] text-red">TUITION</span>
        <span className="display text-3xl sm:text-4xl">
          Two prices. <span className="accent">Two ways in.</span>
        </span>
        <span className="max-w-[640px] text-[15px] leading-relaxed text-ink-soft">
          $3,000 CAD a year to join, with math through Math Academy — upgrade to $15,000 for
          the Full Academic Core with TimeBack. All tuition is HST-exempt. Every group is
          enrolling now.
        </span>
      </div>
      <Cta href="/tuition" variant="ghost" className="self-start px-[26px] py-[15px] md:self-auto">
        See tuition →
      </Cta>
    </section>
  );
}
