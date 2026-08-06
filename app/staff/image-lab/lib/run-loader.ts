import "server-only";

/**
 * Image Lab — the run flow's I/O layer: the real {@link RunDeps} built on the
 * service-role client
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 5).
 *
 * Kept OUT of the `"use server"` action file so none of these becomes a
 * client-callable Server Action, and out of `run-core.ts` so the sequencing stays
 * testable in a node suite with no database. The `reference-loader.ts` shape,
 * one feature over.
 *
 * ⚠ EVERY TOUCH GOES THROUGH THE HANDLE THIS MODULE IS GIVEN. All three
 * `fp_image_lab_*` tables have RLS on with zero policies and no
 * anon/authenticated grant, so the anon client fails here with 42501 in
 * production while CI stays green on fakes. See `./image-lab-db.ts`.
 *
 * FAIL LOUD, NEVER SILENT: every call checks its error and THROWS a labeled
 * error the core catches and maps to a typed outcome. The one deliberate
 * exception is {@link markAttempt}, whose ZERO-ROW result is a designed branch
 * (the CAS refusing) and must be reported as `null`, not as a failure.
 */

import { randomUUID } from "node:crypto";
import {
  IMAGE_LAB_BUCKET,
  normalizeMimeType,
  type ImageLabMimeType,
} from "./image-lab-rules";
import { isImageLabFailureReason, isImageLabImageState } from "./image-lab-rules";
import { generateLabImage } from "./image-model";
import { type ImageLabDb } from "./image-lab-db";
import {
  IMAGE_LAB_DB_CALL_TIMEOUT_MS,
  IMAGE_LAB_REFERENCE_LOAD_TIMEOUT_MS,
  IMAGE_LAB_RESULT_URL_TTL_SECONDS,
  type CellRow,
  type SlotValues,
} from "./run-rules";
import { withFwTimeout } from "@/app/fp/lib/fw-call";
import { excludeTestFamilies } from "@/app/crm/lib/test-family-filter";
import type { FinalizePatch, NewCellRow, RunDeps, RunRow } from "./run-core";

const RUNS = "fp_image_lab_runs";
const IMAGES = "fp_image_lab_images";
const REFERENCES = "fp_image_lab_references";

const RUN_COLUMNS =
  "id, staff_id, idempotency_key, template, slot_values, resolved_prompt, " +
  "reference_ids, drill_tags, note, compare, iterated_on_model, " +
  "iterated_from_run_id, source_child_id, source_idea_id, source_task_id, created_at";

const IMAGE_COLUMNS =
  "id, run_id, model_id, cell_ordinal, state, attempted_at, billed, " +
  "failure_reason, failure_detail, storage_key, content_type, " +
  "cost_estimated, cost_reported, gateway_generation_id, created_at";

/** Postgres unique_violation — here, the `(staff_id, idempotency_key)` index. */
const UNIQUE_VIOLATION = "23505";

/**
 * Every DB and Storage touch on the paid path, BOUNDED BY THE CLOCK.
 *
 * ⚠ NOTHING IN THE SUPABASE CLIENT SETS A FETCH TIMEOUT, and this is the one
 * path in the repo where "the call never settled" costs money: an unbounded
 * `finalize` on a 300s function means the vendor billed, the bytes are in the
 * bucket, and the platform kills the invocation with the row still `requested`
 * and latched for the full staleness window. `assertRouteBudget` only ever
 * proved one inequality about the ADAPTER; these are the awaits either side of
 * it, and now they have a wall too.
 *
 * A timeout is reported as an ordinary `error`, which every caller here already
 * throws on — giving up on the WAIT is not cancelling the request, so the caller
 * must be safe under "reported failed, actually landed". Each one is: the CAS
 * and `finalize` are conditional (a landed write makes the retry a no-op that
 * reports zero rows, which is a branch the core already handles), and the reads
 * are reads.
 */
