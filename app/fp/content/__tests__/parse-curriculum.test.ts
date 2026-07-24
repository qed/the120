import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseCurriculum,
  resolveVariant,
} from "@/app/fp/content/parse-curriculum";
import { BANDS, type Band } from "@/app/fp/content/types";

/**
 * The parser is the only thing standing between 785 lines of prose and every
 * surface in The Path. Its failure mode is a SILENT under-parse — a task
 * quietly missing, a band variant quietly empty — which is invisible at runtime
 * and only shows up as a child seeing the wrong instruction. So this suite
 * asserts against the real curriculum file, not a fixture.
 */

const SOURCE = readFileSync(
  path.resolve(
    process.cwd(),
    "artifacts/The Path/the-path-home-study-curriculum-brief.md"
  ),
  "utf8"
);

const program = parseCurriculum(SOURCE, "2026-27");
const allTasks = program.phases.flatMap((p) =>
  p.criteria.flatMap((c) => c.tasks)
);
const taskById = (id: string) => {
  const t = allTasks.find((x) => x.id === id);
  if (!t) throw new Error(`fixture task ${id} not parsed`);
  return t;
};

describe("structure", () => {
  it("parses exactly 5 phases, 25 criteria, 125 tasks", () => {
    expect(program.phases).toHaveLength(5);
    expect(program.phases.flatMap((p) => p.criteria)).toHaveLength(25);
    expect(allTasks).toHaveLength(125);
  });

  it("produces the published per-phase totals 25/26/24/25/25", () => {
    // Not uniform: Build carries an extra task, Validate one fewer. A parser
    // that assumed 25 everywhere would pass a total-only check.
    expect(
      program.phases.map((p) =>
        p.criteria.reduce((n, c) => n + c.tasks.length, 0)
      )
    ).toEqual([25, 26, 24, 25, 25]);
  });

  it("carries phase identity", () => {
    expect(program.phases.map((p) => p.key)).toEqual([
      "SELL",
      "BUILD",
      "VALIDATE",
      "GROW",
      "SCALE",
    ]);
    expect(program.phases.map((p) => p.num)).toEqual([
      "01",
      "02",
      "03",
      "04",
      "05",
    ]);
    expect(program.phases[0].subtitle).toBe(
      "Learn to confidently sell anything."
    );
  });

  it("gives every task a well-formed id matching its position", () => {
    for (const phase of program.phases) {
      for (const criterion of phase.criteria) {
        criterion.tasks.forEach((task, i) => {
          expect(task.id).toBe(`${criterion.id}.${i + 1}`);
          expect(task.seq).toBe(i + 1);
        });
      }
    }
  });

  it("gives every task a title, body and Done-when line", () => {
    for (const t of allTasks) {
      expect(t.title.length, `${t.id} title`).toBeGreaterThan(0);
      expect(t.body.length, `${t.id} body`).toBeGreaterThan(0);
      expect(t.doneWhen.length, `${t.id} doneWhen`).toBeGreaterThan(0);
    }
  });
});

describe("variable task counts — the case a hard-coded five would hide", () => {
  it("criterion 2.3 has six tasks", () => {
    const c = program.phases[1].criteria.find((x) => x.id === "2.3")!;
    expect(c.tasks).toHaveLength(6);
    expect(c.tasks.at(-1)!.id).toBe("2.3.6");
  });

  it("criterion 3.4 has four tasks", () => {
    const c = program.phases[2].criteria.find((x) => x.id === "3.4")!;
    expect(c.tasks).toHaveLength(4);
    expect(c.tasks.at(-1)!.id).toBe("3.4.4");
  });

  it("every other criterion has five", () => {
    const odd = program.phases
      .flatMap((p) => p.criteria)
      .filter((c) => c.tasks.length !== 5)
      .map((c) => c.id);
    expect(odd.sort()).toEqual(["2.3", "3.4"]);
  });
});

describe("a known task, parsed field by field", () => {
  const t = () => taskById("1.2.4");

  it("splits title from body", () => {
    expect(t().title).toBe("Ask until one yes.");
    expect(t().body).toContain("Work the prospect list");
    // The title must not bleed into the body.
    expect(t().body).not.toContain("Ask until one yes.");
  });

  it("captures the Done-when line without its label", () => {
    expect(t().doneWhen).toBe(
      "money from a non-family customer is in hand and the sale (who, what, amount, date) is logged."
    );
    expect(t().doneWhen).not.toContain("Done when");
  });

  it("captures all three band variants", () => {
    expect(t().bandVariants.g3_5).toContain("Parent physically present");
    expect(t().bandVariants.g6_8).toContain("Parent present but silent");
    expect(t().bandVariants.g9_12).toContain("Child runs the asks");
  });
});

