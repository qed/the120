/**
 * Image Lab — the EVIDENCE surfaces' pure rules: filter composition, the
 * keep-rate maths, cost aggregation, and the Kit projection
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 6; origin R8, R9, R10, R11).
 *
 * PLAIN module — no next/supabase/react imports — because this repo runs
 * `environment: "node"` with NO jsdom. Unit 4's review proved the alternative
 * empirically: NINE source-scan "UI tests" survived deleting the component they
 * claimed to test. So every decision the History and Kit surfaces take is made
 * HERE and asserted in `__tests__/history-rules.test.ts`; the components render
 * what these functions return and decide nothing.
 *
 * ── WHY THIS MODULE IS THE UNIT'S POINT ────────────────────────────────────
 * The Lab exists to answer ONE question — which model do we build the panel
 * engine on — and the answer is a number this file computes. Two ways to get it
 * wrong are already documented in the migration header and in Unit 1's
 * {@link KEEP_RATE_EXCLUDED_FAILURES}, and both push the SAME direction:
 *
 *   1. FOLDING OUR OWN FAILURES INTO THE MODEL'S SCORE. A `timeout` is our
 *      adapter budget; a `safety_blocked` on the Gemini models is a pending
 *      `personGeneration` allowlist. Counting either against the model biases the
 *      comparison toward whichever vendor we are worst at CALLING, which is the
 *      opposite of what the bench measures.
 *   2. SUMMING ESTIMATED AND REPORTED COST. They are two measurements of the same
 *      money — a registry list price and the gateway's own figure — and adding
 *      them double-counts every cell that has both. They are displayed side by
 *      side and never added.
 *   3. DIVIDING BY `done` RATHER THAN BY `keeps + rejects`. An unjudged completion
 *      is an artifact of OUR REVIEW PACE, exactly as a timeout is an artifact of
 *      our adapter budget — and admitting one while excluding the other made a
 *      half-reviewed model score lower for being unfinished. THE FORMULA IS
 *      `keeps / (keeps + rejects)`, and `unjudged` is reported beside it as a
 *      completeness caption rather than folded into it.
 *   4. COUNTING ROWS RATHER THAN CELLS. Retry APPENDS a row at the same
 *      `(run_id, model_id, cell_ordinal)`, so a row count makes iteration itself
 *      read as failure — and hides the inverse abuse of retrying until one lands
 *      and judging only the winner. The rate reads the latest eligible attempt
 *      PER CELL; `attemptsPerCell` shows the iteration beside it.
 *
 * ── WHAT IT DELIBERATELY DOES NOT OWN ──────────────────────────────────────
 * The closed sets (verdicts, drill tags, failure reasons, the excluded-failure
 * set) are Unit 1's and are IMPORTED, never re-spelled. `formatUsd` and the
 * staleness render rule are Unit 5's, likewise. A second copy of "which failures
 * are ours" is a second answer to the question the Lab exists to settle.
 */

import {
  isImageStale,
  isImageLabDrillTag,
  isImageLabVerdict,
  IMAGE_LAB_DRILL_TAGS,
  IMAGE_LAB_STALE_AFTER_MS,
  KEEP_RATE_EXCLUDED_FAILURES,
  type ImageLabDrillTag,
  type ImageLabFailureReason,
  type ImageLabImageState,
  type ImageLabVerdict,
} from "./image-lab-rules";
import {
  formatUsd,
  hashSignature,
  IMAGE_LAB_MAX_CELLS_PER_RUN,
  type SlotValues,
} from "./run-rules";

// ── Rows, as the evidence surfaces reason about them ─────────────────────────

/**
 * One image row. INTERNAL — it carries `storageKey`, which is why
 * {@link projectImageView} exists and why nothing typed as this may cross to the
 * browser.
 */
export type HistoryImageRow = {
  readonly id: string;
  readonly runId: string;
  readonly modelId: string;
  readonly cellOrdinal: number;
  readonly state: ImageLabImageState;
  readonly attemptedAtMs: number | null;
  readonly createdAtMs: number;
  readonly failureReason: ImageLabFailureReason | null;
  readonly failureDetail: string | null;
  readonly storageKey: string | null;
  readonly billed: boolean;
  readonly costEstimatedUsd: number | null;
  readonly costReportedUsd: number | null;
  readonly verdict: ImageLabVerdict | null;
  readonly verdictNote: string;
  readonly verdictAtMs: number | null;
};

/** One run row, as History renders it. */
export type HistoryRunRow = {
  readonly id: string;
  readonly staffId: string;
  readonly template: string;
  readonly slotValues: SlotValues;
  readonly resolvedPrompt: string;
  readonly referenceIds: readonly string[];
  readonly drillTags: readonly ImageLabDrillTag[];
  readonly note: string;
  readonly compare: boolean;
  readonly iteratedOnModel: string | null;
  readonly iteratedFromRunId: string | null;
  readonly sourceChildId: string | null;
  readonly createdAtMs: number;
};

/** A reference, named. History shows labels; the picker owns the thumbnails. */
export type HistoryReference = {
  readonly id: string;
  readonly label: string;
};

/**
 * One image AS THE CLIENT SEES IT.
 *
 * ⚠ `storageKey` IS STRUCTURALLY ABSENT, not merely unset — `Omit` makes a leak a
 * compile error rather than a review miss. The bucket is private, so a raw key is
 * not a credential; but it is the INPUT to one, and a UI that holds keys is a UI
 * whose next feature mints URLs from them client-side. The `RunCellView` posture
 * from Unit 5, applied to the two surfaces that render the most images.
 */
export type HistoryImageView = Omit<HistoryImageRow, "storageKey"> & {
  readonly hasObject: boolean;
  readonly signedUrl: string | null;
};

/**
 * Row → client view, in ONE place.
 *
 * The destructure is the mechanism: `storageKey` is bound to a local that is
 * never used, so it cannot ride along in the spread. `hasObject` carries the one
 * fact the UI actually needed from it — "there are bytes behind this row" — which
 * is what lets a cell whose signed-URL mint FAILED still render as an image that
 * exists rather than as a blank.
 */
export function projectImageView(
  row: HistoryImageRow,
  signedUrl: string | null
): HistoryImageView {
  const { storageKey, ...rest } = row;
  return { ...rest, hasObject: storageKey !== null, signedUrl };
}

// ── Filters ──────────────────────────────────────────────────────────────────

/** `unjudged` is a filter, not a verdict: "nothing has decided this yet". */
export const HISTORY_VERDICT_FILTERS = ["any", "keep", "reject", "unjudged"] as const;
export type HistoryVerdictFilter = (typeof HISTORY_VERDICT_FILTERS)[number];

/**
 * The four filters, composed with AND (origin R11).
 *
 * Empty array = "any", never "none". A filter whose empty state excluded
 * everything would render an empty History on first load, which is
 * indistinguishable from a broken query.
 */
export type HistoryFilter = {
  /** Image-level: which model produced the attempt. */
  readonly modelIds: readonly string[];
  /** Image-level. */
  readonly verdict: HistoryVerdictFilter;
  /** Run-level: the run must carry EVERY selected tag. */
  readonly drillTags: readonly ImageLabDrillTag[];
  /**
   * Run-level: the run must carry EVERY selected reference.
   *
   * ⚠ CONTAINMENT (`@>`), NOT OVERLAP (`&&`), AND THAT IS THE WHOLE POINT OF R11.
   * The consistency drill is "this hero sheet, in every run that used it" — and
   * with two sheets selected the question is "which runs used BOTH", not "which
   * used either". Overlap would silently widen every multi-reference filter into
   * a union and quietly answer a different question than the one asked.
   */
  readonly referenceIds: readonly string[];
  readonly limit: number;
};

/** How many runs one History page reads. */
export const IMAGE_LAB_HISTORY_RUN_LIMIT = 50;
/** The ceiling a hand-edited `?limit=` may ask for. */
export const IMAGE_LAB_HISTORY_MAX_LIMIT = 200;
/** How many kept results the Kit reads. */
export const IMAGE_LAB_KIT_LIMIT = 100;
/** Bound on any one filter list, so a hand-rolled query cannot ask for 10k ids. */
export const IMAGE_LAB_FILTER_MAX_VALUES = 16;

