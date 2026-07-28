import { describe, expect, it } from "vitest";

import { pathSteps } from "@/app/2026-27/data";
import {
  APPLICATION_REGISTER_CLASSES,
  FAQ_OPEN_EVENT,
  PROJECTION_LABEL,
  REVEAL_FAQ,
  emittedCopy,
  firstTasks,
  revealClimb,
  revealModel,
  shareCardModel,
  shareCardSvg,
  statCiteVerdict,
  statStrip,
} from "@/app/lib/funnel/reveal-rules";
import { QUIZ_BANDS } from "@/app/lib/funnel/quiz-rules";
import type { ComposedProject } from "@/app/lib/funnel/compose-rules";

/** U11 (R42–R45, R63): every scenario is a pure-function assertion on the
 *  rules module's return value — `environment: "node"` has no renderer. */

const project: ComposedProject = {
  name: "The Saturday Skills Clinic",
  description: "You coach younger kids every Saturday morning, with drills you design yourself.",
  offerSketch: "A one-hour session of drills.",
  firstCustomerHypothesis: "Your teammates' younger siblings.",
};

const model = revealModel({ project, band: "b68", skin: "hq", group: "athletes" });

describe("the five-phase climb (R43)", () => {
  it("returns SELL and BUILD complete, VALIDATE partial, GROW and SCALE dashed — in published order", () => {
    const climb = revealClimb();
    expect(climb.map((c) => c.key)).toEqual(["SELL", "BUILD", "VALIDATE", "GROW", "SCALE"]);
    expect(climb.map((c) => c.state)).toEqual([
      "complete",
      "complete",
      "partial",
      "projected",
      "projected",
    ]);
    expect(climb.filter((c) => c.dashed).map((c) => c.key)).toEqual(["GROW", "SCALE"]);
    for (const phase of climb) {
      expect(phase.percent).toBeGreaterThan(0);
      expect(phase.percent).toBeLessThanOrEqual(100);
    }
  });

  it("phase titles come from the published Path content, not a private copy", () => {
    const climb = revealClimb();
    for (const [i, phase] of climb.entries()) {
      expect(phase.title).toBe(pathSteps[i].title);
    }
  });

  it("the projection label is present for every band, and never claims achievement", () => {
    for (const band of QUIZ_BANDS) {
      const m = revealModel({ project, band, skin: band === "b35" ? "trail" : "hq", group: "makers" });
      if (m.kind !== "ok") throw new Error(m.kind);
      expect(m.projectionLabel).toBe(PROJECTION_LABEL[band]);
      expect(m.projectionLabel.length).toBeGreaterThan(20);
      // The label must SAY it is a projection (ahead / not yet / projected) —
      // wording varies by register, the disclaimer does not.
      expect(m.projectionLabel.toLowerCase()).toMatch(/project|ahead|not/);
    }
  });
});

describe("the stat strip (R43)", () => {
  it("every emitted stat cites a REAL published pass criterion containing its number", () => {
    const stats = statStrip();
    expect(stats.length).toBeGreaterThanOrEqual(3);
    for (const stat of stats) {
      expect(statCiteVerdict(stat), stat.label).toBe(true);
    }
  });

  it("an invented stat fails the citation verdict", () => {
    expect(
      statCiteVerdict({ value: "97", label: "percent of kids succeed", criterion: "97 percent succeed" })
    ).toBe(false);
    // A real criterion cited for a number it does not contain also fails.
    expect(
      statCiteVerdict({ value: "500", label: "dollars", criterion: pathSteps[0].criteria[0] })
    ).toBe(false);
  });

  it("the verdict matches numbers on word boundaries — coincidental substrings do not satisfy it", () => {
    // Pre-fix, all four of these PASSED: "1" via "one" inside "money",
    // "5"/"2" inside "25", "6" inside "60" (the adversarial review, by
    // execution). The guard exists to catch invented stats.
    const sale = pathSteps[0].criteria[1]; // "...real money changing hands..."
    const outreach = pathSteps[0].criteria[4]; // "...25 supervised outreach..."
    const pitch = pathSteps[0].criteria[0]; // "...60 seconds..."
    expect(statCiteVerdict({ value: "1", label: "sale", criterion: sale })).toBe(false);
    expect(statCiteVerdict({ value: "5", label: "attempts", criterion: outreach })).toBe(false);
    expect(statCiteVerdict({ value: "2", label: "attempts", criterion: outreach })).toBe(false);
    expect(statCiteVerdict({ value: "6", label: "seconds", criterion: pitch })).toBe(false);
  });
});

describe("the first three tasks (R42)", () => {
  it("exactly three bubbles, each with one project-customised sentence and a mono task id", () => {
    const tasks = firstTasks(project);
    expect(tasks).toHaveLength(3);
    expect(tasks.map((t) => t.id)).toEqual(["T1", "T2", "T3"]);
    for (const t of tasks) {
      expect(t.line).toContain(project.name);
      // One sentence is a property of the TEMPLATE, so judge it with the
      // name replaced — a legitimate name may carry its own periods.
      const template = t.line.replace(project.name, "X");
      expect(template.split(/[.!?]/).filter((s) => s.trim().length > 0)).toHaveLength(1);
    }
  });

  it("a name with trailing punctuation does not double up against the template's full stop", () => {
    const tasks = firstTasks({ ...project, name: "K.C. Dog Walking Co." });
    for (const t of tasks) {
      expect(t.line).not.toMatch(/\.\./);
      expect(t.line).toContain("K.C. Dog Walking Co");
    }
  });

  it("step 2 is strictly first product plus ONE person paying — no revenue talk", () => {
    const t2 = firstTasks(project)[1];
    expect(t2.line.toLowerCase()).toContain("one person");
    expect(t2.line).not.toMatch(/\$\s?\d/);
  });

  it("an empty project name falls back to neutral copy rather than an empty slot", () => {
    const tasks = firstTasks({ ...project, name: "  " });
    for (const t of tasks) expect(t.line).toContain("your project");
  });
});

