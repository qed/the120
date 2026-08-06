"use client";

/**
 * Image Lab — History: the judging surface
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 6; origin R8, R9, R11).
 *
 * Every decision this file renders — which rows are in the keep-rate denominator,
 * what the rate is, how cost is split, which runs a filter admits, whether a
 * verdict may be written, which attempt of a cell a card is, whether an optimistic
 * paint still stands — is a pure function in `./lib/history-rules`, asserted in
 * the node suite. This component takes NONE of its own. (There is no jsdom here;
 * Unit 4's review found nine source-grep "UI tests" that survived deleting the
 * thing they claimed to test, so the decisions live where CI can see them.)
 *
 * ── MOBILE (~390px), AND THE ONE EXPLICIT DESIGN FINDING ───────────────────
 * ONE COLUMN at base, widening at `sm`/`lg`. Every control is at least `min-h-11`
 * (44px). ⚠ NO HOVER-ONLY AFFORDANCE ANYWHERE — the verdict buttons are ALWAYS
 * VISIBLE on every card. A phone has no hover, and a review loop whose primary
 * action appears on mouse-over is a review loop that cannot be done on the device
 * the reviewer is holding. The state labels, the attempt costs and the failure
 * reasons are plain text for the same reason, never a `title` tooltip.
 *
 * ── OPTIMISTIC, WITH A REAL ROLLBACK AND A REAL SETTLE ─────────────────────
 * A click paints immediately, is REVERTED to the exact previous value if the write
 * refuses, and is SETTLED to the server's confirmed value (with the server's
 * stamp) when it succeeds. The reducer is `overrideReducer` in `history-rules`,
 * pure and tested there.
 *
 * ⚠ AND THERE IS NO `router.refresh()` ON EVERY WRITE. There used to be — after
 * every verdict, every note and every tag save — which re-ran the whole page query
 * and re-minted every signed URL, so every `<img src>` changed and the browser
 * re-downloaded every thumbnail. Judging twelve cells on a six-hundred-row page
 * cost thousands of mints and a full image reload each time, on a phone. The
 * optimistic state is what the cards read; the stats block says out loud that it
 * describes the page as loaded.
 */

import { useCallback, useMemo, useReducer, useState } from "react";
import {
  attemptIndexes,
  describeStatsPopulation,
  formatCostLine,
  formatKeepRate,
  heldOverride,
  historyFilterChips,
  keepRateIsMeaningful,
  overrideReducer,
  resolveVerdict,
  EMPTY_OVERRIDES,
  IMAGE_LAB_EVIDENCE_COPY,
  type CostTotals,
  type HistoryFilter,
  type HistoryImageView,
  type HistoryReference,
  type HistoryRunRow,
  type ModelStats,
  type VerdictRefusalReason,
} from "./lib/history-rules";
import { cellRenderState, formatUsd, IMAGE_LAB_RUN_COPY } from "./lib/run-rules";
import {
  IMAGE_LAB_DRILL_TAGS,
  type ImageLabDrillTag,
  type ImageLabVerdict,
} from "./lib/image-lab-rules";
import {
  setImageLabRunDrillTags,
  setImageLabVerdict,
  setImageLabVerdictNote,
} from "./lib/verdict-actions";

const COPY = IMAGE_LAB_EVIDENCE_COPY;

const BUTTON =
  "min-h-11 rounded-lg border px-3 text-sm font-medium transition-colors disabled:opacity-60";