/**
 * How many RETRIES a cell is budgeted for when sizing the image read.
 *
 * ⚠ THE IMAGE CAP IS DERIVED FROM THE RUN LIMIT, NEVER A FLAT NUMBER. A flat
 * 1000-row cap against a settable 200-run limit (200 × 12 cells = 2400 rows) does
 * not "truncate" — the read is ordered by run, so the OLDEST runs come back with
 * ZERO images, {@link filterHistory}'s withImages rule prunes them, and they
 * vanish from a page whose own copy says "History is complete by design — nothing
 * is ever pruned". Stats and cost then describe the surviving suffix. Asking for
 * MORE runs would show FEWER.
 */
export const IMAGE_LAB_RETRY_HEADROOM = 2;

/** The image-row ceiling for a page reading `limit` runs. */
export function historyImageCap(limit: number): number {
  const runs = Math.max(1, Math.min(limit, IMAGE_LAB_HISTORY_MAX_LIMIT));
  return runs * IMAGE_LAB_MAX_CELLS_PER_RUN * IMAGE_LAB_RETRY_HEADROOM;
}
/** Mirrors `fp_image_lab_images_verdict_note_bounded` in the migration. */
export const IMAGE_LAB_VERDICT_NOTE_MAX_CHARS = 2000;

export const EMPTY_HISTORY_FILTER: HistoryFilter = {
  modelIds: [],
  verdict: "any",
  drillTags: [],
  referenceIds: [],
  limit: IMAGE_LAB_HISTORY_RUN_LIMIT,
};

/** Query-string keys, named once so the parser and the link builder agree. */
export const HISTORY_QUERY_KEYS = {
  model: "model",
  verdict: "verdict",
  tag: "tag",
  reference: "ref",
  limit: "limit",
} as const;

/** A uuid, loosely — enough to keep junk out of a `.contains()` array. */
const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Model ids are NOT validated against the registry.
 *
 * A model retired from `model-registry.ts` still has history rows, and those rows
 * are exactly the evidence a reader comes to History for. Narrowing to the live
 * registry would make retiring an entry silently delete its past. Bounded by
 * shape instead.
 */
const MODEL_ID_PATTERN = /^[A-Za-z0-9._-]{1,120}$/;

const asList = (raw: string | readonly string[] | undefined): string[] => {
  if (raw === undefined) return [];
  const values = Array.isArray(raw) ? raw : [raw as string];
  return values
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter((value) => value !== "");
};

const dedupe = <T>(values: readonly T[]): T[] => [...new Set(values)];

/**
 * Search params → a filter, TOTAL and never throwing.
 *
 * Unrecognized values are DROPPED rather than refused: the input is a URL a staff
 * member can hand-edit and a stale bookmark should degrade to a wider view, not
 * to an error page.
 *
 * ⚠ A DROP IS ONLY ACCEPTABLE BECAUSE THE APPLIED FILTER IS RENDERED BACK. This
 * docblock used to justify the silence by pointing at "filter chips" that did not
 * exist — {@link historyFilterToQuery} had no caller at all — so a hand-built
 * `?ref=A&ref=B` narrowed to one term on the next Apply, WIDENING the result set
 * with nothing on screen saying so. {@link historyFilterChips} is the promise
 * being kept, and the History page renders it.
 */
export function parseHistoryFilter(
  raw: Record<string, string | string[] | undefined> | undefined,
  defaultLimit: number = IMAGE_LAB_HISTORY_RUN_LIMIT
): HistoryFilter {
  const params = raw ?? {};

  const modelIds = dedupe(asList(params[HISTORY_QUERY_KEYS.model]))
    .filter((id) => MODEL_ID_PATTERN.test(id))
    .slice(0, IMAGE_LAB_FILTER_MAX_VALUES);

  const verdictRaw = asList(params[HISTORY_QUERY_KEYS.verdict])[0];
  const verdict = (HISTORY_VERDICT_FILTERS as readonly string[]).includes(
    verdictRaw ?? ""
  )
    ? (verdictRaw as HistoryVerdictFilter)
    : "any";

  const drillTags = dedupe(asList(params[HISTORY_QUERY_KEYS.tag]))
    .filter(isImageLabDrillTag)
    .slice(0, IMAGE_LAB_DRILL_TAGS.length);

  const referenceIds = dedupe(asList(params[HISTORY_QUERY_KEYS.reference]))
    .filter((id) => UUID_PATTERN.test(id))
    .map((id) => id.toLowerCase())
    .slice(0, IMAGE_LAB_FILTER_MAX_VALUES);

  const limitRaw = Number(asList(params[HISTORY_QUERY_KEYS.limit])[0]);
  const limit =
    Number.isInteger(limitRaw) && limitRaw > 0
      ? Math.min(limitRaw, IMAGE_LAB_HISTORY_MAX_LIMIT)
      : defaultLimit;

  return { modelIds, verdict, drillTags, referenceIds, limit };
}

/**
 * The filter as a query string, so a rendered chip can drop one term.
 *
 * ⚠ `limit` ROUND-TRIPS. It did not, so a hand-set `?limit=200` was silently
 * discarded on the next Apply and the page quietly went back to 50 runs while the
 * URL still said 200. It is emitted only when it differs from the default, so an
 * untouched filter still serializes to the empty string.
 */
export function historyFilterToQuery(filter: HistoryFilter): string {
  const params = new URLSearchParams();
  for (const id of filter.modelIds) params.append(HISTORY_QUERY_KEYS.model, id);
  if (filter.verdict !== "any") params.set(HISTORY_QUERY_KEYS.verdict, filter.verdict);
  for (const tag of filter.drillTags) params.append(HISTORY_QUERY_KEYS.tag, tag);
  for (const id of filter.referenceIds) params.append(HISTORY_QUERY_KEYS.reference, id);
  if (filter.limit !== IMAGE_LAB_HISTORY_RUN_LIMIT) {
    params.set(HISTORY_QUERY_KEYS.limit, String(filter.limit));
  }
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}

export function isHistoryFilterActive(filter: HistoryFilter): boolean {
  return (
    filter.modelIds.length > 0 ||
    filter.verdict !== "any" ||
    filter.drillTags.length > 0 ||
    filter.referenceIds.length > 0
  );
}

/**
 * ONE APPLIED FILTER TERM, with the query that DROPS it.
 *
 * The chips are what make the parser's silent drops honest: whatever the URL
 * asked for, this is what the page actually applied, and each chip links to the
 * same page without that term.
 */
export type HistoryFilterChip = {
  readonly key: string;
  readonly label: string;
  /** The query string for this filter MINUS this term. */
  readonly dropQuery: string;
};

/**
 * Every applied term, as a chip.
 *
 * `labelFor` names a reference; an id with no label (retired, or from another
 * page) is shown as its own short id rather than dropped, because a term the page
 * applied and did not name is exactly the invisibility the chips exist to end.
 */
export function historyFilterChips(
  filter: HistoryFilter,
  labelFor: (referenceId: string) => string | null = () => null
): HistoryFilterChip[] {
  const chips: HistoryFilterChip[] = [];
  const copy = IMAGE_LAB_EVIDENCE_COPY.filters;

  for (const id of filter.modelIds) {
    chips.push({
      key: `model:${id}`,
      label: `${copy.model}: ${id}`,
      dropQuery: historyFilterToQuery({
        ...filter,
        modelIds: filter.modelIds.filter((m) => m !== id),
      }),
    });
  }
  if (filter.verdict !== "any") {
    chips.push({
      key: "verdict",
      label: `${copy.verdict}: ${copy.verdictOptions[filter.verdict]}`,
      dropQuery: historyFilterToQuery({ ...filter, verdict: "any" }),
    });
  }
  for (const tag of filter.drillTags) {
    chips.push({
      key: `tag:${tag}`,
      label: `${copy.tag}: ${tag}`,
      dropQuery: historyFilterToQuery({
        ...filter,
        drillTags: filter.drillTags.filter((t) => t !== tag),
      }),
    });
  }
  for (const id of filter.referenceIds) {
    chips.push({
      key: `ref:${id}`,
      label: `${copy.reference}: ${labelFor(id) ?? id.slice(0, 8)}`,
      dropQuery: historyFilterToQuery({
        ...filter,
        referenceIds: filter.referenceIds.filter((r) => r !== id),
      }),
    });
  }
  return chips;
}

