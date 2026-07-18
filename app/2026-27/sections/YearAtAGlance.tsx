import type { ReactNode } from "react";
import { COPY } from "../data";
import type { Audience } from "../cta-source";

const CARD_SHADOW = "shadow-[0_2px_14px_rgba(19,20,22,0.06)]";

/**
 * 01 · The Year at a glance — 3×2 stat cards (bone band).
 *
 * Honesty fix (R9): card 1's figure reads "19 scheduled workshops (one more to
 * be added)", not the prototype's "20 sessions" — the 20th date is still TBD.
 */
export default function YearAtAGlance({ audience }: { audience: Audience }) {
  const t = COPY[audience];

  const cards: {
    figure: ReactNode;
    note?: string;
    label: string;
    desc: string;
    small?: boolean;
  }[] = [
    {
      figure: (
        <>
          19 scheduled <span className="accent">workshops</span>
        </>
      ),
      note: "(one more to be added)",
      label: t.y1label,
      desc: t.y1desc,
      small: true,
    },
    {
      figure: (
        <>
          5 <span className="accent">phases</span>
        </>
      ),
      label: t.y2label,
      desc: t.y2desc,
    },
    {
      figure: (
        <>
          5 × <span className="accent">5</span>
        </>
      ),
      label: t.y3label,
      desc: t.y3desc,
    },
    {
      figure: (
        <>
          20 <span className="accent">books</span>
        </>
      ),
      label: t.y4label,
      desc: t.y4desc,
    },
    {
      figure: (
        <>
          40 <span className="accent">paragraphs</span>
        </>
      ),
      label: t.y5label,
      desc: t.y5desc,
    },
    {
      figure: (
        <>
          2X, 3X or 4X <span className="accent">speed</span>
        </>
      ),
      label: t.y6label,
      desc: t.y6desc,
      small: true,
    },
  ];

  return (
    <section id="year" className="scroll-mt-[152px] bg-paper">
      <div className="mx-auto w-full max-w-[1240px] px-6 py-14 sm:px-11 sm:py-[88px]">
        <p className="eyebrow">{t.yearKicker}</p>
        <h2 className="display mt-3.5 text-4xl text-ink sm:text-[44px]">
          {t.yearHeadLead} <span className="accent">{t.yearHeadAccent}</span>
        </h2>

        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card, i) => (
            <div
              key={i}
              className={`flex flex-col gap-2.5 rounded-[14px] bg-white p-[22px] ${CARD_SHADOW} transition-shadow duration-200 hover:shadow-md`}
            >
              <div
                className={`display leading-none text-ink ${
                  card.small ? "text-[26px] sm:text-[28px]" : "text-[40px]"
                }`}
              >
                {card.figure}
              </div>
              {card.note ? (
                <div className="font-mono text-[11px] tracking-[0.06em] text-muted">{card.note}</div>
              ) : null}
              <div className="text-[15px] font-semibold text-ink">{card.label}</div>
              <div className="text-sm leading-relaxed text-ink-soft">{card.desc}</div>
            </div>
          ))}
        </div>

        <p className="mt-6 text-right text-[15px] text-ink-soft">{t.yearNote}</p>
      </div>
    </section>
  );
}
