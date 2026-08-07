import "server-only";

/**
 * Image Lab — the evidence surfaces' I/O layer: the real {@link HistoryDeps}
 * built on the service-role client
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 6).
 *
 * Kept OUT of the `"use server"` action file so none of these becomes a
 * client-callable Server Action, and out of `history-core.ts` so the sequencing
 * stays testable in a node suite with no database. The `run-loader.ts` /
 * `reference-loader.ts` shape.
 *
 * ⚠ EVERY TOUCH GOES THROUGH THE HANDLE THIS MODULE IS GIVEN. All three
 * `fp_image_lab_*` tables have RLS on with zero policies and no
 * anon/authenticated grant, so the anon client fails here with 42501 in
 * production while CI stays green on fakes. See `./image-lab-db.ts`.
 *
 * FAIL LOUD, NEVER SILENT: every call checks its error and THROWS a labeled
 * error the core catches and maps to `unavailable`. The single exception is
 * {@link HistoryDeps.signUrls}, whose failure is a MISSING THUMBNAIL rather than a
 * missing answer — the evidence lives on the row.
 *
 * ── THE QUERY THIS UNIT IS ABOUT (R11) ─────────────────────────────────────
 * `listRuns` filters by reference with `.contains("reference_ids", ids)`, which
 * PostgREST sends as `reference_ids=cs.{…}` and Postgres executes as
 *
 *     reference_ids @> array[$1, …]::uuid[]
 *
 * against `fp_image_lab_runs_reference_ids_idx` (GIN). CONTAINMENT, not overlap:
 * the consistency drill asks "which runs used THIS hero sheet", and with two
 * sheets selected it asks "which used BOTH". `&&` (overlap, `.overlaps()`) would
 * answer "either" — a wider set, silently, with the same shape and no error.
 * `__tests__/history-loader.test.ts` pins the operator by recording the query
 * chain, because a suite with no database cannot see a predicate any other way.
 */

import {
  isImageLabDrillTag,
  isImageLabFailureReason,
  isImageLabImageState,
  isImageLabVerdict,
  IMAGE_LAB_BUCKET,
  type ImageLabDrillTag,
} from "./image-lab-rules";
import { IMAGE_LAB_RESULT_URL_TTL_SECONDS, type SlotValues } from "./run-rules";
import { type ImageLabDb } from "./image-lab-db";
import type {
  HistoryFilter,
  HistoryImageRow,
  HistoryReference,
  HistoryRunRow,
} from "./history-rules";
import type { HistoryDeps } from "./history-core";

const RUNS = "fp_image_lab_runs";
const IMAGES = "fp_image_lab_images";
const REFERENCES = "fp_image_lab_references";

/** ⚠ NAMED COLUMNS, NEVER `*`. A select list is the only thing standing between
 *  this feature and a column somebody adds later that nobody meant to render. */
const RUN_COLUMNS =
  "id, staff_id, template, slot_values, resolved_prompt, reference_ids, " +
  // ⚠ `source_child_id` IS NOT SELECTED. Provenance was removed on 2026-08-06
  // and the column is never written; a History badge over an always-null column
  // would tell every reader the opposite of the truth.
  "drill_tags, note, compare, iterated_on_model, iterated_from_run_id, " +
  "created_at";

const IMAGE_COLUMNS =
  "id, run_id, model_id, cell_ordinal, state, attempted_at, billed, " +
  "failure_reason, failure_detail, storage_key, cost_estimated, cost_reported, " +
  // Per-cell prompt recording (20260920120000). The prompt is a per-model
  // choice, so the evidence surfaces read it off the IMAGE, not off the run.
  "resolved_prompt, prompt_derived, " +
  "verdict, verdict_note, verdict_at, created_at";

const REFERENCE_COLUMNS = "id, label";

/** How many storage keys go into one `createSignedUrls` request. */
const SIGN_BATCH_SIZE = 100;

/**
 * ⚠ THROWS on an unparseable timestamp rather than returning 0.
 *
 * Returning 0 made such a row permanently "stale" — 1970 is well past every
 * staleness window — so a data problem rendered as a settled, plausible-looking
 * fact about a model, in the same place the keep rate is read. Every other read
 * boundary in this module fails loud for exactly this reason; this one was the
 * exception.
 */
