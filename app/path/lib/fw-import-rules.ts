/**
 * The bulk-importer's PURE half (FW Unit 7; FW-R12, Decision 11, gaps G7/G19) —
 * CSV parsing, row validation/normalization, within-file dedupe, chunk planning,
 * and the per-row match decision. No I/O; the db-taking orchestration is in
 * `fw-import-core.ts`.
 *
 * PLAIN module by convention (no next/supabase/react imports), so it runs under
 * vitest AND under `tsx` (the CLI import driver parses with the same code the ops
 * page uses). Everything here is exhaustively unit-tested, because a CSV parser
 * that silently drops one line of a ninety-child roster is a child who is never
 * provisioned and never noticed.
 *
 * ── The column contract (deferred-to-implementation, settled here)
 *
 * A header row is REQUIRED. Columns are matched case- and separator-insensitively
 * against alias sets: a first-name column, a last-name column, and a BAND SOURCE
 * — a `grade` column (the realistic registration-export shape; band is derived
 * with the Path's own `bandForGrade`, so there is no second band-derivation path)
 * or, only when there is no grade column, an explicit `band` column. A header
 * missing any of the three, or one where two columns claim the same field, is a
 * FILE-level refusal: the file cannot be interpreted at all, which is a different
 * thing from a bad DATA row. A bad data row is rejected ALONE, with a row-level
 * reason, and the file keeps going (G19) — reject the row, never the file.
 *
 * ── Identity is (normalized name, band)
 *
 * The plan names the match tuple "(first, last, band)" throughout. So within-file
 * dedupe collapses only rows that share BOTH a normalized name and a band; two
 * "Alex Kim"s at different bands are two children and both survive. The same tuple
 * governs `decideFwImportRowMatch`: a returner is a single existing student of
 * this name AT THIS BAND, and anything less certain parks as an exception rather
 * than risk minting a duplicate or merging two children who share a name.
 */

import { type Band } from "@/app/path/content/types";
import { fwMatchKey } from "./fw-match-rules";
import type { FwMatchCandidate } from "./fw-match-rules";
import { narrowFwBand } from "./fw-provision-rules";
import { bandForGrade } from "./progress-core";

/**
 * How many students one importer server-action call provisions before returning.
 *
 * A mint is ~16 service-role round trips (match → provision → materialize → leg
 * verify), so a chunk stays well inside a 60 s `maxDuration` while keeping the
 * client's progress bar moving. Chunking is what makes the import RESUMABLE:
 * every chunk is idempotent (a re-run skips already-minted rows), so a chunk that
 * times out is simply re-sent. Measured, not guessed — see the ops page's
 * `maxDuration` and the CLI import timing recorded in the Unit 7 checkbox.
 */
export const DEFAULT_FW_IMPORT_CHUNK_SIZE = 8;

/* ═══════════════════════════════════════════════════════════ CSV tokenizer ══ */

/**
 * Split CSV text into records of fields (RFC 4180-ish): double-quoted fields may
 * contain commas and newlines, and a doubled `""` inside a quoted field is one
 * literal quote. Bare `\r` is folded into the line break so CRLF files parse.
 *
 * Returns one array of fields per physical record. A trailing newline does not
 * manufacture an empty record; a genuinely blank line becomes `[""]`, which the
 * row parser skips.
 */
function tokenizeCsv(text: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let sawAnyField = false;

  const pushField = () => {
    record.push(field);
    field = "";
    sawAnyField = true;
  };
  const pushRecord = () => {
    pushField();
    records.push(record);
    record = [];
    sawAnyField = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1; // consume the escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      pushField();
    } else if (ch === "\n" || ch === "\r") {
      // Only close a record at the first char of a line break; skip the paired
      // \n of a \r\n. A leading \n with nothing before it is an empty line.
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      pushRecord();
    } else {
      field += ch;
    }
  }
  // A final field/record with no trailing newline still counts.
  if (sawAnyField || field.length > 0 || record.length > 0) pushRecord();
  return records;
}

/** True for a record that is just a blank line (one empty field) — skipped, not
 *  rejected: a blank line is not a malformed student, it is whitespace. */
function isBlankRecord(fields: string[]): boolean {
  return fields.length === 1 && fields[0].trim().length === 0;
}

/* ══════════════════════════════════════════════════════════ header mapping ══ */

