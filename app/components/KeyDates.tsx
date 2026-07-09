import { intensives } from "@/app/lib/site";

export default function KeyDates() {
  return (
    <section className="border-b border-line bg-ink text-paper">
      <div className="mx-auto w-full max-w-6xl px-6 py-16 lg:py-20">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-red">Key dates</p>
            <h2 className="mt-3 font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Four 48-hour intensives. In person, in Toronto.
            </h2>
          </div>
          <p className="max-w-sm text-sm leading-6 text-muted">
            The centrepiece of the year: project demos in the Capstone Arena, signature events, and
            the whole network in one room.
          </p>
        </div>

        <ol className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
          {intensives.map((d, i) => (
            <li key={d.label} className="bg-ink p-6">
              <span className="font-mono text-xs text-muted">0{i + 1}</span>
              <p className="mt-3 font-display text-lg font-semibold text-white">{d.label}</p>
              <p className="mt-1 font-mono text-sm text-red">{d.date}</p>
            </li>
          ))}
        </ol>

        <p className="mt-6 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-muted">
          Virtual info sessions monthly · Venue in Toronto, shared on enrolment
        </p>
      </div>
    </section>
  );
}
