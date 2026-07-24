"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/app/path/components/system/Button";
import { importFwStudentsChunk } from "@/app/path/lib/actions/fw-import";
import {
  DEFAULT_FW_IMPORT_CHUNK_SIZE,
  dedupeFwImportRows,
  parseFwImportCsv,
  planFwImportChunks,
  type FwImportParseResult,
  type FwImportRejectReason,
} from "@/app/path/lib/fw-import-rules";
import type { FwImportOutcome, FwImportOutcomeKind } from "@/app/path/lib/fw-import-core";
import { FW_BAND_LABEL } from "@/app/path/lib/fw-nav-rules";

/**
 * The staff CSV importer (FW Unit 7; FW-R12, Decision 11, gaps G7/G19) — Boston's
 * roster path.
 *
 * The whole thing is CLIENT-driven for one reason: a ~90-account mint is far past
 * any serverless duration, so the file is parsed HERE (the pure `fw-import-rules`
 * code — the same parser the CLI uses), previewed, and then provisioned one CHUNK
 * at a time via `importFwStudentsChunk`, with a progress bar between calls. Every
 * chunk is idempotent, so a re-run (or a re-sent chunk after a timeout) mints
 * nothing new — which is why the "Import" button is safe to press twice.
 *
 * Three properties this component holds:
 *   1. REJECT THE ROW, NEVER THE FILE (G19). A malformed row is previewed with a
 *      row number and a reason; the rest still import. A file whose HEADER cannot
 *      be read is refused whole — that is a different failure.
 *   2. NOTHING SILENTLY DROPPED. The preview reconciles every data line: rows to
 *      import + duplicates collapsed + rows skipped = the file's data lines.
 *   3. try/catch/FINALLY around the chunk loop, so a Server Action that REJECTS
 *      on venue wifi cannot strand the button mid-import.
 */

const REJECT_COPY: Record<FwImportRejectReason, string> = {
  malformed_row: "wrong number of columns (an unquoted comma?)",
  missing_name: "missing a first or last name",
  invalid_name: "name can't be used as-is (retype in plain letters)",
  invalid_grade: "grade isn't a number",
  grade_out_of_range: "grade is outside 3–12",
  invalid_band: "band isn't one of g3_5 / g6_8 / g9_12",
};

const PARSE_ERROR_COPY: Record<
  Extract<FwImportParseResult, { ok: false }>["reason"],
  string
> = {
  empty_file: "The file is empty.",
  no_data_rows: "The file has a header but no student rows.",
  missing_first_name: "No first-name column found. Add a “First Name” column.",
  missing_last_name: "No last-name column found. Add a “Last Name” column.",
  missing_band_source: "No grade (or band) column found. Add a “Grade” column.",
  duplicate_column: "Two columns map to the same field — remove the duplicate.",
};

const OUTCOME_COPY: Record<FwImportOutcomeKind, string> = {
  minted: "Added",
  linked: "Linked (returning student)",
  skipped_existing: "Already on the roster",
  exception: "Needs review",
  skipped_pending_exception: "Already flagged for review",
  failed: "Failed",
};

/** The kinds worth listing row-by-row after an import — the ones a human must act
 *  on. Successes are shown as a count only. */
const NOTABLE: FwImportOutcomeKind[] = ["exception", "failed"];

