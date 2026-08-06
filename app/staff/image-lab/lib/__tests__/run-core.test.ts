import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRun,
  generateCell,
  retryCell,
  type FinalizePatch,
  type RunDeps,
  type RunRow,
} from "../run-core";
import { generateLabImage } from "../image-model";
import type { NormalizedImageResult } from "../image-model-rules";
import type { CellRow } from "../run-rules";
import { IMAGE_LAB_STALE_AFTER_MS } from "../image-lab-rules";

/**
 * The run flow's SEQUENCING, against in-memory fakes
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 5).
 *
 * ── WHY FAKES RATHER THAN A DATABASE ───────────────────────────────────────
 * Two of the properties this unit lives or dies on cannot be asked of a real
 * database on demand:
 *
 *   * THE CAS RACE. Two requests must pass their own read of a `requested` row
 *     and only ONE may reach the vendor. The fake stages exactly that
 *     interleaving (both reads resolve before either CAS runs), which is the
 *     difference between testing the guard and hoping for it.
 *   * THE PURGE-MID-FLIGHT. A finalize matching ZERO rows must delete the object
 *     it just wrote rather than orphan it. The fake deletes the row between the
 *     storage put and the finalize.
 *
 * And one property that is about MONEY rather than timing: the exact bytes handed
 * to storage. `result.bytes` may be a VIEW over a larger pooled ArrayBuffer, so
 * `bytes.buffer` would upload adjacent heap memory from the same invocation. The
 * fake records what it was given, and the round-trip test uses an offset view.
 */

// ── The fake ─────────────────────────────────────────────────────────────────

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A plausible PNG payload of a given length (magic bytes + filler). */
function pngOfLength(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.set(PNG, 0);
  for (let i = PNG.length; i < length; i++) bytes[i] = i % 251;
  return bytes;
}

const generated = (bytes: Uint8Array = pngOfLength(256)): NormalizedImageResult => ({
  kind: "generated",
  bytes,
  contentType: "image/png",
  gatewayGenerationId: "gen-1",
  costReportedUsd: null,
});

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

type Harness = {
  deps: RunDeps;
  runs: Map<string, RunRow>;
  cells: Map<string, CellRow>;
  objects: Map<string, Uint8Array>;
  /** Ordered record of every I/O the core performed. */
  journal: string[];
  audits: string[];
  setNow: (ms: number) => void;
  /** Hooks the tests reach into. */
  hooks: {
    generate: (request: { modelId: string }) => Promise<NormalizedImageResult>;
    beforeFinalize?: (patch: FinalizePatch) => void;
    /** The roster row `createRun` verifies `source.childId` against. */
    childIdentity?: (childId: string) => Promise<{
      firstName: string;
      lastName: string;
      username: string | null;
      isTest: boolean | null;
    } | null>;
  };
};

const MAYA_IDENTITY = {
  firstName: "Maya",
  lastName: "Chen",
  username: "maya.chen@example.com",
  isTest: false as boolean | null,
};

function makeHarness(): Harness {
  const runs = new Map<string, RunRow>();
  const cells = new Map<string, CellRow>();
  const objects = new Map<string, Uint8Array>();
  const journal: string[] = [];
  const audits: string[] = [];
  let seq = 0;
  let nowMs = 1_700_000_000_000;

  const hooks: Harness["hooks"] = {
    generate: async () => generated(),
  };

  const deps: RunDeps = {
    newId: () => `id-${++seq}`,
    now: () => nowMs,

    async insertRun(row) {
      journal.push("insertRun");
      await tick();
      for (const existing of runs.values()) {
        if (
          existing.staffId === row.staffId &&
          existing.idempotencyKey === row.idempotencyKey
        ) {
          // The `(staff_id, idempotency_key)` unique index firing.
          return { ok: false, reason: "duplicate_key" };
        }
      }
      runs.set(row.id, row);
      return { ok: true, run: row };
    },

    async findRunByIdempotency(staffId, key) {
      journal.push("findRunByIdempotency");
      await tick();
      for (const run of runs.values()) {
        if (run.staffId === staffId && run.idempotencyKey === key) return run;
      }
      return null;
    },

    async loadRun(runId) {
      journal.push("loadRun");
      await tick();
      return runs.get(runId) ?? null;
    },

    async insertCells(rows) {
      journal.push(`insertCells:${rows.length}`);
      await tick();
      const made: CellRow[] = rows.map((row) => ({
        id: row.id,
        runId: row.runId,
        modelId: row.modelId,
        cellOrdinal: row.cellOrdinal,
        state: "requested",
        attemptedAtMs: null,
        // The TRANSACTION timestamp — identical across every row of one insert,
        // exactly as Postgres `now()` behaves.
        createdAtMs: nowMs,
        failureReason: null,
        failureDetail: null,
        storageKey: null,
        billed: false,
        costEstimatedUsd: null,
        costReportedUsd: null,
      }));
      for (const row of made) cells.set(row.id, row);
      return made;
    },

    async listCells(runId) {
      journal.push("listCells");
      await tick();
      return [...cells.values()].filter((c) => c.runId === runId);
    },

    async loadCell(imageId) {
      journal.push("loadCell");
      await tick();
      return cells.get(imageId) ?? null;
    },

    /**
     * The CAS. The `await` is BEFORE the check-and-set, so two callers can both
     * complete their READ and still be serialized here — the check and the write
     * happen in one synchronous block, which is what an atomic conditional UPDATE
     * gives us in Postgres.
     */
    async markAttempt(imageId) {
      await tick();
      const row = cells.get(imageId);
      if (!row || row.state !== "requested" || row.attemptedAtMs !== null) {
        journal.push("markAttempt:refused");
        return null;
      }
      const next: CellRow = { ...row, attemptedAtMs: nowMs };
      cells.set(imageId, next);
      journal.push("markAttempt:claimed");
      return next;
    },

    async loadReferenceBytes(ids) {
      journal.push(`loadReferenceBytes:${ids.length}`);
      await tick();
      return ids.map(() => ({ bytes: pngOfLength(128), contentType: "image/png" as const }));
    },

    async loadChildIdentity(childId) {
      journal.push("loadChildIdentity");
      await tick();
      return hooks.childIdentity
        ? hooks.childIdentity(childId)
        : childId === "child-1"
          ? MAYA_IDENTITY
          : null;
    },

    async generate(request) {
      journal.push(`ADAPTER:${request.modelId}`);
      return hooks.generate(request);
    },

    async putObject(key, bytes) {
      journal.push("putObject");
      await tick();
      // ⚠ STORED EXACTLY AS HANDED OVER. No copy, no re-wrap — a fake that
      // normalized here would hide the very mutation this suite exists to catch.
      objects.set(key, bytes);
    },

    async removeObject(key) {
      journal.push("removeObject");
      await tick();
      objects.delete(key);
    },

    async finalize(patch) {
      journal.push(`finalize:${patch.state}`);
      hooks.beforeFinalize?.(patch);
      await tick();
      const row = cells.get(patch.imageId);
      // Conditional on `state = 'requested'`, like the real UPDATE.
      if (!row || row.state !== "requested") return { rowsMatched: 0 };
      cells.set(patch.imageId, {
        ...row,
        state: patch.state,
        storageKey: patch.storageKey,
        failureReason: patch.failureReason,
        failureDetail: patch.failureDetail,
        billed: patch.billed,
        costEstimatedUsd: patch.costEstimatedUsd,
        costReportedUsd: patch.costReportedUsd,
      });
      return { rowsMatched: 1 };
    },

    audit: (line) => {
      journal.push("audit");
      audits.push(line);
    },
  };

  return {
    deps,
    runs,
    cells,
    objects,
    journal,
    audits,
    setNow: (ms) => {
      nowMs = ms;
    },
    hooks,
  };
}