const asMs = (value: unknown, field: string, id: unknown): number => {
  const ms = Date.parse(String(value));
  if (!Number.isFinite(ms)) {
    throw new Error(`row ${String(id)} has unparseable ${field}: ${String(value)}`);
  }
  return ms;
};

const asMsOrNull = (value: unknown, field: string, id: unknown): number | null =>
  value === null || value === undefined ? null : asMs(value, field, id);

const asNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

function toRunRow(raw: Record<string, unknown>): HistoryRunRow {
  return {
    id: String(raw.id),
    staffId: String(raw.staff_id),
    template: typeof raw.template === "string" ? raw.template : "",
    slotValues:
      raw.slot_values !== null && typeof raw.slot_values === "object"
        ? (raw.slot_values as SlotValues)
        : {},
    resolvedPrompt: typeof raw.resolved_prompt === "string" ? raw.resolved_prompt : "",
    referenceIds: Array.isArray(raw.reference_ids) ? raw.reference_ids.map(String) : [],
    // ⚠ NARROWED, NOT ASSERTED. The column is `text[]` with a CHECK; a value
    // outside the vocabulary means the DB and the TS model have drifted, and a
    // dropped tag is a filter that quietly misses a run rather than a crash.
    drillTags: (Array.isArray(raw.drill_tags) ? raw.drill_tags.map(String) : []).filter(
      isImageLabDrillTag
    ),
    note: typeof raw.note === "string" ? raw.note : "",
    compare: raw.compare === true,
    iteratedOnModel:
      typeof raw.iterated_on_model === "string" ? raw.iterated_on_model : null,
    iteratedFromRunId:
      typeof raw.iterated_from_run_id === "string" ? raw.iterated_from_run_id : null,
    createdAtMs: asMs(raw.created_at, "created_at", raw.id),
  };
}

/**
 * Map an image row, NARROWING the three closed-set columns through Unit 1's
 * membership guards rather than asserting them.
 *
 * `row.state as ImageLabImageState` is the path of least resistance at every read
 * boundary and it switches the checker off exactly where the DB and the TS model
 * could have drifted. Here the stakes are the EVIDENCE: a coerced `state` would
 * move a row into or out of the keep-rate denominator silently, which is the one
 * number this whole feature exists to produce.
 */
function toImageRow(raw: Record<string, unknown>): HistoryImageRow {
  const state = typeof raw.state === "string" ? raw.state : null;
  if (!isImageLabImageState(state)) {
    throw new Error(
      `image row ${String(raw.id)} has unrecognized state ${String(raw.state)}`
    );
  }
  const failureReason = typeof raw.failure_reason === "string" ? raw.failure_reason : null;
  if (failureReason !== null && !isImageLabFailureReason(failureReason)) {
    throw new Error(
      `image row ${String(raw.id)} has unrecognized failure_reason ${failureReason}`
    );
  }
  const verdict = typeof raw.verdict === "string" ? raw.verdict : null;
  if (verdict !== null && !isImageLabVerdict(verdict)) {
    throw new Error(`image row ${String(raw.id)} has unrecognized verdict ${verdict}`);
  }

  return {
    id: String(raw.id),
    runId: String(raw.run_id),
    modelId: String(raw.model_id),
    cellOrdinal: Number(raw.cell_ordinal) || 0,
    state,
    attemptedAtMs: asMsOrNull(raw.attempted_at, "attempted_at", raw.id),
    createdAtMs: asMs(raw.created_at, "created_at", raw.id),
    failureReason,
    failureDetail: typeof raw.failure_detail === "string" ? raw.failure_detail : null,
    storageKey: typeof raw.storage_key === "string" ? raw.storage_key : null,
    billed: raw.billed === true,
    costEstimatedUsd: asNumberOrNull(raw.cost_estimated),
    costReportedUsd: asNumberOrNull(raw.cost_reported),
    verdict,
    verdictNote: typeof raw.verdict_note === "string" ? raw.verdict_note : "",
    verdictAtMs: asMsOrNull(raw.verdict_at, "verdict_at", raw.id),
    resolvedPrompt:
      typeof raw.resolved_prompt === "string" ? raw.resolved_prompt : null,
    promptDerived: raw.prompt_derived === true,
  };
}