async function bounded<R extends { data: unknown; error: { message: string } | null }>(
  call: () => PromiseLike<R>,
  label: string,
  budgetMs: number = IMAGE_LAB_DB_CALL_TIMEOUT_MS
): Promise<R | { data: null; error: { message: string } }> {
  let raced;
  try {
    raced = await withFwTimeout(call(), `image-lab/${label}`, budgetMs);
  } catch (e) {
    return { data: null, error: { message: `${label} threw: ${String(e)}` } };
  }
  return raced.timedOut
    ? { data: null, error: { message: `${label} did not answer within ${budgetMs}ms` } }
    : raced.value;
}

const asMs = (value: unknown): number => {
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : 0;
};

const asNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

function toRunRow(raw: Record<string, unknown>, cellCount: number): RunRow {
  return {
    id: String(raw.id),
    staffId: String(raw.staff_id),
    idempotencyKey: String(raw.idempotency_key),
    template: typeof raw.template === "string" ? raw.template : "",
    slotValues:
      raw.slot_values !== null && typeof raw.slot_values === "object"
        ? (raw.slot_values as SlotValues)
        : {},
    resolvedPrompt: typeof raw.resolved_prompt === "string" ? raw.resolved_prompt : "",
    referenceIds: Array.isArray(raw.reference_ids) ? raw.reference_ids.map(String) : [],
    drillTags: Array.isArray(raw.drill_tags) ? raw.drill_tags.map(String) : [],
    note: typeof raw.note === "string" ? raw.note : "",
    compare: raw.compare === true,
    iteratedOnModel: typeof raw.iterated_on_model === "string" ? raw.iterated_on_model : null,
    iteratedFromRunId:
      typeof raw.iterated_from_run_id === "string" ? raw.iterated_from_run_id : null,
    sourceChildId: typeof raw.source_child_id === "string" ? raw.source_child_id : null,
    sourceIdeaId: typeof raw.source_idea_id === "string" ? raw.source_idea_id : null,
    sourceTaskId: typeof raw.source_task_id === "string" ? raw.source_task_id : null,
    createdAtMs: asMs(raw.created_at),
    cellCount,
  };
}

/**
 * Map an image row, NARROWING the two closed-set columns through Unit 1's
 * membership guards rather than asserting them.
 *
 * `row.state as ImageLabImageState` is the path of least resistance at every read
 * boundary and it switches the checker off exactly where the DB and the TS model
 * could have drifted (a hand-run SQL fix, a partially applied migration). A row
 * that fails the guard is a data fault, and a data fault on a PAID row is worth a
 * throw rather than a silent coercion into `requested` — which would make it
 * eligible for a second vendor call.
 */
function toCellRow(raw: Record<string, unknown>): CellRow {
  const state = typeof raw.state === "string" ? raw.state : null;
  if (!isImageLabImageState(state)) {
    throw new Error(`image row ${String(raw.id)} has unrecognized state ${String(raw.state)}`);
  }
  const failureReason =
    typeof raw.failure_reason === "string" ? raw.failure_reason : null;
  if (failureReason !== null && !isImageLabFailureReason(failureReason)) {
    throw new Error(
      `image row ${String(raw.id)} has unrecognized failure_reason ${failureReason}`
    );
  }
  return {
    id: String(raw.id),
    runId: String(raw.run_id),
    modelId: String(raw.model_id),
    cellOrdinal: Number(raw.cell_ordinal) || 0,
    state,
    attemptedAtMs: raw.attempted_at === null || raw.attempted_at === undefined
      ? null
      : asMs(raw.attempted_at),
    createdAtMs: asMs(raw.created_at),
    failureReason,
    failureDetail: typeof raw.failure_detail === "string" ? raw.failure_detail : null,
    storageKey: typeof raw.storage_key === "string" ? raw.storage_key : null,
    billed: raw.billed === true,
    costEstimatedUsd: asNumberOrNull(raw.cost_estimated),
    costReportedUsd: asNumberOrNull(raw.cost_reported),
  };
}

