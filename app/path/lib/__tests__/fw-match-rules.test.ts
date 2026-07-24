import { describe, expect, it } from "vitest";

import {
  matchFwStudent,
  type FwMatchCandidate,
  type FwMatchVerdict,
} from "../fw-match-rules";
import { buildNormalizedFwName } from "../fw-provision-rules";

/**
 * PROPOSED-1's matching module (FW Unit 4; accepted 2026-07-23), written BEFORE
 * the module — it is pure decision logic and Units 5b and 7 consume it too, so
 * it belongs under test before any UI reads it.
 *
 * The two properties that carry real consequences, and are therefore asserted
 * structurally rather than by reading the copy:
 *
 *   1. A SAME-COHORT match returns enough for a human to confirm identity (the
 *      band), because the guide is standing with the child and can settle it.
 *   2. A CROSS-COHORT-ONLY match returns a signal and NOTHING ELSE — no band, no
 *      city, no date, no profile id. The guide at Boston has no business
 *      learning anything about a child at Hamptons, and "confirm with staff" is
 *      the whole intended affordance.
 */

const BOSTON = "cohort-boston";
const HAMPTONS = "cohort-hamptons";

const candidate = (over: Partial<FwMatchCandidate> = {}): FwMatchCandidate => ({
  profileId: "profile-1",
  normalizedName: buildNormalizedFwName("Maya", "Chen"),
  band: "g6_8",
  cohortIds: [BOSTON],
  source: "profile",
  ...over,
});

const match = (
  candidates: readonly FwMatchCandidate[],
  name: [string, string] = ["Maya", "Chen"],
  cohortId = BOSTON
): FwMatchVerdict =>
  matchFwStudent({ firstName: name[0], lastName: name[1], cohortId, candidates });

/* ════════════════════════════════════════════════════════════ no match at all ══ */

describe("no match", () => {
  it("returns `none` for an empty candidate list — 'New student' is the path", () => {
    expect(match([])).toEqual({ kind: "none" });
  });

  it("returns `none` when no candidate's normalized name equals the query's", () => {
    expect(match([candidate({ normalizedName: buildNormalizedFwName("Maia", "Chen") })])).toEqual({
      kind: "none",
    });
  });

  it("never treats a blank stored key as a wildcard that matches everyone", () => {
    // fw-provision-rules returns "" when nothing survives folding. A candidate
    // row carrying "" (a pre-normalization row, a bad import) must match NOBODY
    // — otherwise the first walk-in of the weekend is "confirmed" as that row.
    expect(match([candidate({ normalizedName: "" })])).toEqual({ kind: "none" });
  });
});

/* ══════════════════════════════════════════════════════════ same-cohort match ══ */

describe("same-cohort match — the full confirm card", () => {
  it("returns the match with its band, so the guide can settle identity at the table", () => {
    expect(match([candidate({ profileId: "p-maya", band: "g9_12" })])).toEqual({
      kind: "same_cohort",
      matches: [{ profileId: "p-maya", band: "g9_12", source: "profile" }],
    });
  });

  it("matches on the SHARED normalization, so typing variance still finds the child", () => {
    // Both sides fold through buildNormalizedFwName — one normalization for both
    // sides of every comparison. `Jean-Luc` and `Jean Luc` are one student.
    const stored = candidate({
      profileId: "p-jl",
      normalizedName: buildNormalizedFwName("Jean-Luc", "O'Brien"),
    });
    expect(match([stored], ["Jean Luc", "OBrien"])).toEqual({
      kind: "same_cohort",
      matches: [{ profileId: "p-jl", band: "g6_8", source: "profile" }],
    });
  });

  it("returns EVERY same-cohort match — two real children can share a name", () => {
    const verdict = match([
      candidate({ profileId: "p-1", band: "g3_5" }),
      candidate({ profileId: "p-2", band: "g9_12" }),
    ]);
    expect(verdict.kind).toBe("same_cohort");
    if (verdict.kind !== "same_cohort") throw new Error("unreachable");
    expect(verdict.matches.map((m) => m.profileId)).toEqual(["p-1", "p-2"]);
    // The bands are what disambiguate them on the card.
    expect(verdict.matches.map((m) => m.band)).toEqual(["g3_5", "g9_12"]);
  });

  it("matches a PENDING import-exception row too (G7) and says so", () => {
    // An unresolved import exception is a child staff already knows about.
    // Missing it would mint a second account for them at the check-in table.
    expect(
      match([candidate({ profileId: "x-7", source: "import_exception" })])
    ).toEqual({
      kind: "same_cohort",
      matches: [{ profileId: "x-7", band: "g6_8", source: "import_exception" }],
    });
  });

  it("a returner already in THIS cohort is a same-cohort match, not a cross-cohort one", () => {
    expect(match([candidate({ cohortIds: [HAMPTONS, BOSTON] })]).kind).toBe("same_cohort");
  });

  it("prefers same-cohort over cross-cohort when both exist", () => {
    // The child is standing here. "Confirm with staff" would be the wrong copy
    // for a student whose membership row the guide can see.
    const verdict = match([
      candidate({ profileId: "p-here", cohortIds: [BOSTON] }),
      candidate({ profileId: "p-elsewhere", cohortIds: [HAMPTONS] }),
    ]);
    expect(verdict).toEqual({
      kind: "same_cohort",
      matches: [{ profileId: "p-here", band: "g6_8", source: "profile" }],
    });
  });
});