/**
 * Does this RUN pass the run-level half of the filter?
 *
 * ⚠ `every`, NOT `some`, ON BOTH SETS. This function is the pure mirror of the
 * SQL `reference_ids @> array[…]::uuid[]` / `drill_tags @> array[…]` the loader
 * issues, and the two must agree exactly — a rule that said `some` here would
 * describe an overlap query while the loader ran a containment one, and only one
 * of them would be tested.
 */
export function runMatchesFilter(
  run: Pick<HistoryRunRow, "referenceIds" | "drillTags">,
  filter: HistoryFilter
): boolean {
  const references = new Set(run.referenceIds);
  if (!filter.referenceIds.every((id) => references.has(id))) return false;
  const tags = new Set<string>(run.drillTags);
  return filter.drillTags.every((tag) => tags.has(tag));
}

/** Does this IMAGE pass the image-level half (model, verdict)? */
export function imageMatchesFilter(
  image: Pick<HistoryImageRow, "modelId" | "verdict">,
  filter: HistoryFilter
): boolean {
  if (filter.modelIds.length > 0 && !filter.modelIds.includes(image.modelId)) {
    return false;
  }
  switch (filter.verdict) {
    case "any":
      return true;
    case "unjudged":
      return image.verdict === null;
    default:
      return image.verdict === filter.verdict;
  }
}

/**
 * Both halves, composed.
 *
 * A run survives only if it passes the run-level half AND still has at least one
 * image passing the image-level half — a run whose every gpt-image-2 cell is
 * filtered out is not a "gpt-image-2 run with no images", it is not in the answer
 * at all.
 */
export function filterHistory<R extends HistoryRunRow, I extends HistoryImageRow>(
  runs: readonly R[],
  images: readonly I[],
  filter: HistoryFilter
): { runs: R[]; images: I[] } {
  const eligibleRuns = runs.filter((run) => runMatchesFilter(run, filter));
  const runIds = new Set(eligibleRuns.map((run) => run.id));
  const matchedImages = images.filter(
    (image) => runIds.has(image.runId) && imageMatchesFilter(image, filter)
  );
  const withImages = new Set(matchedImages.map((image) => image.runId));
  return {
    runs: eligibleRuns.filter((run) => withImages.has(run.id)),
    images: matchedImages,
  };
}

// ── The keep-rate maths (the unit's reason to exist) ──────────────────────────

/** Is this failure OURS rather than the model's answer? (Unit 1's set.) */
export function isExcludedFailure(
  reason: ImageLabFailureReason | null
): boolean {
  return (
    reason !== null &&
    (KEEP_RATE_EXCLUDED_FAILURES as readonly string[]).includes(reason)
  );
}

/**
 * IS THIS ROW ELIGIBLE TO BE SCORED AT ALL?
 *
 * ⚠ THIS IS THE ELIGIBILITY PREDICATE, NOT THE DENOMINATOR. The denominator is
 * `keeps + rejects` over the LATEST ELIGIBLE ATTEMPT PER CELL
 * ({@link latestScoredPerCell}); this decides which rows may enter that at all.
 *
 *   * `requested` rows are out — including STALE ones. Stale is a derived render
 *     label over a non-finalized row (Unit 1's `isImageStale`), never a persisted
 *     state, so a tab someone closed can never dilute a model's score.
 *   * `failed` rows are out. A failure is not a judgement about an image, because
 *     there is no image; the schema enforces that too
 *     (`fp_image_lab_images_verdict_needs_done`).
 *   * and the belt-and-braces clause: a `done` row that ALSO carries an excluded
 *     failure reason is out.
 *
 * That last clause looks vacuous against today's schema, and it is not. The
 * migration header describes the exact row it defends against: a killed function
 * finalizes `failed` with `timeout`, the vendor call lands afterwards and
 * finalizes `done` over it. The biconditional CHECK
 * (`fp_image_lab_images_done_iff_object`) makes that a constraint violation
 * GOING FORWARD; it says nothing about a row written before it, by a hand-run
 * fix, or under a partially applied migration. And the cost of trusting the
 * constraint is specific: that single row would sit in the NUMERATOR while the
 * DENOMINATOR excluded it, pushing keep rate above 100% for precisely the
 * flakiest model. Which is why {@link perModelStats} counts keeps only WITHIN
 * this predicate — keeps ⊆ eligible, always — and why {@link ModelStats.anomalies}
 * reports the row rather than swallowing it.
 */
export function isKeepRateDenominatorRow(
  row: Pick<HistoryImageRow, "state" | "failureReason">
): boolean {
  return row.state === "done" && !isExcludedFailure(row.failureReason);
}

/**
 * ⚠ THE FORMULA: keeps / (keeps + rejects). THE DENOMINATOR IS JUDGED, NOT DONE.
 *
 * Dividing by DONE admits an artifact of OUR REVIEW PACE into the vendor's score,
 * which is the same mistake the excluded-failure set exists to prevent one layer
 * down. A model with 10 done, 5 judged, 5 kept read 50%; a fully-reviewed model
 * with 6 keeps of 10 read 60% — so the less-reviewed model scored LOWER purely
 * for being unfinished, and finishing the review could only ever move it. The
 * unit deliberately excludes our own timeouts so as not to score the vendor for
 * our artifacts; unjudged completions are the same category of thing.
 *
 * `unjudged` is reported BESIDE the rate as a completeness caption instead — it
 * is the reader's cue that the number is provisional, which is a fact about the
 * bench rather than about the model.
 *
 * NULL, NOT ZERO AND NEVER NaN. `0/0` is NaN, which renders as "NaN%" and reads
 * as a bug; but a flat 0 would claim a model scored zero when in fact it was
 * never scored at all. The surfaces render null as "—" beside an explicit
 * "0 of 0 judged".
 */
export function keepRate(keeps: number, rejects: number): number | null {
  const judged = keeps + rejects;
  return judged > 0 ? keeps / judged : null;
}

/**
 * The key that identifies ONE CELL across every attempt at it.
 *
 * `\u0000` because a run id, a model id and an ordinal joined by any printable
 * separator can in principle collide with a model id containing that separator.
 */
/**
 * The minimum needed to place an attempt in its cell and order it there.
 *
 * Deliberately STRUCTURAL rather than `HistoryImageRow`, because the same
 * grouping must run over `HistoryImageView` on the client (which has no
 * `storageKey`) and over `HistoryImageRow` on the server. Two implementations of
 * "which cell is this" would be two answers to the question the rate depends on.
 */
export type CellIdentity = {
  readonly id: string;
  readonly runId: string;
  readonly modelId: string;
  readonly cellOrdinal: number;
  readonly createdAtMs: number;
};

const cellKey = (row: CellIdentity): string =>
  `${row.runId}\u0000${row.modelId}\u0000${row.cellOrdinal}`;

/**
 * ⚠ ATTEMPTS AT ONE CELL, NEWEST FIRST — the ordering `buildGrid` uses, for the
 * reason `buildGrid` documents: every cell of one run shares a `created_at`
 * byte-for-byte (transaction timestamp), so a comparator reading only the
 * timestamp hands the runtime's sort a free choice of which attempt is "newest".
 * The row id is the tie-break.
 */
const newestFirst = (a: CellIdentity, b: CellIdentity): number =>
  b.createdAtMs - a.createdAtMs || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/** One cell, and every attempt at it. */
export type HistoryCell<T extends CellIdentity = HistoryImageRow> = {
  readonly runId: string;
  readonly modelId: string;
  readonly cellOrdinal: number;
  /** Newest first. Never empty. */
  readonly attempts: readonly T[];
};