/**
 * The production {@link RunDeps}.
 *
 * The handle is a REQUIRED argument rather than a defaulted one: a default makes
 * the service-role choice invisible at the call site, which is the one fact about
 * this feature a reviewer must be able to see without opening a second file.
 */
export function runDeps(db: ImageLabDb): RunDeps {
  const countCells = async (runId: string): Promise<number> => {
    const result = await bounded(
      () =>
        db.from(IMAGES).select("id", { count: "exact", head: true }).eq("run_id", runId),
      `countCells(${runId})`
    );
    if (result.error) throw new Error(`countCells(${runId}) failed: ${result.error.message}`);
    return (result as { count?: number | null }).count ?? 0;
  };

  return {
    newId: () => randomUUID(),
    now: () => Date.now(),

    async insertRun(row) {
      const { data, error } = await bounded(() => db
        .from(RUNS)
        .insert({
          id: row.id,
          staff_id: row.staffId,
          idempotency_key: row.idempotencyKey,
          template: row.template,
          slot_values: row.slotValues,
          resolved_prompt: row.resolvedPrompt,
          reference_ids: row.referenceIds,
          drill_tags: row.drillTags,
          note: row.note,
          compare: row.compare,
          iterated_on_model: row.iteratedOnModel,
          iterated_from_run_id: row.iteratedFromRunId,
          source_child_id: row.sourceChildId,
          source_idea_id: row.sourceIdeaId,
          source_task_id: row.sourceTaskId,
        })
        .select(RUN_COLUMNS)
        .single(), `insertRun(${row.id})`);
      if (error) {
        // The DESIGNED branch: the staff member composed twice for one intent.
        if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
          return { ok: false, reason: "duplicate_key" };
        }
        throw new Error(`insertRun(${row.id}) failed: ${error.message}`);
      }
      if (!data) throw new Error(`insertRun(${row.id}): no row returned`);
      // Cells are written next; a run that has just been inserted has none yet,
      // and `cellCount` is filled from the composition by the core.
      return { ok: true, run: toRunRow(data as unknown as Record<string, unknown>, row.cellCount) };
    },

    async findRunByIdempotency(staffId, key) {
      const { data, error } = await bounded(() => db
        .from(RUNS)
        .select(RUN_COLUMNS)
        .eq("staff_id", staffId)
        .eq("idempotency_key", key)
        .maybeSingle(), "findRunByIdempotency");
      if (error) throw new Error(`findRunByIdempotency failed: ${error.message}`);
      if (!data) return null;
      const raw = data as unknown as Record<string, unknown>;
      return toRunRow(raw, await countCells(String(raw.id)));
    },

    async loadRun(runId) {
      const { data, error } = await bounded(() => db
        .from(RUNS)
        .select(RUN_COLUMNS)
        .eq("id", runId)
        .maybeSingle(), `loadRun(${runId})`);
      if (error) throw new Error(`loadRun(${runId}) failed: ${error.message}`);
      if (!data) return null;
      return toRunRow(data as unknown as Record<string, unknown>, await countCells(runId));
    },

    async insertCells(rows) {
      if (rows.length === 0) return [];
      const { data, error } = await bounded(() => db
        .from(IMAGES)
        .insert(
          rows.map((row: NewCellRow) => ({
            id: row.id,
            run_id: row.runId,
            model_id: row.modelId,
            // ⚠ ASSIGNED PER CELL. created_at is the TRANSACTION timestamp and is
            // identical across every row of this insert, so it can never order
            // the compare grid (migration header).
            cell_ordinal: row.cellOrdinal,
            state: "requested",
          }))
        )
        .select(IMAGE_COLUMNS), "insertCells");
      if (error) throw new Error(`insertCells failed: ${error.message}`);
      return ((data ?? []) as unknown[]).map((r) =>
        toCellRow(r as Record<string, unknown>)
      );
    },

    async listCells(runId) {
      const { data, error } = await bounded(() => db
        .from(IMAGES)
        .select(IMAGE_COLUMNS)
        .eq("run_id", runId)
        .order("cell_ordinal", { ascending: true }), `listCells(${runId})`);
      if (error) throw new Error(`listCells(${runId}) failed: ${error.message}`);
      return ((data ?? []) as unknown[]).map((r) =>
        toCellRow(r as Record<string, unknown>)
      );
    },

    async loadCell(imageId) {
      const { data, error } = await bounded(() => db
        .from(IMAGES)
        .select(IMAGE_COLUMNS)
        .eq("id", imageId)
        .maybeSingle(), `loadCell(${imageId})`);
      if (error) throw new Error(`loadCell(${imageId}) failed: ${error.message}`);
      return data ? toCellRow(data as unknown as Record<string, unknown>) : null;
    },

    /**
     * The scrub inputs for one child, on the SAME fail-closed posture the picker
     * loader uses: a child with no family record comes back `isTest: true`, so
     * `createRun` refuses to build a run from it. Unknown provenance is not real
     * provenance.
     */
    async loadChildIdentity(childId) {
      const child = await bounded(
        () =>
          db
            .from("children")
            .select("id, parent_id, first_name, last_name, fp_username")
            .eq("id", childId)
            .maybeSingle(),
        "loadChildIdentity"
      );
      if (child.error) {
        throw new Error(`loadChildIdentity failed: ${child.error.message}`);
      }
      const row = child.data as {
        parent_id?: unknown;
        first_name?: unknown;
        last_name?: unknown;
        fp_username?: unknown;
      } | null;
      if (!row) return null;

      const parentId = typeof row.parent_id === "string" ? row.parent_id : null;
      // ⚠ THE ONE CHOKEPOINT, never a hand-written `.eq("is_test", false)` —
      // that drops NULL rows, which are real families.
      const family = parentId
        ? await bounded(
            () =>
              excludeTestFamilies(
                db.from("families").select("parent_id, is_test").eq("parent_id", parentId)
              ),
            "loadChildIdentity/family"
          )
        : { data: null, error: null };
      if (family.error) {
        throw new Error(`loadChildIdentity family read failed: ${family.error.message}`);
      }
      const families = (family.data ?? []) as { is_test: boolean | null }[];

      const str = (v: unknown) => (typeof v === "string" ? v : "");
      return {
        firstName: str(row.first_name),
        lastName: str(row.last_name),
        username: typeof row.fp_username === "string" ? row.fp_username : null,
        isTest: families.length > 0 ? (families[0]!.is_test ?? null) : true,
      };
    },

    /**
     * ⚠ THE ATOMIC CAS, and the three predicates are all load-bearing:
     *   `id = $1`                 — this cell;
     *   `state = 'requested'`     — not already finalized;
     *   `attempted_at is null`    — not already in flight.
     * A single UPDATE evaluates them and writes the stamp indivisibly, so two
     * concurrent requests on the same cell produce exactly one vendor call. A
     * read-then-write pair here would let both pass the read.
     *
     * ZERO ROWS IS A DESIGNED ANSWER, not an error: `maybeSingle` gives `null`
     * data and no error, and the core refuses to dial on it.
     *
     * The stamp is OUR clock rather than SQL `now()` because PostgREST sends
     * values, not expressions. It is the same clock `deps.now()` reads for the
     * staleness comparison, so the two can never disagree with each other —
     * which is the property staleness actually needs.
     */
    async markAttempt(imageId) {
      const { data, error } = await bounded(() => db
        .from(IMAGES)
        .update({ attempted_at: new Date().toISOString() })
        .eq("id", imageId)
        .eq("state", "requested")
        .is("attempted_at", null)
        .select(IMAGE_COLUMNS)
        .maybeSingle(), `markAttempt(${imageId})`);
      if (error) throw new Error(`markAttempt(${imageId}) failed: ${error.message}`);
      return data ? toCellRow(data as unknown as Record<string, unknown>) : null;
    },

    /**
     * ⚠ EVERY REQUESTED ID MUST COME BACK, OR THIS THROWS.
     *
     * The old version `continue`d past a missing row and past an unnormalizable
     * mime, so a DELETED OR UNREADABLE REFERENCE WAS SILENTLY DROPPED: the cell
     * generated and billed as if it had the hero sheet, and was then scored
     * against a drill it never actually ran. A short list is not a degraded
     * result here, it is a DIFFERENT EXPERIMENT — and the reference library
     * exists for exactly the comparison that silently corrupts.
     *
     * CONCURRENT, and bounded as a set: sixteen sequential downloads on the paid
     * path is a wall-clock cost nothing was accounting for (see
     * `IMAGE_LAB_PRE_ADAPTER_BUDGET_MS`). Results are re-assembled IN THE RUN'S
     * OWN ORDER — references are sent to the model as an ordered list, and two
     * runs of "the same" prompt with a reordered reference set are quietly
     * incomparable.
     */
    async loadReferenceBytes(ids) {
      if (ids.length === 0) return [];
      const { data, error } = await bounded(
        () => db.from(REFERENCES).select("id, storage_key, content_type").in("id", ids as string[]),
        "loadReferenceBytes"
      );
      if (error) throw new Error(`loadReferenceBytes failed: ${error.message}`);

      const byId = new Map<string, { storageKey: string; contentType: ImageLabMimeType }>();
      for (const raw of (data ?? []) as unknown as Record<string, unknown>[]) {
        const contentType = normalizeMimeType(raw.content_type as string | null);
        if (contentType === null) continue;
        byId.set(String(raw.id), { storageKey: String(raw.storage_key), contentType });
      }
      const missing = ids.filter((id) => !byId.has(id));
      if (missing.length > 0) {
        throw new Error(
          `loadReferenceBytes: ${missing.length} of ${ids.length} references are ` +
            `missing or carry an unusable content type (${missing.join(", ")})`
        );
      }

      const raced = await withFwTimeout(
        Promise.all(
          ids.map(async (id) => {
            const meta = byId.get(id)!;
            const { data: blob, error: downloadError } = await db.storage
              .from(IMAGE_LAB_BUCKET)
              .download(meta.storageKey);
            if (downloadError || !blob) {
              throw new Error(
                `reference download failed for ${id}: ${downloadError?.message ?? "no body"}`
              );
            }
            return {
              bytes: new Uint8Array(await blob.arrayBuffer()),
              contentType: meta.contentType,
            };
          })
        ),
        "image-lab/loadReferenceBytes/download",
        IMAGE_LAB_REFERENCE_LOAD_TIMEOUT_MS
      );
      if (raced.timedOut) {
        throw new Error(
          `loadReferenceBytes: ${ids.length} references did not download within ` +
            `${IMAGE_LAB_REFERENCE_LOAD_TIMEOUT_MS}ms`
        );
      }
      if (raced.value.length !== ids.length) {
        throw new Error(
          `loadReferenceBytes returned ${raced.value.length} of ${ids.length} references`
        );
      }
      return raced.value;
    },

    generate: (request) => generateLabImage(request),

    /**
     * ⚠ THE BYTES ARE PASSED THROUGH UNTOUCHED. No `.buffer`, no re-wrap, no
     * copy — see the warning at the call site in `run-core.ts`. `upsert` stays
     * off: the key is deterministic, so an upsert would let a retry silently
     * overwrite the object a finalized row already points at.
     */
    async putObject(key, bytes, contentType) {
      const { error } = await bounded(
        () =>
          db.storage
            .from(IMAGE_LAB_BUCKET)
            .upload(key, bytes, { contentType, upsert: false }),
        `putObject(${key})`
      );
      if (error) throw new Error(`putObject(${key}) failed: ${error.message}`);
    },

    async removeObject(key) {
      const { error } = await bounded(
        () => db.storage.from(IMAGE_LAB_BUCKET).remove([key]),
        `removeObject(${key})`
      );
      if (error) throw new Error(`removeObject(${key}) failed: ${error.message}`);
    },

    /**
     * ⚠ CONDITIONAL ON `state = 'requested'`, so a finalize can only ever happen
     * once per row. The returned row COUNT is the answer the core needs: zero
     * means the row is gone (the run was purged mid-flight), and the core then
     * deletes the object it just wrote instead of orphaning it.
     */
    async finalize(patch: FinalizePatch) {
      const { data, error } = await bounded(() => db
        .from(IMAGES)
        .update({
          state: patch.state,
          storage_key: patch.storageKey,
          content_type: patch.contentType,
          failure_reason: patch.failureReason,
          failure_detail: patch.failureDetail,
          billed: patch.billed,
          cost_estimated: patch.costEstimatedUsd,
          cost_reported: patch.costReportedUsd,
          gateway_generation_id: patch.gatewayGenerationId,
        })
        .eq("id", patch.imageId)
        .eq("state", "requested")
        .select("id"), `finalize(${patch.imageId})`);
      if (error) throw new Error(`finalize(${patch.imageId}) failed: ${error.message}`);
      return { rowsMatched: ((data ?? []) as unknown[]).length };
    },

    // `console.info` rather than `error`: a successful paid call is not a fault,
    // and an audit trail buried in the error stream is one nobody reads.
    audit: (line) => console.info(line),
  };
}

