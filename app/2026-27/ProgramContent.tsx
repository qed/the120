"use client";

import { useState } from "react";
import type { GroupKey } from "./data";
import type { Audience } from "./cta-source";
import Hero from "./sections/Hero";
import YearAtAGlance from "./sections/YearAtAGlance";
import WhoTheyBecome from "./sections/WhoTheyBecome";
import Coaching from "./sections/Coaching";
import ReadWidely from "./sections/ReadWidely";
import Schedule from "./sections/Schedule";
import CoreLoop from "./sections/CoreLoop";
import SkillTrack from "./sections/SkillTrack";
import ThePath from "./sections/ThePath";
import MathSection from "./sections/Math";
import EndOfYear from "./sections/EndOfYear";
import MidPageCta from "./MidPageCta";
import RedCtaBand from "./RedCtaBand";

const AUDIENCES: { key: Audience; label: string }[] = [
  { key: "parents", label: "PARENTS" },
  { key: "kids", label: "KIDS" },
];

/**
 * The single client island for /2026-27. Owns the cross-cutting `audience` and
 * hero `group` state and passes them as props to flat child sections (direct
 * children — no context needed). The route + chrome (Nav/Footer) stay server.
 *
 * NOTE: the sticky PARENTS|KIDS bar here is a TEMPORARY stand-in — Unit 5
 * replaces it with the real sticky anchor sub-nav + scroll-spy that carries the
 * audience toggle. It is kept minimal but works (radiogroup, arrow keys).
 */
export default function ProgramContent({ seatsRemaining }: { seatsRemaining: number }) {
  const [audience, setAudience] = useState<Audience>("parents");
  const [group, setGroup] = useState<GroupKey>("the120");

  const onAudienceKeyDown = (e: React.KeyboardEvent, index: number) => {
    let next = index;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (index + 1) % AUDIENCES.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      next = (index - 1 + AUDIENCES.length) % AUDIENCES.length;
    else return;
    e.preventDefault();
    setAudience(AUDIENCES[next].key);
    const btn = e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
      '[role="radio"]'
    )[next];
    btn?.focus();
  };

  return (
    <main className="flex-1">
      {/* TEMPORARY audience toggle — Unit 5 replaces this with the sub-nav */}
      <div className="sticky top-[92px] z-40 mx-5 mt-2">
        <div className="flex items-center justify-end rounded-[14px] border border-line bg-white px-[22px] py-2.5 shadow-[0_4px_18px_rgba(19,20,22,0.14)]">
          <div
            role="radiogroup"
            aria-label="Choose audience"
            className="flex gap-0.5 rounded-full border border-line-strong p-0.5"
          >
            {AUDIENCES.map((a, i) => {
              const checked = a.key === audience;
              return (
                <button
                  key={a.key}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  tabIndex={checked ? 0 : -1}
                  onClick={() => setAudience(a.key)}
                  onKeyDown={(e) => onAudienceKeyDown(e, i)}
                  className={`rounded-full px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors ${
                    checked ? "bg-ink text-white" : "text-ink-soft hover:text-ink"
                  }`}
                >
                  {a.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <Hero group={group} setGroup={setGroup} />
      <YearAtAGlance audience={audience} />
      <WhoTheyBecome audience={audience} />
      <Coaching audience={audience} />
      <ReadWidely audience={audience} />
      <Schedule audience={audience} />
      <CoreLoop audience={audience} />
      <SkillTrack audience={audience} />
      <ThePath audience={audience} />
      <MidPageCta audience={audience} />
      <MathSection audience={audience} />
      <EndOfYear audience={audience} />
      <RedCtaBand audience={audience} seatsRemaining={seatsRemaining} />
    </main>
  );
}