/**
 * Rows → cells, keyed by `(runId, modelId, cellOrdinal)`.
 *
 * ⚠ RETRY APPENDS A ROW; IT DOES NOT REPLACE ONE. `canRetryCell` lets a reviewer
 * retry a `done` cell for a better variant, so counting ROWS makes iteration
 * itself look like failure: three attempts with one kept reads 33% for a cell the
 * reviewer considers a success. The inverse abuse — retry until one lands, judge
 * only the winner — is equally invisible to a row count. Counting CELLS scores
 * the outcome, and `attemptsPerCell` makes the iteration visible beside it rather
 * than penalising it.
 */
export function groupCells<T extends CellIdentity>(
  rows: readonly T[]
): HistoryCell<T>[] {
  const byCell = new Map<string, T[]>();
  for (const row of rows) {
    const key = cellKey(row);
    const bucket = byCell.get(key);
    if (bucket) bucket.push(row);
    else byCell.set(key, [row]);
  }
  return [...byCell.values()].map((attempts) => {
    const sorted = [...attempts].sort(newestFirst);
    const head = sorted[0]!;
    return {
      runId: head.runId,
      modelId: head.modelId,
      cellOrdinal: head.cellOrdinal,
      attempts: sorted,
    };
  });
}

/**
 * The LATEST DONE attempt at each cell — the keep-rate population.
 *
 * "Latest DONE", not "latest": a cell whose newest attempt timed out but whose
 * previous attempt produced a kept image is still a cell this model delivered.
 * Taking the newest row unconditionally would let one of OUR timeouts erase a
 * verdict, which is the excluded-failure bug wearing a different hat.
 */
export function latestScoredPerCell(
  rows: readonly HistoryImageRow[]
): HistoryImageRow[] {
  return groupCells(rows)
    .map((cell) => cell.attempts.find(isKeepRateDenominatorRow))
    .filter((row): row is HistoryImageRow => row !== undefined);
}

/**
 * WHICH ATTEMPT OF THIS CELL IS THIS? 1-based, newest LAST.
 *
 * Two attempts at one cell rendered with identical headings and identical
 * `aria-label`s — "gpt-image-2 candidate 3" twice, with different pictures and
 * independent Keep buttons. That is a correctness problem for the reader and an
 * accessibility defect for anyone navigating by label.
 */
export function attemptIndexes(
  rows: readonly CellIdentity[]
): Map<string, { index: number; of: number }> {
  const indexes = new Map<string, { index: number; of: number }>();
  for (const cell of groupCells(rows)) {
    const oldestFirst = [...cell.attempts].reverse();
    oldestFirst.forEach((row, i) => {
      indexes.set(row.id, { index: i + 1, of: oldestFirst.length });
    });
  }
  return indexes;
}