/**
 * The RUN-LEVEL half of the filter, applied to a query builder.
 *
 * ⚠ ONE HELPER, TWO CALLERS (`listRuns` and `countRuns`). "Showing 50 of 312" is
 * a lie the moment the count and the list are built from two copies of the same
 * predicate that drift.
 *
 * `.contains(column, values)` → `column=cs.{…}` → `column @> array[…]`. Both array
 * terms use it:
 *   * `reference_ids` — R11's consistency drill, retrieved as a SET, served by
 *     the GIN index the migration creates for exactly this;
 *   * `drill_tags` — the same containment semantics, so "consistency AND style"
 *     means both tags rather than either.
 */
function withRunFilter<Q extends { contains(column: string, values: string[]): Q }>(
  query: Q,
  filter: HistoryFilter
): Q {
  let next = query;
  if (filter.referenceIds.length > 0) {
    next = next.contains("reference_ids", filter.referenceIds as string[]);
  }
  if (filter.drillTags.length > 0) {
    next = next.contains("drill_tags", filter.drillTags as string[]);
  }
  return next;
}

function toReference(raw: Record<string, unknown>): HistoryReference {
  return { id: String(raw.id), label: typeof raw.label === "string" ? raw.label : "" };
}

/**
 * The production {@link HistoryDeps}.
 *
 * The handle is a REQUIRED argument rather than a defaulted one: a default makes
 * the service-role choice invisible at the call site, which is the one fact about
 * this feature a reviewer must be able to see without opening a second file.
 */
