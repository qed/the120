// Pure scroll-spy math for the /2026-27 sticky sub-nav. No DOM, no React — it is
// unit-tested in `node` (repo canon: pure `.test.ts`). The `useScrollSpy` hook
// measures the real section offsets from the DOM and defers the decision here.

/** A section's id paired with its top edge in document (page) coordinates. */
export interface SectionOffset {
  /** The target section id (also the URL fragment, without "#"). */
  id: string;
  /** The section's top, in px from the top of the document. */
  top: number;
}

/**
 * Distance (px) from the viewport top down to the "active line". A section
 * becomes active once its top scrolls above this line, which is placed just
 * below the floating Nav + sub-nav chrome. Matches the prototype's
 * `window.scrollY + 170`.
 */
export const ACTIVE_LINE_OFFSET = 170;

/**
 * The id of the section currently under the active line.
 *
 * Returns the id of the LAST section whose `top` has passed `scrollY + threshold`
 * — a cumulative test, not a `[top, nextTop)` range test. That is what makes a
 * short final section still activate the instant its top crosses the line (the
 * classic "the last section never highlights" bug), and it guarantees exactly
 * one id at every scroll position:
 *   - above the first section (top of page / in the hero) → the first id
 *   - anywhere below → the last section whose top has crossed the line
 *
 * `offsets` need not be pre-sorted; entries are ordered by `top` internally and
 * ties resolve to the later one.
 */
export function activeSectionFor(
  offsets: SectionOffset[],
  scrollY: number,
  threshold: number = ACTIVE_LINE_OFFSET
): string {
  if (offsets.length === 0) return "";
  const line = scrollY + threshold;
  const sorted = [...offsets].sort((a, b) => a.top - b.top);
  // Default to the first section so there is always exactly one active id, even
  // while the reader is still above the first section (scrolling the hero).
  let active = sorted[0].id;
  for (const { id, top } of sorted) {
    if (top <= line) active = id;
  }
  return active;
}