export function HistoryView({
  runs,
  images,
  stats,
  cost,
  serverNowMs,
  filter,
  references,
  totalRuns,
  imagesTruncated,
  imageCap,
}: {
  runs: readonly HistoryRunRow[];
  images: readonly HistoryImageView[];
  stats: readonly ModelStats[];
  cost: CostTotals;
  /** The SERVER's clock. Never `Date.now()` here — the stale label is judged
   *  against the clock that stamped `attempted_at`. */
  serverNowMs: number;
  filter: HistoryFilter;
  references: readonly HistoryReference[];
  totalRuns: number;
  imagesTruncated: boolean;
  imageCap: number;
}) {
  const [overrides, dispatch] = useReducer(overrideReducer, EMPTY_OVERRIDES);
  const [tagOverrides, setTagOverrides] = useState<
    Record<string, readonly ImageLabDrillTag[]>
  >({});
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [announcement, setAnnouncement] = useState<string>("");

  const imagesByRun = useMemo(() => {
    const map = new Map<string, HistoryImageView[]>();
    for (const image of images) {
      const bucket = map.get(image.runId);
      if (bucket) bucket.push(image);
      else map.set(image.runId, [image]);
    }
    return map;
  }, [images]);

  /** ⚠ WHICH ATTEMPT OF ITS CELL EACH ROW IS. Two attempts at one cell used to
   *  render with identical headings and identical aria-labels. */
  const attempts = useMemo(() => attemptIndexes(images), [images]);

  const verdictOf = useCallback(
    (image: HistoryImageView): ImageLabVerdict | null =>
      resolveVerdict(overrides, image),
    [overrides]
  );

  const mark = useCallback((id: string, on: boolean) => {
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const refuse = useCallback((reason: VerdictRefusalReason) => {
    setAnnouncement(`${COPY.verdict.failed} ${COPY.verdict.refusal[reason]}`);
  }, []);

  /**
   * ⚠ PAINT → SETTLE or ROLLBACK, never paint-and-forget.
   *
   * `previous` is captured BEFORE the paint and restored verbatim on refusal.
   * On success the paint is replaced by the CONFIRMED value carrying the server's
   * own `verdict_at`, which is what lets a later render whose row has a NEWER
   * stamp supersede it (`isOverrideSuperseded`).
   */
  const judge = useCallback(
    async (image: HistoryImageView, verdict: ImageLabVerdict | null) => {
      const previous = heldOverride(overrides, image.id);
      dispatch({
        kind: "paint",
        imageId: image.id,
        override: { verdict, basedOnVerdictAtMs: image.verdictAtMs },
      });
      mark(image.id, true);
      try {
        const result = await setImageLabVerdict({ imageId: image.id, verdict });
        if (!result.ok) {
          dispatch({ kind: "rollback", imageId: image.id, previous });
          refuse(result.reason);
          return;
        }
        dispatch({
          kind: "settle",
          imageId: image.id,
          verdict: result.verdict,
          verdictAtMs: result.verdictAtMs,
        });
        setAnnouncement("");
      } catch {
        dispatch({ kind: "rollback", imageId: image.id, previous });
        refuse("unavailable");
      } finally {
        mark(image.id, false);
      }
    },
    [mark, overrides, refuse]
  );

  /**
   * ⚠ A NOTE WRITE TOUCHES NO VERDICT STATE AT ALL.
   *
   * It used to roll back a whole `{verdict, note}` snapshot, so a note that
   * refused pinned the card's VERDICT display to whatever it had been when the
   * textarea was opened. The note lives in the card's own draft state and is
   * rendered nowhere else, so there is nothing here to roll back — only an
   * announcement to make.
   */
  const saveNote = useCallback(
    async (image: HistoryImageView, note: string) => {
      mark(image.id, true);
      try {
        const result = await setImageLabVerdictNote({ imageId: image.id, note });
        if (!result.ok) {
          refuse(result.reason);
          return;
        }
        setAnnouncement(COPY.verdict.noteSaved);
      } catch {
        refuse("unavailable");
      } finally {
        mark(image.id, false);
      }
    },
    [mark, refuse]
  );

  const saveTags = useCallback(
    async (run: HistoryRunRow, tags: readonly ImageLabDrillTag[]) => {
      const previous = tagOverrides[run.id] ?? run.drillTags;
      setTagOverrides((prev) => ({ ...prev, [run.id]: tags }));
      mark(run.id, true);
      try {
        const result = await setImageLabRunDrillTags({ runId: run.id, tags });
        if (!result.ok) {
          setTagOverrides((prev) => ({ ...prev, [run.id]: previous }));
          refuse(result.reason);
          return;
        }
        setAnnouncement("");
      } catch {
        setTagOverrides((prev) => ({ ...prev, [run.id]: previous }));
        refuse("unavailable");
      } finally {
        mark(run.id, false);
      }
    },
    [mark, refuse, tagOverrides]
  );

  const referenceLabel = useCallback(
    (id: string) => references.find((ref) => ref.id === id)?.label || null,
    [references]
  );
  const chips = useMemo(
    () => historyFilterChips(filter, referenceLabel),
    [filter, referenceLabel]
  );

  return (
    <div className="mt-6 flex flex-col gap-8">
      {/* Announcements, not just repaints: the visual delta of a rolled-back
          verdict is one border on a card that may already be off screen. */}
      <p aria-live="polite" className="text-pretty text-sm text-hq-ink">
        {announcement}
      </p>

      {/* ⚠ THE APPLIED FILTER, RENDERED BACK. The parser drops what it does not
          recognize, and these chips are what stop that drop being invisible. */}
      {chips.length > 0 && (
        <section aria-label={COPY.filters.applied}>
          <ul className="flex flex-wrap items-center gap-2">
            <li className="text-xs text-hq-ink-soft">{COPY.filters.applied}</li>
            {chips.map((chip) => (
              <li key={chip.key}>
                <a
                  href={`/staff/image-lab/history${chip.dropQuery}`}
                  aria-label={COPY.filters.drop(chip.label)}
                  className="flex min-h-11 items-center gap-2 rounded-full border border-hq-border px-3 text-xs text-hq-ink"
                >
                  <span>{chip.label}</span>
                  <span aria-hidden="true">×</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <StatsSection
        stats={stats}
        cost={cost}
        filter={filter}
        totalRuns={totalRuns}
        shownRuns={runs.length}
        imagesTruncated={imagesTruncated}
        imageCap={imageCap}
      />

      <section>
        <h3 className="font-path-display text-base text-hq-ink">{COPY.runs.heading}</h3>
        {runs.length === 0 ? (
          <p className="mt-2 text-pretty text-sm text-hq-ink-soft">
            {filter.modelIds.length + filter.drillTags.length + filter.referenceIds.length >
              0 || filter.verdict !== "any"
              ? COPY.runs.empty
              : COPY.runs.unfiltered}
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-6">
            {runs.map((run) => (
              <RunCard
                key={run.id}
                run={run}
                images={imagesByRun.get(run.id) ?? []}
                tags={tagOverrides[run.id] ?? run.drillTags}
                attempts={attempts}
                serverNowMs={serverNowMs}
                busy={busy}
                verdictOf={verdictOf}
                onJudge={judge}
                onSaveNote={saveNote}
                onSaveTags={saveTags}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ── Per-model evidence ───────────────────────────────────────────────────────

function StatsSection({
  stats,
  cost,
  filter,
  totalRuns,
  shownRuns,
  imagesTruncated,
  imageCap,
}: {
  stats: readonly ModelStats[];
  cost: CostTotals;
  /** ⚠ REQUIRED. The stats are computed over the FILTERED set; rendering them
   *  with no filter beside them is how `?verdict=keep` came to show "100% keep
   *  rate" on every card, indistinguishable from an unfiltered page. */
  filter: HistoryFilter;
  totalRuns: number;
  shownRuns: number;
  imagesTruncated: boolean;
  imageCap: number;
}) {
  const population = describeStatsPopulation(filter);
  const showRate = keepRateIsMeaningful(filter);

  return (
    <section>
      <h3 className="font-path-display text-base text-hq-ink">{COPY.stats.heading}</h3>

      <p className="mt-2 text-sm text-hq-ink">
        {COPY.stats.showing(shownRuns, totalRuns)}
      </p>

      {population !== null && (
        <p className="mt-1 text-pretty text-sm font-medium text-hq-ink">{population}</p>
      )}

      {imagesTruncated && (
        <p
          role="status"
          className="mt-2 text-pretty rounded-lg border border-hq-border-strong p-3 text-xs leading-relaxed text-hq-ink"
        >
          {COPY.stats.truncated(imageCap)}
        </p>
      )}

      <p className="mt-2 text-pretty text-xs leading-relaxed text-hq-ink-soft">
        {showRate ? COPY.stats.keepRateNote : COPY.stats.rateSuppressed}
      </p>
      <p className="mt-1 text-pretty text-xs leading-relaxed text-hq-ink-soft">
        {COPY.stats.cellNote}
      </p>
      <p className="mt-1 text-pretty text-xs leading-relaxed text-hq-ink-soft">
        {COPY.stats.liveNote}
      </p>

      {stats.length === 0 ? (
        <p className="mt-3 text-pretty text-sm text-hq-ink-soft">{COPY.stats.empty}</p>
      ) : (
        <ul className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
          {stats.map((model) => (
            <li
              key={model.modelId}
              className="rounded-xl border border-hq-border bg-hq-surface p-4"
            >
              <h4 className="font-path-mono text-sm text-hq-ink">{model.modelId}</h4>

              {showRate && (
                <p className="mt-2 text-2xl text-hq-ink">
                  {formatKeepRate(model.keepRate)}{" "}
                  <span className="text-xs text-hq-ink-soft">
                    {COPY.stats.keepRateLabel}
                  </span>
                </p>
              )}

              {model.keeps + model.rejects === 0 ? (
                <p className="mt-1 text-pretty text-xs text-hq-ink-soft">
                  {COPY.stats.noJudged}
                </p>
              ) : (
                <p className="mt-1 text-xs text-hq-ink-soft">
                  {model.keeps} {COPY.stats.keeps} · {model.rejects} {COPY.stats.rejects}{" "}
                  · {model.keeps + model.rejects} {COPY.stats.judged}
                </p>
              )}

              {/* ⚠ THE COMPLETENESS CAPTION, BESIDE THE RATE AND NOT INSIDE IT.
                  These completions are outside the denominator ON PURPOSE — they
                  measure our review pace, not the model. */}
              <p className="mt-1 text-xs text-hq-ink">
                {model.unjudged} {COPY.stats.unjudged}
              </p>

              {/* ⚠ SEVEN BUCKETS THAT SUM TO `attempts`, plus the cell view. A
                  count a reader cannot reconcile is a count a reader stops
                  trusting — `anomalies` is here for exactly that reason. */}
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <Stat label={COPY.stats.cells} value={model.cells} />
                <Stat
                  label={COPY.stats.attemptsPerCell}
                  value={
                    model.attemptsPerCell === null
                      ? "—"
                      : model.attemptsPerCell.toFixed(2)
                  }
                />
                <Stat label={COPY.stats.completions} value={model.completions} />
                <Stat label={COPY.stats.anomalies} value={model.anomalies} />
                <Stat label={COPY.stats.timeouts} value={model.timeouts} />
                <Stat label={COPY.stats.safetyBlocked} value={model.safetyBlocked} />
                <Stat label={COPY.stats.otherFailures} value={model.otherFailures} />
                <Stat label={COPY.stats.pending} value={model.pending} />
                <Stat label={COPY.stats.stale} value={model.stale} />
              </dl>

              <p className="mt-3 text-pretty text-xs text-hq-ink-soft">
                {formatCostLine(model.cost)}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 rounded-xl border border-hq-border bg-hq-surface p-4">
        <h4 className="font-path-display text-sm text-hq-ink">{COPY.cost.heading}</h4>
        {/* ⚠ TWO FIGURES, SIDE BY SIDE, NEVER ADDED. */}
        <p className="mt-1 text-sm text-hq-ink">{formatCostLine(cost)}</p>
        <p className="mt-2 text-pretty text-xs leading-relaxed text-hq-ink-soft">
          {COPY.cost.footnote}
        </p>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <>
      <dt className="text-hq-ink-soft">{label}</dt>
      <dd className="text-right text-hq-ink">{value}</dd>
    </>
  );
}

// ── One run ──────────────────────────────────────────────────────────────────

function RunCard({
  run,
  images,
  tags,
  attempts,
  serverNowMs,
  busy,
  verdictOf,
  onJudge,
  onSaveNote,
  onSaveTags,
}: {
  run: HistoryRunRow;
  images: readonly HistoryImageView[];
  tags: readonly ImageLabDrillTag[];
  attempts: ReadonlyMap<string, { index: number; of: number }>;
  serverNowMs: number;
  busy: ReadonlySet<string>;
  verdictOf: (image: HistoryImageView) => ImageLabVerdict | null;
  onJudge: (image: HistoryImageView, verdict: ImageLabVerdict | null) => void;
  onSaveNote: (image: HistoryImageView, note: string) => void;
  onSaveTags: (run: HistoryRunRow, tags: readonly ImageLabDrillTag[]) => void;
}) {
  /**
   * ⚠ DERIVED FROM THE `tags` PROP, NOT INITIALIZED FROM IT ONCE.
   *
   * `useState(tags)` reads the prop exactly one time, so the prop fed NOTHING:
   * a refused write rolled `tagOverrides` back to a state no element rendered —
   * the buttons stayed pressed, showing a set the database does not hold — and a
   * newer set arriving from the server left the editor stale, so pressing Save
   * then wrote the STALE set over the newer one. A lost update on a run-level
   * column, which the verdict-level last-write-wins note does not cover.
   *
   * The reset-on-prop-change pattern (React's own "adjusting state when a prop
   * changes") is what makes rollback and refresh both take effect.
   */
  const [draft, setDraft] = useState<{
    from: readonly ImageLabDrillTag[];
    tags: readonly ImageLabDrillTag[];
  }>({ from: tags, tags });
  if (draft.from !== tags) setDraft({ from: tags, tags });
  const draftTags = draft.from === tags ? draft.tags : tags;

  const slotEntries = Object.entries(run.slotValues).filter(
    ([, value]) => typeof value === "string" && value !== ""
  );

  return (
    <li className="rounded-xl border border-hq-border bg-hq-surface p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-path-display text-sm text-hq-ink">
          {new Date(run.createdAtMs).toISOString().slice(0, 16).replace("T", " ")}
        </h4>
        <p className="text-xs text-hq-ink-soft">
          {run.compare ? `${COPY.runs.compare} · ` : ""}
          {run.iteratedOnModel ? `${COPY.runs.iteratedOn(run.iteratedOnModel)} · ` : ""}
          {run.sourceChildId ? `${COPY.runs.sourceChild} · ` : ""}
          {run.staffId.slice(0, 8)}
        </p>
      </header>

      {/* ⚠ THE TEMPLATE AND THE RESOLVED PROMPT ARE BOTH SHOWN, LABELLED. They are
          different artifacts (R10 vs R16) and a reader deciding what to harvest
          must not have to guess which one is on screen. */}
      <dl className="mt-3 flex flex-col gap-2 text-sm">
        <dt className="text-xs uppercase tracking-wide text-hq-ink-soft">
          {COPY.runs.template}
        </dt>
        <dd className="whitespace-pre-wrap break-words rounded-lg border border-hq-border p-2 font-path-mono text-xs text-hq-ink">
          {run.template}
        </dd>
        <dt className="text-xs uppercase tracking-wide text-hq-ink-soft">
          {COPY.runs.resolvedPrompt}
        </dt>
        <dd className="whitespace-pre-wrap break-words rounded-lg border border-hq-border p-2 text-xs text-hq-ink-soft">
          {run.resolvedPrompt}
        </dd>
        <dt className="text-xs uppercase tracking-wide text-hq-ink-soft">
          {COPY.runs.slotValues}
        </dt>
        <dd className="text-xs text-hq-ink-soft">
          {slotEntries.length === 0
            ? COPY.runs.noSlotValues
            : slotEntries.map(([slot, value]) => (
                <span key={slot} className="mr-2 inline-block break-words">
                  <span className="font-path-mono">{slot}</span>: {value}
                </span>
              ))}
        </dd>
        <dt className="text-xs uppercase tracking-wide text-hq-ink-soft">
          {COPY.runs.references}
        </dt>
        <dd className="text-xs text-hq-ink-soft">
          {run.referenceIds.length === 0
            ? COPY.runs.noReferences
            : run.referenceIds.length}
        </dd>
      </dl>

      {/* Drill tags — a RUN-level edit, and the only one on this surface. */}
      <fieldset className="mt-3">
        <legend className="text-xs uppercase tracking-wide text-hq-ink-soft">
          {COPY.verdict.tagsLabel}
        </legend>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {IMAGE_LAB_DRILL_TAGS.map((tag) => {
            const on = draftTags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setDraft({
                    from: tags,
                    tags: on
                      ? draftTags.filter((t) => t !== tag)
                      : [...draftTags, tag],
                  })
                }
                className={`${BUTTON} ${
                  on
                    ? "border-crm-blue bg-hq-surface text-hq-ink"
                    : "border-hq-border text-hq-ink-soft"
                }`}
              >
                {tag}
              </button>
            );
          })}
          <button
            type="button"
            disabled={busy.has(run.id)}
            onClick={() => onSaveTags(run, draftTags)}
            className={`${BUTTON} border-hq-border-strong text-hq-ink`}
          >
            {COPY.verdict.saveTags}
          </button>
        </div>
      </fieldset>

      <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {images.map((image) => (
          <ImageCard
            key={image.id}
            image={image}
            verdict={verdictOf(image)}
            attempt={attempts.get(image.id) ?? { index: 1, of: 1 }}
            serverNowMs={serverNowMs}
            busy={busy.has(image.id)}
            onJudge={onJudge}
            onSaveNote={onSaveNote}
          />
        ))}
      </ul>
    </li>
  );
}

// ── One image, and its always-visible verdict ────────────────────────────────

function ImageCard({
  image,
  verdict,
  attempt,
  serverNowMs,
  busy,
  onJudge,
  onSaveNote,
}: {
  image: HistoryImageView;
  verdict: ImageLabVerdict | null;
  /** Which attempt of its cell this row is, and how many there are. */
  attempt: { index: number; of: number };
  serverNowMs: number;
  busy: boolean;
  onJudge: (image: HistoryImageView, verdict: ImageLabVerdict | null) => void;
  onSaveNote: (image: HistoryImageView, note: string) => void;
}) {
  const [draftNote, setDraftNote] = useState(image.verdictNote);
  const state = cellRenderState(image, serverNowMs);
  /**
   * ⚠ THE ATTEMPT INDEX IS PART OF THE NAME. Two attempts at one cell rendered
   * as "gpt-image-2 candidate 3" twice — same heading, same `aria-label`,
   * different picture, independent Keep buttons. A reader could not tell them
   * apart and a screen-reader user could not tell them apart at all.
   */
  const cellName =
    attempt.of > 1
      ? `${image.modelId} candidate ${image.cellOrdinal + 1}, attempt ${attempt.index} of ${attempt.of}`
      : `${image.modelId} candidate ${image.cellOrdinal + 1}`;
  // ⚠ THE SCHEMA'S RULE, RENDERED: a verdict is a judgement about an IMAGE, so a
  // cell with no image cannot take one (`fp_image_lab_images_verdict_needs_done`).
  // Clearing stays available — a row judged before a late `failed` finalize must
  // remain un-judgeable, not un-clearable.
  const judgeable = image.state === "done";

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-hq-border p-3">
      {image.signedUrl ? (
        // Plain <img>: a short-lived SIGNED URL on a private bucket cannot be a
        // stable `next/image` remote pattern, and the optimizer would cache a
        // credential.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image.signedUrl}
          alt={cellName}
          className="aspect-square w-full rounded-lg object-cover"
        />
      ) : (
        <span className="flex aspect-square w-full items-center justify-center rounded-lg border border-hq-border text-xs text-hq-ink-soft">
          {IMAGE_LAB_RUN_COPY.grid.state[state]}
        </span>
      )}

      <p className="text-xs text-hq-ink-soft">
        {cellName} · {IMAGE_LAB_RUN_COPY.grid.state[state]}
      </p>

      {image.failureReason && (
        <p className="text-pretty text-xs text-hq-ink">
          {image.failureDetail
            ? `${image.failureReason}: ${image.failureDetail}`
            : image.failureReason}
        </p>
      )}

      <p className="text-xs text-hq-ink-soft">
        {image.billed ? IMAGE_LAB_RUN_COPY.grid.billed : IMAGE_LAB_RUN_COPY.grid.notBilled} ·{" "}
        {IMAGE_LAB_RUN_COPY.grid.costLine(
          image.costEstimatedUsd === null ? null : formatUsd(image.costEstimatedUsd),
          image.costReportedUsd === null ? null : formatUsd(image.costReportedUsd)
        )}
      </p>

      {/* ⚠ ALWAYS VISIBLE. Not on hover, not behind a menu, not revealed on focus.
          This is the explicit design finding of the unit: the review loop is the
          product, and on a phone a hover-only control does not exist. */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-label={COPY.verdict.keepLabel(cellName)}
          aria-pressed={verdict === "keep"}
          disabled={busy || !judgeable}
          onClick={() => onJudge(image, "keep")}
          className={`${BUTTON} flex-1 ${
            verdict === "keep"
              ? "border-crm-blue bg-hq-surface text-hq-ink"
              : "border-hq-border text-hq-ink-soft"
          }`}
        >
          {COPY.verdict.keep}
        </button>
        <button
          type="button"
          aria-label={COPY.verdict.rejectLabel(cellName)}
          aria-pressed={verdict === "reject"}
          disabled={busy || !judgeable}
          onClick={() => onJudge(image, "reject")}
          className={`${BUTTON} flex-1 ${
            verdict === "reject"
              ? "border-hq-border-strong bg-hq-surface text-hq-ink"
              : "border-hq-border text-hq-ink-soft"
          }`}
        >
          {COPY.verdict.reject}
        </button>
        <button
          type="button"
          aria-label={COPY.verdict.clearLabel(cellName)}
          disabled={busy || verdict === null}
          onClick={() => onJudge(image, null)}
          className={`${BUTTON} border-hq-border text-hq-ink-soft`}
        >
          {COPY.verdict.clear}
        </button>
      </div>

      {!judgeable && (
        <p className="text-pretty text-xs text-hq-ink-soft">{COPY.verdict.onlyDone}</p>
      )}

      <label className="flex flex-col gap-1 text-xs text-hq-ink-soft">
        <span>{COPY.verdict.noteLabel(cellName)}</span>
        <textarea
          value={draftNote}
          onChange={(event) => setDraftNote(event.target.value)}
          placeholder={COPY.verdict.notePlaceholder}
          rows={2}
          className="w-full rounded-lg border border-hq-border bg-transparent p-2 text-xs text-hq-ink"
        />
      </label>
      <button
        type="button"
        disabled={busy}
        onClick={() => onSaveNote(image, draftNote)}
        className={`${BUTTON} border-hq-border text-hq-ink-soft`}
      >
        {busy ? COPY.verdict.savingNote : COPY.verdict.saveNote}
      </button>
    </li>
  );
}