const composeInput = (over: Record<string, unknown> = {}) => ({
  staffId: "staff-1",
  idempotencyKey: "compose-key-0001",
  template: "Draw {{product}}",
  slotValues: { product: "sticker packs" },
  modelIds: ["gpt-image-2"],
  imageCount: 1,
  ...over,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

// ── 1. createRun ─────────────────────────────────────────────────────────────

describe("createRun — intent is stamped before the effect", () => {
  it("persists the run and one requested row per cell BEFORE any adapter call", async () => {
    const h = makeHarness();
    const created = await createRun(
      h.deps,
      composeInput({
        modelIds: ["gpt-image-2", "gemini-3-pro-image"],
        imageCount: 3,
      })
    );

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.cells).toHaveLength(6);
    expect(created.cells.every((c) => c.state === "requested")).toBe(true);
    expect(created.run.compare).toBe(true);

    // The ORDER is the assertion: nothing that could reach a vendor appears in
    // the journal at all.
    expect(h.journal).toEqual(["insertRun", "insertCells:6"]);
    expect(h.journal.some((entry) => entry.startsWith("ADAPTER"))).toBe(false);
  });

  it("resolves the prompt server-side and stores template, values AND resolved text", async () => {
    const h = makeHarness();
    const created = await createRun(h.deps, composeInput());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.run.template).toBe("Draw {{product}}");
    expect(created.run.slotValues).toEqual({ product: "sticker packs" });
    expect(created.run.resolvedPrompt).toBe("Draw sticker packs");
  });

  it("assigns cell_ordinal per model column, never leaning on created_at", async () => {
    const h = makeHarness();
    const created = await createRun(
      h.deps,
      composeInput({ modelIds: ["gpt-image-2", "gemini-3-pro-image"], imageCount: 2 })
    );
    if (!created.ok) return;
    // Every cell shares one created_at (transaction timestamp) — so ordering
    // MUST come from the ordinal.
    expect(new Set(created.cells.map((c) => c.createdAtMs)).size).toBe(1);
    expect(
      created.cells.map((c) => `${c.modelId}:${c.cellOrdinal}`)
    ).toEqual([
      "gpt-image-2:0",
      "gpt-image-2:1",
      "gemini-3-pro-image:0",
      "gemini-3-pro-image:1",
    ]);
  });

  it("REFUSES zero models without writing anything", async () => {
    const h = makeHarness();
    const created = await createRun(h.deps, composeInput({ modelIds: [] }));
    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect("refusal" in created && created.refusal.reason).toBe("no_models");
    expect(h.journal).toEqual([]);
    expect(h.runs.size).toBe(0);
  });

  it("records source ids for a run built from a child's real content (R17)", async () => {
    const h = makeHarness();
    const created = await createRun(
      h.deps,
      composeInput({
        source: { childId: "child-1", ideaId: "idea-2", taskId: "1.1.2" },
      })
    );
    if (!created.ok) return;
    expect(created.run.sourceChildId).toBe("child-1");
    expect(created.run.sourceIdeaId).toBe("idea-2");
    expect(created.run.sourceTaskId).toBe("1.1.2");
    // …and NOT a name. Internal ids only.
    expect(JSON.stringify(created.run)).not.toMatch(/first_name|firstName/);
  });
});

