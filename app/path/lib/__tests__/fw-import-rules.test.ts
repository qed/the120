import { describe, expect, it } from "vitest";

import {
  DEFAULT_FW_IMPORT_CHUNK_SIZE,
  decideFwImportRowMatch,
  dedupeFwImportRows,
  parseFwImportCsv,
  planFwImportChunks,
  type FwImportParsedRow,
} from "../fw-import-rules";
import type { FwMatchCandidate } from "../fw-match-rules";
import { buildNormalizedFwName } from "../fw-provision-rules";

/**
 * The CSV importer's pure half (FW Unit 7; FW-R12, Decision 11, gaps G7/G19).
 *
 * Greenfield format with NO repo prior art, so — per the execution note — the
 * contract is pinned with AGGREGATE INVARIANTS (every input line accounted for,
 * counts reconcile), not fixture spot-checks. The spot-checks below exist only
 * to name the intended mapping; the load-bearing assertions are the
 * reconciliation ones (`accounts for every data line`, `unique + duplicates ==
 * rows`, `flatten(chunks) == rows`), which a whole class of parser bugs — a
 * dropped row, a double-counted one, a chunk that loses the tail — reddens.
 *
 * ── The column contract, settled here (deferred-to-implementation)
 *
 * A header row is REQUIRED. Recognized columns, matched case/separator-
 * insensitively: a first-name column, a last-name column, and a band source —
 * a `grade` column (the realistic registration-export shape; band DERIVED via
 * the Path's own `bandForGrade`) or, failing that, an explicit `band` column.
 * A header missing any of the three is a FILE-level refusal (the file cannot be
 * interpreted at all) — distinct from a bad DATA row, which is rejected alone
 * while the file continues (G19).
 */

/* ═══════════════════════════════════════════════════════════════ the parser ══ */

/** A realistic Boston-shaped roster with DELIBERATE DIRT, so the reconciliation
 *  invariants have something to reconcile. 11 data lines below. */
const BOSTON_CSV = [
  "First Name,Last Name,Grade",
  "Maya,Chen,7", // clean → g6_8
  "José,García,10", // accented → folds, g9_12
  "Sean,O'Brien,5", // apostrophe → folds, g3_5
  "Ada,Lovelace,6th", // "6th" → digits extracted → g6_8
  "Maya,Chen,7", // within-file duplicate of row 2 (same name+band)
  "Alex,Kim,4", // g3_5
  "Alex,Kim,11", // SAME name, DIFFERENT band → a different child, kept
  "Bad,Row,Extra,8", // 4 fields vs 3 → malformed_row
  ",Nofirst,7", // empty first name → missing_name
  "Tiny,Tot,1", // grade 1 → grade_out_of_range
  "Older,Kid,senior", // no digits in grade → invalid_grade
].join("\n");

