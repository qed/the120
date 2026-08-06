/**
 * Image Lab — the evidence surfaces' SEQUENCING, against injected deps
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 6).
 *
 * PLAIN module — no next/supabase/react imports. Every I/O touch arrives as a
 * function on {@link HistoryDeps}, so the sequences below are tested against
 * in-memory fakes (`__tests__/history-core.test.ts`) rather than against a
 * database that does not exist in this suite. `history-loader.ts` builds the real
 * deps from `imageLabDb()`; `verdict-actions.ts` is the wire and holds the gate.
 * The `reference-core` / `run-core` shape, one surface over.
 *
 * ── THE FOUR SEQUENCES ─────────────────────────────────────────────────────
 * 1. HISTORY. Filter the RUNS in the database (the reference filter is a GIN
 *    containment query — R11, and the single most important query in the unit),
 *    read their images, apply the image-level half of the filter in the pure
 *    rules, mint one signed URL per stored object, and derive per-model stats.
 * 2. KIT. Kept images → their runs → group by template.
 * 3. VERDICT. Read the row, decide (pure), write verdict AND verdict_at together.
 * 4. NOTE / TAGS. Independent of the verdict, and of each other.
 *
 * ── FAIL LOUD, NEVER SILENT ────────────────────────────────────────────────
 * Every dep THROWS on a database error and this module maps the throw to a typed
 * `unavailable`. A swallowed list error masquerading as "no runs" would render as
 * an empty History — and History's whole claim is that it is COMPLETE, so an
 * empty page is read as "nothing was ever generated" rather than "the query
 * failed". The one deliberate exception is the signed-URL mint, where a failure
 * costs ONE thumbnail and the row's evidence (state, cost, verdict) still renders
 * — the `loadRunCellViews` posture.
 *
 * ── CROSS-STAFF, DELIBERATELY, AND STATED ──────────────────────────────────
 * Unit 5 scoped `loadImageLabRunCells` to the calling staff member, because that
 * endpoint mints signed URLs for a run named BY ID and an unscoped version would
 * let any staff session pull a colleague's images one guess at a time.
 *
 * These surfaces are the opposite case and take the opposite decision. History
 * and Kit are AGGREGATES whose entire product is a comparison across the bench's
 * work: scoped per staff member, two people running the consistency drill would
 * each see a keep rate computed over half the evidence, with nothing on screen
 * saying so, and the model decision the Lab exists to make would be taken on a
 * silent partition. So reads here span every staff member's runs, the run's
 * `staff_id` is rendered so any row can be attributed, and WRITES are cross-staff
 * too: last-write-wins, single reviewer, said out loud in the surface's copy
 * (`IMAGE_LAB_EVIDENCE_COPY.verdict.lastWriteWins`). The schema has no
 * `verdict_by` column to arbitrate with, and inventing one is a v2 question.
 * Everyone who can reach any of it is an active staff member who passed
 * `requireStaff()`.
 */

import {
  decideNoteWrite,
  decideTagWrite,
  decideVerdictWrite,
  filterHistory,
  perModelStats,
  projectImageView,
  projectKit,
  totalCost,
  verdictPatch,
  historyImageCap,
  IMAGE_LAB_KIT_LIMIT,
  type CostTotals,
  type HistoryFilter,
  type HistoryImageRow,
  type HistoryImageView,
  type HistoryReference,
  type HistoryRunRow,
  type KitGroup,
  type ModelStats,
  type VerdictPatch,
  type VerdictRefusal,
} from "./history-rules";
import type { ImageLabDrillTag, ImageLabVerdict } from "./image-lab-rules";

// ── Deps ─────────────────────────────────────────────────────────────────────