describe("createRun — the idempotency key is the double-submit defence", () => {
  it("a RESUBMITTED compose returns the EXISTING run and mints nothing", async () => {
    const h = makeHarness();
    const first = await createRun(h.deps, composeInput({ imageCount: 4 }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const again = await createRun(h.deps, composeInput({ imageCount: 4 }));
    expect(again.ok).toBe(true);
    if (!again.ok) return;

    expect(again.duplicate).toBe(true);
    expect(again.run.id).toBe(first.run.id);
    expect(again.cells.map((c) => c.id).sort()).toEqual(
      first.cells.map((c) => c.id).sort()
    );
    // ONE run, and NO second set of cells — which is the whole point: a fresh
    // compose would have minted fresh cell ids that every CAS then passes.
    expect(h.runs.size).toBe(1);
    expect(h.cells.size).toBe(4);
  });

  it("a DIFFERENT key from the same staff member mints a second run", async () => {
    const h = makeHarness();
    await createRun(h.deps, composeInput({ idempotencyKey: "key-a" }));
    await createRun(h.deps, composeInput({ idempotencyKey: "key-b" }));
    expect(h.runs.size).toBe(2);
  });

  it("the SAME key from a different staff member does not collide", async () => {
    const h = makeHarness();
    await createRun(h.deps, composeInput({ staffId: "staff-1" }));
    await createRun(h.deps, composeInput({ staffId: "staff-2" }));
    expect(h.runs.size).toBe(2);
  });

  it("repairs a run whose cells never landed, and only when there are none", async () => {
    const h = makeHarness();
    const first = await createRun(h.deps, composeInput({ imageCount: 2 }));
    if (!first.ok) return;
    // Simulate the crash between the two inserts.
    for (const id of [...h.cells.keys()]) h.cells.delete(id);

    const repaired = await createRun(h.deps, composeInput({ imageCount: 2 }));
    expect(repaired.ok).toBe(true);
    if (!repaired.ok) return;
    expect(repaired.duplicate).toBe(true);
    expect(repaired.cells).toHaveLength(2);

    // And a THIRD submit does not top the run up again — a resubmit can never
    // double a run's cell count, and therefore never double its bill.
    const third = await createRun(h.deps, composeInput({ imageCount: 2 }));
    if (!third.ok) return;
    expect(h.cells.size).toBe(2);
    expect(third.cells).toHaveLength(2);
  });
});

// ── 2. generateCell ──────────────────────────────────────────────────────────

async function seedOneCell(h: Harness, over: Record<string, unknown> = {}) {
  const created = await createRun(h.deps, composeInput(over));
  if (!created.ok) throw new Error("seed failed");
  h.journal.length = 0;
  return created;
}

describe("generateCell — the paid path", () => {
  it("goes requested → adapter → put → done, with the deterministic key and a cost", async () => {
    const h = makeHarness();
    const created = await seedOneCell(h);
    const imageId = created.cells[0]!.id;

    const outcome = await generateCell(h.deps, { staffId: "staff-1", imageId });
    expect(outcome).toEqual({ kind: "done", imageId });

    // The order, asserted rather than assumed: the CAS precedes the adapter, and
    // the store precedes the finalize.
    expect(h.journal).toEqual([
      "loadCell",
      "loadRun",
      "markAttempt:claimed",
      "ADAPTER:gpt-image-2",
      "putObject",
      "finalize:done",
      "audit",
    ]);

    const key = `runs/${created.run.id}/${imageId}`;
    expect(h.objects.has(key)).toBe(true);
    const row = h.cells.get(imageId)!;
    expect(row.state).toBe("done");
    expect(row.storageKey).toBe(key);
    expect(row.billed).toBe(true);
    // gpt-image-2 at its registry default tier (medium).
    expect(row.costEstimatedUsd).toBeCloseTo(0.053, 6);
  });

  it("stores the EXACT bytes — never the backing ArrayBuffer", async () => {
    // ⚠ THE MUTATION THIS TEST EXISTS FOR: `new Uint8Array(bytes.buffer)` on an
    // SDK payload that is a VIEW over a pooled buffer uploads adjacent heap
    // memory from the same serverless invocation into a bucket served to a
    // browser by signed URL.
    const h = makeHarness();
    const created = await seedOneCell(h);
    const imageId = created.cells[0]!.id;

    const backing = new ArrayBuffer(4096);
    const view = new Uint8Array(backing, 512, 300);
    view.set(PNG, 0);
    for (let i = PNG.length; i < view.length; i++) view[i] = (i * 7) % 251;
    h.hooks.generate = async () => generated(view);

    await generateCell(h.deps, { staffId: "staff-1", imageId });

    const stored = h.objects.get(`runs/${created.run.id}/${imageId}`)!;
    expect(stored.byteLength).toBe(300);
    expect(stored.byteLength).not.toBe(backing.byteLength);
    expect([...stored]).toEqual([...view]);
  });

  it("is a NO-OP on an already-finalized cell — no adapter, no finalize", async () => {
    const h = makeHarness();
    const created = await seedOneCell(h);
    const imageId = created.cells[0]!.id;
    await generateCell(h.deps, { staffId: "staff-1", imageId });
    h.journal.length = 0;

    const outcome = await generateCell(h.deps, { staffId: "staff-1", imageId });
    expect(outcome).toEqual({ kind: "already_finalized", state: "done" });
    expect(h.journal).toEqual(["loadCell"]);
  });

  it("THE CAS ADMITS EXACTLY ONE of two concurrent calls on the same cell", async () => {
    const h = makeHarness();
    const created = await seedOneCell(h);
    const imageId = created.cells[0]!.id;

    let adapterCalls = 0;
    h.hooks.generate = async () => {
      adapterCalls++;
      return generated();
    };

    // Both start together, and the fake's `loadCell` awaits — so BOTH complete a
    // read that sees `requested`. Only the CAS separates them.
    const [a, b] = await Promise.all([
      generateCell(h.deps, { staffId: "staff-1", imageId }),
      generateCell(h.deps, { staffId: "staff-1", imageId }),
    ]);

    expect(adapterCalls).toBe(1);
    const kinds = [a.kind, b.kind].sort();
    expect(kinds).toEqual(["done", "not_admitted"]);
    // The refused caller stopped BEFORE the adapter.
    expect(h.journal.filter((e) => e.startsWith("ADAPTER"))).toHaveLength(1);
    expect(h.journal).toContain("markAttempt:refused");
  });

  it("refuses a second call on an in-flight cell and says how long to wait", async () => {
    const h = makeHarness();
    const created = await seedOneCell(h);
    const imageId = created.cells[0]!.id;
    h.cells.set(imageId, { ...h.cells.get(imageId)!, attemptedAtMs: h.deps.now() - 1_000 });

    const outcome = await generateCell(h.deps, { staffId: "staff-1", imageId });
    expect(outcome.kind).toBe("retry_refused");
    if (outcome.kind !== "retry_refused") return;
    expect(outcome.retryAfterMs).toBeGreaterThan(0);
    expect(h.journal.some((e) => e.startsWith("ADAPTER"))).toBe(false);
  });
});

describe("generateCell — failures finalize, and never touch a sibling", () => {
  it("safety_blocked finalizes failed with its reason; the sibling cell is untouched", async () => {
    const h = makeHarness();
    const created = await seedOneCell(h, {
      modelIds: ["gpt-image-2", "gemini-3-pro-image"],
      imageCount: 1,
    });
    const [first, second] = created.cells;

    h.hooks.generate = async () => ({
      kind: "safety_blocked",
      reason: "The model refused to render people or characters.",
    });

    const outcome = await generateCell(h.deps, {
      staffId: "staff-1",
      imageId: first!.id,
    });
    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") return;
    expect(outcome.reason).toBe("safety_blocked");
    expect(outcome.detail).toContain("refused");

    const row = h.cells.get(first!.id)!;
    expect(row.state).toBe("failed");
    // A safety block is NOT billed and carries no cost (cost_needs_billed).
    expect(row.billed).toBe(false);
    expect(row.costEstimatedUsd).toBeNull();

    // Origin R3: one model's failure never blanks a run.
    expect(h.cells.get(second!.id)!.state).toBe("requested");
    expect(h.objects.size).toBe(0);
  });

  it("a payload that failed validation finalizes provider_error with NOTHING in the bucket", async () => {
    const h = makeHarness();
    const created = await seedOneCell(h);
    // The adapter sniffs the bytes (Unit 2) and refuses a non-image before it
    // ever returns `generated` — so the storage put is never reached.
    h.hooks.generate = async () => ({
      kind: "provider_error",
      detail: "unreadable_image_bytes",
    });

    const outcome = await generateCell(h.deps, {
      staffId: "staff-1",
      imageId: created.cells[0]!.id,
    });
    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") return;
    expect(outcome.reason).toBe("provider_error");
    expect(h.objects.size).toBe(0);
    expect(h.journal).not.toContain("putObject");

    // Billed: the vendor generated and charged; the payload was unusable to US.
    const row = h.cells.get(created.cells[0]!.id)!;
    expect(row.billed).toBe(true);
    expect(row.costEstimatedUsd).toBeCloseTo(0.053, 6);
  });

  it("an adapter timeout is BILLED with a cost; an abort BEFORE dispatch is not", async () => {
    const h = makeHarness();
    const one = await seedOneCell(h, { idempotencyKey: "k1" });
    h.hooks.generate = async () => ({ kind: "timeout", cause: "adapter_timeout" });
    await generateCell(h.deps, { staffId: "staff-1", imageId: one.cells[0]!.id });
    const timedOut = h.cells.get(one.cells[0]!.id)!;
    expect(timedOut.state).toBe("failed");
    expect(timedOut.billed).toBe(true);
    expect(timedOut.costEstimatedUsd).not.toBeNull();

    // An abort the caller had ALREADY raised when we reached the adapter: no
    // vendor call can have happened, so nothing is billed.
    const two = await createRun(h.deps, composeInput({ idempotencyKey: "k2" }));
    if (!two.ok) return;
    const preAborted = AbortSignal.abort();
    h.hooks.generate = async () => ({ kind: "timeout", cause: "caller_aborted" });
    await generateCell(h.deps, {
      staffId: "staff-1",
      imageId: two.cells[0]!.id,
      abortSignal: preAborted,
    });
    const aborted = h.cells.get(two.cells[0]!.id)!;
    expect(aborted.billed).toBe(false);
    expect(aborted.costEstimatedUsd).toBeNull();
  });

  it("a caller abort AFTER dispatch is BILLED-UNKNOWN, not free", async () => {
    // ⚠ AN ABORT AT t=200s HAS ALMOST CERTAINLY BILLED. Recording it not-billed
    // AND `failed` left it immediately retryable, which makes a second payment
    // the designed behaviour — and `canRetryCell` now gates it behind the
    // staleness window for the same reason a `pending` cell is gated.
    const h = makeHarness();
    const created = await seedOneCell(h);
    h.hooks.generate = async () => ({ kind: "timeout", cause: "caller_aborted" });

    await generateCell(h.deps, { staffId: "staff-1", imageId: created.cells[0]!.id });

    const row = h.cells.get(created.cells[0]!.id)!;
    expect(row.state).toBe("failed");
    expect(row.failureDetail).toBe("caller_aborted");
    expect(row.billed).toBe(true);
    expect(row.costEstimatedUsd).not.toBeNull();
  });

  it("passes the caller's AbortSignal THROUGH to the adapter", async () => {
    const h = makeHarness();
    const created = await seedOneCell(h);
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    const spy = vi.fn(async (request: { abortSignal?: AbortSignal }) => {
      seen = request.abortSignal;
      return generated();
    });
    h.deps.generate = spy as unknown as RunDeps["generate"];

    await generateCell(h.deps, {
      staffId: "staff-1",
      imageId: created.cells[0]!.id,
      abortSignal: controller.signal,
    });
    expect(seen).toBe(controller.signal);
  });
});

describe("generateCell — a purge underneath a running call", () => {
  it("DELETES the object it just wrote when the finalize matches zero rows", async () => {
    const h = makeHarness();
    const created = await seedOneCell(h);
    const imageId = created.cells[0]!.id;
    const key = `runs/${created.run.id}/${imageId}`;

    // The consent-revocation purge landing between the storage put and the
    // finalize — the branch the migration header explicitly requires.
    h.hooks.beforeFinalize = () => {
      h.cells.delete(imageId);
    };

    const outcome = await generateCell(h.deps, { staffId: "staff-1", imageId });
    expect(outcome).toEqual({ kind: "run_purged" });
    expect(h.journal).toContain("putObject");
    expect(h.journal).toContain("removeObject");
    // Nothing is left in the bucket that no row can ever name.
    expect(h.objects.has(key)).toBe(false);
    expect(h.objects.size).toBe(0);
  });
});

describe("generateCell — the go-live flag", () => {
  it("with IMAGE_LAB_LIVE unset, NOTHING reaches a vendor and the row records unconfigured", async () => {
    const h = makeHarness();
    const created = await seedOneCell(h);
    const sdkImage = vi.fn();
    const sdkText = vi.fn();

    // The REAL adapter, with the real flag path and fake SDK edges — so this
    // asserts the flag as the route would experience it, not as a fake decides.
    h.deps.generate = (request) =>
      generateLabImage(request, {
        isLive: () => false,
        generateImage: sdkImage as never,
        generateText: sdkText as never,
      });

    const outcome = await generateCell(h.deps, {
      staffId: "staff-1",
      imageId: created.cells[0]!.id,
    });
    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") return;
    expect(outcome.reason).toBe("unconfigured");
    expect(sdkImage).not.toHaveBeenCalled();
    expect(sdkText).not.toHaveBeenCalled();

    // Latched but NOT billed — `attempted_at` means "claimed", `billed` means
    // "this appears on the invoice".
    const row = h.cells.get(created.cells[0]!.id)!;
    expect(row.attemptedAtMs).not.toBeNull();
    expect(row.billed).toBe(false);
    expect(row.costEstimatedUsd).toBeNull();
  });
});

describe("generateCell — the audit breadcrumb", () => {
  it("notes DB-content use and carries no prompt body, slot value or child field", async () => {
    const h = makeHarness();
    const created = await seedOneCell(h, {
      slotValues: { product: "secret sticker packs" },
      source: { childId: "child-1", ideaId: "idea-1", taskId: "1.1.2" },
    });

    await generateCell(h.deps, { staffId: "staff-1", imageId: created.cells[0]!.id });

    expect(h.audits).toHaveLength(1);
    const line = h.audits[0]!;
    expect(line).toContain("staff=staff-1");
    expect(line).toContain("model=gpt-image-2");
    expect(line).toContain("runCells=1");
    expect(line).toContain("dbContent=true");
    // The prompt, the slot value, and the child's id are all absent.
    expect(line).not.toContain("sticker");
    expect(line).not.toContain("Maya");
    expect(line).not.toContain("child-77");
    expect(line).not.toContain("Draw");
  });

  it("reports dbContent=false for a hand-typed run", async () => {
    const h = makeHarness();
    const created = await seedOneCell(h);
    await generateCell(h.deps, { staffId: "staff-1", imageId: created.cells[0]!.id });
    expect(h.audits[0]!).toContain("dbContent=false");
  });
});

// ── 3. Retry ─────────────────────────────────────────────────────────────────

// ── The chokepoint: provenance and the scrub on the PAID path ────────────────

describe("createRun verifies provenance and RE-SCRUBS server-side", () => {
  it("removes the child's name from CLIENT-SUPPLIED slot values before resolving", async () => {
    // ⚠ THE SCRUB USED TO BE ADVISORY UI BEHAVIOUR. The prompt that reaches a
    // vendor is assembled HERE, from whatever slot values the client posted — so
    // a stale tab, a replayed action or a compromised session could send
    // unscrubbed child prose and still stamp `source.childId` on it.
    const h = makeHarness();
    const created = await createRun(
      h.deps,
      composeInput({
        template: "Draw {{product}} for Maya",
        slotValues: { product: "Maya's Street Cards" },
        source: { childId: "child-1", ideaId: "idea-a", taskId: null },
      })
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(created.run.resolvedPrompt).not.toMatch(/maya/i);
    expect(created.run.slotValues.product).not.toMatch(/maya/i);
    // The TEMPLATE too: pasting a child's sentence into it is the same leak by a
    // different door.
    expect(created.run.template).not.toMatch(/maya/i);
  });

  it("REFUSES an unknown source child, and writes nothing", async () => {
    const h = makeHarness();
    const created = await createRun(
      h.deps,
      composeInput({ source: { childId: "child-nope", ideaId: null, taskId: null } })
    );
    expect(created.ok).toBe(false);
    if (created.ok || !("refusal" in created)) return;
    expect(created.refusal.reason).toBe("unknown_source_child");
    expect(h.runs.size).toBe(0);
    expect(h.cells.size).toBe(0);
  });

  it("REFUSES a test family's child, on the same predicate the picker uses", async () => {
    const h = makeHarness();
    h.hooks.childIdentity = async () => ({ ...MAYA_IDENTITY, isTest: true });
    const created = await createRun(
      h.deps,
      composeInput({ source: { childId: "child-1", ideaId: null, taskId: null } })
    );
    expect(created.ok).toBe(false);
    if (created.ok || !("refusal" in created)) return;
    expect(created.refusal.reason).toBe("unknown_source_child");
  });

  it("REFUSES a source id that is not an id", async () => {
    // `source_idea_id`/`source_task_id` are documented "internal ids ONLY —
    // never a name", and arrived as free 200-character client strings.
    const h = makeHarness();
    const created = await createRun(
      h.deps,
      composeInput({
        source: { childId: "child-1", ideaId: "Maya Chen's second idea", taskId: null },
      })
    );
    expect(created.ok).toBe(false);
    if (created.ok || !("refusal" in created)) return;
    expect(created.refusal.reason).toBe("bad_source_id");
    expect(h.runs.size).toBe(0);
  });

  it("records source ids ONLY from the verified lookup", async () => {
    const h = makeHarness();
    const created = await createRun(
      h.deps,
      composeInput({ source: { childId: "child-1", ideaId: "idea-a", taskId: "1.1.2" } })
    );
    if (!created.ok) return;
    expect(created.run.sourceChildId).toBe("child-1");
    // …and a run with NO source never touches the roster at all.
    const plain = await createRun(h.deps, composeInput({ idempotencyKey: "k-plain" }));
    if (!plain.ok) return;
    expect(plain.run.sourceChildId).toBeNull();
    expect(h.journal.filter((entry) => entry === "loadChildIdentity")).toHaveLength(1);
  });
});

describe("the interrupted-insert repair cannot attach a DIFFERENT composition", () => {
  it("REFUSES a key collision between two genuinely different composes", async () => {
    // ⚠ THE OLD REPAIR INSERTED THE INCOMING REQUEST'S CELLS against a run whose
    // template, prompt and references are the FIRST request's — so the vendor is
    // billed for T1 while the composer shows T2, and the history row, the grid
    // and the evidence all name T1.
    const h = makeHarness();
    const first = await createRun(h.deps, composeInput({ template: "Draw {{product}} — A" }));
    expect(first.ok).toBe(true);

    const second = await createRun(
      h.deps,
      composeInput({ template: "Draw {{product}} — B, totally different" })
    );
    expect(second.ok).toBe(false);
    if (second.ok || !("refusal" in second)) return;
    expect(second.refusal.reason).toBe("idempotency_conflict");
  });

  it("still repairs a MATCHING compose whose cells never landed", async () => {
    const h = makeHarness();
    const first = await createRun(h.deps, composeInput());
    if (!first.ok) return;
    for (const cell of first.cells) h.cells.delete(cell.id);

    const again = await createRun(h.deps, composeInput());
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.duplicate).toBe(true);
    expect(again.cells).toHaveLength(first.cells.length);
  });
});

// ── The paid path's failure arms ─────────────────────────────────────────────

describe("a reference that cannot be read never consumes the cell", () => {
  const REF_ID = "ref-1";

  it("REFUSES before the CAS and files NO per-model failure", async () => {
    // ⚠ TWO FIXES IN ONE ORDERING. Filing a storage fault as a vendor
    // `provider_error` contaminates the per-model failure evidence Unit 6 breaks
    // out precisely to keep infra artifacts out of the model comparison — and
    // claiming the cell means the drill's one intent is spent on it.
    const h = makeHarness();
    const created = await seedOneCell(h, { referenceIds: [REF_ID] });
    h.deps.loadReferenceBytes = async () => {
      throw new Error("object gone");
    };

    const outcome = await generateCell(h.deps, {
      staffId: "staff-1",
      imageId: created.cells[0]!.id,
    });

    expect(outcome.kind).toBe("reference_unavailable");
    expect(h.journal).not.toContain("markAttempt:claimed");
    expect(h.journal.filter((entry) => entry.startsWith("ADAPTER"))).toEqual([]);
    const row = h.cells.get(created.cells[0]!.id)!;
    expect(row.state).toBe("requested");
    expect(row.attemptedAtMs).toBeNull();
    expect(row.failureReason).toBeNull();
    expect(h.audits).toHaveLength(0);
  });

  it("loads references BEFORE the CAS, so the download is not in the latched window", async () => {
    const h = makeHarness();
    const created = await seedOneCell(h, { referenceIds: [REF_ID] });
    await generateCell(h.deps, { staffId: "staff-1", imageId: created.cells[0]!.id });
    expect(h.journal.indexOf("loadReferenceBytes:1")).toBeLessThan(
      h.journal.indexOf("markAttempt:claimed")
    );
  });
});

describe("a throw from the adapter is finalized, not latched", () => {
  it("routes an unexpected throw into finalizeFailure(provider_error)", async () => {
    // ⚠ THE ONE POST-CAS AWAIT WITH NO GUARD. The adapter's contract is that no
    // vendor exception escapes it — but the run-loader wrapper, AbortSignal
    // composition, reference marshalling and an OOM are all outside it, and a
    // throw latched the row for the full staleness window with no finalize and
    // no audit.
    const h = makeHarness();
    const created = await seedOneCell(h);
    h.hooks.generate = async () => {
      throw new Error("out of memory");
    };

    const outcome = await generateCell(h.deps, {
      staffId: "staff-1",
      imageId: created.cells[0]!.id,
    });

    expect(outcome.kind).toBe("failed");
    const row = h.cells.get(created.cells[0]!.id)!;
    expect(row.state).toBe("failed");
    expect(row.failureReason).toBe("provider_error");
    expect(h.audits).toHaveLength(1);
  });
});

describe("EXACTLY ONE audit line on EVERY terminal path", () => {
  const outcomes: [string, (h: Harness) => void, string, boolean][] = [
    ["done", () => {}, "outcome=done", true],
    [
      "safety_blocked",
      (h) => {
        h.hooks.generate = async () => ({ kind: "safety_blocked", reason: "blocked" });
      },
      "outcome=safety_blocked",
      false,
    ],
    [
      "adapter timeout (billed)",
      (h) => {
        h.hooks.generate = async () => ({ kind: "timeout", cause: "adapter_timeout" });
      },
      "outcome=timeout",
      true,
    ],
    [
      "unconfigured",
      (h) => {
        h.hooks.generate = async () => ({ kind: "unconfigured" });
      },
      "outcome=unconfigured",
      false,
    ],
    [
      "adapter throw",
      (h) => {
        h.hooks.generate = async () => {
          throw new Error("boom");
        };
      },
      "outcome=provider_error",
      false,
    ],
  ];

  it.each(outcomes)(
    "%s writes one breadcrumb naming the outcome and the spend",
    async (_label, arrange, expected, billed) => {
      const h = makeHarness();
      const created = await seedOneCell(h);
      arrange(h);

      await generateCell(h.deps, { staffId: "staff-1", imageId: created.cells[0]!.id });

      expect(h.audits).toHaveLength(1);
      expect(h.audits[0]!).toContain(expected);
      expect(h.audits[0]!).toContain(`billed=${billed}`);
    }
  );

  it("a FINALIZE THROW after a paid generation still leaves a breadcrumb — and no orphan", async () => {
    // ⚠ THE OBJECT, THE COST RECORD AND THE AUDIT LINE WERE ALL LOST. Money left
    // the building and nothing anywhere recorded it, while the bytes sat in a
    // bucket no row names.
    const h = makeHarness();
    const created = await seedOneCell(h);
    h.deps.finalize = async () => {
      throw new Error("connection reset");
    };

    const outcome = await generateCell(h.deps, {
      staffId: "staff-1",
      imageId: created.cells[0]!.id,
    });

    expect(outcome.kind).toBe("unavailable");
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]!).toContain("outcome=finalize_failed");
    expect(h.audits[0]!).toContain("billed=true");
    // The key is deterministic, so the object is provably this call's own.
    expect(h.objects.size).toBe(0);
    expect(h.journal).toContain("removeObject");
  });

  it("a FAILURE finalize throw still leaves a breadcrumb", async () => {
    const h = makeHarness();
    const created = await seedOneCell(h);
    h.hooks.generate = async () => ({ kind: "rate_limited" });
    h.deps.finalize = async () => {
      throw new Error("connection reset");
    };

    await generateCell(h.deps, { staffId: "staff-1", imageId: created.cells[0]!.id });

    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]!).toContain("outcome=rate_limited");
  });

  it("the STORAGE-PUT arm records the spend even when its own finalize throws", async () => {
    // The `forceBilled` case: the vendor generated and charged, and we lost the
    // bytes afterwards. Without the breadcrumb the spend leaves zero trace.
    const h = makeHarness();
    const created = await seedOneCell(h);
    h.deps.putObject = async () => {
      throw new Error("bucket unavailable");
    };
    h.deps.finalize = async () => {
      throw new Error("connection reset");
    };

    await generateCell(h.deps, { staffId: "staff-1", imageId: created.cells[0]!.id });

    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]!).toContain("billed=true");
  });

  it("the STORAGE-PUT arm records billed spend on the row when finalize works", async () => {
    const h = makeHarness();
    const created = await seedOneCell(h);
    h.deps.putObject = async () => {
      throw new Error("bucket unavailable");
    };

    const outcome = await generateCell(h.deps, {
      staffId: "staff-1",
      imageId: created.cells[0]!.id,
    });

    expect(outcome.kind).toBe("failed");
    const row = h.cells.get(created.cells[0]!.id)!;
    expect(row.state).toBe("failed");
    expect(row.billed).toBe(true);
    expect(row.costEstimatedUsd).not.toBeNull();
    expect(h.audits[0]!).toContain("billed=true");
  });

  it("writes NOTHING for a pre-CAS refusal, where no money was authorized", async () => {
    const h = makeHarness();
    const created = await seedOneCell(h);
    const imageId = created.cells[0]!.id;
    h.cells.set(imageId, { ...h.cells.get(imageId)!, state: "done" });

    await generateCell(h.deps, { staffId: "staff-1", imageId });
    expect(h.audits).toHaveLength(0);
  });
});

