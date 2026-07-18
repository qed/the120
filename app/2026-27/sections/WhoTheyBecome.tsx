import { COPY } from "../data";
import type { Audience } from "../cta-source";

/**
 * 02 · Who they become (white band). Three ink-topped cards + a full-width
 * math callout (red left rule). The math copy is the softened, no-gate variant
 * (no "business work stops if math falls behind") — that lives in the data.
 */
export default function WhoTheyBecome({ audience }: { audience: Audience }) {
  const t = COPY[audience];

  const cards = [
    { kicker: t.b1k, body: t.b1b },
    { kicker: t.b2k, body: t.b2b },
    { kicker: t.b3k, body: t.b3b },
  ];

  return (
    <section id="become" className="scroll-mt-[152px] bg-white">
      <div className="mx-auto w-full max-w-[1240px] px-6 py-14 sm:px-11 sm:py-[88px]">
        <p className="eyebrow">{t.becomeKicker}</p>
        <h2 className="display mt-3.5 text-4xl text-ink sm:text-[44px]">
          {t.becomeHeadLead} <span className="accent">{t.becomeHeadAccent}</span>
        </h2>
        <p className="mt-4 max-w-[620px] text-[17px] leading-relaxed text-ink-soft">
          {t.becomeIntro}
        </p>

        <div className="mt-11 grid grid-cols-1 gap-6 md:grid-cols-3">
          {cards.map((card) => (
            <div key={card.kicker} className="flex flex-col gap-2.5 border-t-2 border-ink pt-[18px]">
              <span className="font-mono text-xs tracking-[0.1em] text-red">{card.kicker}</span>
              <p className="text-[15px] leading-relaxed text-ink-soft">{card.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-9 flex flex-col gap-3 rounded-[14px] border-l-[3px] border-red bg-white p-7 shadow-[0_2px_14px_rgba(19,20,22,0.06)] sm:p-8">
          <span className="font-mono text-xs tracking-[0.1em] text-red">{t.mathCalloutKicker}</span>
          <p className="max-w-[900px] text-lg leading-relaxed text-ink">{t.mathCalloutBody}</p>
        </div>
      </div>
    </section>
  );
}