describe("parseFwImportCsv — the column contract", () => {
  it("maps a realistic header and reconciles every data line (aggregate invariant)", () => {
    const res = parseFwImportCsv(BOSTON_CSV);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    // THE load-bearing assertion: nothing is silently dropped or double-counted.
    expect(res.rows.length + res.rejected.length).toBe(res.dataRowCount);
    expect(res.dataRowCount).toBe(11);
  });

  it("accepts the clean rows and derives band from grade", () => {
    const res = parseFwImportCsv(BOSTON_CSV);
    if (!res.ok) throw new Error("unreachable");
    const maya = res.rows.find((r) => r.firstName === "Maya");
    expect(maya).toMatchObject({ firstName: "Maya", lastName: "Chen", band: "g6_8" });
    expect(res.rows.find((r) => r.firstName === "José")).toMatchObject({ band: "g9_12" });
    expect(res.rows.find((r) => r.firstName === "Sean")).toMatchObject({ band: "g3_5" });
    // "6th" → digits extracted → grade 6 → g6_8.
    expect(res.rows.find((r) => r.firstName === "Ada")).toMatchObject({ band: "g6_8" });
  });

  it("stores the normalized name from the ONE shared key, not a second derivation", () => {
    const res = parseFwImportCsv(BOSTON_CSV);
    if (!res.ok) throw new Error("unreachable");
    const jose = res.rows.find((r) => r.firstName === "José");
    expect(jose?.normalizedName).toBe(buildNormalizedFwName("José", "García"));
  });

  it("rejects each dirty row with a row-level reason and keeps the file going (G19)", () => {
    const res = parseFwImportCsv(BOSTON_CSV);
    if (!res.ok) throw new Error("unreachable");
    const byReason = Object.fromEntries(res.rejected.map((r) => [r.reason, r]));
    expect(byReason).toHaveProperty("malformed_row"); // Bad,Row,Extra,8
    expect(byReason).toHaveProperty("missing_name"); // ,Nofirst,7
    expect(byReason).toHaveProperty("grade_out_of_range"); // Tiny,Tot,1
    expect(byReason).toHaveProperty("invalid_grade"); // Older,Kid,senior
    // Four dirty lines rejected, seven data lines survived as rows.
    expect(res.rejected).toHaveLength(4);
    expect(res.rows).toHaveLength(7);
  });

  it("keeps two SAME-NAME DIFFERENT-BAND children as distinct rows", () => {
    const res = parseFwImportCsv(BOSTON_CSV);
    if (!res.ok) throw new Error("unreachable");
    const kims = res.rows.filter((r) => r.lastName === "Kim");
    expect(kims.map((r) => r.band).sort()).toEqual(["g3_5", "g9_12"]);
  });

  it("rejects an unkeyable name (folds to nothing) as invalid_name, not missing_name", () => {
    const res = parseFwImportCsv("first,last,grade\n!!!,Chen,7");
    if (!res.ok) throw new Error("unreachable");
    expect(res.rows).toHaveLength(0);
    expect(res.rejected).toHaveLength(1);
    expect(res.rejected[0].reason).toBe("invalid_name");
  });

  it("honors quoted fields containing a comma", () => {
    // A last name of "Smith, Jr." must NOT read as a malformed 4-field row.
    const res = parseFwImportCsv('first,last,grade\nBob,"Smith, Jr.",8');
    if (!res.ok) throw new Error("unreachable");
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({ firstName: "Bob", lastName: "Smith, Jr.", band: "g6_8" });
  });

  it("does NOT let a stray mid-field quote swallow the rest of the roster (P1)", () => {
    // `Robert "Bob` is a stray unbalanced quote MID-field. Before the fix it
    // flipped the tokenizer into quote mode and ate every following comma and
    // newline to EOF, collapsing three clean children into one rejected record.
    const res = parseFwImportCsv(
      ['first,last,grade', 'Robert "Bob,Smith,6', 'Maya,Chen,7', 'Jose,Garcia,8'].join("\n")
    );
    if (!res.ok) throw new Error("unreachable");
    // The stray-quote row still parses as a single 3-field row (the quote stays a
    // literal in the name); crucially, the rows AFTER it are untouched.
    expect(res.dataRowCount).toBe(3);
    expect(res.rows).toHaveLength(3);
    expect(res.rows.find((r) => r.firstName === "Maya")).toMatchObject({ lastName: "Chen", band: "g6_8" });
    expect(res.rows.find((r) => r.firstName === "Jose")).toMatchObject({ lastName: "Garcia", band: "g6_8" });
  });

  it("flags a shortfall (source lines vs parsed rows) when an unterminated quote eats lines", () => {
    // A field that DOES open a quote at its start and never closes swallows to
    // EOF. It can't be parsed correctly, but the source-line reconciliation makes
    // the loss visible rather than silent.
    const res = parseFwImportCsv('first,last,grade\nMaya,"Chen,7\nJose,Garcia,8\nSean,OBrien,5');
    if (!res.ok) throw new Error("unreachable");
    // Three physical data lines; far fewer parsed records — the shortfall is the
    // signal the surface warns on.
    expect(res.sourceDataLineCount).toBe(3);
    expect(res.dataRowCount).toBeLessThan(res.sourceDataLineCount);
  });

  it("reconciles source lines with parsed rows on a clean file", () => {
    const res = parseFwImportCsv("first,last,grade\nMaya,Chen,7\nRae,Kim,10");
    if (!res.ok) throw new Error("unreachable");
    expect(res.sourceDataLineCount).toBe(2);
    expect(res.dataRowCount).toBe(2);
  });

  it("parses CRLF line endings the same as LF (Excel-on-Windows exports)", () => {
    const res = parseFwImportCsv("first,last,grade\r\nMaya,Chen,7\r\nSean,O'Brien,5\r\n");
    if (!res.ok) throw new Error("unreachable");
    expect(res.rows).toHaveLength(2);
    expect(res.rows.map((r) => r.firstName).sort()).toEqual(["Maya", "Sean"]);
  });

  it("unescapes a doubled quote inside a quoted field", () => {
    const res = parseFwImportCsv('first,last,grade\nBob,"Smith ""Bobby"" Jr.",8');
    if (!res.ok) throw new Error("unreachable");
    expect(res.rows[0]).toMatchObject({ lastName: 'Smith "Bobby" Jr.', band: "g6_8" });
  });

  it("rejects a decimal grade rather than silently truncating it to a band", () => {
    // "12.5" must not read as g9_12 and "5.9" must not read as g3_5 — band is
    // part of the identity tuple, so a truncated grade is a wrong match.
    const res = parseFwImportCsv("first,last,grade\nAva,Reed,12.5\nBen,Cole,5.9");
    if (!res.ok) throw new Error("unreachable");
    expect(res.rows).toHaveLength(0);
    expect(res.rejected.map((r) => r.reason)).toEqual(["invalid_grade", "invalid_grade"]);
  });

  it("still accepts ordinal and 'grade'-worded grade cells", () => {
    const res = parseFwImportCsv("first,last,grade\nA,B,6th\nC,D,grade 10\nE,F,8th grade");
    if (!res.ok) throw new Error("unreachable");
    expect(res.rows.map((r) => r.band)).toEqual(["g6_8", "g9_12", "g6_8"]);
  });

  it("accepts an explicit band column when there is no grade column", () => {
    const res = parseFwImportCsv("First Name,Last Name,Band\nMaya,Chen,g6_8\nRae,Kim,nope");
    if (!res.ok) throw new Error("unreachable");
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({ firstName: "Maya", band: "g6_8" });
    expect(res.rejected).toEqual([expect.objectContaining({ reason: "invalid_band" })]);
  });

  it("prefers grade over band when a file carries both columns", () => {
    const res = parseFwImportCsv("first,last,grade,band\nMaya,Chen,7,g9_12");
    if (!res.ok) throw new Error("unreachable");
    // grade 7 wins → g6_8, not the band column's g9_12.
    expect(res.rows[0].band).toBe("g6_8");
  });

  it("accepts common header aliases and is separator/case-insensitive", () => {
    const res = parseFwImportCsv("FIRST_NAME,surname,grade level\nMaya,Chen,7");
    if (!res.ok) throw new Error("unreachable");
    expect(res.rows[0]).toMatchObject({ firstName: "Maya", lastName: "Chen", band: "g6_8" });
  });

  it("skips blank lines without counting them as rejected rows", () => {
    const res = parseFwImportCsv("first,last,grade\n\nMaya,Chen,7\n\n");
    if (!res.ok) throw new Error("unreachable");
    expect(res.dataRowCount).toBe(1);
    expect(res.rows).toHaveLength(1);
    expect(res.rejected).toHaveLength(0);
  });
});

