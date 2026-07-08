import JoinButton from "./JoinButton";
import { TUITION_CAD } from "@/app/lib/site";

const included = [
  "Membership in the founding 120",
  "Tin Can device + Party-Line service",
  "The 120 Address Book",
  "One mentored, year-long project",
  "1–2 subjects accelerated on TimeBack",
  "Weekly 1:1 with a PhD-level advisor",
  "Four quarterly Toronto intensives",
];

export default function TuitionCard() {
  return (
    <section id="tuition" className="scroll-mt-24 border-b border-line bg-paper">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 lg:py-28">
        <div className="mx-auto max-w-xl text-center">
          <p className="eyebrow">Tuition</p>
          <h2 className="mt-4 font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            One price. Everything included.
          </h2>
        </div>

        <div className="mx-auto mt-12 max-w-lg overflow-hidden rounded-2xl border border-line bg-white shadow-[0_30px_60px_-40px_rgba(19,20,22,0.4)]">
          <div className="border-b border-line bg-ink px-8 py-10 text-center text-paper">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted">
              The 120 Membership
            </p>
            <p className="mt-4 font-display text-5xl font-bold tracking-tight text-white">
              ${TUITION_CAD.toLocaleString("en-CA")}
              <span className="ml-2 align-middle font-mono text-base font-normal text-muted">
                CAD / year
              </span>
            </p>
            <p className="mt-2 text-sm text-muted">All-inclusive. Tin Can included.</p>
          </div>

          <ul className="space-y-3 px-8 py-8">
            {included.map((item) => (
              <li key={item} className="flex items-start gap-3 text-sm text-ink-soft">
                <span
                  aria-hidden
                  className="mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full bg-red/10 text-[0.6rem] font-bold text-red"
                >
                  ✓
                </span>
                {item}
              </li>
            ))}
          </ul>

          <div className="px-8 pb-8">
            <JoinButton className="w-full">Claim your child&rsquo;s seat</JoinButton>
            <p className="mt-4 text-center text-xs leading-5 text-muted">
              Want the whole thing? The complete GT academic core is available as an upgrade —
              we&rsquo;ll walk you through it on a call.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
