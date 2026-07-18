import { COPY } from "../data";
import type { Audience } from "../cta-source";

/**
 * 04 · Read Widely (white band) — STUB. The three grade-track tabs (5×4 book
 * grid) land in Unit 6; this renders the band shell so the page composes.
 */
export default function ReadWidely({ audience }: { audience: Audience }) {
  const t = COPY[audience];

  return (
    <section id="books" className="scroll-mt-[152px] bg-white">
      <div className="mx-auto w-full max-w-[1240px] px-6 py-14 sm:px-11 sm:py-[88px]">
        <p className="eyebrow">{t.booksKicker}</p>
        <h2 className="display mt-3.5 text-4xl text-ink sm:text-[44px]">
          Twenty books. <span className="accent">Three tracks.</span>
        </h2>
        <p className="mt-8 font-mono text-xs uppercase tracking-[0.1em] text-muted">
          [section coming in a later unit]
        </p>
      </div>
    </section>
  );
}
