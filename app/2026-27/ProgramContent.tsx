"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { SUBNAV, type GroupKey } from "./data";
import type { Audience } from "./cta-source";
import { useScrollSpy } from "./useScrollSpy";
import SubNav from "./SubNav";
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

/** The ten scroll-spy section ids, stable for the island's life. */
const SECTION_IDS = SUBNAV.map((s) => s.id);

/** The sub-nav/toggle anchor whose viewport position is pinned across a voice swap. */
const ANCHOR_ID = "audience-toggle";

/**
 * `useLayoutEffect` runs before paint on the client but warns during SSR; select
 * `useEffect` on the server so the prerender is quiet. (Same hook every render
 * within a given environment — Rules of Hooks safe.)
 */
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * The single client island for /2026-27. Owns the cross-cutting `audience` and
 * hero `group` state and passes them as props to flat child sections (direct
 * children — no context needed). The route + chrome (Nav/Footer) stay server.
 *
 * Unit 5 wires in the real navigation primitive: the sticky anchor sub-nav with
 * scroll-spy (which carries the PARENTS|KIDS control), the voice-swap scroll
 * anchor, and a single polite announcer.
 */
export default function ProgramContent({ seatsRemaining }: { seatsRemaining: number }) {
  const [audience, setAudience] = useState<Audience>("parents");
  const [group, setGroup] = useState<GroupKey>("the120");
  const activeId = useScrollSpy(SECTION_IDS);

  // Voice-swap scroll anchoring: record the reader's current section's viewport
  // top the instant a switch is requested, then after the DOM reflows to the
  // other voice, scroll by the delta so that section (and the reader's place)
  // stays put despite the height change. We anchor to the active *section* (in
  // normal flow), not the sticky toggle — a sticky element's viewport top never
  // moves, so it can't preserve the reading position. Falls back to the toggle
  // only if the active section can't be found.
  const swapAnchor = useRef<{ id: string; top: number } | null>(null);

  const changeAudience = (next: Audience) => {
    if (next === audience) return;
    const anchorId = document.getElementById(activeId) ? activeId : ANCHOR_ID;
    const el = document.getElementById(anchorId);
    swapAnchor.current = el ? { id: anchorId, top: el.getBoundingClientRect().top } : null;
    setAudience(next);
  };

  useIsomorphicLayoutEffect(() => {
    const anchor = swapAnchor.current;
    swapAnchor.current = null;
    if (!anchor) return; // initial mount / no pending swap
    const el = document.getElementById(anchor.id);
    if (!el) return;
    const delta = el.getBoundingClientRect().top - anchor.top;
    if (delta !== 0) window.scrollBy(0, delta);
  }, [audience]);

  return (
    <main className="flex-1">
      {/* One polite announcer for the whole page — the big content containers are
          NOT marked live. Its text only changes on an audience switch, so it
          announces the swap exactly once (and stays silent on first render). */}
      <div role="status" aria-live="polite" className="sr-only">
        {audience === "kids" ? "Showing content for kids" : "Showing content for parents"}
      </div>

      <SubNav audience={audience} setAudience={changeAudience} activeId={activeId} />

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