/** Normalize a header cell so `First_Name`, `first name`, and `FIRST NAME` all
 *  collapse to one key. Underscores and hyphens become spaces; runs collapse. */
function normalizeHeader(cell: string): string {
  return cell.trim().toLowerCase().replace(/[\s_-]+/g, " ").trim();
}

const FIRST_NAME_HEADERS = new Set([
  "first name",
  "first",
  "firstname",
  "given name",
  "student first name",
]);
const LAST_NAME_HEADERS = new Set([
  "last name",
  "last",
  "lastname",
  "surname",
  "family name",
  "student last name",
]);
const GRADE_HEADERS = new Set(["grade", "grade level", "student grade"]);
const BAND_HEADERS = new Set(["band", "grade band"]);

export type FwImportColumnMap = {
  firstName: number;
  lastName: number;
  bandSource: { kind: "grade"; index: number } | { kind: "band"; index: number };
};

export type FwImportParseError =
  | "empty_file"
  | "no_data_rows"
  | "missing_first_name"
  | "missing_last_name"
  | "missing_band_source"
  | "duplicate_column";

/**
 * Resolve the header record to a column map, or a file-level refusal reason.
 *
 * `duplicate_column` fires when two header cells map to the SAME field: silently
 * keeping the first would drop a column staff meant to use. Grade wins over band
 * when a file carries both, so the band source is a FILE-level fact, never a
 * per-row precedence dance.
 */
function mapHeader(header: string[]): { ok: true; columns: FwImportColumnMap } | { ok: false; reason: FwImportParseError } {
  let firstName: number | null = null;
  let lastName: number | null = null;
  let grade: number | null = null;
  let band: number | null = null;
  const claim = (current: number | null, index: number): number | "dup" =>
    current === null ? index : "dup";

  for (let i = 0; i < header.length; i += 1) {
    const key = normalizeHeader(header[i]);
    if (FIRST_NAME_HEADERS.has(key)) {
      const r = claim(firstName, i);
      if (r === "dup") return { ok: false, reason: "duplicate_column" };
      firstName = r;
    } else if (LAST_NAME_HEADERS.has(key)) {
      const r = claim(lastName, i);
      if (r === "dup") return { ok: false, reason: "duplicate_column" };
      lastName = r;
    } else if (GRADE_HEADERS.has(key)) {
      const r = claim(grade, i);
      if (r === "dup") return { ok: false, reason: "duplicate_column" };
      grade = r;
    } else if (BAND_HEADERS.has(key)) {
      const r = claim(band, i);
      if (r === "dup") return { ok: false, reason: "duplicate_column" };
      band = r;
    }
    // Unrecognized columns (email, parent, school, …) are simply ignored.
  }

  if (firstName === null) return { ok: false, reason: "missing_first_name" };
  if (lastName === null) return { ok: false, reason: "missing_last_name" };
  const bandSource: FwImportColumnMap["bandSource"] | null =
    grade !== null ? { kind: "grade", index: grade } : band !== null ? { kind: "band", index: band } : null;
  if (bandSource === null) return { ok: false, reason: "missing_band_source" };
  return { ok: true, columns: { firstName, lastName, bandSource } };
}

/* ═════════════════════════════════════════════════════════════ row parsing ══ */

export type FwImportRejectReason =
  | "malformed_row"
  | "missing_name"
  | "invalid_name"
  | "invalid_grade"
  | "grade_out_of_range"
  | "invalid_band";

export type FwImportParsedRow = {
  /** 1-based record index INCLUDING the header (header = 1; first data row = 2),
   *  so a report line maps back to a place a human can find in the file. */
  rowNumber: number;
  firstName: string;
  lastName: string;
  band: Band;
  /** The `fwMatchKey` for (firstName, lastName) — the ONE key both the DB lookup
   *  and the matcher compare on. Stored so downstream never re-derives it. */
  normalizedName: string;
};

export type FwImportRejectedRow = {
  rowNumber: number;
  reason: FwImportRejectReason;
  /** The raw cells, so the report can show staff exactly what was wrong. */
  raw: string[];
};

export type FwImportParseResult =
  | { ok: false; reason: FwImportParseError }
  | {
      ok: true;
      columns: FwImportColumnMap;
      rows: FwImportParsedRow[];
      rejected: FwImportRejectedRow[];
      /** rows.length + rejected.length — the reconciliation base for the report. */
      dataRowCount: number;
    };

