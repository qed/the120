"use client";

/**
 * Image Lab — the result grid
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 5; origin R3, R7).
 *
 * One column per model, one card per candidate, ATTEMPTS STACKED NEWEST FIRST
 * inside their cell. The grouping, the ordering, the render state and the
 * retry-until-stale rule are all `run-rules` decisions — this file renders them
 * and takes none of its own. (There is no jsdom in this suite; a decision written
 * inline here is a decision CI cannot see, and Unit 4's review found nine source
 * greps that survived deleting the thing they claimed to test.)
 *
 * ── MOBILE (~390px) ────────────────────────────────────────────────────────
 * `grid-cols-1` at base, widening at `sm`/`lg`, so the compare columns STACK on a
 * phone rather than scrolling sideways. Every control is at least `min-h-11`
 * (44px). The attempt count and the state label are TEXT, never a hover badge or
 * a `title` — there is no hover on a phone, and the count is the one thing that
 * explains why a cell shows two pictures.
 */

import {
  buildGrid,
  canRetryCell,
  cellAttemptName,
  cellRenderState,
  describeAttemptLine,
  formatUsd,
  newestAttempt,
  IMAGE_LAB_RUN_COPY,
  IMAGE_LAB_STALE_MINUTES,
  type CellRenderState,
} from "./lib/run-rules";
import type { RunCellView } from "./lib/run-loader";

const STATE_SKIN: Record<CellRenderState, string> = {
  requested: "border-hq-border",
  pending: "border-crm-blue",
  stale: "border-hq-border-strong",
  done: "border-crm-blue",
  failed: "border-hq-border-strong",
};

