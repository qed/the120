import { COPY } from "../data";
import type { Audience } from "../cta-source";

const OVERLAY_GRADIENT =
  "linear-gradient(rgba(19,20,22,0.18) 0%, rgba(19,20,22,0) 30%, rgba(19,20,22,0.02) 55%, rgba(19,20,22,0.78) 100%)";

/**
 * 03 · Coaching (bone band). Two columns: an intro paragraph + an optional
 * inline coaching image slot (blue placeholder until real photography lands),
 * and four hairline-divided rows.
 */
export default function Coaching({ audience }: { audience: Audience }) {
  const t = COPY[audience];

  const rows = [
    { label: t.cr1l, body: t.cr1b },
    { label: t.cr2l, body: t.cr2b },
    { label: t.cr3l, body: t.cr3b },
    { label: t.cr4l, body: t.cr4b },
  ];

  return (
    <section id="coaching" className="scroll-mt-[152px] bg-paper">
      <div className="mx-auto w-full max-w-[1240px] px-6 py-14 sm:px-11 sm:py-[88px]">
        <p className="eyebrow">{t.coachKicker}</p>
        <h2 className="display mt-3.5 text-4xl text-ink sm:text-[44px]">
          {t.coachHeadLead} <span className="accent">{t.coachHeadAccent}</span>
        </h2>

        <div className="mt-10 grid grid-cols-1 gap-14 lg:grid-cols-[1fr_1.1fr]">
          <div className="flex flex-col gap-6">
            <p className="text-[17px] leading-relaxed text-ink-soft">{t.coachIntro}</p>
            {/* Optional coaching image slot — blue until real photography lands */}
            <div
              className="relative min-h-[280px] overflow-hidden rounded-[18px] bg-blue"
              role="img"
              aria-label="Coaching photo placeholder"
            >
              <div className="absolute inset-0" style={{ background: OVERLAY_GRADIENT }} />
            </div>
          </div>

          <div className="flex flex-col">
            {rows.map((row, i) => {
              const first = i === 0;
              const last = i === rows.length - 1;
              return (
                <div
                  key={row.label}
                  className={`grid grid-cols-1 gap-2 sm:grid-cols-[168px_1fr] sm:gap-x-7 ${
                    last ? "" : "border-b border-line"
                  } ${first ? "pb-[22px]" : last ? "pt-[22px]" : "py-[22px]"}`}
                >
                  <span className="pt-[3px] font-mono text-[11px] tracking-[0.09em] text-red">
                    {row.label}
                  </span>
                  <span className="text-[15px] leading-relaxed text-ink-soft">{row.body}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