/** Resolve the band from a grade cell (digits extracted, e.g. "6th" → 6) or an
 *  explicit band token, returning the reason a bad value is rejected for. */
function resolveBand(
  cell: string,
  source: FwImportColumnMap["bandSource"]
): { ok: true; band: Band } | { ok: false; reason: FwImportRejectReason } {
  if (source.kind === "grade") {
    const digits = cell.match(/\d+/);
    if (!digits) return { ok: false, reason: "invalid_grade" };
    const band = bandForGrade(Number(digits[0]));
    if (!band) return { ok: false, reason: "grade_out_of_range" };
    return { ok: true, band };
  }
  const band = narrowFwBand(cell.trim().toLowerCase());
  if (!band) return { ok: false, reason: "invalid_band" };
  return { ok: true, band };
}

/**
 * Parse a CSV roster into validated rows and per-row rejections.
 *
 * AGGREGATE INVARIANT (the property the test suite pins, not a spot-check):
 * `rows.length + rejected.length === dataRowCount`, and `dataRowCount` is exactly
 * the number of non-blank records after the header. No data line is ever silently
 * dropped or double-counted.
 */
export function parseFwImportCsv(text: string): FwImportParseResult {
  const records = tokenizeCsv(text).filter((r) => !isBlankRecord(r));
  if (records.length === 0) return { ok: false, reason: "empty_file" };

  const [header, ...data] = records;
  const mapped = mapHeader(header);
  if (!mapped.ok) return { ok: false, reason: mapped.reason };
  if (data.length === 0) return { ok: false, reason: "no_data_rows" };
  const { columns } = mapped;

  const rows: FwImportParsedRow[] = [];
  const rejected: FwImportRejectedRow[] = [];
  data.forEach((fields, i) => {
    const rowNumber = i + 2; // header is record 1

    // A field count mismatch is almost always an unescaped comma or a broken
    // quote — the cell boundaries are untrustworthy, so the whole row is refused
    // rather than mapped by a position that no longer means what it should.
    if (fields.length !== header.length) {
      rejected.push({ rowNumber, reason: "malformed_row", raw: fields });
      return;
    }

    const firstName = fields[columns.firstName].trim();
    const lastName = fields[columns.lastName].trim();
    if (firstName.length === 0 || lastName.length === 0) {
      rejected.push({ rowNumber, reason: "missing_name", raw: fields });
      return;
    }

    const key = fwMatchKey(firstName, lastName);
    if (key === null) {
      rejected.push({ rowNumber, reason: "invalid_name", raw: fields });
      return;
    }

    const bandCell = fields[columns.bandSource.index] ?? "";
    const band = resolveBand(bandCell, columns.bandSource);
    if (!band.ok) {
      rejected.push({ rowNumber, reason: band.reason, raw: fields });
      return;
    }

    rows.push({ rowNumber, firstName, lastName, band: band.band, normalizedName: key });
  });

  return { ok: true, columns, rows, rejected, dataRowCount: data.length };
}

/* ═════════════════════════════════════════════════════════════════ dedupe ══ */

export type FwImportDuplicateRow = FwImportParsedRow & {
  /** The row that WON (kept) for this (name, band). */
  keptRowNumber: number;
};

export type FwImportDedupeResult = {
  unique: FwImportParsedRow[];
  duplicates: FwImportDuplicateRow[];
};

/** The identity tuple — `(normalizedName, band)`. Two "Alex Kim"s at different
 *  bands are two children; two at the same band are one row typed twice. */
function identityKey(row: FwImportParsedRow): string {
  return `${row.normalizedName} ${row.band}`;
}

/**
 * Collapse within-file duplicates by identity tuple, keeping the first occurrence.
 *
 * AGGREGATE INVARIANT: `unique.length + duplicates.length === rows.length` — a
 * collapsed row is REPORTED (as a duplicate pointing at the row it collapsed
 * into), never silently discarded.
 */
export function dedupeFwImportRows(rows: readonly FwImportParsedRow[]): FwImportDedupeResult {
  const firstByKey = new Map<string, FwImportParsedRow>();
  const unique: FwImportParsedRow[] = [];
  const duplicates: FwImportDuplicateRow[] = [];
  for (const row of rows) {
    const key = identityKey(row);
    const won = firstByKey.get(key);
    if (won) duplicates.push({ ...row, keptRowNumber: won.rowNumber });
    else {
      firstByKey.set(key, row);
      unique.push(row);
    }
  }
  return { unique, duplicates };
}