describe("band variants — five source shapes, not three", () => {
  it("treats `As written.` as inheritance, never as text", () => {
    // 15 tasks carry `- **6–8:** As written.` The sentinel means "identical to
    // the base text". Storing it literally would show a Grade 7 child the words
    // "As written." where their instruction belongs.
    const sentinelTasks = ["1.1.3", "1.1.4"];
    for (const id of sentinelTasks) {
      expect(taskById(id).bandVariants.g6_8, id).toBeUndefined();
    }
    for (const t of allTasks) {
      for (const b of BANDS) {
        expect(t.bandVariants[b] ?? "", `${t.id}/${b}`).not.toMatch(
          /^as written\.?$/i
        );
      }
    }
  });

  it("expands a combined `6–8/9–12:` line to both bands", () => {
    // 1.2.2 in the source reads `- **6–8/9–12:** Child makes it.`-style; a
    // parser matching only single-band prefixes drops these entirely.
    const combined = allTasks.filter(
      (t) =>
        t.bandVariants.g6_8 !== undefined &&
        t.bandVariants.g6_8 === t.bandVariants.g9_12
    );
    expect(combined.length).toBeGreaterThanOrEqual(6);
  });

  it("expands a combined `3–5/6–8:` line to both bands", () => {
    const combined = allTasks.filter(
      (t) =>
        t.bandVariants.g3_5 !== undefined &&
        t.bandVariants.g3_5 === t.bandVariants.g6_8
    );
    expect(combined.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps `All bands:` guidance as a note, not as three fabricated variants", () => {
    // These often carry an inline addendum ("as written; **9–12** adds …").
    // Copying that into every band would show a Grade 4 child text addressed
    // to a Grade 11 one.
    const withNote = allTasks.filter((t) => t.allBandsNote !== undefined);
    expect(withNote.length).toBeGreaterThanOrEqual(60);
    for (const t of withNote) {
      expect(t.allBandsNote).not.toMatch(/^-\s*All bands:/i);
    }
  });

  it("leaves bands absent where the curriculum states no variant", () => {
    // "Where a band line is not listed for a task, the task is identical
    // across bands." Absence must be inheritance, never a parse failure.
    const noVariants = allTasks.filter(
      (t) => Object.keys(t.bandVariants).length === 0
    );
    expect(noVariants.length).toBeGreaterThan(0);
  });

  it("never stores an empty-string variant", () => {
    for (const t of allTasks) {
      for (const b of BANDS) {
        const v = t.bandVariants[b];
        if (v !== undefined) expect(v.trim(), `${t.id}/${b}`).not.toBe("");
      }
    }
  });
});

describe("resolveVariant", () => {
  it("returns the band's own line when present", () => {
    expect(resolveVariant(taskById("1.2.4"), "g3_5")).toContain(
      "Parent physically present"
    );
  });

  it("returns undefined when the task is identical across bands", () => {
    const identical = allTasks.find(
      (t) => Object.keys(t.bandVariants).length === 0
    )!;
    for (const b of BANDS) expect(resolveVariant(identical, b)).toBeUndefined();
  });

  it("returns undefined for a band whose only marker was the sentinel", () => {
    expect(resolveVariant(taskById("1.1.3"), "g6_8")).toBeUndefined();
  });
});

describe("completesCriterion", () => {
  it("marks the task whose Done-when closes the criterion", () => {
    expect(taskById("1.1.5").completesCriterion).toBe(true);
    expect(taskById("1.1.4").completesCriterion).toBe(false);
  });

  it("marks the last task of 2.3 (the six-task criterion), not its fifth", () => {
    expect(taskById("2.3.6").completesCriterion).toBe(true);
  });

  it("marks EXACTLY ONE task per criterion — 25 in total", () => {
    // The aggregate, not a hand-picked fixture. Spot-checking 1.1.5 and 2.3.6
    // passed while 5.5.5 — the task that completes The Path itself — was
    // silently false, because its closing marker is worded differently.
    for (const phase of program.phases) {
      for (const criterion of phase.criteria) {
        const closers = criterion.tasks.filter((t) => t.completesCriterion);
        expect(closers.map((t) => t.id), criterion.id).toHaveLength(1);
      }
    }
    expect(allTasks.filter((t) => t.completesCriterion)).toHaveLength(25);
  });

  it("marks 5.5.5 — the last task of the whole program", () => {
    // Its source line reads "**This completes the criterion — and The Path.**",
    // not the period-terminated wording the other 24 use.
    expect(taskById("5.5.5").completesCriterion).toBe(true);
  });

  it("always marks the criterion's LAST task, never an earlier one", () => {
    for (const phase of program.phases) {
      for (const criterion of phase.criteria) {
        const closer = criterion.tasks.find((t) => t.completesCriterion)!;
        expect(closer.id, criterion.id).toBe(criterion.tasks.at(-1)!.id);
      }
    }
  });
});

describe("text fidelity", () => {
  it("preserves the source's actual punctuation byte-for-byte", () => {
    const joined = allTasks
      .map((t) => `${t.title} ${t.body} ${t.doneWhen}`)
      .join(" ");
    // The curriculum uses em dashes (244), en dashes (235) and STRAIGHT
    // apostrophes (91) — it contains no curly quotes at all. That asymmetry is
    // exactly why reconciliation against app/2026-27/data.ts must be
    // structural: data.ts renders some of the same criteria with curly quotes.
    expect(joined).toContain("—");
    expect(joined).toContain("'");
    expect(joined).not.toMatch(/[“”’]/);
    // A mojibake round-trip through the wrong encoding would leave these.
    expect(joined).not.toContain("â€”");
    expect(joined).not.toContain("Ã©");
  });

  it("strips the closing marker from EVERY criterion-closing Done-when", () => {
    // Structural markers are not part of the bar a parent checks against. The
    // aggregate matters: an exact-match strip left 5.5.5's marker in place, so
    // the final task of the year showed a parent literal asterisks.
    for (const t of allTasks) {
      expect(t.doneWhen, t.id).not.toContain("This completes the criterion");
    }
  });

  it("leaves no markdown bold anywhere in a Done-when line", () => {
    for (const t of allTasks) {
      expect(t.doneWhen, t.id).not.toContain("**");
    }
  });

  it("leaves no markdown list bullets inside parsed prose", () => {
    for (const t of allTasks) {
      expect(t.body.startsWith("- "), t.id).toBe(false);
      expect(t.doneWhen.startsWith("- "), t.id).toBe(false);
    }
  });
});

describe("parse failures are loud", () => {
  it("throws when a criterion header is malformed", () => {
    const broken = SOURCE.replace(
      "## Criterion 1.2 —",
      "## Criterion ONE POINT TWO —"
    );
    expect(() => parseCurriculum(broken, "2026-27")).toThrow(/criterion/i);
  });

  it("throws when a task id does not follow its criterion", () => {
    const broken = SOURCE.replace("**1.2.4 —", "**9.9.9 —");
    expect(() => parseCurriculum(broken, "2026-27")).toThrow(/9\.9\.9|sequence/i);
  });

  it("throws when a task has no Done-when line", () => {
    const broken = SOURCE.replace(
      "*Done when:* money from a non-family customer",
      "money from a non-family customer"
    );
    expect(() => parseCurriculum(broken, "2026-27")).toThrow(/done when/i);
  });

  it("throws on a malformed phase header, not a misleading downstream error", () => {
    // Without a dedicated guard this surfaces much later as "Criterion out of
    // sequence", misdirecting whoever has to fix it.
    const broken = SOURCE.replace("# Phase 02 · BUILD", "# Phase 02 BUILD");
    expect(() => parseCurriculum(broken, "2026-27")).toThrow(/phase header/i);
  });

  // These edge-case throws use minimal synthetic documents rather than
  // mutating the real 785-line curriculum: a targeted replace is fragile (a
  // hyphen makes a line not-a-band-line rather than a bad label; a body
  // sentence has continuation text a naive cut leaves behind). The parser's
  // contract is under test, so a hand-built document exercises it precisely.
  const doc = (rest: string) =>
    "# Phase 01 · SELL — *Learn to confidently sell anything.*\n" +
    "## Criterion 1.1 — Some criterion\n" +
    rest;

  it("throws on a band label that matches the shape but isn't a real band", () => {
    // "1–2" (en dash, digits) matches the band-bullet regex but is no known
    // band — it must fail loudly, not store a variant under a bogus band.
    const broken = doc(
      "**1.1.1 — Title.** A body.\n*Done when:* x.\n- **1–2:** oops.\n"
    );
    expect(() => parseCurriculum(broken, "2026-27")).toThrow(
      /unrecognised band label/i
    );
  });

  it("throws when a criterion parses with zero tasks", () => {
    const broken = doc("(no task lines at all)\n");
    expect(() => parseCurriculum(broken, "2026-27")).toThrow(/zero tasks/i);
  });

  it("throws when a task body is empty", () => {
    // Title marker with nothing after it, no continuation before Done-when.
    const broken = doc("**1.1.1 — Title only.**\n*Done when:* something.\n");
    expect(() => parseCurriculum(broken, "2026-27")).toThrow(/empty body/i);
  });

  it("throws when no phases parse at all", () => {
    expect(() => parseCurriculum("just some prose\n", "2026-27")).toThrow(
      /No phases parsed/i
    );
  });

  it("handles CRLF input identically to LF", () => {
    // The file is CRLF on disk here; a parser keyed on "\n" alone would leave
    // a trailing \r on every field.
    const lf = parseCurriculum(SOURCE.replace(/\r\n/g, "\n"), "2026-27");
    expect(JSON.stringify(lf)).toBe(JSON.stringify(program));
    for (const t of lf.phases.flatMap((p) =>
      p.criteria.flatMap((c) => c.tasks)
    )) {
      expect(t.doneWhen).not.toContain("\r");
    }
  });
});

describe("band coverage matches the source's own counts", () => {
  const count = (b: Band) =>
    allTasks.filter((t) => t.bandVariants[b] !== undefined).length;

  it("resolves more variants than there are single-band lines", () => {
    // Single-band lines: 63 / 57 / 59. Combined lines add to two bands each,
    // and the 15 sentinels subtract from 6–8. If these came out equal to the
    // raw single-band counts, the combined forms were silently dropped.
    expect(count("g3_5")).toBe(63 + 2);
    expect(count("g6_8")).toBe(57 - 15 + 6 + 2);
    expect(count("g9_12")).toBe(59 + 6);
  });
});
