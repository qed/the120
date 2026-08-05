import { describe, expect, it } from "vitest";
import {
  IMAGE_LAB_NAV,
  IMAGE_LAB_BENCH_COPY,
  IMAGE_LAB_HUB_COPY,
  imageLabCardLine,
  imageLabGenerationNotice,
} from "../shell-rules";

/**
 * The Image Lab shell's pure decisions (first-profit repo:
 * docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md, Unit 3).
 *
 * Small, and deliberately still here rather than inlined into three `page.tsx`
 * files: with no jsdom in this suite, a ternary written in a page is a decision
 * CI cannot see (`app/staff/lib/hub-rules.ts` exists for exactly this reason).
 * The two decisions below are the same fact — is generation on — rendered on two
 * different surfaces, and the property that matters is that they cannot disagree.
 *
 * That the pages actually CALL these, with the right arguments, is a separate
 * property and is pinned in `../../__tests__/gate-enforcement.test.ts`.
 */

describe("navigation", () => {
  it("resolves every segment to its own /staff/image-lab route, in launch order", () => {
    // Exact hrefs in exact order. The nav table is a Record over the segment
    // union, so "every segment has an entry" is a COMPILE error rather than a
    // test; what a test can still catch is a wrong or duplicated path.
    expect(IMAGE_LAB_NAV.map((link) => [link.segment, link.href])).toEqual([
      ["bench", "/staff/image-lab"],
      ["history", "/staff/image-lab/history"],
      ["kit", "/staff/image-lab/kit"],
    ]);
    const hrefs = IMAGE_LAB_NAV.map((link) => link.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("the generation notice is stated in BOTH states", () => {
  it("flag off → an explicit off notice that names the flag and the consequence", () => {
    const notice = imageLabGenerationNotice(false);
    expect(notice.tone).toBe("off");
    expect(notice.headline).toBe(IMAGE_LAB_BENCH_COPY.generationOff.headline);
    // Naming the variable is the difference between a notice a staff member can
    // ACT on and one that only tells them something is wrong.
    expect(notice.body).toContain("IMAGE_LAB_LIVE");
    // …and it says the bench still opens, so "off" is not read as "broken".
    expect(notice.body).toMatch(/not call a model/);
  });

  it("the off notice does NOT claim the variable is unset", () => {
    // `isImageLabLive` is a strict allowlist, so this branch is also what
    // IMAGE_LAB_LIVE=on / =yes / =enabled / a value that kept its quotes
    // produces — the variable IS set. A notice asserting "not set" sends the
    // operator to chase env propagation instead of the value they typed.
    const body = imageLabGenerationNotice(false).body;
    expect(body).not.toMatch(/IMAGE_LAB_LIVE is not set(?! to)/);
    // It says what "on" actually requires, so the fix is readable off the page.
    expect(body).toMatch(/not set to 1 or true/);
  });

  it("flag on → an on notice that says runs are billed", () => {
    const notice = imageLabGenerationNotice(true);
    expect(notice.tone).toBe("on");
    expect(notice.headline).toBe(IMAGE_LAB_BENCH_COPY.generationOn.headline);
    expect(notice.body).toContain("billed");
  });

  it("never returns null or an empty notice — silence is not a state", () => {
    // The regression this pins: "only render the banner when it is off". An
    // indicator that appears only on the bad state cannot be told apart from one
    // that failed to render, and it never teaches what "on" looks like.
    for (const isLive of [true, false]) {
      const notice = imageLabGenerationNotice(isLive);
      expect(notice.headline.length).toBeGreaterThan(0);
      expect(notice.body.length).toBeGreaterThan(0);
    }
  });
});

describe("the hub card says it first", () => {
  it("the off line says generation is off, in words, on the card", () => {
    // R1's practical half: staff learn the bench is switched off BEFORE
    // navigating in, not after composing a prompt.
    expect(imageLabCardLine(false)).toMatch(/generation is off/i);
    expect(imageLabCardLine(true)).not.toMatch(/generation is off/i);
  });

  it("card and bench never disagree", () => {
    for (const isLive of [true, false]) {
      const cardSaysOn = imageLabCardLine(isLive) === IMAGE_LAB_HUB_COPY.generationOn;
      expect(cardSaysOn).toBe(imageLabGenerationNotice(isLive).tone === "on");
    }
  });
});
