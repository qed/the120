import Link from "next/link";
import Cta from "./Cta";

/**
 * Home-page band for the Toronto parent stories (T9) — excerpts + link to /parents.
 * Per positioning: proof content lives front and center on/from the home page.
 */
const excerpts = [
  {
    quote:
      "The biggest surprise for me was that my boys actually wanted to do extra work. They stayed up late doing more lessons — definitely a first for us.",
    name: "Ian Logan",
    detail: "Toronto parent · two boys",
  },
  {
    quote:
      "In a little over 5 weeks, my middle child went from Grade 3 to Grade 5 in Math. He can feel it. I can feel it. The progress is palpable.",
    name: "Peter Kuperman",
    detail: "Toronto parent · three kids",
  },
  {
    quote:
      "We had a similar experience with our 7-year-old twin boys. Earning XPs for an end reward was very motivating.",
    name: "Gordon McKay",
    detail: "Toronto parent · twins",
  },
];

export default function ParentStoriesBand() {
  return (
    <section className="border-y border-line bg-white">
      <div className="mx-auto w-full max-w-[1240px] px-6 py-20 sm:px-8 lg:py-24">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <p className="font-mono text-xs tracking-[0.1em] text-red">TORONTO PARENTS</p>
            <h2 className="display mt-4 text-3xl sm:text-[42px] sm:leading-[1.1]">
              Real families. <span className="accent">Real progress.</span>
            </h2>
          </div>
          <Cta href="/parents" variant="ghost" className="self-start px-[26px] py-[15px] md:self-auto">
            Read their stories →
          </Cta>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {excerpts.map((q) => (
            <Link
              key={q.name}
              href="/parents"
              className="flex flex-col justify-between rounded-2xl border border-line bg-paper p-8 transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-[0_24px_50px_-30px_rgba(19,20,22,0.3)]"
            >
              <blockquote className="font-display text-lg font-medium leading-snug text-ink">
                <span className="text-red">&ldquo;</span>
                {q.quote}
                <span className="text-red">&rdquo;</span>
              </blockquote>
              <div className="mt-6 border-t border-line pt-4">
                <p className="font-display font-semibold text-ink">{q.name}</p>
                <p className="font-mono text-[0.7rem] uppercase tracking-[0.1em] text-muted">
                  {q.detail}
                </p>
              </div>
            </Link>
          ))}
        </div>

        <p className="mt-8 font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted">
          TimeBack/Alpha experiences — the platform behind The 120&rsquo;s academics
        </p>
      </div>
    </section>
  );
}
