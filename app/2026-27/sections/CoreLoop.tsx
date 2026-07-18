import { COPY } from "../data";
import type { Audience } from "../cta-source";

/**
 * 06 · The Core Loop (white band): expertise → audience → product. Three
 * ink-topped cards with fixed titles; the bodies + closing line are voiced.
 */
export default function CoreLoop({ audience }: { audience: Audience }) {
  const t = COPY[audience];

  const cards = [
    { kicker: "01 · EXPERTISE", title: "Get good at something real.", body: t.l1b },
    { kicker: "02 · AUDIENCE", title: "Share it until people listen.", body: t.l2b },
    { kicker: "03 · PRODUCT", title: "Build what the audience asks for.", body: t.l3b },
  ];

  return (
    <section id="loop" className="scroll-mt-[152px] bg-white">
      <div className="mx-auto w-full max-w-[1240px] px-6 py-14 sm:px-11 sm:py-[88px]">
        <p className="eyebrow">{t.loopKicker}</p>
        <h2 className="display mt-3.5 text-4xl text-ink sm:text-[44px]">
          {t.loopHeadLead} <span className="accent">{t.loopHeadAccent}</span>
        </h2>
        <p className="mt-4 max-w-[680px] text-[17px] leading-relaxed text-ink-soft">{t.loopIntro}</p>

        <div className="mt-11 grid grid-cols-1 gap-6 md:grid-cols-3">
          {cards.map((card) => (
            <div key={card.kicker} className="flex flex-col gap-2.5 border-t-2 border-ink pt-[18px]">
              <span className="font-mono text-xs tracking-[0.1em] text-red">{card.kicker}</span>
              <div className="text-[21px] font-semibold tracking-[-0.01em] text-ink">
                {card.title}
              </div>
              <p className="text-[15px] leading-relaxed text-ink-soft">{card.body}</p>
            </div>
          ))}
        </div>

        <p className="mt-10 max-w-[900px] text-[17px] leading-relaxed text-ink-soft">{t.loopClose}</p>
      </div>
    </section>
  );
}