describe("parseFwImportCsv — FILE-level refusals (an uninterpretable header)", () => {
  it("refuses an empty file", () => {
    expect(parseFwImportCsv("")).toEqual({ ok: false, reason: "empty_file" });
    expect(parseFwImportCsv("   \n  ")).toEqual({ ok: false, reason: "empty_file" });
  });

  it("refuses a header with no data rows", () => {
    expect(parseFwImportCsv("first,last,grade")).toEqual({ ok: false, reason: "no_data_rows" });
  });

  it("refuses a header missing the first-name column", () => {
    expect(parseFwImportCsv("last,grade\nChen,7")).toEqual({
      ok: false,
      reason: "missing_first_name",
    });
  });

  it("refuses a header missing the last-name column", () => {
    expect(parseFwImportCsv("first,grade\nMaya,7")).toEqual({
      ok: false,
      reason: "missing_last_name",
    });
  });

  it("refuses a header with neither a grade nor a band column", () => {
    expect(parseFwImportCsv("first,last\nMaya,Chen")).toEqual({
      ok: false,
      reason: "missing_band_source",
    });
  });

  it("refuses a header where two columns map to the same field", () => {
    // "first" and "first name" both mean first name — the mapping is ambiguous
    // and silently picking one would drop the other's data.
    expect(parseFwImportCsv("first,first name,last,grade\na,b,Chen,7")).toEqual({
      ok: false,
      reason: "duplicate_column",
    });
  });
});

