import { describe, expect, it } from "vitest";

import {
  OWN_IDEA,
  QUIZ_BANDS,
  QUIZ_BLOCKER_COPY,
  QUIZ_FIELDS,
  TEMPLATES,
  parentAssist,
  quizBandForGrade,
  quizBlockers,
  quizForGroup,
  seedAnswers,
  templatesForGroup,
} from "@/app/lib/funnel/quiz-rules";
import { GROUP_SLUGS } from "@/app/lib/site";

/** U9's content package (R37, R38) — asserted over the WHOLE set, not a named
 *  fixture: the failure worth catching is one group's question or one band's
 *  phrasing quietly missing, which a sampled test never sees. */

describe("templates (§8.2, R37)", () => {
  it("ships exactly two per group, plus the one own-idea box", () => {
    for (const g of GROUP_SLUGS) {
      expect(templatesForGroup(g), g).toHaveLength(2);
    }
    expect(TEMPLATES).toHaveLength(10);
    expect(OWN_IDEA.id).toBe("own-idea");
  });

  it("carries the §8.2 shipping copy — pitch and first-customers, non-empty and distinct", () => {
    const pitches = new Set<string>();
    for (const t of TEMPLATES) {
      expect(t.pitch.length, t.id).toBeGreaterThan(40);
      expect(t.firstCustomers.length, t.id).toBeGreaterThan(5);
      pitches.add(t.pitch);
    }
    expect(pitches.size).toBe(TEMPLATES.length);
  });

  it("every template's seeds are a subset of the quiz fields, and never seed `spark`", () => {
    // spark is "why YOU" — the one answer no template may write for a child.
    for (const t of TEMPLATES) {
      for (const key of Object.keys(t.seeds)) {
        expect(QUIZ_FIELDS, `${t.id}:${key}`).toContain(key);
      }
      expect(t.seeds.spark, t.id).toBeUndefined();
    }
  });
});

describe("the quiz (§8.3, R38)", () => {
  it("returns four questions per group, every band phrased, over the whole set", () => {
    for (const g of GROUP_SLUGS) {
      const qs = quizForGroup(g);
      expect(qs, g).toHaveLength(4);
      expect(qs.map((q) => q.id)).toEqual(["what", "who", "offer", "spark"]);
      for (const q of qs) {
        for (const band of QUIZ_BANDS) {
          expect(q.phrasing[band]?.length, `${g}:${q.id}:${band}`).toBeGreaterThan(10);
          expect(q.suggestion[band]?.length, `${g}:${q.id}:${band}`).toBeGreaterThan(5);
        }
        // The three phrasings genuinely differ — one register copy-pasted
        // thrice would pass a presence check and fail the point.
        expect(new Set(QUIZ_BANDS.map((b) => q.phrasing[b])).size, `${g}:${q.id}`).toBe(3);
      }
    }
  });

  it("maps grades to phrasing bands at the boundaries", () => {
    expect(quizBandForGrade(3)).toBe("b35");
    expect(quizBandForGrade(5)).toBe("b35");
    expect(quizBandForGrade(6)).toBe("b68");
    expect(quizBandForGrade(8)).toBe("b68");
    expect(quizBandForGrade(9)).toBe("b912");
    expect(quizBandForGrade(12)).toBe("b912");
  });

  it("out-of-range grades take the HQ-matching register, never the parent-assist band", () => {
    // skinForGrade defaults invalid grades to the HQ chrome; the quiz must
    // not split registers by showing b35 phrasing + parent-assist inside it.
    for (const bad of [0, -1, 2, 13, 2.5, NaN]) {
      expect(quizBandForGrade(bad), String(bad)).toBe("b912");
    }
  });

  it("flags parent-assist for the Trail band only, naming the group", () => {
    for (const g of GROUP_SLUGS) {
      const flag = parentAssist(g, "b35");
      expect(flag, g).toBeTruthy();
      expect(flag, g).toContain(g.slice(0, -1));
      expect(parentAssist(g, "b68"), g).toBeNull();
      expect(parentAssist(g, "b912"), g).toBeNull();
    }
  });

  it("blocks progression on unanswered REQUIRED questions, with copy that avoids 'failed'", () => {
    const qs = quizForGroup("makers");
    expect(quizBlockers({}, qs)).toEqual(["what", "who", "offer"]);
    expect(quizBlockers({ what: "x", who: "y", offer: "z" }, qs)).toEqual([]);
    // spark is optional: leaving it empty blocks nothing.
    expect(quizBlockers({ what: "x", who: "y", offer: "z", spark: "" }, qs)).toEqual([]);
    expect(quizBlockers({ what: "   ", who: "y", offer: "z" }, qs)).toEqual(["what"]);
    expect(QUIZ_BLOCKER_COPY).not.toMatch(/fail/i);
  });

  it("a chosen template pre-seeds editable draft answers; own-idea feeds the same structure", () => {
    const seeded = seedAnswers("makers-commission", null);
    expect(seeded.what).toContain("commissions");
    expect(seeded.who).toBeTruthy();
    const own = seedAnswers(null, "  A robot that walks dogs  ");
    expect(own).toEqual({ what: "A robot that walks dogs" });
    expect(seedAnswers(null, null)).toEqual({});
    expect(seedAnswers("not-a-template", null)).toEqual({});
  });

  it("pins seedAnswers precedence: a valid template wins; an invalid one falls through to the own idea", () => {
    expect(seedAnswers("makers-commission", "my own text").what).toContain("commissions");
    expect(seedAnswers("not-a-template", "my own text")).toEqual({ what: "my own text" });
  });

  it("caps the own-idea seed at the ANSWER limit — the bigger box must not overflow the quiz field", () => {
    const seeded = seedAnswers(null, "z".repeat(800));
    expect(seeded.what).toHaveLength(400);
  });
});
