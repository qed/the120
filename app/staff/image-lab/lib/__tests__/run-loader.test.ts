import { describe, expect, it } from "vitest";
import { loadRunCellViews, runDeps } from "../run-loader";
import type { ImageLabDb } from "../image-lab-db";
import { IMAGE_LAB_BUCKET } from "../image-lab-rules";

/**
 * The run flow's I/O layer, against a fake PostgREST/Storage double
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 5).
 *
 * ── WHY THIS FILE HAS TO EXIST ─────────────────────────────────────────────
 * `run-core.test.ts` proves the SEQUENCING against fakes that synthesize the
 * signals — `markAttempt` returning null, `finalize` returning zero rows. But the
 * signals themselves are produced HERE, by a query whose PREDICATES are the whole
 * guarantee:
 *
 *   * drop `.is("attempted_at", null)` from `markAttempt` and it stops being a
 *     CAS. It still returns a row, the core still dials the vendor, and every
 *     test in the core suite stays green — while two tabs pay twice.
 *   * drop `.eq("state", "requested")` from `finalize` and a late vendor success
 *     overwrites a row already finalized as `failed`, which the schema's
 *     biconditional CHECK exists to make loud.
 *   * typo `23505` and every resubmitted compose mints a second paid run.
 *
 * None of those is visible to a suite with no database, so the QUERY is the thing
 * under test: the fake records the chain and the assertions read it.
 */

// ── The recorder ─────────────────────────────────────────────────────────────

type Call = { method: string; args: unknown[] };

/**
 * A chainable PostgREST double that RECORDS every link.
 *
 * A canned-answer fake cannot see predicates, and the predicates are the subject
 * here — so this proxy answers whatever the test configured while keeping an
 * ordered transcript of how it was asked.
 */
function fakeDb(
  /** One canned answer, or one per table name (`fp_image_lab_runs`, …). */
  answer: unknown | Record<string, unknown>,
  storage: Record<string, unknown> = {},
  /** Set when `answer` is a per-table map. */
  perTable = false
) {
  const calls: Call[] = [];
  let current: unknown = perTable ? { data: null, error: null } : answer;
  const uploads: { key: string; body: unknown; options: unknown }[] = [];
  const removed: string[][] = [];
  const downloads: string[] = [];

  const link = (): unknown =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") {
            const settled = Promise.resolve(current);
            return settled.then.bind(settled);
          }
          return (...args: unknown[]) => {
            calls.push({ method: String(prop), args });
            if (prop === "single" || prop === "maybeSingle") return Promise.resolve(current);
            return link();
          };
        },
      }
    );

  const bucket = {
    async upload(key: string, body: unknown, options: unknown) {
      uploads.push({ key, body, options });
      return (storage.upload as { error: unknown } | undefined) ?? { error: null };
    },
    async remove(keys: string[]) {
      removed.push(keys);
      return { error: null };
    },
    async download(key: string) {
      downloads.push(key);
      return (
        (storage.download as { data: unknown; error: unknown } | undefined) ?? {
          data: new Blob([new Uint8Array([1, 2, 3])]),
          error: null,
        }
      );
    },
    async createSignedUrl(key: string) {
      return (
        (storage.signedUrl as { data: unknown; error: unknown } | undefined) ?? {
          data: { signedUrl: `https://s/${key}` },
          error: null,
        }
      );
    },
  };

  const db = {
    from: (table: string) => {
      calls.push({ method: "from", args: [table] });
      if (perTable) {
        current =
          (answer as Record<string, unknown>)[table] ?? { data: null, error: null };
      }
      return link();
    },
    storage: {
      from: (name: string) => {
        calls.push({ method: "storage.from", args: [name] });
        return bucket;
      },
    },
  } as unknown as ImageLabDb;

  return { db, calls, uploads, removed, downloads };
}

const callFor = (calls: Call[], method: string) =>
  calls.filter((call) => call.method === method);

// ── The CAS ──────────────────────────────────────────────────────────────────

