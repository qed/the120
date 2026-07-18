import { COPY } from "../data";
import type { Audience } from "../cta-source";

/**
 * 08 · The Path (BLUE statement band) — STUB. The 5-node stepper, pacing cards,
 * single-open accordion, and Kids voice sub-toggle land in Unit 7; this renders
 * the band shell (blush kicker + white/blush headline) so the page composes.
 */
export default function ThePath({ audience }: { audience: Audience }) {
  const t = COPY[audience];

  return (
    <section id="path" className="scroll-mt-[152px] bg-blue">
      <div className="mx-auto w-full max-w-[1240px] px-6 py-14 sm:px-11 sm:py-[88px]">
        <p className="font-mono text-xs uppercase tracking-[0.1em] text-blush">{t.pathKicker}</p>
        <h2 className="display mt-3.5 text-4xl text-white sm:text-[44px]">
          {t.pathHeadLead} <span className="accent-blush">{t.pathHeadAccent}</span>
        </h2>
        <p className="mt-8 font-mono text-xs uppercase tracking-[0.1em] text-white/60">
          [section coming in a later unit]
        </p>
      </div>
    </section>
  );
}