export function ResultGrid({
  cells,
  modelIds,
  serverNowMs,
  busyIds,
  onRetry,
  onGenerate,
}: {
  cells: readonly RunCellView[];
  /**
   * ⚠ THE RUN'S MODEL LIST, NOT THE LIVE CHIP SELECTION.
   *
   * These used to be the composer's currently-selected chips, so deselecting a
   * model mid-fan ERASED its live, billing cells from the only surface that
   * could show or retry them — and toggling a chip silently reordered the
   * compare columns of a run already recorded. The caller holds the created
   * run's list and passes that.
   */
  modelIds: readonly string[];
  /** The SERVER's clock, anchored by the caller. Never `Date.now()` here — a
   *  laptop fifteen minutes fast would offer Retry on every running call. */
  serverNowMs: number;
  busyIds: ReadonlySet<string>;
  onRetry: (imageId: string) => void;
  /** For a row nothing has ever attempted, whose correct action is to generate
   *  the EXISTING row rather than append a second live one beside it. */
  onGenerate: (imageId: string) => void;
}) {
  const copy = IMAGE_LAB_RUN_COPY.grid;
  const grid = buildGrid(cells, modelIds);

  if (grid.length === 0) {
    return (
      <div className="mt-4 rounded-xl border border-hq-border bg-hq-surface p-4">
        <p className="text-pretty text-sm text-hq-ink-soft">{copy.empty}</p>
      </div>
    );
  }

  return (
    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {grid.map((cell) => {
        const newest = newestAttempt(cell);
        const state = cellRenderState(newest, serverNowMs);
        const retryable = canRetryCell(newest, serverNowMs);
        // A row nothing ever touched is not a retry candidate however old it is:
        // appending beside it leaves TWO live rows for one intended image, both
        // generatable. Generate the row that already exists instead.
        const neverAttempted =
          newest.state === "requested" && newest.attemptedAtMs === null;
        const busy = busyIds.has(newest.id);
        return (
          <section
            key={`${cell.modelId}:${cell.cellOrdinal}`}
            className={`rounded-xl border bg-hq-surface p-3 ${STATE_SKIN[state]}`}
          >
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <h4 className="font-path-display text-sm text-hq-ink">
                {cell.modelId} · #{cell.cellOrdinal + 1}
              </h4>
              <p className="text-xs text-hq-ink-soft">
                {copy.state[state]}
                {cell.attemptCount > 1 ? ` · ${copy.attemptBadge(cell.attemptCount)}` : ""}
              </p>
            </header>

            <ul className="mt-3 flex flex-col gap-3">
              {cell.attempts.map((attempt, index) => {
                const attemptState = cellRenderState(attempt, serverNowMs);
                // ⚠ NAMED BY ATTEMPT, not just by cell. `cell.attempts` is
                // NEWEST FIRST, so the newest is attempt N of N — every stacked
                // picture here used to carry the byte-identical `alt`, which is
                // the same bug Unit 6 fixed on History. One rule, both surfaces.
                const ordinal = {
                  index: cell.attempts.length - index,
                  of: cell.attempts.length,
                };
                const attemptName = cellAttemptName(
                  cell.modelId,
                  cell.cellOrdinal,
                  ordinal
                );
                const attemptLine = describeAttemptLine(ordinal);
                return (
                  // Named on the LIST ITEM too, so the placeholder branch below
                  // (which has no `alt` to carry it) is distinguishable as well.
                  <li key={attempt.id} aria-label={attemptName} className="flex flex-col gap-1">
                    {attempt.signedUrl ? (
                      // Plain <img>: a short-lived SIGNED URL on a private bucket
                      // cannot be a stable `next/image` remote pattern, and the
                      // optimizer would cache a credential.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={attempt.signedUrl}
                        alt={attemptName}
                        className="aspect-square w-full rounded-lg object-cover"
                      />
                    ) : (
                      <span className="flex aspect-square w-full items-center justify-center rounded-lg border border-hq-border text-xs text-hq-ink-soft">
                        {copy.state[attemptState]}
                      </span>
                    )}
                    {attempt.failureReason && (
                      <span className="text-pretty text-xs text-hq-ink">
                        {attempt.failureDetail
                          ? `${attempt.failureReason}: ${attempt.failureDetail}`
                          : attempt.failureReason}
                      </span>
                    )}
                    <span className="text-xs text-hq-ink-soft">
                      {attempt.billed ? copy.billed : copy.notBilled} ·{" "}
                      {copy.costLine(
                        attempt.costEstimatedUsd === null
                          ? null
                          : formatUsd(attempt.costEstimatedUsd),
                        attempt.costReportedUsd === null
                          ? null
                          : formatUsd(attempt.costReportedUsd)
                      )}
                      {/* ⚠ ONE RULE, not a second hand-built copy of the
                          numbering `cellAttemptName` already encodes. */}
                      {attemptLine === "" ? "" : ` · ${attemptLine}`}
                    </span>
                    {/* ⚠ THE PROMPT THIS ATTEMPT ACTUALLY SENT, ON THE ATTEMPT.
                        The prompt is a per-model choice now, so a single
                        run-level line could only ever be right for one column —
                        and "this phrasing beat that one on this model" is the
                        question the whole bench exists to answer, which means the
                        phrasing has to be readable beside the picture it
                        produced. Derived vs as-written is stated, never implied
                        by the text looking generic. */}
                    <details className="text-xs text-hq-ink-soft">
                      <summary className="min-h-11 cursor-pointer py-3">
                        {copy.cellPromptHeading(attempt.attemptedAtMs !== null)} ·{" "}
                        {attempt.promptDerived
                          ? copy.cellPromptDerived
                          : copy.cellPromptAuthored}
                      </summary>
                      <pre className="mt-1 max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-hq-border p-2 text-xs text-hq-ink">
                        {attempt.resolvedPrompt === "" ? copy.cellPromptMissing : attempt.resolvedPrompt}
                      </pre>
                    </details>
                  </li>
                );
              })}
            </ul>

            <button
              type="button"
              onClick={() => (neverAttempted ? onGenerate(newest.id) : onRetry(newest.id))}
              // ⚠ DISABLED UNTIL STALENESS for anything still running. The CAS
              // cannot help here: a retry mints a NEW row whose own CAS passes
              // cleanly, so waiting is the only thing that stops a double spend.
              disabled={busy || (!neverAttempted && !retryable)}
              className="mt-3 min-h-11 w-full rounded-lg border border-crm-blue px-3 text-sm font-medium text-hq-ink disabled:opacity-60"
            >
              {neverAttempted ? copy.generate : copy.retry}
            </button>
            <p className="mt-1 text-pretty text-xs text-hq-ink-soft">
              {neverAttempted
                ? copy.generateHint
                : retryable
                  ? copy.retryWarning
                  : copy.retryDisabled(IMAGE_LAB_STALE_MINUTES)}
            </p>
          </section>
        );
      })}
    </div>
  );
}