describe("markAttempt is an ATOMIC CAS, not a read-then-write", () => {
  const requestedRow = {
    data: {
      id: "img-1",
      run_id: "run-1",
      model_id: "gpt-image-2",
      cell_ordinal: 0,
      state: "requested",
      attempted_at: "2026-08-05T00:00:00.000Z",
      billed: false,
      failure_reason: null,
      failure_detail: null,
      storage_key: null,
      content_type: null,
      cost_estimated: null,
      cost_reported: null,
      gateway_generation_id: null,
      created_at: "2026-08-05T00:00:00.000Z",
    },
    error: null,
  };

  it("carries ALL THREE predicates in one conditional UPDATE", async () => {
    const { db, calls } = fakeDb(requestedRow);
    await runDeps(db).markAttempt("img-1");

    expect(callFor(calls, "update")).toHaveLength(1);
    // The stamp.
    expect(callFor(calls, "update")[0]!.args[0]).toHaveProperty("attempted_at");

    // ⚠ ORDER-INDEPENDENT ON PURPOSE. An earlier version compared the eq/is
    // transcripts positionally, and a positional assertion over a recorder is
    // exactly the kind that goes red once on a full run and green in isolation —
    // and a security-critical assertion that flips on run order eventually gets
    // called flaky and skipped. What matters is that all three predicates are
    // PRESENT on the one UPDATE, each exactly once, not which link came first.
    const predicates = calls
      .filter((call) => call.method === "eq" || call.method === "is")
      .map((call) => JSON.stringify(call.args))
      .sort();
    expect(predicates).toEqual(
      [
        JSON.stringify(["id", "img-1"]),
        JSON.stringify(["state", "requested"]),
        // The predicate that makes it a CAS. Without it the update still returns
        // a row and the vendor is still dialled.
        JSON.stringify(["attempted_at", null]),
      ].sort()
    );
    expect(callFor(calls, "is")).toHaveLength(1);
    expect(callFor(calls, "eq")).toHaveLength(2);
  });

  it("returns NULL on zero rows rather than throwing — the designed refusal", async () => {
    const { db } = fakeDb({ data: null, error: null });
    await expect(runDeps(db).markAttempt("img-1")).resolves.toBeNull();
  });

  it("throws on a real query error, so a fault is never mistaken for a refusal", async () => {
    const { db } = fakeDb({ data: null, error: { message: "boom" } });
    await expect(runDeps(db).markAttempt("img-1")).rejects.toThrow(/markAttempt/);
  });
});

// ── Finalize ─────────────────────────────────────────────────────────────────

describe("finalize is conditional and reports its row count", () => {
  const patch = {
    imageId: "img-1",
    state: "done" as const,
    storageKey: "runs/run-1/img-1",
    contentType: "image/png" as const,
    failureReason: null,
    failureDetail: null,
    billed: true,
    costEstimatedUsd: 0.053,
    costReportedUsd: null,
    gatewayGenerationId: "gen-1",
  };

  it("guards on `state = requested`, so a row can only be finalized once", async () => {
    const { db, calls } = fakeDb({ data: [{ id: "img-1" }], error: null });
    const result = await runDeps(db).finalize(patch);

    expect(callFor(calls, "eq").map((c) => c.args)).toEqual([
      ["id", "img-1"],
      ["state", "requested"],
    ]);
    expect(result).toEqual({ rowsMatched: 1 });
  });

  it("reports ZERO rows when the run was purged underneath the call", async () => {
    // The core's cue to delete the object it just wrote rather than orphan it.
    const { db } = fakeDb({ data: [], error: null });
    await expect(runDeps(db).finalize(patch)).resolves.toEqual({ rowsMatched: 0 });
  });

  it("writes cost only alongside billed, and the sniffed content type", async () => {
    const { db, calls } = fakeDb({ data: [{ id: "img-1" }], error: null });
    await runDeps(db).finalize(patch);
    const written = callFor(calls, "update")[0]!.args[0] as Record<string, unknown>;
    expect(written.billed).toBe(true);
    expect(written.cost_estimated).toBe(0.053);
    expect(written.content_type).toBe("image/png");
    expect(written.storage_key).toBe("runs/run-1/img-1");
  });
});

// ── Idempotency ──────────────────────────────────────────────────────────────

describe("insertRun maps the unique violation, and only that", () => {
  const row = {
    id: "run-1",
    staffId: "staff-1",
    idempotencyKey: "key-1",
    template: "t",
    slotValues: {},
    resolvedPrompt: "t",
    referenceIds: [],
    drillTags: [],
    note: "",
    compare: false,
    iteratedOnModel: null,
    iteratedFromRunId: null,
    sourceChildId: null,
    sourceIdeaId: null,
    sourceTaskId: null,
    createdAtMs: 0,
    cellCount: 1,
  };

  it("23505 becomes `duplicate_key` — the resubmit branch", async () => {
    // Typo this constant and every resubmitted compose mints a SECOND PAID RUN
    // while the whole core suite stays green (it synthesizes the signal).
    const { db } = fakeDb({ data: null, error: { code: "23505", message: "dupe" } });
    await expect(runDeps(db).insertRun(row)).resolves.toEqual({
      ok: false,
      reason: "duplicate_key",
    });
  });

  it("any other error THROWS rather than looking like a duplicate", async () => {
    const { db } = fakeDb({ data: null, error: { code: "42501", message: "denied" } });
    await expect(runDeps(db).insertRun(row)).rejects.toThrow(/insertRun/);
  });
});