/* ═════════════════════════════════════════════════════════ chunk planning ══ */

/**
 * Split rows into order-preserving chunks of at most `chunkSize`.
 *
 * AGGREGATE INVARIANT: `chunks.flat()` deep-equals the input — chunking is a
 * partition, never a filter. Throws on a non-positive size rather than looping
 * forever (the no-silent-caps posture: a bad size is a loud programmer error).
 */
export function planFwImportChunks<T>(
  rows: readonly T[],
  chunkSize: number = DEFAULT_FW_IMPORT_CHUNK_SIZE
): T[][] {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error(`planFwImportChunks: chunkSize must be a positive integer, got ${chunkSize}`);
  }
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    chunks.push(rows.slice(i, i + chunkSize));
  }
  return chunks;
}

/* ═══════════════════════════════════ PROPOSED-1: the per-row match decision ══ */

export type FwImportRowDecision =
  | { action: "mint" }
  | { action: "link"; profileId: string }
  | { action: "skip_existing"; profileId: string }
  | { action: "skip_pending_exception" }
  | { action: "exception"; reason: "ambiguous_match" };

/**
 * Decide what to do with one row given the existing students (and pending import
 * exceptions) that key to its name — PROPOSED-1, importer side.
 *
 * This is NOT `matchFwStudent`, and the difference is deliberate: that function
 * serves the GUIDE, so its cross-cohort arm hides everything but a count. The
 * importer is staff-authorized across cohorts and needs the PROFILE ID to link a
 * returner, so it consumes the candidate list directly. Both key on the same
 * `fwMatchKey` (via `loadFwMatchCandidates`) — the one thing that must never be
 * duplicated is the key, and it is not.
 *
 * The identity tuple is `(name, band)`. Precedence, most-certain first:
 *   - nobody by this name            → mint;
 *   - a PENDING exception already on THIS cohort → skip (staff are on it);
 *   - a (name, band) already a member of THIS cohort → skip (idempotent re-run);
 *   - exactly one same-band student elsewhere, and none of this name here → link;
 *   - anything else (multiple candidates, a band mismatch, a same-name-different-
 *     band already here) → exception, nothing minted. The cautious default,
 *     because minting a duplicate burns a permanent name-derived address (FW-D2)
 *     and linking the wrong child is unrecoverable.
 */
export function decideFwImportRowMatch(input: {
  candidates: readonly FwMatchCandidate[];
  cohortId: string;
  band: Band;
}): FwImportRowDecision {
  const { candidates, cohortId, band } = input;
  if (candidates.length === 0) return { action: "mint" };

  // A pending exception for this name, already parked on THIS cohort, means staff
  // are already resolving it — do not park a second one. An exception scoped to a
  // DIFFERENT cohort has no bearing on this import.
  if (candidates.some((c) => c.source === "import_exception" && c.cohortIds.includes(cohortId))) {
    return { action: "skip_pending_exception" };
  }

  // Only real students constrain the decision from here. A pending exception on
  // some OTHER cohort is not a student of this name — if that is all there is,
  // this name is free to mint.
  const profiles = candidates.filter((c) => c.source === "profile");
  if (profiles.length === 0) return { action: "mint" };

  // Already enrolled at this band → the row is satisfied. Idempotent re-run.
  const hereSameBand = profiles.find((c) => c.cohortIds.includes(cohortId) && c.band === band);
  if (hereSameBand) return { action: "skip_existing", profileId: hereSameBand.profileId };

  // A same-name student already in this cohort at a DIFFERENT band is ambiguous —
  // it is not a clean returner and not a safe fresh mint. Staff decide.
  const hereAnyBand = profiles.some((c) => c.cohortIds.includes(cohortId));
  if (hereAnyBand) return { action: "exception", reason: "ambiguous_match" };

  // Not here yet. A single same-band student from another weekend is the returner.
  const elsewhereSameBand = profiles.filter((c) => c.band === band);
  if (elsewhereSameBand.length === 1) {
    return { action: "link", profileId: elsewhereSameBand[0].profileId };
  }

  // Zero same-band candidates (name exists only at other bands) or several of them
  // (which one is the returner?) — either way, mint nothing.
  return { action: "exception", reason: "ambiguous_match" };
}
