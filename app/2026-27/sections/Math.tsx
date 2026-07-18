import { COPY } from "../data";
import type { Audience } from "../cta-source";

/**
 * 09 · The Foundation / Math (bone band). Two columns: three voiced paragraphs
 * and a white card naming the curriculum (Math Academy) + speed layer (The
 * Gauntlet). No math-gate language — the softened copy lives in the data.
 */
export default function MathSection({ audience }: { audience: Audience }) {
  const t = COPY[audience];

  return (
    <section id="math" className="scroll-mt-[152px] bg-paper">
      <div className="mx-auto w-full max-w-[1240px] px-6 py-14 sm:px-11 sm:py-[88px]">
        <p className="eyebrow">{t.mathKicker}</p>
        <h2 className="display mt-3.5 text-4xl text-ink sm:text-[44px]">
          Math at <span className="accent">2X, 3X, 4X</span> speed.
        </h2>

        <div className="mt-10 grid grid-cols-1 items-start gap-14 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="flex flex-col gap-5">
            <p className="text-[17px] leading-relaxed text-ink-soft">{t.mathP1}</p>
            <p className="text-[17px] leading-relaxed text-ink-soft">{t.mathP2}</p>
            <p className="text-[17px] leading-relaxed text-ink-soft">{t.mathP3}</p>
          </div>

          <div className="rounded-[14px] bg-white px-7 shadow-[0_2px_14px_rgba(19,20,22,0.06)]">
            <div className="flex flex-col gap-2 border-b border-line py-6">
              <span className="font-mono text-[11px] tracking-[0.1em] text-muted">THE CURRICULUM</span>
              <span className="text-[21px] font-semibold tracking-[-0.01em] text-ink">
                Math Academy
              </span>
              <span className="text-[15px] leading-relaxed text-ink-soft">{t.mathCurDesc}</span>
            </div>
            <div className="flex flex-col gap-2 py-6">
              <span className="font-mono text-[11px] tracking-[0.1em] text-muted">THE SPEED LAYER</span>
              <span className="text-[21px] font-semibold tracking-[-0.01em] text-ink">
                The Gauntlet
              </span>
              <span className="text-[15px] leading-relaxed text-ink-soft">{t.mathSpeedDesc}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