export type HistoryDeps = {
  /** The SERVER's clock. Stale labels and verdict stamps are judged against it. */
  now(): number;
  /**
   * Runs matching the RUN-LEVEL half of the filter, newest first, bounded.
   *
   * ⚠ THE REFERENCE AND TAG TERMS ARE CONTAINMENT (`@>`) QUERIES. The pure
   * `runMatchesFilter` is their mirror and the loader test pins the operator —
   * `&&` (overlap) would answer "used either" where the drill asks "used both".
   */
  listRuns(filter: HistoryFilter): Promise<HistoryRunRow[]>;
  /**
   * How many runs match the run-level half of the filter, IGNORING the limit.
   *
   * ⚠ WITHOUT IT THE PAGE IS A 50-RUN WINDOW PRESENTED AS THE BENCH. The keep
   * rate is the number the Lab exists to produce, and rendering it with no
   * "showing 50 of N" beside it invites the reader to take a window for the whole
   * evidence.
   */
  countRuns(filter: HistoryFilter): Promise<number>;
  listRunsByIds(runIds: readonly string[]): Promise<HistoryRunRow[]>;
  /** ⚠ THE CAP IS PASSED IN, derived from the run limit. See `historyImageCap`. */
  listImagesForRuns(
    runIds: readonly string[],
    limit: number
  ): Promise<HistoryImageRow[]>;
  /** Kept images across every run, newest first, bounded. */
  listKeptImages(limit: number): Promise<HistoryImageRow[]>;
  listReferencesByIds(ids: readonly string[]): Promise<HistoryReference[]>;
  /** The filter control's options. */
  listAllReferences(limit: number): Promise<HistoryReference[]>;
  /**
   * Short-lived signed URLs for a SET of keys, keyed by storage key. MUST NOT
   * THROW — see the header.
   *
   * ⚠ PLURAL, AND THAT IS NOT A MICRO-OPTIMISATION. The singular version ran an
   * unbounded `Promise.all` over up to a thousand rows, once per render, on a
   * page whose stated target device is a phone.
   */
  signUrls(storageKeys: readonly string[]): Promise<ReadonlyMap<string, string>>;
  loadImage(imageId: string): Promise<HistoryImageRow | null>;
  /** Rows matched. Zero means the row vanished between the read and the write. */
  updateVerdict(imageId: string, patch: VerdictPatch): Promise<number>;
  updateNote(imageId: string, note: string): Promise<number>;
  updateRunTags(runId: string, tags: readonly ImageLabDrillTag[]): Promise<number>;
};

// ── 1. History ───────────────────────────────────────────────────────────────

export type HistoryView = {
  ok: true;
  readonly runs: readonly HistoryRunRow[];
  readonly images: readonly HistoryImageView[];
  readonly stats: readonly ModelStats[];
  readonly cost: CostTotals;
  /** Every reference on the bench, for the filter control. */
  readonly references: readonly HistoryReference[];
  /** The SERVER's clock, so the client can anchor staleness against its own. */
  readonly serverNowMs: number;
  readonly filter: HistoryFilter;
  /** Runs matching the filter, IGNORING the limit — "showing N of M". */
  readonly totalRuns: number;
  /**
   * The image read came back AT its ceiling, so the numbers below describe the
   * newest {@link imageCap} attempts rather than every attempt in the runs
   * listed. Surfaced as a banner; never silently pruned.
   */
  readonly imagesTruncated: boolean;
  readonly imageCap: number;
};

export type HistoryResult = HistoryView | { ok: false; reason: "unavailable" };

/**
 * The History page's data.
 *
 * ⚠ THE STATS ARE COMPUTED OVER THE FILTERED SET, and that is a product decision
 * rather than an implementation detail: filtering to `verdict=keep` and reading a
 * 100% keep rate off the result would be a tautology.
 *
 * ⚠ THE FILTER IS THEREFORE PART OF THE RESULT, AND IS RENDERED BESIDE THE
 * NUMBERS. It used not to be passed to the stats block at all, so `?verdict=keep`
 * showed "100% keep rate" on every model card and `?verdict=reject` showed "0%",
 * both screenshot-able and both indistinguishable from an unfiltered page. The
 * surface renders `describeStatsPopulation(filter)` whenever any term is applied,
 * and suppresses the rate entirely under a verdict filter
 * (`keepRateIsMeaningful`). The unfiltered page — the default — is the one that
 * answers the model question.
 */