/* ═════════════════════════════════════════════════════════ cross-cohort match ══ */

describe("cross-cohort-only match — the minimal signal", () => {
  it("says only that something was found, and how many", () => {
    expect(match([candidate({ cohortIds: [HAMPTONS] })])).toEqual({
      kind: "cross_cohort",
      count: 1,
    });
  });

  it("counts every cross-cohort candidate", () => {
    expect(
      match([
        candidate({ profileId: "p-1", cohortIds: [HAMPTONS] }),
        candidate({ profileId: "p-2", cohortIds: ["cohort-chicago"] }),
      ])
    ).toEqual({ kind: "cross_cohort", count: 2 });
  });

  it("a candidate with NO memberships at all is cross-cohort, never same-cohort", () => {
    // A minted-but-unenrolled profile (a half-run import, an anonymize in
    // flight). Treating it as same-cohort would offer to route a guide into a
    // student who has no membership row for the stamp Decision 3 verifies.
    expect(match([candidate({ cohortIds: [] })])).toEqual({ kind: "cross_cohort", count: 1 });
  });

  it("LEAKS NOTHING: the serialized payload contains no band, id, name, or cohort", () => {
    // The structural assertion the plan asks for. Written over the SERIALIZED
    // verdict rather than by naming fields, so adding a leaky field later fails
    // this test instead of quietly passing a shape check.
    const verdict = match([
      candidate({
        profileId: "p-secret",
        band: "g9_12",
        cohortIds: [HAMPTONS],
        normalizedName: buildNormalizedFwName("Maya", "Chen"),
      }),
    ]);
    const payload = JSON.stringify(verdict);
    for (const leak of ["p-secret", "g9_12", HAMPTONS, "maya", "chen"]) {
      expect(payload).not.toContain(leak);
    }
    // …and what it DOES carry is exactly two keys.
    expect(Object.keys(verdict).sort()).toEqual(["count", "kind"]);
  });
});

/* ═══════════════════════════════════════════════════════════════ bad input ══ */

describe("names the matcher refuses to key on", () => {
  it("refuses a name that folds to nothing — never a blank key that matches all", () => {
    expect(match([candidate()], ["   ", "Chen"])).toEqual({ kind: "invalid_name" });
    expect(match([candidate()], ["Maya", ""])).toEqual({ kind: "invalid_name" });
  });

  it("refuses homoglyphs rather than keying on a quietly different name", () => {
    // Cyrillic а. buildNormalizedFwName throws; a matcher that swallowed the
    // throw would return `none` and mint a second Maya Chen with a near-miss
    // address — the exact failure fw-provision-rules refuses at the door.
    expect(match([candidate()], ["Mаya", "Chen"])).toEqual({ kind: "invalid_name" });
  });

  it("refuses a control/format character in the name", () => {
    expect(match([candidate()], ["Ma‮ya", "Chen"])).toEqual({ kind: "invalid_name" });
  });

  it("refuses before it reads the candidate list at all", () => {
    // No candidates needed: an unkeyable name cannot match anything, and the
    // form should say so before the guide taps Create.
    expect(match([], ["", ""])).toEqual({ kind: "invalid_name" });
  });
});
