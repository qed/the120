import { describe, expect, it } from "vitest";
import {
  activeSectionFor,
  ACTIVE_LINE_OFFSET,
  type SectionOffset,
} from "../scrollspy";

// A realistic-ish layout: ten sections stacked down a long page, where the last
// ("end") is deliberately SHORT and near the bottom — the case that trips the
// classic "last section never activates" bug.
const OFFSETS: SectionOffset[] = [
  { id: "year", top: 800 },
  { id: "become", top: 1800 },
  { id: "coaching", top: 2900 },
  { id: "books", top: 4200 },
  { id: "schedule", top: 5400 },
  { id: "loop", top: 6600 },
  { id: "skills", top: 7700 },
  { id: "path", top: 9000 },
  { id: "math", top: 10200 },
  { id: "end", top: 11000 }, // short last section (page bottom ~11120)
];

describe("activeSectionFor", () => {
  it("defaults to the first section at the very top of the page (in the hero)", () => {
    // scrollY 0: nothing has crossed the line yet, but we still report exactly one.
    expect(activeSectionFor(OFFSETS, 0)).toBe("year");
    // Still in the hero, just above where `year` crosses the line.
    expect(activeSectionFor(OFFSETS, 800 - ACTIVE_LINE_OFFSET - 1)).toBe("year");
  });

  it("activates a section the moment its top crosses the line", () => {
    // `year` top (800) crosses the line exactly when scrollY = 800 - 170 = 630.
    expect(activeSectionFor(OFFSETS, 629)).toBe("year"); // first, by default
    expect(activeSectionFor(OFFSETS, 630)).toBe("year"); // year has now crossed
    // `become` top (1800) crosses at scrollY = 1630.
    expect(activeSectionFor(OFFSETS, 1629)).toBe("year");
    expect(activeSectionFor(OFFSETS, 1630)).toBe("become");
  });

  it("picks the lower section when the line sits between two sections", () => {
    // Line between `coaching` (2900) and `books` (4200): scrollY 3500 → line 3670.
    expect(activeSectionFor(OFFSETS, 3500)).toBe("coaching");
    // Just before `books` crosses (4200 - 170 = 4030).
    expect(activeSectionFor(OFFSETS, 4029)).toBe("coaching");
    expect(activeSectionFor(OFFSETS, 4030)).toBe("books");
  });

  it("mid-page returns the correct single section", () => {
    // scrollY 6700 → line 6870: `loop` (6600) crossed, `skills` (7700) not.
    expect(activeSectionFor(OFFSETS, 6700)).toBe("loop");
  });

  it("activates the short final section once its top crosses the line", () => {
    // `end` top (11000) crosses at scrollY = 10830 — reachable even though the
    // section itself is short. A range-based ([top,nextTop)) implementation
    // would fail to ever return `end`; the cumulative test does not.
    expect(activeSectionFor(OFFSETS, 10829)).toBe("math");
    expect(activeSectionFor(OFFSETS, 10830)).toBe("end");
    // Scrolled to the extreme bottom.
    expect(activeSectionFor(OFFSETS, 999999)).toBe("end");
  });

  it("returns exactly one id at every scroll position across the page", () => {
    const ids = new Set(OFFSETS.map((o) => o.id));
    for (let y = 0; y <= 12000; y += 25) {
      const active = activeSectionFor(OFFSETS, y);
      expect(ids.has(active)).toBe(true); // always a real, single id
    }
  });

  it("does not depend on input ordering", () => {
    const shuffled = [...OFFSETS].reverse();
    expect(activeSectionFor(shuffled, 6700)).toBe("loop");
    expect(activeSectionFor(shuffled, 0)).toBe("year");
    expect(activeSectionFor(shuffled, 999999)).toBe("end");
  });

  it("honours a custom threshold", () => {
    // With a zero threshold the active line is the viewport top itself.
    expect(activeSectionFor(OFFSETS, 800, 0)).toBe("year");
    expect(activeSectionFor(OFFSETS, 799, 0)).toBe("year"); // default-to-first
    expect(activeSectionFor(OFFSETS, 1800, 0)).toBe("become");
  });

  it("returns an empty string when there are no sections", () => {
    expect(activeSectionFor([], 0)).toBe("");
  });
});