/** "62%" / "—". One formatter, so two surfaces cannot disagree about rounding. */
export function formatKeepRate(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

/**
 * Everything one model's row set says, per model.
 *
 * The three failure buckets are SEPARATE on purpose: `timeouts` and
 * `safetyBlocked` are ours (adapter budget; pending allowlist), `otherFailures`
 * are the vendor's. Only the last belongs in a sentence about how good a model
 * is — and none of the three can reach the keep-rate denominator, which is
 * `keeps + rejects` over the latest eligible attempt per CELL.
 *
 * ⚠ THE SEVEN CENSUS BUCKETS SUM TO `attempts`, EXACTLY, and there is a test that
 * says so. A count a reader cannot reconcile is a count a reader stops trusting.
 */
export type ModelStats = {
  readonly modelId: string;

  // ── The row census. These SEVEN buckets sum to `attempts`, exactly. ────────
  /** Rows of every kind, for this model. */
  readonly attempts: number;
  /** `done`, with no excluded failure reason. */
  readonly completions: number;
  /**
   * ⚠ A `done` ROW CARRYING AN EXCLUDED FAILURE REASON — a DATA-INTEGRITY signal,
   * surfaced as its own count.
   *
   * It used to be in `attempts` and in no other bucket, so the rendered counts
   * visibly did not sum and the reader had no way to reconcile them. The row is
   * the one the migration header describes: a killed function finalized
   * `failed`/`timeout`, the vendor call landed afterwards and finalized `done`
   * over it. It is in neither half of the ratio, and now it is not invisible.
   */
  readonly anomalies: number;
  /** OUR artifact — the adapter budget. Never in the denominator. */
  readonly timeouts: number;
  /** OUR artifact — the pending personGeneration allowlist. Never in it either. */
  readonly safetyBlocked: number;
  /** The vendor's own failures: provider_error, rate_limited, unconfigured. */
  readonly otherFailures: number;
  /** Non-finalized and young enough that a call may still be running. */
  readonly pending: number;
  /** Non-finalized and past the staleness window. */
  readonly stale: number;

  // ── The score, computed over CELLS rather than rows. ──────────────────────
  /** Distinct `(runId, modelId, cellOrdinal)` positions this model was asked for. */
  readonly cells: number;
  /** `attempts / cells`, so iteration is VISIBLE rather than penalised. */
  readonly attemptsPerCell: number | null;
  /** Cells whose latest DONE attempt exists — the population that could be judged. */
  readonly scoredCells: number;
  readonly keeps: number;
  readonly rejects: number;
  /** ⚠ NOT IN THE DENOMINATOR. The completeness caption beside the rate. */
  readonly unjudged: number;
  /** keeps / (keeps + rejects). Null when nothing has been judged. */
  readonly keepRate: number | null;

  readonly cost: CostTotals;
};

/**
 * Per-model evidence, one row per model present in the set.
 *
 * `serverNowMs` MUST come from the server — the same clock that stamped
 * `attempted_at`. A browser fifteen minutes fast would report every in-flight
 * cell as stale, which is a caption error here rather than a spend error, but it
 * is the same clock discipline Unit 5 established and there is no reason to have
 * two.
 */
export function perModelStats(
  rows: readonly HistoryImageRow[],
  serverNowMs: number,
  staleAfterMs: number = IMAGE_LAB_STALE_AFTER_MS
): ModelStats[] {
  const byModel = new Map<string, HistoryImageRow[]>();
  for (const row of rows) {
    const bucket = byModel.get(row.modelId);
    if (bucket) bucket.push(row);
    else byModel.set(row.modelId, [row]);
  }

  return [...byModel.entries()]
    .map(([modelId, modelRows]): ModelStats => {
      // ⚠ ONE PREDICATE, USED FOR BOTH HALVES OF THE RATIO — and applied to ONE
      // ROW PER CELL. Counting keeps over the whole row set while dividing by a
      // subset is the >100% bug the migration header documents; counting rows
      // rather than cells makes iteration read as failure.
      const scored = latestScoredPerCell(modelRows);
      const keeps = scored.filter((row) => row.verdict === "keep").length;
      const rejects = scored.filter((row) => row.verdict === "reject").length;

      const done = modelRows.filter((row) => row.state === "done");
      const failed = modelRows.filter((row) => row.state === "failed");
      const nonFinal = modelRows.filter((row) => row.state === "requested");
      const stale = nonFinal.filter((row) =>
        isImageStale(row, serverNowMs, staleAfterMs)
      ).length;
      const cells = groupCells(modelRows).length;

      return {
        modelId,
        attempts: modelRows.length,
        completions: done.filter((row) => !isExcludedFailure(row.failureReason)).length,
        anomalies: done.filter((row) => isExcludedFailure(row.failureReason)).length,
        timeouts: failed.filter((row) => row.failureReason === "timeout").length,
        safetyBlocked: failed.filter((row) => row.failureReason === "safety_blocked")
          .length,
        otherFailures: failed.filter((row) => !isExcludedFailure(row.failureReason))
          .length,
        pending: nonFinal.length - stale,
        stale,

        cells,
        attemptsPerCell: cells > 0 ? modelRows.length / cells : null,
        scoredCells: scored.length,
        keeps,
        rejects,
        unjudged: scored.length - keeps - rejects,
        keepRate: keepRate(keeps, rejects),

        cost: aggregateCost(modelRows),
      };
    })
    .sort((a, b) => (a.modelId < b.modelId ? -1 : a.modelId > b.modelId ? 1 : 0));
}

// ── Cost ─────────────────────────────────────────────────────────────────────

/**
 * Two measurements of the same money, HELD APART.
 *
 * ⚠ THEY ARE NEVER SUMMED. `estimatedUsd` is the registry list price stamped at
 * finalize; `reportedUsd` is the gateway's own figure where the image modality
 * supplies one (registry: `costReporting` is UNVERIFIED for every launch model,
 * so a null reported figure is EXPECTED, not a bug). Adding them would
 * double-count every cell that carries both and would produce a total that is
 * neither what we predicted nor what we were charged.
 *
 * The counts ride along so the display can say "reported for 3 of 12 cells"
 * rather than presenting a partial total as a complete one — a $0.10 reported
 * figure over twelve cells is not a cheap run, it is one measurement.
 */
export type CostTotals = {
  /** Cells with `billed = true`: the only rows that may carry cost at all. */
  readonly billedCount: number;
  readonly estimatedUsd: number;
  readonly estimatedCount: number;
  readonly reportedUsd: number;
  readonly reportedCount: number;
};

/** Money, to the millionth — floating addition of 0.0336 twelve times otherwise
 *  renders "$0.40320000000000005" (the `estimateRunCostUsd` precedent). */
const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

/**
 * Cost over a row set.
 *
 * ⚠ ONLY `billed` ROWS CONTRIBUTE, mirroring the schema's
 * `fp_image_lab_images_cost_needs_billed`. `attempted_at` means "we latched this
 * cell"; `billed` means "this will appear on the invoice", and an `unconfigured`
 * row (bench off) is latched but never dialled. Reading cost off unbilled rows
 * would invent spend.
 *
 * ⚠ A BILLED-BUT-FAILED ROW STILL COUNTS. Vendors bill on GENERATION, not on
 * delivery, so an `adapter_timeout` is money that left the building
 * (`isBilledOutcome`). Excluding it would understate spend on exactly the slowest
 * model — while the keep-rate denominator separately excludes the same rows.
 * Both errors push the same way, and together they would favour the worst vendor.
 */
export function aggregateCost(
  rows: readonly Pick<
    HistoryImageRow,
    "billed" | "costEstimatedUsd" | "costReportedUsd"
  >[]
): CostTotals {
  let estimatedUsd = 0;
  let estimatedCount = 0;
  let reportedUsd = 0;
  let reportedCount = 0;
  let billedCount = 0;

  for (const row of rows) {
    if (!row.billed) continue;
    billedCount += 1;
    if (row.costEstimatedUsd !== null && Number.isFinite(row.costEstimatedUsd)) {
      estimatedUsd += row.costEstimatedUsd;
      estimatedCount += 1;
    }
    if (row.costReportedUsd !== null && Number.isFinite(row.costReportedUsd)) {
      reportedUsd += row.costReportedUsd;
      reportedCount += 1;
    }
  }

  return {
    billedCount,
    estimatedUsd: round6(estimatedUsd),
    estimatedCount,
    reportedUsd: round6(reportedUsd),
    reportedCount,
  };
}

/**
 * The cost line, with BOTH figures LABELLED and never added.
 *
 * The reported half is omitted entirely when nothing reported, rather than shown
 * as "$0.00 reported" — a zero there would read as "the gateway says this was
 * free", which is the opposite of "the gateway said nothing".
 */
export function formatCostLine(cost: CostTotals): string {
  const estimated = `${formatUsd(cost.estimatedUsd)} estimated (${cost.estimatedCount} of ${cost.billedCount} billed)`;
  if (cost.reportedCount === 0) {
    return `${estimated} · ${IMAGE_LAB_EVIDENCE_COPY.cost.noneReported}`;
  }
  return `${estimated} · ${formatUsd(cost.reportedUsd)} reported (${cost.reportedCount} of ${cost.billedCount})`;
}

/** Totals across every model, computed from the ROWS — never by summing the
 *  per-model lines, which would make a rounding drift compound. */
export function totalCost(rows: readonly HistoryImageRow[]): CostTotals {
  return aggregateCost(rows);
}

// ── Verdict writes ───────────────────────────────────────────────────────────

export type VerdictRefusalReason =
  | "not_found"
  | "not_done"
  | "invalid_verdict"
  | "invalid_tag"
  | "note_too_long"
  | "unavailable";

export type VerdictRefusal = { ok: false; reason: VerdictRefusalReason };

/**
 * The verdict patch, WITH ITS TIMESTAMP, as one indivisible value.
 *
 * ⚠ THE SCHEMA PAIRS THEM: `(verdict is null) = (verdict_at is null)`. Writing
 * one without the other is not a lint issue, it is a CHECK violation that reaches
 * the staff member as an opaque Postgres error on a button press. Returning both
 * from one function is what makes "write them together" structural rather than
 * remembered — there is no way to call this and get only one.
 */
export type VerdictPatch = {
  readonly verdict: ImageLabVerdict | null;
  readonly verdictAtMs: number | null;
};

export function verdictPatch(
  verdict: ImageLabVerdict | null,
  nowMs: number
): VerdictPatch {
  return verdict === null
    ? { verdict: null, verdictAtMs: null }
    : { verdict, verdictAtMs: nowMs };
}

/**
 * May this verdict be written to this row?
 *
 * ⚠ REFUSES A NON-`done` ROW BEFORE THE DATABASE DOES. The CHECK
 * `fp_image_lab_images_verdict_needs_done` would refuse it too — as a 23514 with
 * a constraint name in it, which is the worst possible answer to a staff member
 * who just clicked Keep on a cell that failed while they were looking at it. This
 * turns that into a sentence.
 *
 * IDEMPOTENT BY CONSTRUCTION: nothing here reads the CURRENT verdict, so keep →
 * reject → keep is three legal writes ending `keep`, and a repeated keep is a
 * legal write that changes nothing but the stamp. Last-write-wins is the accepted
 * v1 model (single reviewer; the schema has no `verdict_by` column to arbitrate
 * with) and is stated in the surface's copy.
 */
export function decideVerdictWrite(
  row: Pick<HistoryImageRow, "state"> | null,
  verdict: unknown
): { ok: true; verdict: ImageLabVerdict | null } | VerdictRefusal {
  if (row === null) return { ok: false, reason: "not_found" };
  // ⚠ CLEARING IS ALLOWED ON ANY ROW. `verdict = null` is the schema's legal
  // state for every row regardless of state, and a cell that failed AFTER being
  // judged (the late `failed` finalize) must remain un-judgeable, not un-clearable.
  if (verdict === null) return { ok: true, verdict: null };
  if (typeof verdict !== "string" || !isImageLabVerdict(verdict)) {
    return { ok: false, reason: "invalid_verdict" };
  }
  if (row.state !== "done") return { ok: false, reason: "not_done" };
  return { ok: true, verdict };
}

/** Notes are independent of the verdict — the schema links them not at all, and
 *  "why I rejected this" is written before the click as often as after. */
export function decideNoteWrite(
  row: Pick<HistoryImageRow, "state"> | null,
  note: unknown
): { ok: true; note: string } | VerdictRefusal {
  if (row === null) return { ok: false, reason: "not_found" };
  if (typeof note !== "string") return { ok: false, reason: "note_too_long" };
  if (note.length > IMAGE_LAB_VERDICT_NOTE_MAX_CHARS) {
    return { ok: false, reason: "note_too_long" };
  }
  return { ok: true, note };
}

/**
 * Drill tags, closed to Unit 1's vocabulary.
 *
 * ⚠ THEY LIVE ON THE RUN, NOT ON THE IMAGE (`fp_image_lab_runs.drill_tags`), and
 * that is deliberate: a drill is a thing you set out to do, and its evidence is
 * every cell of the run. So this is the ONE write in this unit that touches a
 * run-level column — it touches ONLY that column, never a verdict, so two tabs
 * judging different images of one run can never clobber each other.
 *
 * Closed here AND in SQL (`drill_tags <@ array[…]`), because a client writing
 * `kid_appeal` for `kid-appeal` would drop that run out of every drill filter
 * with no error anywhere.
 */
export function decideTagWrite(
  tags: unknown
): { ok: true; tags: ImageLabDrillTag[] } | VerdictRefusal {
  if (!Array.isArray(tags)) return { ok: false, reason: "invalid_tag" };
  const seen: ImageLabDrillTag[] = [];
  for (const tag of tags) {
    if (!isImageLabDrillTag(tag)) return { ok: false, reason: "invalid_tag" };
    if (!seen.includes(tag)) seen.push(tag);
  }
  return { ok: true, tags: seen };
}

// ── The Kit projection ───────────────────────────────────────────────────────

/** One kept result, with everything that produced it. */
export type KitResult = {
  readonly imageId: string;
  readonly runId: string;
  readonly modelId: string;
  readonly slotValues: SlotValues;
  readonly resolvedPrompt: string;
  readonly referenceLabels: readonly string[];
  readonly drillTags: readonly ImageLabDrillTag[];
  readonly verdictNote: string;
  readonly createdAtMs: number;
  readonly signedUrl: string | null;
  readonly hasObject: boolean;
};

/**
 * The Kit's unit: ONE TEMPLATE, and every kept result it produced.
 *
 * Grouped by the template TEXT rather than by run, because the template is what
 * the panel engine inherits — the same `{{slot}}` template kept on two models in
 * two runs is ONE thing to harvest with two pieces of evidence behind it, and
 * showing it twice would invite copying the same prompt twice.
 */
export type KitGroup = {
  /**
   * A stable short name for the template text — a REACT KEY, and nothing else.
   *
   * ⚠ IT IS NOT THE GROUPING KEY, AND IT MUST NOT BECOME ONE AGAIN. It is a
   * 32-bit FNV-1a hash, so two different templates collide roughly once in four
   * billion — and on a collision the two would share a group and `kitCopyText`
   * would hand over the WRONG template, which is the single failure the Kit
   * exists to prevent. The template text is in hand at grouping time, so the map
   * is keyed on the text itself and the hash is derived afterwards.
   */
  readonly templateKey: string;
  /** ⚠ THE `{{slot}}` TEMPLATE, VERBATIM. What {@link kitCopyText} yields. */
  readonly template: string;
  readonly results: readonly KitResult[];
  readonly modelIds: readonly string[];
};

/**
 * The Kit, and the FOURTH STATE beside it.
 *
 * `groups: []` with `unresolved: 0` is an honestly empty kit — nothing has been
 * judged `keep`. `groups: []` with `unresolved > 0` is something else entirely:
 * kept rows EXIST and could not be resolved to the runs that produced them. The
 * two must never share a rendering, for the same reason a failed query must not
 * render as an empty one.
 */
export type KitProjection = {
  readonly groups: readonly KitGroup[];
  /** Kept images whose run was not in the page. A data-integrity signal. */
  readonly unresolved: number;
};

/**
 * Kept results only, grouped by template.
 *
 * ⚠ `verdict === "keep"` IS THE WHOLE FILTER, and it is applied to IMAGES, never
 * to runs. A run with one kept cell out of four contributes that one cell; the
 * other three were judged and rejected, and putting them in the Kit would make
 * "kept" mean nothing.
 */
export function projectKit(
  runs: readonly HistoryRunRow[],
  images: readonly HistoryImageView[],
  references: readonly HistoryReference[]
): KitProjection {
  const runById = new Map(runs.map((run) => [run.id, run]));
  const labelById = new Map(references.map((ref) => [ref.id, ref.label]));

  // ⚠ KEYED ON THE TEMPLATE TEXT ITSELF, never on its hash. See KitGroup.
  const groups = new Map<string, KitResult[]>();
  let unresolved = 0;

  const kept = images
    .filter((image) => image.verdict === "keep")
    .sort((a, b) => b.createdAtMs - a.createdAtMs || (a.id < b.id ? 1 : -1));

  for (const image of kept) {
    const run = runById.get(image.runId);
    // ⚠ COUNTED, NOT SWALLOWED. A kept image whose run is missing has nothing to
    // harvest — the template IS the product here — but dropping it silently is
    // how the page came to render "Nothing kept yet" over a bench that HAS kept
    // results, which its own docblock forbids. `loadKitView` fails loud on the
    // short read that causes it; this is the second line of that defence.
    if (!run) {
      unresolved += 1;
      continue;
    }

    const results = groups.get(run.template) ?? [];
    results.push({
      imageId: image.id,
      runId: run.id,
      modelId: image.modelId,
      slotValues: run.slotValues,
      resolvedPrompt: run.resolvedPrompt,
      referenceLabels: run.referenceIds.map(
        (id) => labelById.get(id) ?? IMAGE_LAB_EVIDENCE_COPY.kit.unknownReference
      ),
      drillTags: run.drillTags,
      verdictNote: image.verdictNote,
      createdAtMs: image.createdAtMs,
      signedUrl: image.signedUrl,
      hasObject: image.hasObject,
    });
    groups.set(run.template, results);
  }

  return {
    groups: [...groups.entries()].map(([template, results]) => ({
      templateKey: hashSignature(template),
      template,
      results,
      modelIds: [...new Set(results.map((result) => result.modelId))],
    })),
    unresolved,
  };
}

/**
 * WHAT THE COPY BUTTON YIELDS: the `{{slot}}` template, VERBATIM.
 *
 * ⚠ NOT THE RESOLVED PROMPT, and this is the single most load-bearing line in the
 * Kit. The resolved prompt has one child's product name and pitch baked into it —
 * copying that into the panel engine would hardcode one child's business into a
 * template meant to be filled from every child's record, AND it would carry that
 * child's authored text into a new home nobody audited. The template is the
 * artifact; the slot values are shown BESIDE it so the reader can see what filled
 * it without the copy carrying them.
 */
export function kitCopyText(group: Pick<KitGroup, "template">): string {
  return group.template;
}

// ── The optimistic paint, as a PURE REDUCER ──────────────────────────────────

/**
 * ONE CARD'S UNCONFIRMED-OR-JUST-CONFIRMED VERDICT.
 *
 * ⚠ IT CARRIES THE SERVER STAMP IT WAS COMPUTED FROM, and that is the fix for
 * two separate defects at once:
 *
 *   1. THE ENTRY WAS NEVER CLEARED ON SUCCESS. A card could contradict the stats
 *      block on the same screen indefinitely, because the paint outlived every
 *      later render of the row it painted over.
 *   2. A FAILED **NOTE** SAVE PINNED THE CARD'S **VERDICT**. The rollback wrote a
 *      whole `{verdict, note}` snapshot, so a note that refused froze the verdict
 *      display at whatever it had been when the textarea was opened. Notes are
 *      not in this state at all now — the textarea holds the draft, and the note
 *      is not rendered anywhere else — so a note write cannot touch a verdict.
 *
 * `basedOnVerdictAtMs` is what makes a NEWER SERVER STAMP SUPERSEDE a stale local
 * paint: when the row comes back carrying a later `verdict_at` than this paint
 * knew about, somebody else's answer is newer and the paint is discarded.
 */
export type VerdictOverride = {
  readonly verdict: ImageLabVerdict | null;
  readonly basedOnVerdictAtMs: number | null;
};

/** Keyed by image id. */
export type OverrideState = Readonly<Record<string, VerdictOverride>>;

export const EMPTY_OVERRIDES: OverrideState = {};

export type OverrideAction =
  /** A click, painted before the server has answered. */
  | { readonly kind: "paint"; readonly imageId: string; readonly override: VerdictOverride }
  /** The server said yes, WITH its stamp. The paint becomes the confirmed value. */
  | {
      readonly kind: "settle";
      readonly imageId: string;
      readonly verdict: ImageLabVerdict | null;
      readonly verdictAtMs: number | null;
    }
  /** The server refused. Restore exactly what was there — `null` = nothing was. */
  | {
      readonly kind: "rollback";
      readonly imageId: string;
      readonly previous: VerdictOverride | null;
    };

export function overrideReducer(
  state: OverrideState,
  action: OverrideAction
): OverrideState {
  switch (action.kind) {
    case "paint":
      return { ...state, [action.imageId]: action.override };
    case "settle":
      return {
        ...state,
        [action.imageId]: {
          verdict: action.verdict,
          basedOnVerdictAtMs: action.verdictAtMs,
        },
      };
    case "rollback": {
      if (action.previous !== null) {
        return { ...state, [action.imageId]: action.previous };
      }
      // ⚠ DELETED, not set to a guessed value. "There was no override" is a
      // different state from "the override happens to equal the server's value",
      // and only the first lets the next server render through.
      const { [action.imageId]: _dropped, ...rest } = state;
      void _dropped;
      return rest;
    }
  }
}

/** Is this paint older than what the server now says? */
export function isOverrideSuperseded(
  held: VerdictOverride,
  image: Pick<HistoryImageView, "verdictAtMs">
): boolean {
  if (image.verdictAtMs === null) return false;
  if (held.basedOnVerdictAtMs === null) return true;
  return image.verdictAtMs > held.basedOnVerdictAtMs;
}

/** What the card RENDERS: the local paint, unless the server has moved past it. */
export function resolveVerdict(
  state: OverrideState,
  image: Pick<HistoryImageView, "id" | "verdict" | "verdictAtMs">
): ImageLabVerdict | null {
  const held = state[image.id];
  if (held === undefined || isOverrideSuperseded(held, image)) return image.verdict;
  return held.verdict;
}

/** The paint to restore if the write refuses — `null` when there was none. */
export function heldOverride(
  state: OverrideState,
  imageId: string
): VerdictOverride | null {
  return state[imageId] ?? null;
}

// ── Component-owned logic, PULLED OUT OF THE COMPONENTS ─────────────────────

/**
 * ⚠ THESE THREE ARE HERE BECAUSE THEY ARE REAL BRANCHES THAT `environment:
 * "node"` CANNOT REACH INSIDE A `.tsx`.
 *
 * The alternative was the anti-pattern Unit 4's review killed: source scans over
 * a component, nine of which survived deleting the component they claimed to
 * test. A branch that matters either lives somewhere a test can call it, or it is
 * untested. These lived in `KitView`/`HistoryView` and now live here, called from
 * both.
 */

/** The clipboard write's outcome, as the sentence the surface announces. */
export function describeCopyOutcome(copied: boolean): string {
  // ⚠ FAILURE IS REPORTED, never swallowed: `navigator.clipboard` is unavailable
  // on an insecure origin and can be denied by permission, and a button that
  // silently does nothing teaches a reviewer that the Kit is broken. The template
  // is on screen and selectable, so the fallback is honest advice.
  return copied ? IMAGE_LAB_EVIDENCE_COPY.kit.copied : IMAGE_LAB_EVIDENCE_COPY.kit.copyFailed;
}

/**
 * Slot values worth rendering: present, a string, and non-empty.
 *
 * `SlotValues` is `Partial<Record<slot, string>>` and a composer that touched a
 * field and cleared it leaves `""` behind — rendering "product: " with nothing
 * after it reads as a value that IS empty rather than one that was never given.
 */
export function filledSlotEntries(values: SlotValues): [string, string][] {
  return Object.entries(values).filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === "string" && entry[1] !== ""
  );
}

