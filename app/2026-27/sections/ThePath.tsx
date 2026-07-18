"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { COPY, pathSteps } from "../data";
import type { Audience } from "../cta-source";
import { criteriaFor } from "../path-criteria";

/** The Kids-only "PASS CRITERIA" wording sub-toggle options. */
const VOICE_OPTS: { value: boolean; label: string }[] = [
  { value: true, label: "KID VOICE" },
  { value: false, label: "ORIGINAL" },
];

/** The three fixed pacing-card titles (single-voice; bodies come from COPY). */
const PACING_TITLES = [
  "PASS FIVE, MOVE ON",
  "STUCK IS NORMAL",
  "FINISH EARLY, GO DEEPER",
] as const;

/**
 * 08 · The Path (BLUE statement band). The richest section:
 *  - a 5-node horizontal stepper (stacks vertically ≤920, arrows hidden),
 *  - three bone pacing cards,
 *  - a Kids-only KID VOICE | ORIGINAL sub-toggle (radiogroup), and
 *  - a single-open, collapse-to-zero accordion of the 25 pass criteria
 *    (Phase 01 open on load).
 *
 * On the blue band, kickers/accents are blush and text is white; the cards are
 * bone/white. Voiced accordion content (subtitle/principle/criteria/pull-off
 * line) follows `criteriaFor(audience, kidVoice)`; the structural stepper +
 * accordion header fields (num/key/title) always read the original `pathSteps`.
 */