export function historyDeps(db: ImageLabDb): HistoryDeps {
  return {
    now: () => Date.now(),

    /**
     * ⚠ THE RUN-LEVEL FILTER, AND THE UNIT'S MOST IMPORTANT QUERY. The predicate
     * itself is {@link withRunFilter}, shared with `countRuns`.
     *
     * MODEL AND VERDICT ARE NOT PUSHED DOWN HERE ON PURPOSE. They are IMAGE-level
     * terms, and a run qualifies when at least one of its images matches — which
     * is a decision, not a predicate, so it lives in the pure `filterHistory`
     * where a test can see it. At this cardinality (≤ 50 runs) reading the run's
     * cells and filtering them in memory costs nothing, and it keeps ONE
     * implementation of "does this image match" instead of one in SQL and one in
     * TypeScript that only agree until someone edits one.
     */
    async listRuns(filter: HistoryFilter) {
      const { data, error } = await withRunFilter(
        db.from(RUNS).select(RUN_COLUMNS),
        filter
      )
        .order("created_at", { ascending: false })
        .limit(filter.limit);
      if (error) throw new Error(`listRuns failed: ${error.message}`);
      return ((data ?? []) as unknown[]).map((r) => toRunRow(r as Record<string, unknown>));
    },

    /**
     * ⚠ THE SAME PREDICATE, WITHOUT THE LIMIT — built by the SAME helper, so the
     * count can never describe a different population than the list. A head+count
     * request transfers no rows.
     */
    async countRuns(filter: HistoryFilter) {
      const { count, error } = await withRunFilter(
        db.from(RUNS).select("id", { count: "exact", head: true }),
        filter
      );
      if (error) throw new Error(`countRuns failed: ${error.message}`);
      return count ?? 0;
    },

    async listRunsByIds(runIds) {
      if (runIds.length === 0) return [];
      const { data, error } = await db
        .from(RUNS)
        .select(RUN_COLUMNS)
        .in("id", runIds as string[]);
      if (error) throw new Error(`listRunsByIds failed: ${error.message}`);
      return ((data ?? []) as unknown[]).map((r) => toRunRow(r as Record<string, unknown>));
    },

    /**
     * ⚠ ORDERED BY `(run_id, cell_ordinal, created_at)` WITH AN `id` TIE-BREAK —
     * the index the migration creates, and the sort key History had dropped.
     *
     * `created_at` alone is NOT an order here: the migration states plainly that
     * every cell of one run shares a `created_at` byte-for-byte (they are written
     * in one transaction), which is precisely why the index is
     * `(run_id, cell_ordinal, created_at)` and why Unit 5's `listCells` orders by
     * `cell_ordinal`. Ordering by the timestamp alone handed Postgres a free
     * choice among equal keys, so the grid rendered `#3, #1, #4, #2` and reordered
     * itself between reloads with no data change.
     *
     * `created_at` still rides along ASCENDING within a cell so retries read
     * oldest-to-newest; `id` closes the last tie.
     */
    async listImagesForRuns(runIds, limit) {
      if (runIds.length === 0) return [];
      const { data, error } = await db
        .from(IMAGES)
        .select(IMAGE_COLUMNS)
        .in("run_id", runIds as string[])
        // ⚠ RECENCY IS THE *PRIMARY* KEY NOW, AND THE CAP IS WHY.
        //
        // This read used to order by `run_id ASC` first and then limit — and
        // `run_id` is a v4 uuid, i.e. RANDOM WITH RESPECT TO TIME. So the banner
        // saying "the newest N attempts" described the newest of nothing: the
        // runs that lost their images were whichever ones happened to sort at the
        // high-uuid end, they came back with ZERO rows, and `filterHistory`'s
        // `withImages` rule then pruned them off a page whose own copy says
        // nothing is ever pruned. The Unit 6 fix only changed WHICH runs vanished.
        //
        // Cells of one run share `created_at` byte-for-byte (one transaction), so
        // this orders RUNS by recency and leaves the within-run order to the three
        // keys below — which are the migration's own index
        // `(run_id, cell_ordinal, created_at)` plus an `id` tie-break, because
        // ordering by the shared timestamp alone hands Postgres a free choice
        // among equal keys and the grid renders `#3, #1, #4, #2`.
        //
        // A retry row is NEWER than its run, so it sorts even earlier — a retried
        // run can never be the one truncation drops. The core prunes the oldest
        // PARTIALLY-read run whole (`dropPartialOldestRun`) rather than showing a
        // run with some of its attempts missing.
        .order("created_at", { ascending: false })
        .order("run_id", { ascending: true })
        .order("cell_ordinal", { ascending: true })
        .order("id", { ascending: true })
        .limit(limit);
      if (error) throw new Error(`listImagesForRuns failed: ${error.message}`);
      return ((data ?? []) as unknown[]).map((r) =>
        toImageRow(r as Record<string, unknown>)
      );
    },

    /**
     * The Kit's population: `verdict = 'keep'` AND `state = 'done'`, newest first,
     * served by `fp_image_lab_images_verdict_idx`.
     *
     * ⚠ THE `state` TERM IS NOT REDUNDANT. Going forward the CHECK
     * `fp_image_lab_images_verdict_needs_done` makes the two equivalent — but a
     * row written before that constraint, by a hand-run fix, or under a partially
     * applied migration could carry `verdict = 'keep'` with no object at all, and
     * it would enter the Kit as a harvestable result with nothing behind it.
     */
    async listKeptImages(limit) {
      const { data, error } = await db
        .from(IMAGES)
        .select(IMAGE_COLUMNS)
        .eq("verdict", "keep")
        .eq("state", "done")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit);
      if (error) throw new Error(`listKeptImages failed: ${error.message}`);
      return ((data ?? []) as unknown[]).map((r) =>
        toImageRow(r as Record<string, unknown>)
      );
    },

    async listReferencesByIds(ids) {
      if (ids.length === 0) return [];
      const { data, error } = await db
        .from(REFERENCES)
        .select(REFERENCE_COLUMNS)
        .in("id", ids as string[]);
      if (error) throw new Error(`listReferencesByIds failed: ${error.message}`);
      return ((data ?? []) as unknown[]).map((r) =>
        toReference(r as Record<string, unknown>)
      );
    },

    async listAllReferences(limit) {
      const { data, error } = await db
        .from(REFERENCES)
        .select(REFERENCE_COLUMNS)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(`listAllReferences failed: ${error.message}`);
      return ((data ?? []) as unknown[]).map((r) =>
        toReference(r as Record<string, unknown>)
      );
    },

    /**
     * ⚠ ONE REQUEST PER BATCH, NOT ONE PER ROW, and it NEVER THROWS.
     *
     * `createSignedUrls` (plural) mints a whole page's thumbnails in a single
     * round trip. The singular version, fanned with an unbounded `Promise.all`
     * over as many as a thousand rows, was the storm this page could not afford on
     * the phone it is meant to be used on.
     *
     * A failed mint — for the batch or for one path within it — costs THUMBNAILS,
     * never the page: the row's state, cost, failure reason and verdict all render
     * regardless and the cell stays judgeable. That promise is kept here, at the
     * one call site that makes it (`signViews`).
     */
    async signUrls(storageKeys) {
      const signed = new Map<string, string>();
      for (let i = 0; i < storageKeys.length; i += SIGN_BATCH_SIZE) {
        const batch = storageKeys.slice(i, i + SIGN_BATCH_SIZE) as string[];
        try {
          const { data, error } = await db.storage
            .from(IMAGE_LAB_BUCKET)
            .createSignedUrls(batch, IMAGE_LAB_RESULT_URL_TTL_SECONDS);
          if (error || !data) continue;
          for (const entry of data) {
            // Per-path errors ride INSIDE the batch response; one bad path must
            // not blank its siblings.
            if (entry.error || !entry.signedUrl || !entry.path) continue;
            signed.set(entry.path, entry.signedUrl);
          }
        } catch (e) {
          console.error("[image-lab/history] signed url batch failed:", e);
        }
      }
      return signed;
    },

    async loadImage(imageId) {
      const { data, error } = await db
        .from(IMAGES)
        .select(IMAGE_COLUMNS)
        .eq("id", imageId)
        .maybeSingle();
      if (error) throw new Error(`loadImage(${imageId}) failed: ${error.message}`);
      return data ? toImageRow(data as unknown as Record<string, unknown>) : null;
    },

    /**
     * ⚠ BOTH COLUMNS, ALWAYS, IN ONE UPDATE.
     *
     * `fp_image_lab_images_verdict_at_pairs` is `(verdict is null) = (verdict_at
     * is null)`, so an update that set only one of them would be refused by
     * Postgres with a constraint name — on a button press, to a staff member. The
     * patch type makes carrying one impossible; this writes what it carries.
     *
     * It names ONLY these two columns: no run field, no state, no cost. Two tabs
     * judging two images of one run cannot collide, and a verdict can never
     * rewrite the evidence it is a judgement about.
     */
    async updateVerdict(imageId, patch) {
      const { data, error } = await db
        .from(IMAGES)
        .update({
          verdict: patch.verdict,
          verdict_at:
            patch.verdictAtMs === null ? null : new Date(patch.verdictAtMs).toISOString(),
        })
        .eq("id", imageId)
        .select("id");
      if (error) throw new Error(`updateVerdict(${imageId}) failed: ${error.message}`);
      return ((data ?? []) as unknown[]).length;
    },

    /** The note alone — no verdict, no stamp. Editing one never touches the other. */
    async updateNote(imageId, note) {
      const { data, error } = await db
        .from(IMAGES)
        .update({ verdict_note: note })
        .eq("id", imageId)
        .select("id");
      if (error) throw new Error(`updateNote(${imageId}) failed: ${error.message}`);
      return ((data ?? []) as unknown[]).length;
    },

    /** The run's tags alone. The only run-level write in this unit. */
    async updateRunTags(runId, tags: readonly ImageLabDrillTag[]) {
      const { data, error } = await db
        .from(RUNS)
        .update({ drill_tags: tags as string[] })
        .eq("id", runId)
        .select("id");
      if (error) throw new Error(`updateRunTags(${runId}) failed: ${error.message}`);
      return ((data ?? []) as unknown[]).length;
    },
  };
}