/**
 * WHAT A THUMBNAIL SLOT SHOWS — the client half of the {@link projectImageView}
 * contract.
 *
 * Three cases, and collapsing any two of them loses the distinction the
 * projection exists to carry: `"image"` (bytes exist and we hold a URL),
 * `"unavailable"` (bytes exist, the mint failed — the row is still evidence and
 * still judgeable), `"missing"` (there are no bytes at all).
 */
export type ThumbnailState = "image" | "unavailable" | "missing";

export function thumbnailState(
  view: Pick<HistoryImageView, "signedUrl" | "hasObject">
): ThumbnailState {
  if (view.signedUrl !== null) return "image";
  return view.hasObject ? "unavailable" : "missing";
}

// ── The population a number describes ────────────────────────────────────────

/**
 * ⚠ WHICH POPULATION PRODUCED THESE NUMBERS — rendered, not merely intended.
 *
 * The stats are computed over the FILTERED set, which is a defensible product
 * decision and an indefensible one to leave unsaid: `?verdict=keep` rendered
 * "100% keep rate" on every model card and `?verdict=reject` rendered "0%", both
 * screenshot-able and both indistinguishable from an unfiltered page.
 *
 * So: whenever any filter is active this sentence appears beside the stats, and
 * whenever the VERDICT filter is active the rate is not rendered at all — under
 * `verdict=keep` the rate is a restatement of the filter, not a measurement.
 */