export default function ThePath({ audience }: { audience: Audience }) {
  const t = COPY[audience];

  // Accordion: which phase is open (0-based). -1 = all collapsed. Phase 01 open
  // on load. Single-open; re-tapping the open header collapses to zero.
  const [open, setOpen] = useState(0);

  // Kids-only sub-toggle. Re-initialised to KID VOICE each time Kids is entered.
  const [kidVoice, setKidVoice] = useState(true);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const wasKids = useRef(audience === "kids");
  const ids = useId();

  // Reset the sub-toggle to KID VOICE whenever Kids is (re-)entered — the
  // React-recommended "adjust state during render when a prop changes" pattern
  // (https://react.dev/learn/you-might-not-need-an-effect), so no effect is
  // needed and there is no extra render/flash.
  const [prevAudience, setPrevAudience] = useState(audience);
  if (audience !== prevAudience) {
    setPrevAudience(audience);
    if (audience === "kids") setKidVoice(true);
  }

  // Focus remedy (self-contained): when the Kids-only sub-toggle unmounts on a
  // Kids→Parents switch while it held focus, the browser drops focus to <body>.
  // Reclaim it to this section's heading (tabindex=-1) so keyboard users aren't
  // dumped at the top of the document. The sub-toggle is the only focusable this
  // component removes on that transition, so activeElement === body is a safe
  // signal that it was the thing that lost focus. Runs pre-paint.
  useLayoutEffect(() => {
    const leftKids = wasKids.current && audience === "parents";
    wasKids.current = audience === "kids";
    if (!leftKids) return;
    const active = document.activeElement;
    if (!active || active === document.body) {
      headingRef.current?.focus();
    }
  }, [audience]);

  const onVoiceKeyDown = (e: React.KeyboardEvent, index: number) => {
    let next = index;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (index + 1) % VOICE_OPTS.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      next = (index - 1 + VOICE_OPTS.length) % VOICE_OPTS.length;
    else return;
    e.preventDefault();
    setKidVoice(VOICE_OPTS[next].value);
    const btn = e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
      '[role="radio"]'
    )[next];
    btn?.focus();
  };

  // Voiced phase content (subtitle/principle/parentsSee/criteria), by audience +
  // sub-toggle. Indexed positionally against the structural `pathSteps`.
  const voices = criteriaFor(audience, kidVoice);

  return (
    <section id="path" className="scroll-mt-[152px] bg-blue">
      <div className="mx-auto w-full max-w-[1240px] px-6 py-14 sm:px-11 sm:py-[88px]">
        <p className="font-mono text-xs uppercase tracking-[0.1em] text-blush">{t.pathKicker}</p>
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="display mt-3.5 text-4xl text-white outline-none sm:text-[44px]"
        >
          {t.pathHeadLead} <span className="accent-blush">{t.pathHeadAccent}</span>
        </h2>
        <p className="mt-5 max-w-[760px] text-[17px] leading-relaxed text-white/75">{t.pathIntro}</p>

        {/* 5-node stepper — horizontal ≥920, stacks vertically below (arrows hidden). */}
        <div className="mt-14 mb-14 flex flex-col gap-4 min-[920px]:flex-row min-[920px]:items-start min-[920px]:justify-between min-[920px]:gap-0">
          {pathSteps.map((step, i) => (
            <div
              key={step.key}
              className="flex items-center gap-3.5 min-[920px]:min-w-[150px] min-[920px]:flex-1"
            >
              {i > 0 && (
                <span
                  aria-hidden="true"
                  className="hidden flex-none text-xl text-white/40 min-[920px]:inline"
                >
                  →
                </span>
              )}
              <div className="flex flex-1 flex-col items-center gap-3">
                <div className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-paper font-mono text-sm text-ink">
                  {step.num}
                </div>
                <div className="display text-center text-[22px] text-white">{step.title}</div>
              </div>
            </div>
          ))}
        </div>

        {/* 3 pacing cards (bone on blue). */}
        <div className="mb-14 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {PACING_TITLES.map((title, i) => (
            <div key={title} className="flex flex-col gap-2.5 rounded-[14px] bg-paper p-6">
              <div className="font-mono text-xs font-medium tracking-[0.08em] text-red">{title}</div>
              <div className="text-[15px] leading-relaxed text-ink-soft">
                {[t.pc1b, t.pc2b, t.pc3b][i]}
              </div>
            </div>
          ))}
        </div>

        {/* Kids-only criteria wording sub-toggle (radiogroup). */}
        {audience === "kids" && (
          <div className="mb-[18px] flex flex-wrap items-center gap-3">
            <span className="font-mono text-[11px] tracking-[0.1em] text-white/70">
              PASS CRITERIA
            </span>
            <div
              role="radiogroup"
              aria-label="Pass criteria wording"
              className="flex gap-0.5 rounded-full border border-white/24 p-0.5"
            >
              {VOICE_OPTS.map((opt, i) => {
                const checked = opt.value === kidVoice;
                return (
                  <button
                    key={opt.label}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    tabIndex={checked ? 0 : -1}
                    onClick={() => setKidVoice(opt.value)}
                    onKeyDown={(e) => onVoiceKeyDown(e, i)}
                    className={`rounded-full px-[15px] py-1.5 font-mono text-[11px] tracking-[0.08em] transition-colors ${
                      checked ? "bg-white text-ink" : "text-white hover:text-blush"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Accordion — single-open, collapse-to-zero, Phase 01 open on load. */}
        <div className="flex flex-col gap-3">
          {pathSteps.map((step, i) => {
            const isOpen = open === i;
            const voice = voices[i];
            const headerId = `${ids}-header-${i}`;
            const panelId = `${ids}-panel-${i}`;
            return (
              <div key={step.key} className="overflow-hidden rounded-[14px] bg-white">
                <h3 className="m-0">
                  <button
                    type="button"
                    id={headerId}
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    aria-label={step.title}
                    onClick={() => setOpen((cur) => (cur === i ? -1 : i))}
                    className="flex w-full cursor-pointer items-start justify-between gap-5 px-[26px] py-6 text-left"
                  >
                    <span className="flex flex-col gap-2">
                      <span className="font-mono text-xs uppercase tracking-[0.1em] text-red">
                        PHASE {step.num} · {step.key}
                      </span>
                      <span className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
                        <span className="display text-[28px] text-ink">{step.title}</span>
                        <span className="text-[15px] text-ink-soft">{voice.subtitle}</span>
                      </span>
                    </span>
                    <span
                      aria-hidden="true"
                      className="flex-none font-mono text-2xl leading-none text-red"
                    >
                      {isOpen ? "−" : "+"}
                    </span>
                  </button>
                </h3>
                {isOpen && (
                  <div
                    id={panelId}
                    role="region"
                    aria-labelledby={headerId}
                    className="px-[26px] pb-[26px]"
                  >
                    <p className="m-0 mb-[18px] max-w-[720px] text-base italic leading-relaxed text-ink">
                      {voice.principle}
                    </p>
                    <ul className="m-0 list-none border-t border-line p-0">
                      {voice.criteria.map((c, j) => (
                        <li key={j} className="flex gap-3.5 border-b border-line py-[11px]">
                          <span className="mt-[3px] flex-none font-mono text-xs text-red">
                            {j + 1}
                          </span>
                          <span className="text-[15px] leading-[1.55] text-ink-soft">{c}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-4 flex flex-col gap-1.5">
                      <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
                        {t.pathSeeLabel}
                      </span>
                      <span className="max-w-[720px] text-[15px] italic leading-relaxed text-ink">
                        {voice.parentsSee}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