// ── Storage ──────────────────────────────────────────────────────────────────

describe("putObject hands storage the EXACT bytes", () => {
  it("passes the Uint8Array through untouched, with upsert off", async () => {
    // ⚠ An offset VIEW over a larger buffer: `bytes.buffer` here would upload
    // adjacent heap memory from the same invocation.
    const backing = new ArrayBuffer(1024);
    const view = new Uint8Array(backing, 256, 64);
    view.fill(9);

    const { db, uploads, calls } = fakeDb({ data: null, error: null });
    await runDeps(db).putObject("runs/run-1/img-1", view, "image/png");

    expect(callFor(calls, "storage.from")[0]!.args).toEqual([IMAGE_LAB_BUCKET]);
    expect(uploads).toHaveLength(1);
    const body = uploads[0]!.body as Uint8Array;
    expect(body).toBe(view);
    expect(body.byteLength).toBe(64);
    expect(body.byteLength).not.toBe(backing.byteLength);
    expect(uploads[0]!.options).toEqual({ contentType: "image/png", upsert: false });
  });
});

describe("loadReferenceBytes keeps the RUN's order", () => {
  it("returns references in the order the run names them, not the query's", async () => {
    // References are sent as an ORDERED list; `in()` returns rows in whatever
    // order Postgres likes, and two runs of "the same" prompt with a reordered
    // reference set are quietly incomparable.
    const { db, downloads } = fakeDb({
      data: [
        { id: "b", storage_key: "references/b", content_type: "image/png" },
        { id: "a", storage_key: "references/a", content_type: "image/png" },
      ],
      error: null,
    });
    const out = await runDeps(db).loadReferenceBytes(["a", "b"]);
    expect(downloads).toEqual(["references/a", "references/b"]);
    expect(out).toHaveLength(2);
  });

  it("makes no query at all for a run with no references", async () => {
    const { db, calls } = fakeDb({ data: [], error: null });
    await expect(runDeps(db).loadReferenceBytes([])).resolves.toEqual([]);
    expect(calls).toEqual([]);
  });

  /**
   * ⚠ THE COVERAGE THROW. Two `continue`s used to drop a reference silently: a
   * missing row (`if (!meta) continue`) and an unnormalizable mime. The cell then
   * generated and BILLED as if it had the hero sheet, and was scored against a
   * drill it never actually ran — corrupting exactly the comparison the
   * reference library exists for. A short list is not a degraded result here, it
   * is a DIFFERENT EXPERIMENT.
   */
  it("THROWS when a requested reference row is missing", async () => {
    const { db, downloads } = fakeDb({
      data: [{ id: "a", storage_key: "references/a", content_type: "image/png" }],
      error: null,
    });
    await expect(runDeps(db).loadReferenceBytes(["a", "deleted"])).rejects.toThrow(
      /missing or carry an unusable content type/
    );
    // And nothing was downloaded, so no partial set can escape.
    expect(downloads).toEqual([]);
  });

  it("THROWS when a reference's content type cannot be normalized", async () => {
    const { db } = fakeDb({
      data: [
        { id: "a", storage_key: "references/a", content_type: "image/png" },
        { id: "b", storage_key: "references/b", content_type: "application/pdf" },
      ],
      error: null,
    });
    await expect(runDeps(db).loadReferenceBytes(["a", "b"])).rejects.toThrow(/\bb\b/);
  });

  it("THROWS when a download fails, rather than returning a short list", async () => {
    const { db } = fakeDb(
      {
        data: [{ id: "a", storage_key: "references/a", content_type: "image/png" }],
        error: null,
      },
      { download: { data: null, error: { message: "not found" } } }
    );
    await expect(runDeps(db).loadReferenceBytes(["a"])).rejects.toThrow();
  });
});

// ── The grid's view ──────────────────────────────────────────────────────────

