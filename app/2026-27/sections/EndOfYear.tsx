import type { ReactNode } from "react";
import { COPY } from "../data";
import type { Audience } from "../cta-source";

/**
 * 10 · End of Year (white band). 3×2 bone cards with fixed serif figures (one
 * red italic accent word) and voiced descriptions, plus a closing paragraph.
 */
export default function EndOfYear({ audience }: { audience: Audience }) {
  const t = COPY[audience];

  const cards: { figure: ReactNode; desc: string }[] = [
    {
      figure: (
        <>
          A real <span className="accent">sale</span>
        </>
      ),
      desc: t.e1,
    },
    {
      figure: (
        <>
          A real <span className="accent">product</span>
        </>
      ),
      desc: t.e2,
    },
    {
      figure: (
        <>
          Real <span className="accent">numbers</span>
        </>
      ),
      desc: t.e3,
    },
    {
      figure: (
        <>
          Up to <span className="accent">20 books</span>
        </>
      ),
      desc: t.e4,
    },
    {
      figure: (
        <>
          A <span className="accent">stage moment</span>
        </>
      ),
      desc: t.e5,
    },
    {
      figure: (
        <>
          A <span className="accent">tested mind</span>
        </>
      ),
      desc: t.e6,
    },
  ];

  return (
    <section id="end" className="scroll-mt-[152px] bg-white">
      <div className="mx-auto w-full max-w-[1240px] px-6 py-14 sm:px-11 sm:py-[88px]">
        <p className="eyebrow">{t.endKicker}</p>
        <h2 className="display mt-3.5 text-4xl text-ink sm:text-[44px]">
          {t.endHeadLead} <span className="accent">{t.endHeadAccent}</span>
        </h2>
        <p className="mt-4 max-w-[640px] text-[17px] leading-relaxed text-ink-soft">{t.endIntro}</p>

        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-[14px] bg-paper p-6">
              <div className="display text-[26px] text-ink">{card.figure}</div>
              <div className="text-[15px] leading-relaxed text-ink-soft">{card.desc}</div>
            </div>
          ))}
        </div>

        <p className="mt-10 max-w-[760px] text-[17px] leading-relaxed text-ink-soft">{t.endClose}</p>
      </div>
    </section>
  );
}