export function describeStatsPopulation(filter: HistoryFilter): string | null {
  if (!isHistoryFilterActive(filter)) return null;
  const terms: string[] = [];
  if (filter.modelIds.length > 0) terms.push(`model ${filter.modelIds.join(" or ")}`);
  if (filter.verdict !== "any") {
    terms.push(
      `verdict "${IMAGE_LAB_EVIDENCE_COPY.filters.verdictOptions[filter.verdict]}"`
    );
  }
  if (filter.drillTags.length > 0) terms.push(`drill tags ${filter.drillTags.join(" + ")}`);
  if (filter.referenceIds.length > 0) {
    terms.push(
      `${filter.referenceIds.length} reference image${filter.referenceIds.length === 1 ? "" : "s"}`
    );
  }
  return `${IMAGE_LAB_EVIDENCE_COPY.stats.populationPrefix} ${terms.join("; ")}.`;
}

/** May a keep rate be shown at all for this filter? */
export function keepRateIsMeaningful(filter: HistoryFilter): boolean {
  return filter.verdict === "any";
}

// ── Copy ─────────────────────────────────────────────────────────────────────

/**
 * ALL user-facing evidence-surface strings, in ONE constant (the `run-rules` /
 * `shell-rules` precedent). Copy lives beside the rules that choose between
 * copies, so an outcome can never be rendered by a string the decision does not
 * know about.
 */