describe("loadRunCellViews hands the client a row with NO storage key", () => {
  const doneRow = (over: Record<string, unknown> = {}) => ({
    id: "img-1",
    run_id: "run-1",
    model_id: "gpt-image-2",
    cell_ordinal: 0,
    state: "done",
    attempted_at: "2026-08-05T00:00:00.000Z",
    billed: true,
    failure_reason: null,
    failure_detail: null,
    storage_key: "runs/run-1/img-1",
    content_type: "image/png",
    cost_estimated: 0.053,
    cost_reported: null,
    gateway_generation_id: "gen-1",
    created_at: "2026-08-05T00:00:00.000Z",
    ...over,
  });

  const runRow = {
    id: "run-1",
    staff_id: "staff-1",
    idempotency_key: "k",
    template: "Draw {{product}}",
    slot_values: { product: "kites" },
    resolved_prompt: "Draw kites",
    reference_ids: [],
    drill_tags: [],
    note: "",
    compare: false,
    iterated_on_model: null,
    iterated_from_run_id: null,
    source_child_id: null,
    source_idea_id: null,
    source_task_id: null,
    created_at: "2026-08-05T00:00:00.000Z",
  };

  /** `fp_image_lab_runs` answers the run row; `fp_image_lab_images` the cells. */
  const viewDb = (cells: unknown[], storage: Record<string, unknown> = {}) =>
    fakeDb(
      {
        fp_image_lab_runs: { data: runRow, error: null },
        fp_image_lab_images: { data: cells, error: null },
      },
      storage,
      true
    ).db;

  it("omits storageKey entirely and reports hasObject + a signed URL", async () => {
    // ⚠ A RAW KEY IS NOT A CREDENTIAL, BUT IT IS THE INPUT TO ONE — and a UI that
    // holds keys is a UI whose next feature mints URLs from them client-side.
    const view = await loadRunCellViews(viewDb([doneRow()]), "run-1");
    expect(view.cells).toHaveLength(1);
    const cell = view.cells[0]!;
    expect(Object.keys(cell)).not.toContain("storageKey");
    expect(cell.hasObject).toBe(true);
    expect(cell.signedUrl).toBe("https://s/runs/run-1/img-1");
    // The TYPE says `Omit<CellRow, "storageKey">`; this says the runtime object
    // agrees, since a spread that forgot to destructure would still typecheck at
    // the call site.
    expect("storageKey" in (cell as Record<string, unknown>)).toBe(false);
  });

  it("DEGRADES per cell when a signed URL cannot be minted", async () => {
    // One failed mint costs one thumbnail, never the whole grid: a cell's
    // evidence lives on the ROW (state, cost, failure reason), not on the picture.
    const view = await loadRunCellViews(
      viewDb([doneRow()], { signedUrl: { data: null, error: { message: "nope" } } }),
      "run-1"
    );
    const cell = view.cells[0]!;
    expect(cell.hasObject).toBe(true);
    expect(cell.signedUrl).toBeNull();
    expect(cell.costEstimatedUsd).toBe(0.053);
    expect(cell.billed).toBe(true);
  });

  it("reports hasObject:false for a row that never stored anything", async () => {
    const view = await loadRunCellViews(
      viewDb([doneRow({ state: "requested", storage_key: null, billed: false })]),
      "run-1"
    );
    expect(view.cells[0]!.hasObject).toBe(false);
    expect(view.cells[0]!.signedUrl).toBeNull();
  });

  it("carries the SERVER's clock, which is what staleness is judged against", async () => {
    // A browser five minutes fast would otherwise mark every cell stale the
    // instant it was minted and offer Retry on a call still running.
    const before = Date.now();
    const view = await loadRunCellViews(viewDb([doneRow()]), "run-1");
    expect(view.serverNowMs).toBeGreaterThanOrEqual(before);
    expect(view.serverNowMs).toBeLessThanOrEqual(Date.now());
    // The run rides along so the caller can scope it to the staff member asking.
    expect(view.run?.staffId).toBe("staff-1");
    expect(view.run?.resolvedPrompt).toBe("Draw kites");
  });
});

// ── Row narrowing ────────────────────────────────────────────────────────────

describe("closed-set columns are NARROWED, never asserted", () => {
  it("throws on an unrecognized state rather than coercing it to `requested`", async () => {
    // A coercion here would make a finalized row eligible for a SECOND vendor
    // call, which is the most expensive possible way to be wrong.
    const { db } = fakeDb({
      data: { id: "img-1", run_id: "r", model_id: "m", cell_ordinal: 0, state: "queued" },
      error: null,
    });
    await expect(runDeps(db).loadCell("img-1")).rejects.toThrow(/unrecognized state/);
  });

  it("throws on an unrecognized failure_reason", async () => {
    const { db } = fakeDb({
      data: {
        id: "img-1",
        run_id: "r",
        model_id: "m",
        cell_ordinal: 0,
        state: "failed",
        failure_reason: "gremlins",
      },
      error: null,
    });
    await expect(runDeps(db).loadCell("img-1")).rejects.toThrow(/failure_reason/);
  });
});
