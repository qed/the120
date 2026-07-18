import type { ReactNode } from "react";
import { COPY, workshopDates, dateNotes, dateNotesKid } from "../data";
import type { Audience } from "../cta-source";
import { pillState, type PillState } from "../pill-state";

const CARD =
  "rounded-[14px] bg-white px-8 py-[30px] shadow-[0_2px_14px_rgba(19,20,22,0.06)]";

/** Card sub-header (mono red, e.g. THE YEAR / THE MONTH / THE WEEK). */
const CARD_LABEL = "font-mono text-xs tracking-[0.1em] text-red";
/** Muted mono cluster label (e.g. AT THE WORKSHOP · TWO SATURDAYS). */
const CLUSTER_LABEL = "font-mono text-[11px] tracking-[0.1em] text-muted";

/** Every pill shares this shape; state supplies the fill/border/text. */
const PILL_BASE =
  "flex items-center justify-center gap-[5px] rounded-full px-2.5 py-2 font-mono text-xs tracking-[0.04em]";

const PILL_STATE: Record<PillState, string> = {
  kickoff: "border border-red bg-red text-white",
  "demo-day": "border border-line-strong bg-line-strong text-ink",
  tbd: "border border-dashed border-line-strong bg-transparent text-muted",
  normal: "border border-line bg-paper text-ink",
};

/**
 * Group the 20 workshop dates into three hairline-separated season blocks by
 * month prefix (Sep–Dec = Fall 2026, Jan–Feb = Winter 2027, Mar–Jun = Spring
 * 2027). The label-less SPECIAL/TBD entry has no month, so it lands last, in
 * the Spring block.
 */
const SEASONS: { label: string; months: string[] }[] = [
  { label: "FALL 2026", months: ["SEP", "OCT", "NOV", "DEC"] },
  { label: "WINTER 2027", months: ["JAN", "FEB"] },
  { label: "SPRING 2027", months: ["MAR", "APR", "MAY", "JUN"] },
];

const seasons = SEASONS.map((season, i) => ({
  label: season.label,
  items: workshopDates.filter((d) =>
    d.tbd
      ? i === SEASONS.length - 1 // SPECIAL/TBD goes last (Spring)
      : season.months.includes(d.label.split(" ")[0])
  ),
}));

/** Fixed, single-voice bullet copy (does not vary with the audience toggle). */
const WORKSHOP_BULLETS = [
  "Demo what you built",
  "Pass criteria with your coach",
  "Sell to the room",
  "Plan the next two weeks",
];

const WEEK_BULLETS = [
  "Go 2-4X with Math, earn rewards for The Emporium",
  "Write & publish one paragraph or more (optional)",
  "A book on the go, about one every two weeks",
  "Whatever hours the business demands",
];

function Bullet({ tone, children }: { tone: "red" | "ink"; children: ReactNode }) {
  return (
    <div className="flex items-start gap-[11px]">
      <span
        className={`mt-[7px] h-[7px] w-[7px] flex-none rounded-full ${
          tone === "red" ? "bg-red" : "bg-ink"
        }`}
      />
      <span className="text-base leading-[1.5] text-ink">{children}</span>
    </div>
  );
}

/**
 * 05 · The Schedule (bone band). Three white cards — THE YEAR / THE MONTH /
 * THE WEEK. THE YEAR renders the honest, data-driven date strip grouped into
 * Fall/Winter/Spring blocks of mono pills (normal / ★ Demo Day / Sep 19 kickoff
 * / SPECIAL-TBD), with audience-varied note lines. THE MONTH and THE WEEK are
 * labelled bullet clusters with a Georgia italic closing line.
 */
export default function Schedule({ audience }: { audience: Audience }) {
  const t = COPY[audience];
  const notes = audience === "kids" ? dateNotesKid : dateNotes;

  return (
    <section id="schedule" className="scroll-mt-[152px] bg-paper">
      <div className="mx-auto w-full max-w-[1240px] px-6 py-14 sm:px-11 sm:py-[88px]">
        <p className="eyebrow">{t.schedKicker}</p>
        <h2 className="display mt-3.5 text-4xl text-ink sm:text-[44px]">
          Year. Month. Week. <span className="accent">How it all fits.</span>
        </h2>

        <div className="mt-10 flex flex-col gap-4">
          {/* THE YEAR — paragraph + season-grouped date strip + notes */}
          <div className={`${CARD} flex flex-col gap-[18px]`}>
            <span className={CARD_LABEL}>THE YEAR</span>
            <p className="max-w-[900px] text-[17px] leading-relaxed text-ink-soft">
              {t.yearBlockBody}
            </p>

            <div className="flex flex-col gap-5">
              {seasons.map((season) => (
                <div
                  key={season.label}
                  className="flex flex-col gap-2.5 border-t border-line pt-4"
                >
                  <span className={CLUSTER_LABEL}>{season.label}</span>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {season.items.map((entry) => {
                      const state = pillState(entry);
                      return (
                        <div
                          key={entry.label}
                          className={`${PILL_BASE} ${PILL_STATE[state]}`}
                        >
                          <span>{entry.label}</span>
                          {state === "demo-day" ? (
                            <span className="text-red">{entry.mark}</span>
                          ) : null}
                          {state === "kickoff" ? (
                            <span className="text-[9px] tracking-[0.12em]">KICKOFF</span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-1">
              {notes.map((note) => (
                <span key={note} className="text-[13px] text-muted">
                  {note}
                </span>
              ))}
            </div>
          </div>

          {/* THE MONTH — two bullet clusters (red-dot workshop / ink-dot home) */}
          <div className={`${CARD} flex flex-col gap-3.5`}>
            <span className={CARD_LABEL}>THE MONTH</span>
            <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
              <div className="flex flex-col gap-3.5">
                <span className={CLUSTER_LABEL}>AT THE WORKSHOP · TWO SATURDAYS</span>
                {WORKSHOP_BULLETS.map((b) => (
                  <Bullet key={b} tone="red">
                    {b}
                  </Bullet>
                ))}
              </div>
              <div className="flex flex-col gap-3.5">
                <span className={CLUSTER_LABEL}>AT HOME · IN BETWEEN</span>
                <Bullet tone="ink">{t.monthHome1}</Bullet>
                <Bullet tone="ink">{t.monthHome2}</Bullet>
                <Bullet tone="ink">{t.monthHome3}</Bullet>
              </div>
            </div>
          </div>

          {/* THE WEEK — 2×2 red-dot bullets + Georgia italic closing line */}
          <div className={`${CARD} flex flex-col gap-3.5`}>
            <span className={CARD_LABEL}>THE WEEK</span>
            <span className={CLUSTER_LABEL}>THE AT-HOME RHYTHM · MOST WEEKS</span>
            <div className="grid grid-cols-1 gap-x-8 gap-y-3.5 sm:grid-cols-2">
              {WEEK_BULLETS.map((b) => (
                <Bullet key={b} tone="red">
                  {b}
                </Bullet>
              ))}
            </div>
            <p className="mt-1.5 font-serif text-xl italic leading-[1.3] text-ink">
              {t.weekCloseLead}
              <span className="text-red">{t.weekCloseAccent}</span>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