/**
 * One cell as the grid renders it: the row plus a SHORT-LIVED SIGNED URL.
 *
 * ⚠ NO `storageKey` REACHES THE CLIENT. The bucket is private, so a raw key is
 * not a credential — but it is the input to one, and a UI that holds keys is a UI
 * whose next feature mints URLs from them client-side (the `ReferenceView`
 * argument, applied to generated images).
 */
export type RunCellView = Omit<CellRow, "storageKey"> & {
  readonly hasObject: boolean;
  readonly signedUrl: string | null;
};

/**
 * The bench grid's data after a reload: the run, its cells, and a fresh signed
 * URL per stored image.
 *
 * URLs mint CONCURRENTLY and one failed mint costs one thumbnail rather than the
 * whole grid — the `loadEvidenceViews` posture. A cell with a null URL still
 * renders with its state, cost and failure reason, because its evidence lives on
 * the row, not on the picture.
 */
export async function loadRunCellViews(
  db: ImageLabDb,
  runId: string
): Promise<{ run: RunRow | null; cells: RunCellView[]; serverNowMs: number }> {
  const deps = runDeps(db);
  // The run rides along so the caller can check it belongs to the staff member
  // asking, and so the grid can show the prompt THIS run actually sent rather
  // than whatever the composer's live template resolves to now.
  const run = await deps.loadRun(runId);
  const rows = await deps.listCells(runId);
  const cells = await Promise.all(
    rows.map(async ({ storageKey, ...rest }): Promise<RunCellView> => {
      if (storageKey === null) return { ...rest, hasObject: false, signedUrl: null };
      try {
        const { data, error } = await bounded(
          () =>
            db.storage
              .from(IMAGE_LAB_BUCKET)
              .createSignedUrl(storageKey, IMAGE_LAB_RESULT_URL_TTL_SECONDS),
          `createSignedUrl(${rest.id})`
        );
        const signed = data as { signedUrl?: string } | null;
        if (error || !signed?.signedUrl) throw new Error(error?.message ?? "no url returned");
        return { ...rest, hasObject: true, signedUrl: signed.signedUrl };
      } catch (e) {
        console.error(`[image-lab/run] signed url mint failed for ${rest.id}:`, e);
        return { ...rest, hasObject: true, signedUrl: null };
      }
    })
  );
  // ⚠ THE SERVER'S CLOCK RIDES ALONG. Staleness is judged against the same clock
  // that stamped `attempted_at`; a browser five minutes fast would otherwise mark
  // every cell stale the instant it was minted and offer Retry on a call still
  // running — paying twice. The client anchors this against its own clock at
  // receipt (the `ReferenceView.signedUrlExpiresInMs` posture, one surface over).
  return { run, cells, serverNowMs: Date.now() };
}