export async function loadHistoryView(
  deps: HistoryDeps,
  filter: HistoryFilter
): Promise<HistoryResult> {
  // ⚠ DERIVED FROM THE RUN LIMIT, not a flat number. A fixed 1000 against a
  // settable 200-run limit (200 × 12 = 2400) returns ZERO images for the oldest
  // runs, `filterHistory` prunes them, and they vanish beneath copy claiming
  // History is never pruned. See `historyImageCap`.
  const imageCap = historyImageCap(filter.limit);

  let runs: HistoryRunRow[];
  let images: HistoryImageRow[];
  let references: HistoryReference[];
  let totalRuns: number;
  try {
    runs = await deps.listRuns(filter);
    totalRuns = await deps.countRuns(filter);
    images =
      runs.length === 0
        ? []
        : await deps.listImagesForRuns(
            runs.map((r) => r.id),
            imageCap
          );
    references = await deps.listAllReferences(200);
  } catch (e) {
    console.error("[image-lab/history] load failed:", e);
    return { ok: false, reason: "unavailable" };
  }

  // The run-level half already ran in SQL; running it again here is not
  // belt-and-braces theatre — it is what keeps the pure rule and the query
  // honest about being the same rule, and it is free at this cardinality.
  const matched = filterHistory(runs, images, filter);
  const views = await signViews(deps, matched.images);

  return {
    ok: true,
    runs: matched.runs,
    images: views,
    stats: perModelStats(matched.images, deps.now()),
    cost: totalCost(matched.images),
    references,
    serverNowMs: deps.now(),
    filter,
    totalRuns,
    imagesTruncated: images.length >= imageCap,
    imageCap,
  };
}

/**
 * Rows → client views, minting signed URLs in ONE BATCHED CALL.
 *
 * ⚠ BATCHED, NOT AN UNBOUNDED `Promise.all` OVER EVERY ROW. The singular version
 * fanned one request per row over up to a thousand rows; combined with a
 * `router.refresh()` after every verdict, judging twelve cells on a six-hundred
 * row page issued something on the order of seven THOUSAND signed-URL mints — and
 * because every refresh returns fresh URLs, every `<img src>` changed and the
 * browser re-downloaded every thumbnail. The stated target device is a phone.
 *
 * ONE FAILED MINT STILL COSTS ONE THUMBNAIL rather than the page: the evidence a
 * reader needs — state, failure reason, cost, verdict — lives on the ROW, not on
 * the picture, so a cell with a null URL still renders and is still judgeable.
 *
 * ⚠ THE ONLY PLACE `storageKey` IS READ, and {@link projectImageView} is the only
 * thing that reads it. Nothing typed `HistoryImageView` carries it onward.
 */
async function signViews(
  deps: HistoryDeps,
  rows: readonly HistoryImageRow[]
): Promise<HistoryImageView[]> {
  const keys = [
    ...new Set(
      rows
        .map((row) => row.storageKey)
        .filter((key): key is string => key !== null)
    ),
  ];

  let signed: ReadonlyMap<string, string> = new Map();
  try {
    if (keys.length > 0) signed = await deps.signUrls(keys);
  } catch (e) {
    // The dep promises not to throw; if it does, the page is still the answer.
    console.error("[image-lab/history] signed url batch failed:", e);
  }

  return rows.map((row) =>
    projectImageView(row, row.storageKey === null ? null : signed.get(row.storageKey) ?? null)
  );
}

// ── 2. Kit ───────────────────────────────────────────────────────────────────