export const IMAGE_LAB_EVIDENCE_COPY = {
  filters: {
    heading: "Filters",
    hint: "Filters compose: a run must match every one of them.",
    model: "Model",
    verdict: "Verdict",
    tag: "Drill tag",
    reference: "Reference image",
    any: "Any",
    apply: "Apply filters",
    clear: "Clear filters",
    /** ⚠ NAMES THE SEMANTICS. With two references selected this returns runs that
     *  used BOTH, and a reader who assumed "either" would misread an empty result
     *  as "nobody used these sheets". */
    referenceHint:
      "Selecting a reference finds the runs that attached it — the consistency drill, retrieved as a set. Select two (ctrl/cmd-click, or drag) and only runs carrying BOTH are shown.",
    /** ⚠ SAYS THE CONTROL IS MULTI-VALUE, because the containment copy above is a
     *  lie under a single-value select. */
    multiHint: "These accept more than one value — hold ctrl (⌘ on a Mac) to add.",
    applied: "Showing",
    drop: (term: string) => `Remove the filter ${term}`,
    limit: "Runs to read",
    /** An id the page applied but the registry no longer lists. Rendered as a
     *  SELECTED option so the control can never read "Any" over single-model
     *  stats. */
    retiredModel: (id: string) => `${id} (no longer listed)`,
    verdictOptions: {
      any: "Any",
      keep: "Kept",
      reject: "Rejected",
      unjudged: "Not judged yet",
    } as Record<HistoryVerdictFilter, string>,
    noReferences: "No reference images uploaded yet.",
  },

  stats: {
    heading: "Per-model evidence",
    /** ⚠ THE FOOTNOTE IS NOT DECORATION. Without it a reader treats the keep rate
     *  as "how good this model is", which is exactly the misreading the excluded
     *  set exists to prevent. */
    keepRateNote:
      "Keep rate is keeps ÷ (keeps + rejects) — the images someone actually JUDGED. Completed images nobody has judged yet are NOT in the denominator; they are reported beside the rate as “not judged” so you can see how provisional the number is. Queued and stale cells are in neither half, and timeouts and safety blocks are counted separately below — both are OUR artifacts (the adapter's own budget; a pending personGeneration allowlist), so folding them in would score the vendor we are worst at calling.",
    /** ⚠ THE CELL RULE, SAID OUT LOUD. Retry appends a row, so a row count would
     *  make iteration read as failure. */
    cellNote:
      "One cell counts once, however many times it was retried: the rate reads the latest completed attempt at each cell, and “attempts per cell” beside it shows how much iteration it took.",
    /** Without a refresh on every write, the counts are a snapshot. Say so. */
    liveNote:
      "These counts describe the page as loaded. Verdicts you record now are shown on the cards immediately and are folded into these numbers the next time the page loads.",
    populationPrefix: "These numbers describe only the attempts matching",
    /** Under `?verdict=keep` a keep rate is a restatement of the filter. */
    rateSuppressed:
      "No keep rate is shown while a verdict filter is applied — over a filtered verdict the rate only restates the filter.",
    completions: "completed",
    anomalies: "completed after a failure",
    keeps: "kept",
    rejects: "rejected",
    unjudged: "not judged",
    judged: "judged",
    cells: "cells",
    attemptsPerCell: "attempts per cell",
    keepRateLabel: "keep rate",
    timeouts: "timed out",
    safetyBlocked: "safety blocked",
    otherFailures: "other failures",
    pending: "in flight",
    stale: "no answer",
    noJudged: "0 of 0 judged — nothing has been judged, so there is no rate to show.",
    empty: "No attempts match these filters, so there is nothing to compare yet.",
    showing: (shown: number, total: number) =>
      `Showing ${shown} of ${total} run${total === 1 ? "" : "s"}.`,
    /** ⚠ THE CAP, ADMITTED. Silently pruning whole runs beneath copy that says
     *  "nothing is ever pruned" is the worst available outcome. */
    truncated: (cap: number) =>
      `This page hit its ceiling of ${cap} image rows, so the statistics and cost below describe the newest ${cap} attempts rather than every attempt in the runs listed. Narrow the filters or lower the run count to get a complete answer.`,
  },

  cost: {
    heading: "Cost",
    noneReported: "nothing reported by the gateway",
    /** ⚠ THE UNDERCOUNT, STATED. A cost line that looks complete and is not is
     *  worse than one that admits its floor. */
    footnote:
      "Estimated and reported are two measurements of the same money and are never added together. Both are a FLOOR: a generation we killed mid-flight can still have been billed with nothing recorded, and a caller-abort after dispatch is billed-unknown. Reported is blank wherever the gateway supplies no figure for image modality — which is expected, not a fault.",
  },

  runs: {
    heading: "Runs",
    empty:
      "No runs match these filters. History is complete by design — nothing is ever pruned — so widen the filters rather than looking for expired runs.",
    unfiltered:
      "No runs yet. Compose one on the Bench and it appears here the moment it is created — before any model is called.",
    loadFailed: {
      headline: "History could not be loaded.",
      body:
        "The query failed, so this page is showing nothing rather than showing a partial answer as if it were complete. Reload; if it persists the bench's database handle is the place to look.",
    },
    template: "Template",
    resolvedPrompt: "What this run sent",
    slotValues: "Slot values",
    references: "References",
    drillTags: "Drill tags",
    compare: "Compare run",
    iteratedOn: (model: string) => `Prompt iterated on ${model}`,
    sourceChild: "Built from a child's business content",
    noSlotValues: "No slot values — the template was sent as written.",
    noReferences: "No references attached.",
    noTags: "No drill tag.",
  },

  verdict: {
    heading: "Verdict",
    keep: "Keep",
    reject: "Reject",
    clear: "Clear",
    keepLabel: (cell: string) => `Keep ${cell}`,
    rejectLabel: (cell: string) => `Reject ${cell}`,
    clearLabel: (cell: string) => `Clear the verdict on ${cell}`,
    noteLabel: (cell: string) => `Note on ${cell}`,
    notePlaceholder: "Why this one? (saved separately from the verdict)",
    saveNote: "Save note",
    savingNote: "Saving…",
    noteSaved: "Note saved.",
    /** ⚠ THE SINGLE-REVIEWER MODEL, SAID OUT LOUD. There is no `verdict_by`
     *  column to arbitrate with, so the honest thing is to tell the reader. */
    lastWriteWins:
      "Verdicts are last-write-wins: this bench has one reviewer, so a second person judging the same image simply replaces the first answer.",
    onlyDone:
      "Only a completed image can be judged. This cell has no image, so Keep and Reject are unavailable — clearing an existing verdict still works.",
    tagsLabel: "Drill tags for this run",
    saveTags: "Save tags",
    failed: "That change did not save, so it has been rolled back.",
    refusal: {
      not_found: "That image no longer exists, so nothing was written.",
      not_done:
        "That cell has no completed image, so it cannot be judged. Nothing was written.",
      invalid_verdict: "That is not a verdict this bench records.",
      invalid_tag: "That is not a drill tag this bench records.",
      note_too_long: `A note is capped at ${IMAGE_LAB_VERDICT_NOTE_MAX_CHARS} characters.`,
      unavailable: "The bench is unreachable right now. Nothing was written.",
    } as Record<VerdictRefusalReason, string>,
  },

  kit: {
    heading: "Kit",
    /** ⚠ EXPLICIT, and it says WHY it is empty — the Kit is derived from
     *  verdicts, so it stays empty until someone judges, not until someone
     *  generates. A blank page is indistinguishable from a broken query. */
    empty: {
      headline: "Nothing kept yet.",
      body:
        "The Kit is derived from verdicts, not from runs: it fills up when you mark a result Keep in History, not when you generate one. Judge a few results and the templates that earned their keep collect here, ready to copy.",
    },
    loadFailed: {
      headline: "The kit could not be loaded.",
      body:
        "The query failed, so nothing is shown rather than a partial harvest presented as the whole one. Reload; if it persists the bench's database handle is the place to look.",
    },
    copy: "Copy template",
    copied: "Template copied.",
    copyFailed: "Copy failed — select the template text and copy it by hand.",
    /** The three thumbnail cases, named. See `thumbnailState`. */
    thumbnail: {
      image: "",
      unavailable: "image unavailable",
      missing: "no image",
    } as Record<ThumbnailState, string>,
    /** ⚠ SAYS WHAT THE BUTTON GIVES YOU, because the difference matters. */
    copyHint:
      "Copy yields the {{slot}} template exactly as written — not the resolved prompt. The slot values below show what filled it for this result; the panel engine fills the same slots from a child's record.",
    templateHeading: "Template",
    slotValuesHeading: "Slot values behind this result",
    resolvedHeading: "Resolved prompt as sent",
    referencesHeading: "References",
    keptCount: (n: number) => `${n} kept result${n === 1 ? "" : "s"}`,
    /** ⚠ THE FOURTH STATE. Kept rows EXIST and could not be resolved to the runs
     *  that produced them — which is not "nothing kept yet", and rendering it as
     *  that is the confusion this surface's own docblock forbids. */
    unresolved: {
      headline: "Some kept results could not be assembled.",
      body: (n: number) =>
        `${n} kept image${n === 1 ? " has" : "s have"} no run record on this page, so the template behind ${n === 1 ? "it" : "them"} cannot be shown. This is a data problem, not an empty kit — the bench HAS kept results. Reload; if it persists the runs behind those images are the place to look.`,
    },
    /** The Kit reads a bounded window. A window presented as the whole harvest is
     *  a harvest somebody will believe is complete. */
    capped: (limit: number) =>
      `Showing the newest ${limit} kept results. Older keeps are not on this page.`,
    unknownReference: "a reference that is no longer listed",
    noReferences: "No references attached.",
    noSlotValues: "No slot values — the template was sent as written.",
  },
} as const;