describe("a latched cell past the window is told the TRUTH", () => {
  it("answers stale_latched, not `another request is already generating this`", async () => {
    // ⚠ THE OLD ANSWER WAS THE OPPOSITE OF BOTH THE TRUTH AND THE ADVICE:
    // `not_admitted` says "wait for it to finish", and `attempted_at` means this
    // row can never be re-run at all.
    const h = makeHarness();
    const created = await seedOneCell(h);
    const imageId = created.cells[0]!.id;
    h.cells.set(imageId, { ...h.cells.get(imageId)!, attemptedAtMs: h.deps.now() });
    h.setNow(h.deps.now() + IMAGE_LAB_STALE_AFTER_MS + 1);

    const outcome = await generateCell(h.deps, { staffId: "staff-1", imageId });
    expect(outcome.kind).toBe("stale_latched");
    expect(h.journal).not.toContain("markAttempt:claimed");
    expect(h.journal.filter((e) => e.startsWith("ADAPTER"))).toEqual([]);
  });
});

describe("retry refuses a row nothing has ever attempted", () => {
  it("does NOT append a second live row for one intended image", async () => {
    // Staleness ages a never-attempted row from `created_at`, so Retry used to be
    // offered — leaving two `requested` rows at one grid position, both
    // generatable and both billable.
    const h = makeHarness();
    const created = await seedOneCell(h);
    h.setNow(h.deps.now() + IMAGE_LAB_STALE_AFTER_MS + 1);

    const result = await retryCell(h.deps, {
      imageId: created.cells[0]!.id,
      staffId: "staff-1",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.outcome.kind).toBe("not_attempted");
    expect(h.cells.size).toBe(1);
  });
});

describe("a run belongs to the staff member who composed it", () => {
  it("refuses generation on ANOTHER staff member's run", async () => {
    const h = makeHarness();
    const created = await seedOneCell(h);
    const outcome = await generateCell(h.deps, {
      staffId: "staff-2",
      imageId: created.cells[0]!.id,
    });
    expect(outcome.kind).toBe("not_found");
    expect(h.journal).not.toContain("markAttempt:claimed");
  });

  it("refuses retry on ANOTHER staff member's run", async () => {
    const h = makeHarness();
    const created = await seedOneCell(h);
    h.cells.set(created.cells[0]!.id, {
      ...h.cells.get(created.cells[0]!.id)!,
      state: "failed",
      attemptedAtMs: h.deps.now(),
    });
    const result = await retryCell(h.deps, {
      imageId: created.cells[0]!.id,
      staffId: "staff-2",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.outcome.kind).toBe("not_found");
    expect(h.cells.size).toBe(1);
  });
});

describe("retryCell — a new row is the only re-entry", () => {
  it("REFUSES a non-finalized, non-stale cell", async () => {
    const h = makeHarness();
    const created = await seedOneCell(h);
    const imageId = created.cells[0]!.id;
    h.cells.set(imageId, { ...h.cells.get(imageId)!, attemptedAtMs: h.deps.now() });

    const result = await retryCell(h.deps, { imageId, staffId: "staff-1" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.outcome.kind).toBe("retry_refused");
    expect(h.cells.size).toBe(1);
  });

  it("after the staleness window it succeeds as a NEW row at the same grid position", async () => {
    const h = makeHarness();
    const created = await seedOneCell(h);
    const original = created.cells[0]!;
    h.cells.set(original.id, {
      ...h.cells.get(original.id)!,
      attemptedAtMs: h.deps.now(),
    });
    h.setNow(h.deps.now() + IMAGE_LAB_STALE_AFTER_MS);

    const result = await retryCell(h.deps, { imageId: original.id, staffId: "staff-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.imageId).not.toBe(original.id);

    const appended = h.cells.get(result.imageId)!;
    expect(appended.runId).toBe(original.runId);
    expect(appended.modelId).toBe(original.modelId);
    expect(appended.cellOrdinal).toBe(original.cellOrdinal);
    expect(appended.state).toBe("requested");
    // The failed/latched attempt REMAINS — its cost is evidence.
    expect(h.cells.get(original.id)!.attemptedAtMs).not.toBeNull();
    expect(h.cells.size).toBe(2);
  });

  it("a FAILED cell is retryable immediately", async () => {
    const h = makeHarness();
    const created = await seedOneCell(h);
    h.hooks.generate = async () => ({ kind: "rate_limited" });
    await generateCell(h.deps, { staffId: "staff-1", imageId: created.cells[0]!.id });

    const result = await retryCell(h.deps, { imageId: created.cells[0]!.id, staffId: "staff-1" });
    expect(result.ok).toBe(true);
  });

  it("the appended row generates independently of the one it replaces", async () => {
    const h = makeHarness();
    const created = await seedOneCell(h);
    h.hooks.generate = async () => ({ kind: "rate_limited" });
    await generateCell(h.deps, { staffId: "staff-1", imageId: created.cells[0]!.id });

    const retry = await retryCell(h.deps, { imageId: created.cells[0]!.id, staffId: "staff-1" });
    if (!retry.ok) return;
    h.hooks.generate = async () => generated();
    const outcome = await generateCell(h.deps, {
      staffId: "staff-1",
      imageId: retry.imageId,
    });
    expect(outcome.kind).toBe("done");
    expect(h.cells.get(created.cells[0]!.id)!.state).toBe("failed");
    expect(h.cells.get(retry.imageId)!.state).toBe("done");
  });
});