describe("the close (R44) and the FAQ", () => {
  it("all four FAQ rows are closed by default, and the open-event seam is named for U16", () => {
    expect(REVEAL_FAQ).toHaveLength(4);
    for (const row of REVEAL_FAQ) expect(row.defaultOpen).toBe(false);
    expect(FAQ_OPEN_EVENT).toBe("reveal_faq_opened");
  });

  it("the close renders in the application register — a nested swap with complete literal classes", () => {
    expect(model.kind).toBe("ok");
    if (model.kind !== "ok") return;
    expect(model.cta).toBe("Continue Application →");
    expect(APPLICATION_REGISTER_CLASSES).toBe("bg-paper text-ink");
  });
});

describe("the share card (R45, R40b)", () => {
  it("is parent-only, carries only cited stats, and renders the CRESTS the requirement names", () => {
    const card = shareCardModel(project, "athletes");
    expect(card.audience).toBe("parent");
    for (const stat of card.stats) expect(statCiteVerdict(stat)).toBe(true);
    // R45: "project name, crests, and stat strip" — one heraldic crest per
    // cited criterion, and the shield artwork actually present in the SVG.
    expect(card.crests).toHaveLength(card.stats.length);
    const svg = shareCardSvg(card);
    const shields = svg.match(/M50 6 L86 18/g) ?? [];
    expect(shields).toHaveLength(card.crests.length);
  });

  it("fits the 600px canvas: the name is capped and the excerpt wraps into bounded lines", () => {
    const card = shareCardModel(
      {
        ...project,
        name: "The Extremely Long Project Name That A Family Might Type In Full",
        description: Array(60).fill("word").join(" "),
      },
      "makers"
    );
    expect(card.name.length).toBeLessThanOrEqual(36);
    const svg = shareCardSvg(card);
    // Every excerpt line the SVG renders is short enough for one line.
    const lines = [...svg.matchAll(/font-size="15"[^>]*>([^<]*)</g)].map((m) => m[1]);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThanOrEqual(3);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(52);
  });

  it("strips XML-invalid control characters: a BEL in a crafted edit must not corrupt the download", () => {
    const svg = shareCardSvg(
      shareCardModel(
        { ...project, name: "Bell Co", description: "linebreakform" },
        "givers"
      )
    );
    expect(svg).not.toMatch(/[ --]/);
  });

  it("ESCAPES project fields at the SVG render surface — the admissions-inbox injection, not repeated", () => {
    const hostile = shareCardModel(
      {
        ...project,
        name: `<script>alert(1)</script> "quoted" & <img>`,
        description: `</text><rect onload="x"/>`,
      },
      "makers"
    );
    const svg = shareCardSvg(hostile);
    expect(svg).not.toContain("<script>");
    expect(svg).not.toContain("<img>");
    expect(svg).not.toContain(`onload="x"`);
    expect(svg).toContain("&lt;script&gt;");
  });

  it("shortest and longest plausible AI output both produce a valid model — the cap is a request, not a guarantee", () => {
    const shortest = revealModel({
      project: { name: "A", description: "B.", offerSketch: "C.", firstCustomerHypothesis: null },
      band: "b35",
      skin: "trail",
      group: "givers",
    });
    expect(shortest.kind).toBe("ok");
    // The surrogate boundary is REAL here: the 140th UTF-16 code unit falls
    // inside the emoji, so a naive slice would strand a lone surrogate.
    const longest = revealModel({
      project: {
        ...project,
        description: "x".repeat(139) + "\u{1F600} and plenty more words after the boundary",
      },
      band: "b912",
      skin: "hq",
      group: "scholars",
    });
    if (longest.kind !== "ok") throw new Error(longest.kind);
    expect(longest.shareCard.excerpt.length).toBeLessThanOrEqual(140);
    expect(longest.shareCard.excerpt.isWellFormed()).toBe(true);
    expect(longest.shareCard.excerpt.length).toBe(139);
  });
});

describe("the whole model", () => {
  it("refuses a child with no composed project rather than returning a partial model", () => {
    expect(revealModel({ project: null, band: "b68", skin: "hq", group: "athletes" })).toEqual({
      kind: "no_project",
    });
  });

  it("copy rules hold across the WHOLE emitted copy set (R63): no em dashes, no 'failed', no 'sealed', no promised outcomes, no emoji", () => {
    for (const band of QUIZ_BANDS) {
      const m = revealModel({ project, band, skin: "hq", group: "founders" });
      for (const copy of emittedCopy(m)) {
        expect(copy, copy).not.toContain("—");
        expect(copy.toLowerCase(), copy).not.toMatch(/\bfail(ed|ure)?\b/);
        expect(copy.toLowerCase(), copy).not.toContain("sealed");
        expect(copy.toLowerCase(), copy).not.toMatch(/will (earn|make)|guaranteed/);
        expect(copy, copy).not.toMatch(/\p{Extended_Pictographic}/u);
      }
    }
  });
});
