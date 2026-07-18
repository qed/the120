"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { activeSectionFor, type SectionOffset } from "./scrollspy";

/**
 * Track which sub-nav section is active as the page scrolls. Section tops are
 * re-measured from the DOM on every scroll/resize (so the maths stays correct
 * as content reflows or the voice swaps), and the active-id decision is handed
 * to the pure {@link activeSectionFor}.
 *
 * Highlight ONLY — this hook never moves focus and never announces; those are
 * reserved for explicit sub-nav link activation. Focus/announce on scroll would
 * hijack the reader (WAI-ARIA `aria-current` guidance).
 *
 * `ids` must be a stable reference (a module constant) so the scroll listener
 * subscribes exactly once. The per-frame measurement runs inside a React 19.2
 * `useEffectEvent`, which reads the latest `ids`/active id without forcing the
 * effect to re-subscribe.
 */
export function useScrollSpy(ids: string[]): string {
  const [activeId, setActiveId] = useState<string>(ids[0] ?? "");

  const measure = useEffectEvent(() => {
    const offsets: SectionOffset[] = [];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) offsets.push({ id, top: el.getBoundingClientRect().top + window.scrollY });
    }
    if (offsets.length === 0) return;

    // Bottom-of-page clamp: if the final (often short) section can never scroll
    // far enough for its top to cross the active line, force it active once the
    // page is scrolled to the very bottom — otherwise it would never highlight.
    const doc = document.documentElement;
    const atBottom =
      Math.ceil(window.scrollY + window.innerHeight) >= doc.scrollHeight - 1;

    const next = atBottom
      ? offsets[offsets.length - 1].id
      : activeSectionFor(offsets, window.scrollY);

    setActiveId((prev) => (prev === next ? prev : next));
  });

  useEffect(() => {
    // Sync the highlight after first paint (also handles deep-link landing on a
    // `#section`). Deferred to a frame so it is not a synchronous setState in the
    // effect body. `measure` is a stable effect event, so we subscribe once.
    const raf = requestAnimationFrame(() => measure());
    const onScrollOrResize = () => measure();
    window.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, []);

  return activeId;
}