export default function FwImport({ cohortId }: { cohortId: string }) {
  const router = useRouter();
  const [fileName, setFileName] = useState<string | null>(null);
  const [parse, setParse] = useState<FwImportParseResult | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [report, setReport] = useState<FwImportOutcome[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** The unique rows to import and the within-file duplicates that collapse. */
  const deduped = useMemo(
    () => (parse?.ok ? dedupeFwImportRows(parse.rows) : null),
    [parse]
  );

  const handleFile = async (file: File | null) => {
    setError(null);
    setReport(null);
    setProgress(null);
    if (!file) {
      setFileName(null);
      setParse(null);
      return;
    }
    setFileName(file.name);
    try {
      const text = await file.text();
      setParse(parseFwImportCsv(text));
    } catch {
      setParse(null);
      setError("That file couldn't be read. Try again.");
    }
  };

  const handleImport = async () => {
    if (!parse?.ok || !deduped || running) return;
    const chunks = planFwImportChunks(deduped.unique, DEFAULT_FW_IMPORT_CHUNK_SIZE);
    const total = deduped.unique.length;
    setRunning(true);
    setError(null);
    setReport([]);
    setProgress({ done: 0, total });
    const collected: FwImportOutcome[] = [];
    try {
      for (const chunk of chunks) {
        const res = await importFwStudentsChunk({
          cohortId,
          rows: chunk.map((r) => ({
            rowNumber: r.rowNumber,
            firstName: r.firstName,
            lastName: r.lastName,
            band: r.band,
          })),
        });
        if (!res.success) {
          setError(res.error);
          break;
        }
        collected.push(...res.outcomes);
        setReport([...collected]);
        setProgress({ done: collected.length, total });
      }
      router.refresh(); // pick up the new roster + any parked exceptions
    } catch {
      setError("The import was interrupted. Re-run it — already-added students are skipped.");
    } finally {
      setRunning(false);
    }
  };

  const tally = useMemo(() => {
    if (!report) return null;
    const counts = new Map<FwImportOutcomeKind, number>();
    for (const o of report) counts.set(o.kind, (counts.get(o.kind) ?? 0) + 1);
    return counts;
  }, [report]);

  return (
    <div className="rounded-xl border border-hq-border bg-hq-surface p-5 shadow-hq">
      <label className="block">
        <span className="mb-1.5 block font-path-mono text-[11px] uppercase tracking-[0.12em] text-hq-ink-muted">
          Roster CSV
        </span>
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={running}
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          className="block w-full font-path-body text-sm text-hq-ink file:mr-3 file:min-h-[44px] file:rounded-lg file:border file:border-hq-border file:bg-hq-canvas file:px-4 file:font-path-body file:text-sm file:font-medium file:text-hq-ink"
        />
      </label>
      <p className="mt-2 font-path-body text-xs leading-5 text-hq-ink-muted">
        A header row with First Name, Last Name, and Grade (band is derived). Extra
        columns are ignored.
      </p>

      {parse && !parse.ok && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-not-yet/40 bg-not-yet/10 p-3 font-path-body text-sm leading-5 text-hq-ink"
        >
          {PARSE_ERROR_COPY[parse.reason]}
        </p>
      )}

      {parse?.ok && deduped && (
        <div className="mt-4 rounded-lg border border-hq-border bg-hq-canvas p-4">
          {fileName && (
            <p className="mb-1 font-path-mono text-[11px] uppercase tracking-[0.12em] text-hq-ink-muted">
              {fileName}
            </p>
          )}
          <p className="font-path-body text-sm leading-6 text-hq-ink">
            <strong className="font-semibold">{deduped.unique.length}</strong> student
            {deduped.unique.length === 1 ? "" : "s"} to import
            {deduped.duplicates.length > 0 && (
              <> · {deduped.duplicates.length} duplicate row(s) collapsed</>
            )}
            {parse.rejected.length > 0 && <> · {parse.rejected.length} row(s) skipped</>}
          </p>
          {parse.rejected.length > 0 && (
            <ul className="mt-2 space-y-1 font-path-body text-xs leading-5 text-hq-ink-soft">
              {parse.rejected.map((r) => (
                <li key={r.rowNumber}>
                  Row {r.rowNumber}: {REJECT_COPY[r.reason]}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {parse?.ok && deduped && deduped.unique.length > 0 && (
        <div className="mt-4">
          <Button type="button" skin="hq" size="lg" onClick={handleImport} disabled={running}>
            {running
              ? `Importing… ${progress?.done ?? 0} / ${progress?.total ?? 0}`
              : `Import ${deduped.unique.length} student${deduped.unique.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-not-yet/40 bg-not-yet/10 p-3 font-path-body text-sm leading-5 text-hq-ink"
        >
          {error}
        </p>
      )}

      {tally && report && report.length > 0 && (
        <div className="mt-5 border-t border-hq-border pt-4">
          <p className="font-path-mono text-[11px] uppercase tracking-[0.12em] text-hq-ink-muted">
            Result
          </p>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-path-body text-sm text-hq-ink">
            {[...tally.entries()].map(([kind, n]) => (
              <li key={kind}>
                {OUTCOME_COPY[kind]}: <strong className="font-semibold">{n}</strong>
              </li>
            ))}
          </ul>
          {report.some((o) => NOTABLE.includes(o.kind)) && (
            <ul className="mt-3 space-y-1 font-path-body text-xs leading-5 text-hq-ink-soft">
              {report
                .filter((o) => NOTABLE.includes(o.kind))
                .map((o) => (
                  <li key={o.rowNumber}>
                    Row {o.rowNumber}: {o.firstName} {o.lastName} ({FW_BAND_LABEL[o.band]}) —{" "}
                    {OUTCOME_COPY[o.kind]}
                    {o.reason ? ` (${o.reason})` : ""}
                  </li>
                ))}
            </ul>
          )}
          {report.some((o) => o.kind === "exception") && (
            <p className="mt-3 font-path-body text-xs leading-5 text-hq-ink-soft">
              “Needs review” rows are parked below under <em>Import exceptions</em> — resolve each
              before the weekend’s doors open.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
