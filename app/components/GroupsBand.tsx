import Link from "next/link";
import SeatsDot from "./SeatsDot";
import { groups } from "@/app/lib/site";

/** Handoff: intro paragraph + seats dot, then the #0300ED five-groups band. */
export default function GroupsBand({ seatsRemaining }: { seatsRemaining?: number }) {
  return (
    <>
      {/* Intro + seats */}
      <div className="mx-auto flex w-full max-w-[1240px] flex-col justify-between gap-5 px-6 py-11 sm:flex-row sm:items-center sm:gap-8 sm:px-8">
        <p className="max-w-[720px] text-lg leading-relaxed text-ink-soft">
          The 120 is a selective network of 120 kids across five groups. Your child finds
          people with the same core interests, and different ones, in a cohort where everyone
          is building something. 3&ndash;5 hours a week, alongside any school.
        </p>
        <SeatsDot className="flex-shrink-0" remaining={seatsRemaining} />
      </div>

      {/* Five groups */}
      <section id="groups" className="scroll-mt-24 bg-blue px-6 py-20 sm:px-11">
        <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-10">
          <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end sm:gap-8">
            <div className="flex flex-col gap-3">
              <span className="font-mono text-xs tracking-[0.1em] text-blush">
                FIVE GROUPS · ONE NETWORK
              </span>
              <h2 className="display text-3xl text-paper sm:text-[44px] sm:leading-[1.1]">
                Every kid needs <span className="accent-blush">their people</span>
              </h2>
            </div>
            <span className="max-w-[380px] text-[15px] leading-relaxed text-white/75">
              120 seats across 5 groups. Book a call or join today.
            </span>
          </div>

          <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2 lg:grid-cols-5">
            {groups.map((g) => (
              <Link
                key={g.slug}
                href={g.href}
                className="flex min-h-[250px] flex-col rounded-[14px] bg-paper p-[22px] text-ink transition-all duration-200 ease-out hover:-translate-y-1 hover:shadow-[0_18px_40px_-18px_rgba(0,0,0,0.5)]"
              >
                <span className="font-mono text-[9.5px] tracking-[0.12em] opacity-75">
                  {g.category}
                </span>
                <span className="display mt-2 text-[26px] leading-[1.05]">{g.name}</span>
                <span className="mt-2.5 text-[13px] leading-[1.55] opacity-85">{g.blurb}</span>
                <span className="mt-auto pt-[18px] font-mono text-[10px] tracking-[0.08em] text-red">
                  {g.cta}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
