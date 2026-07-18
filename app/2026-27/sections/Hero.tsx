"use client";

import { groupLines, type GroupKey } from "../data";

/** Protection gradient shared with the site hero + group-page placeholder. */
const OVERLAY_GRADIENT =
  "linear-gradient(rgba(19,20,22,0.18) 0%, rgba(19,20,22,0) 30%, rgba(19,20,22,0.02) 55%, rgba(19,20,22,0.78) 100%)";

const GROUP_OPTIONS: { key: GroupKey; label: string }[] = [
  { key: "the120", label: "The 120" },
  { key: "athletes", label: "Athletes" },
  { key: "founders", label: "Founders" },
  { key: "givers", label: "Givers" },
  { key: "makers", label: "Makers" },
  { key: "scholars", label: "Scholars" },
];

const SUBHEAD_CLASS =
  "border-l-[3px] border-blush pl-[18px] text-[17px] leading-relaxed text-white sm:text-lg";

/**
 * Hero band (blue placeholder until real photography lands). Fixed group-mode
 * kicker + headline; a radiogroup of six pills swaps only the subhead line
 * (`groupLines[group]`), single-voice, independent of the Parents/Kids toggle.
 *
 * The subhead uses a single-cell grid: all six lines are stacked invisibly to
 * reserve the height of the tallest, and one persistent `aria-live` node paints
 * the active line on top — so the vertically-centred hero never jumps when the
 * selection changes (and the swap is announced once).
 */
export default function Hero({
  group,
  setGroup,
}: {
  group: GroupKey;
  setGroup: (g: GroupKey) => void;
}) {
  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    let next = index;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (index + 1) % GROUP_OPTIONS.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      next = (index - 1 + GROUP_OPTIONS.length) % GROUP_OPTIONS.length;
    else return;
    e.preventDefault();
    setGroup(GROUP_OPTIONS[next].key);
    const radiogroupEl = e.currentTarget.parentElement;
    const btn = radiogroupEl?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next];
    btn?.focus();
  };

  return (
    // Pull full-bleed up behind the floating chrome so the blue reaches the very
    // top with the Nav + sub-nav floating over it. -152px matches the chrome's
    // stuck bottom (see SubNav's geometry note) and the sections' scroll-mt-152;
    // it slightly overshoots the true offset, which safely covers the top rather
    // than leaving a paper gap. The hero is single-voice and vertically centred,
    // so its copy stays well clear of the chrome.
    <section className="relative -mt-[152px] flex min-h-[780px] flex-col justify-center overflow-hidden bg-blue">
      <div className="absolute inset-0" style={{ background: OVERLAY_GRADIENT }} aria-hidden />

      <div className="relative z-10 mx-auto w-full max-w-[1240px] px-6 py-24 sm:px-11">
        {/* Group selector — swaps only the subhead line */}
        <div role="radiogroup" aria-label="Choose a group" className="mb-6 flex flex-wrap gap-1.5">
          {GROUP_OPTIONS.map((opt, i) => {
            const checked = opt.key === group;
            return (
              <button
                key={opt.key}
                type="button"
                role="radio"
                aria-checked={checked}
                tabIndex={checked ? 0 : -1}
                onClick={() => setGroup(opt.key)}
                onKeyDown={(e) => onKeyDown(e, i)}
                className={`rounded-full border px-3.5 py-1.5 font-mono text-xs uppercase tracking-[0.08em] transition-colors ${
                  checked
                    ? "border-blush bg-blush text-ink"
                    : "border-white/30 text-white hover:border-white"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        <p className="font-mono text-xs uppercase tracking-[0.1em] text-blush">
          THE 2026-27 YEAR · FIVE GROUPS · ONE PROGRAM
        </p>

        <h1 className="display mt-4 max-w-[880px] text-4xl text-white sm:text-5xl lg:text-[68px]">
          The 2026-27 year.{" "}
          <span className="accent-blush block">Your business.</span>
        </h1>

        {/* Subhead: single-cell grid reserves the tallest line's height */}
        <div className="mt-5 grid max-w-[760px]">
          {GROUP_OPTIONS.map((opt) => (
            <p key={opt.key} aria-hidden className={`invisible [grid-area:1/1] ${SUBHEAD_CLASS}`}>
              {groupLines[opt.key]}
            </p>
          ))}
          <p aria-live="polite" className={`[grid-area:1/1] ${SUBHEAD_CLASS}`}>
            {groupLines[group]}
          </p>
        </div>

        <p className="mt-6 font-mono text-[11px] tracking-[0.06em] text-white/70">
          The program is to learn how to build a business - you adapt the plan to your business.
        </p>
      </div>
    </section>
  );
}