/* ═══════════════════════════════════════════════════════════════ dedupe ══ */

const parsed = (over: Partial<FwImportParsedRow> & { firstName: string; lastName: string }): FwImportParsedRow => ({
  rowNumber: over.rowNumber ?? 1,
  band: over.band ?? "g6_8",
  firstName: over.firstName,
  lastName: over.lastName,
  normalizedName: buildNormalizedFwName(over.firstName, over.lastName),
});

describe("dedupeFwImportRows", () => {
  it("collapses a repeat (name, band) to the first occurrence and reconciles (aggregate)", () => {
    const rows = [
      parsed({ rowNumber: 2, firstName: "Maya", lastName: "Chen", band: "g6_8" }),
      parsed({ rowNumber: 3, firstName: "Rae", lastName: "Kim", band: "g9_12" }),
      parsed({ rowNumber: 4, firstName: "Maya", lastName: "Chen", band: "g6_8" }),
    ];
    const res = dedupeFwImportRows(rows);
    // Reconciliation: not one input row vanishes.
    expect(res.unique.length + res.duplicates.length).toBe(rows.length);
    expect(res.unique.map((r) => r.rowNumber).sort()).toEqual([2, 3]);
    expect(res.duplicates).toEqual([
      expect.objectContaining({ rowNumber: 4, keptRowNumber: 2 }),
    ]);
  });

  it("does NOT collapse the same name with a DIFFERENT band — two children", () => {
    const rows = [
      parsed({ rowNumber: 2, firstName: "Alex", lastName: "Kim", band: "g3_5" }),
      parsed({ rowNumber: 3, firstName: "Alex", lastName: "Kim", band: "g9_12" }),
    ];
    const res = dedupeFwImportRows(rows);
    expect(res.unique).toHaveLength(2);
    expect(res.duplicates).toHaveLength(0);
  });

  it("returns nothing for an empty input", () => {
    expect(dedupeFwImportRows([])).toEqual({ unique: [], duplicates: [] });
  });
});

/* ══════════════════════════════════════════════════════════ chunk planning ══ */

describe("planFwImportChunks", () => {
  const rows = Array.from({ length: 23 }, (_, i) => i);

  it("splits into chunks no larger than the size and loses nothing (aggregate)", () => {
    const chunks = planFwImportChunks(rows, 8);
    expect(chunks.flat()).toEqual(rows); // order-preserving, complete
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(8);
    expect(chunks).toHaveLength(3); // 8 + 8 + 7
  });

  it("uses the default chunk size when none is given", () => {
    const chunks = planFwImportChunks(rows);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(DEFAULT_FW_IMPORT_CHUNK_SIZE);
    expect(chunks.flat()).toEqual(rows);
  });

  it("returns [] for no rows and a single chunk for a short list", () => {
    expect(planFwImportChunks([], 8)).toEqual([]);
    expect(planFwImportChunks([1, 2], 8)).toEqual([[1, 2]]);
  });

  it("refuses a non-positive chunk size rather than looping forever", () => {
    expect(() => planFwImportChunks(rows, 0)).toThrow();
  });
});

/* ═══════════════════════════════════ per-row match decision (PROPOSED-1) ══ */

const BOSTON = "cohort-boston";
const HAMPTONS = "cohort-hamptons";

