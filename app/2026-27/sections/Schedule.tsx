import { COPY } from "../data";
import type { Audience } from "../cta-source";

/**
 * 05 · The Schedule (bone band) — STUB. The date strip + month/week blocks land
 * in Unit 8; this renders the band shell so the page composes.
 */
export default function Schedule({ audience }: { audience: Audience }) {
  const t = COPY[audience];

  return (
    <section id="schedule" className="scroll-mt-[152px] bg-paper">
      <div className="mx-auto w-full max-w-[1240px] px-6 py-14 sm:px-11 sm:py-[88px]">
        <p className="eyebrow">{t.schedKicker}</p>
        <h2 className="display mt-3.5 text-4xl text-ink sm:text-[44px]">
          Year. Month. Week. <span className="accent">How it all fits.</span>
        </h2>
        <p className="mt-8 font-mono text-xs uppercase tracking-[0.1em] text-muted">
          [section coming in a later unit]
        </p>
      </div>
    </section>
  );
}
