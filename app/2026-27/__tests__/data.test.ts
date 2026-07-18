import { describe, expect, it } from "vitest";
import {
  COPY,
  bookTracks,
  pathSteps,
  pathStepsKid,
  workshopDates,
  groupLines,
  SUBNAV,
  type PathPhaseKey,
} from "../data";

/**
 * Recursively collect the full key path set of a value, so nested objects are
 * compared structurally rather than only at the top level. Arrays index by
 * position; primitives contribute no keys.
 */
function keyPaths(value: unknown, prefix = ""): Set<string> {
  const out = new Set<string>();
  if (value === null || typeof value !== "object") return out;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    out.add(path);
    for (const nested of keyPaths(v, path)) out.add(nested);
  }
  return out;
}

/** Every string leaf reachable from a value, for content assertions. */
function collectStrings(value: unknown, acc: string[] = []): string[] {
  if (typeof value === "string") {
    acc.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, acc);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectStrings(v, acc);
  }
  return acc;
}

const PHASES: PathPhaseKey[] = ["SELL", "BUILD", "VALIDATE", "GROW", "SCALE"];

describe("COPY — two-voice key parity (the toggle invariant)", () => {
  it("parents and kids expose identical deep key sets", () => {
    const parentKeys = [...keyPaths(COPY.parents)].sort();
    const kidKeys = [...keyPaths(COPY.kids)].sort();
    expect(kidKeys).toEqual(parentKeys);
  });

  it("has a non-trivial number of keys in each voice", () => {
    // Guards against an accidentally-empty voice passing the parity check.
    expect(Object.keys(COPY.parents).length).toBeGreaterThan(50);
    expect(Object.keys(COPY.kids).length).toBe(Object.keys(COPY.parents).length);
  });

  it("has no empty string in either voice", () => {
    for (const voice of [COPY.parents, COPY.kids]) {
      for (const [key, val] of Object.entries(voice)) {
        expect(val, `COPY value for "${key}"`).toBeTypeOf("string");
        expect(val.trim().length, `COPY value for "${key}"`).toBeGreaterThan(0);
      }
    }
  });
});

describe("bookTracks — 3 tracks × 5 phase-groups × 4 books", () => {
  it("has exactly 3 grade tracks", () => {
    expect(bookTracks).toHaveLength(3);
  });

  it("each track has 5 phase-groups in SELL→BUILD→VALIDATE→GROW→SCALE order", () => {
    for (const track of bookTracks) {
      expect(track.groups.map((g) => g.step)).toEqual(PHASES);
    }
  });

  it("each phase-group has exactly 4 books with non-empty title + author", () => {
    for (const track of bookTracks) {
      for (const group of track.groups) {
        expect(group.books, `${track.id} · ${group.step}`).toHaveLength(4);
        for (const book of group.books) {
          expect(book.title.trim().length).toBeGreaterThan(0);
          expect(book.author.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("pathSteps / pathStepsKid — 5 phases × 5 criteria", () => {
  it("pathSteps has 5 phases keyed SELL→BUILD→VALIDATE→GROW→SCALE, 5 criteria each", () => {
    expect(pathSteps).toHaveLength(5);
    expect(pathSteps.map((s) => s.key)).toEqual(PHASES);
    for (const step of pathSteps) {
      expect(step.criteria, step.key).toHaveLength(5);
      for (const c of step.criteria) expect(c.trim().length).toBeGreaterThan(0);
    }
  });

  it("pathStepsKid has 5 phases with 5 criteria each", () => {
    expect(pathStepsKid).toHaveLength(5);
    for (const [i, step] of pathStepsKid.entries()) {
      expect(step.criteria, `kid phase ${i + 1}`).toHaveLength(5);
      for (const c of step.criteria) expect(c.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("workshopDates — 19 dated + 1 TBD, with Demo Days", () => {
  it("has 20 entries", () => {
    expect(workshopDates).toHaveLength(20);
  });

  it("has exactly 1 TBD (SPECIAL) entry and 19 dated entries", () => {
    const tbd = workshopDates.filter((d) => d.tbd);
    expect(tbd).toHaveLength(1);
    expect(tbd[0].label).toBe("SPECIAL");
    expect(workshopDates.filter((d) => !d.tbd)).toHaveLength(19);
  });

  it("has exactly 1 kickoff (Sep 19)", () => {
    const kickoff = workshopDates.filter((d) => d.kickoff);
    expect(kickoff).toHaveLength(1);
    expect(kickoff[0].label).toBe("SEP 19");
  });

  it("has exactly 4 ★ Demo Days", () => {
    const demoDays = workshopDates.filter((d) => d.mark === "★");
    expect(demoDays).toHaveLength(4);
    expect(demoDays.map((d) => d.label)).toEqual([
      "NOV 7",
      "MAR 6",
      "JUN 5",
      "JUN 19",
    ]);
  });
});

describe("groupLines / SUBNAV", () => {
  it("groupLines covers the 6 hero selections, each non-empty", () => {
    const keys = Object.keys(groupLines).sort();
    expect(keys).toEqual(
      ["athletes", "founders", "givers", "makers", "scholars", "the120"].sort()
    );
    for (const line of Object.values(groupLines)) {
      expect(line.trim().length).toBeGreaterThan(0);
    }
  });

  it("SUBNAV has 10 sections with the expected ids/labels in order", () => {
    expect(SUBNAV).toHaveLength(10);
    expect(SUBNAV.map((s) => s.id)).toEqual([
      "year",
      "become",
      "coaching",
      "books",
      "schedule",
      "loop",
      "skills",
      "path",
      "math",
      "end",
    ]);
    expect(SUBNAV.map((s) => s.label)).toEqual([
      "THE YEAR",
      "WHO THEY BECOME",
      "COACHING",
      "BOOKS",
      "SCHEDULE",
      "THE LOOP",
      "SKILLS",
      "THE PATH",
      "MATH",
      "END OF YEAR",
    ]);
  });
});

describe("content corrections", () => {
  it("no string in the module reads the wrong age range (9-16 / 9–16)", () => {
    const allStrings = collectStrings({
      COPY,
      bookTracks,
      pathSteps,
      pathStepsKid,
      workshopDates,
      groupLines,
      SUBNAV,
    });
    for (const s of allStrings) {
      expect(s.includes("9-16"), s).toBe(false);
      expect(s.includes("9–16"), s).toBe(false);
    }
  });
});