const candidate = (over: Partial<FwMatchCandidate> & { profileId: string }): FwMatchCandidate => ({
  normalizedName: buildNormalizedFwName("Maya", "Chen"),
  band: "g6_8",
  cohortIds: [],
  source: "profile",
  ...over,
});

describe("decideFwImportRowMatch", () => {
  const decide = (candidates: FwMatchCandidate[], band: FwImportParsedRow["band"] = "g6_8") =>
    decideFwImportRowMatch({ candidates, cohortId: BOSTON, band });

  it("mints when nobody by this name exists", () => {
    expect(decide([])).toEqual({ action: "mint" });
  });

  it("skips a (name, band) already enrolled in THIS cohort — idempotent re-run", () => {
    expect(
      decide([candidate({ profileId: "p1", cohortIds: [BOSTON], band: "g6_8" })])
    ).toEqual({ action: "skip_existing", profileId: "p1" });
  });

  it("links a single same-band returner from another weekend (membership only)", () => {
    expect(
      decide([candidate({ profileId: "p1", cohortIds: [HAMPTONS], band: "g6_8" })])
    ).toEqual({ action: "link", profileId: "p1" });
  });

  it("parks an ambiguous match (two same-band elsewhere) — nothing minted (G7)", () => {
    expect(
      decide([
        candidate({ profileId: "p1", cohortIds: [HAMPTONS], band: "g6_8" }),
        candidate({ profileId: "p2", cohortIds: ["cohort-chicago"], band: "g6_8" }),
      ])
    ).toEqual({ action: "exception", reason: "ambiguous_match" });
  });

  it("parks a same-name DIFFERENT-band match rather than link the wrong child", () => {
    expect(
      decide([candidate({ profileId: "p1", cohortIds: [HAMPTONS], band: "g9_12" })])
    ).toEqual({ action: "exception", reason: "ambiguous_match" });
  });

  it("parks when a same-name child is already in this cohort at a different band", () => {
    // A g9_12 'Maya Chen' is already here; a g6_8 row of the same name is not a
    // clean returner and not a safe fresh mint — staff decide.
    expect(
      decide([candidate({ profileId: "p1", cohortIds: [BOSTON], band: "g9_12" })])
    ).toEqual({ action: "exception", reason: "ambiguous_match" });
  });

  it("skips when a PENDING exception for this (name, band) already sits on this cohort", () => {
    expect(
      decide(
        [candidate({ profileId: "x1", source: "import_exception", cohortIds: [BOSTON], band: "g6_8" })],
        "g6_8"
      )
    ).toEqual({ action: "skip_pending_exception" });
  });

  it("does NOT let a pending exception at a DIFFERENT band swallow a distinct same-name child (P1)", () => {
    // A g3_5 'Maya Chen' exception is pending; a genuinely different g9_12 'Maya
    // Chen' row must not be absorbed by it. With no other candidate at g9_12 it
    // is a fresh mint — never a silent skip that vanishes the child.
    expect(
      decide(
        [candidate({ profileId: "x1", source: "import_exception", cohortIds: [BOSTON], band: "g3_5" })],
        "g9_12"
      )
    ).toEqual({ action: "mint" });
  });

  it("parks its OWN exception when a different-band pending exception coexists and the row is itself ambiguous", () => {
    // g3_5 exception pending; a g9_12 row that is independently ambiguous (two
    // g9_12 candidates elsewhere) must raise its OWN g9_12 exception, not skip.
    expect(
      decide(
        [
          candidate({ profileId: "x1", source: "import_exception", cohortIds: [BOSTON], band: "g3_5" }),
          candidate({ profileId: "p1", cohortIds: [HAMPTONS], band: "g9_12" }),
          candidate({ profileId: "p2", cohortIds: ["cohort-chicago"], band: "g9_12" }),
        ],
        "g9_12"
      )
    ).toEqual({ action: "exception", reason: "ambiguous_match" });
  });

  it("mints past a pending exception that belongs to a DIFFERENT cohort", () => {
    expect(
      decide([
        candidate({ profileId: "x1", source: "import_exception", cohortIds: [HAMPTONS] }),
      ])
    ).toEqual({ action: "mint" });
  });
});