export type KitView = {
  ok: true;
  readonly groups: readonly KitGroup[];
  readonly keptCount: number;
  /**
   * Kept images that could not be resolved to a run. ⚠ THE FOURTH STATE — with
   * zero groups this is NOT an empty kit, and must never render as one.
   */
  readonly unresolved: number;
  /** The read came back AT its ceiling: older keeps exist and are not here. */
  readonly capped: boolean;
  readonly limit: number;
};

export type KitResultSet = KitView | { ok: false; reason: "unavailable" };

/**
 * The Kit's data: kept results only, grouped by the template behind them.
 *
 * ⚠ FOUR STATES, FOUR RENDERINGS, AND NO TWO MAY SHARE ONE:
 *
 *   1. `ok: false` — the query failed.
 *   2. `groups: []`, `unresolved: 0` — an honestly empty kit. Nothing has been
 *      judged `keep` yet, which is a fact about VERDICTS rather than about runs.
 *   3. `groups: []`, `unresolved > 0` — kept rows EXIST and could not be resolved
 *      to the runs behind them. Rendering this as (2) puts "Nothing kept yet"
 *      over a bench that has kept results.
 *   4. content.
 */
export async function loadKitView(
  deps: HistoryDeps,
  limit: number = IMAGE_LAB_KIT_LIMIT
): Promise<KitResultSet> {
  let kept: HistoryImageRow[];
  let runs: HistoryRunRow[];
  let references: HistoryReference[];
  try {
    kept = await deps.listKeptImages(limit);
    if (kept.length === 0) {
      return { ok: true, groups: [], keptCount: 0, unresolved: 0, capped: false, limit };
    }
    const runIds = [...new Set(kept.map((image) => image.runId))];
    runs = await deps.listRunsByIds(runIds);
    // ⚠ FAIL LOUD ON A SHORT READ (the `listCells` precedent, Unit 5). Without
    // this, `projectKit` drops every kept image whose run did not come back, and
    // in the terminal case the page renders "Nothing kept yet" over a bench that
    // HAS kept results — the exact confusion the Kit's own docblock forbids.
    if (runs.length !== runIds.length) {
      throw new Error(
        `loadKitView: asked for ${runIds.length} runs behind kept images and got ${runs.length}`
      );
    }
    const referenceIds = [...new Set(runs.flatMap((run) => run.referenceIds))];
    references =
      referenceIds.length === 0 ? [] : await deps.listReferencesByIds(referenceIds);
  } catch (e) {
    console.error("[image-lab/kit] load failed:", e);
    return { ok: false, reason: "unavailable" };
  }

  const views = await signViews(deps, kept);
  const { groups, unresolved } = projectKit(runs, views, references);
  return {
    ok: true,
    groups,
    keptCount: groups.reduce((total, group) => total + group.results.length, 0),
    unresolved,
    capped: kept.length >= limit,
    limit,
  };
}

// ── 3. Verdicts ──────────────────────────────────────────────────────────────

export type VerdictResult =
  | {
      ok: true;
      readonly imageId: string;
      readonly verdict: ImageLabVerdict | null;
      readonly verdictAtMs: number | null;
    }
  | VerdictRefusal;

/**
 * Write one image's verdict.
 *
 * ⚠ IT TOUCHES ONE ROW AND TWO COLUMNS. No run-level field is written, so two
 * tabs judging two images of the same run cannot clobber each other — the failure
 * a run-blob write would guarantee.
 *
 * ⚠ IDEMPOTENT. Nothing here reads the current verdict, so `keep` → `reject` →
 * `keep` is three legal writes ending `keep`, and a repeated `keep` changes only
 * the stamp. Last-write-wins is the accepted v1 model (single reviewer) and is
 * stated on the surface.
 *
 * The `state = 'done'` refusal comes from {@link decideVerdictWrite}, BEFORE the
 * database — the CHECK `fp_image_lab_images_verdict_needs_done` would otherwise
 * answer a button press with a 23514 naming a constraint.
 */
export async function recordVerdict(
  deps: HistoryDeps,
  input: { imageId: string; verdict: ImageLabVerdict | null }
): Promise<VerdictResult> {
  let row: HistoryImageRow | null;
  try {
    row = await deps.loadImage(input.imageId);
  } catch (e) {
    console.error("[image-lab/verdict] image read failed:", e);
    return { ok: false, reason: "unavailable" };
  }

  const decision = decideVerdictWrite(row, input.verdict);
  if (!decision.ok) return decision;

  // ⚠ ONE VALUE, BOTH COLUMNS. The schema pairs them
  // (`(verdict is null) = (verdict_at is null)`), and a patch that could carry
  // one without the other is a CHECK violation waiting for a button press.
  const patch = verdictPatch(decision.verdict, deps.now());

  let matched: number;
  try {
    matched = await deps.updateVerdict(input.imageId, patch);
  } catch (e) {
    console.error("[image-lab/verdict] write failed:", e);
    return { ok: false, reason: "unavailable" };
  }
  // The row was read a moment ago and is gone now — a purge landed underneath
  // this click. Reported as not_found rather than as a success that wrote nothing.
  if (matched === 0) return { ok: false, reason: "not_found" };

  return {
    ok: true,
    imageId: input.imageId,
    verdict: patch.verdict,
    verdictAtMs: patch.verdictAtMs,
  };
}

export type NoteResult =
  | { ok: true; readonly imageId: string; readonly note: string }
  | VerdictRefusal;

/**
 * Write one image's note.
 *
 * INDEPENDENT OF THE VERDICT in both directions: a note may be written on an
 * unjudged image (a reviewer writes "hero drifts on the left" before deciding),
 * and changing a verdict never rewrites the note. The schema links them not at
 * all — `verdict_note` is `not null default ''` with no dependency on `verdict`.
 * A non-`done` row may still be annotated: "this timed out twice" is worth
 * recording exactly where it happened.
 */
export async function recordVerdictNote(
  deps: HistoryDeps,
  input: { imageId: string; note: unknown }
): Promise<NoteResult> {
  let row: HistoryImageRow | null;
  try {
    row = await deps.loadImage(input.imageId);
  } catch (e) {
    console.error("[image-lab/verdict] image read failed:", e);
    return { ok: false, reason: "unavailable" };
  }

  const decision = decideNoteWrite(row, input.note);
  if (!decision.ok) return decision;

  let matched: number;
  try {
    matched = await deps.updateNote(input.imageId, decision.note);
  } catch (e) {
    console.error("[image-lab/verdict] note write failed:", e);
    return { ok: false, reason: "unavailable" };
  }
  if (matched === 0) return { ok: false, reason: "not_found" };
  return { ok: true, imageId: input.imageId, note: decision.note };
}

export type TagResult =
  | { ok: true; readonly runId: string; readonly tags: readonly ImageLabDrillTag[] }
  | VerdictRefusal;

/**
 * Write a RUN's drill tags.
 *
 * The one run-level write in this unit, and it touches ONLY `drill_tags` — no
 * verdict, no prompt column, nothing another tab could be editing. Tags are
 * closed to Unit 1's vocabulary here and again by the SQL CHECK
 * (`drill_tags <@ array[…]`), because a client writing `kid_appeal` for
 * `kid-appeal` would drop that run out of every drill filter with no error
 * anywhere.
 */
export async function recordRunTags(
  deps: HistoryDeps,
  input: { runId: string; tags: unknown }
): Promise<TagResult> {
  const decision = decideTagWrite(input.tags);
  if (!decision.ok) return decision;

  let matched: number;
  try {
    matched = await deps.updateRunTags(input.runId, decision.tags);
  } catch (e) {
    console.error("[image-lab/verdict] tag write failed:", e);
    return { ok: false, reason: "unavailable" };
  }
  if (matched === 0) return { ok: false, reason: "not_found" };
  return { ok: true, runId: input.runId, tags: decision.tags };
}
