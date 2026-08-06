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
import {
  decideRunComposition,
  previewRows,
  type CellRow,
} from "../run-rules";
import { isCategoryDerivedPrompt } from "../category-prompt-rules";
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
  /** Every (model, prompt) pair the adapter was actually handed. */
  dispatched: { modelId: string; prompt: string }[];
  /** Every staff id `createRun` presented to the token verifier. */
  verifiedFor: string[];
  setNow: (ms: number) => void;
  /** Hooks the tests reach into. */
  hooks: {
    generate: (request: {
      modelId: string;
      prompt: string;
    }) => Promise<NormalizedImageResult>;
    /** `IMAGE_LAB_REAL_CONTENT_LIVE`, as the core sees it. */
    realContentLive: boolean;
    /** The provenance verifier. The staff id the core presented is recorded on
     *  the harness as `verifiedFor` — the real verifier binds a token to the
     *  staff member it was minted for, and can only do so if the core hands it
     *  the caller's id. */
    verifyToken: (token: string) => {
      ok: boolean;
      provenance?: { childId: string; ideaId: string | null; taskId: string | null };
    };
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

/**
 * A stand-in for the real HMAC token, decodable by the harness verifier.
 *
 * The REAL minting and verification are asserted in `source-token.test.ts`; what
 * matters to these sequences is only that provenance ARRIVES SIGNED and is
 * DERIVED rather than asserted, so a transparent format keeps the fixtures
 * readable. `INVALID_SOURCE_TOKEN` is anything this cannot parse.
 */
const token = (childId: string, ideaId: string | null = null, taskId: string | null = null) =>
  `tok:${childId}:${ideaId ?? ""}:${taskId ?? ""}`;
const VALID_SOURCE_TOKEN = token("child-1", "idea-a", "1.1.2");
const INVALID_SOURCE_TOKEN = "v1.forged.signature";

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
  /** Every (model, prompt) pair that actually reached the adapter. */
  const dispatched: { modelId: string; prompt: string }[] = [];
  /** Every staff id `createRun` presented to the token verifier. */
  const verifiedFor: string[] = [];
  let seq = 0;
  let nowMs = 1_700_000_000_000;

  const hooks: Harness["hooks"] = {
    generate: async () => generated(),
    // OFF by default, exactly as production is: an ordinary manual compose must
    // work with no token and no flag. The provenance tests turn it on.
    realContentLive: false,
    verifyToken: (presented) => {
      const parts = presented.split(":");
      if (parts[0] !== "tok" || parts.length !== 4) return { ok: false };
      return {
        ok: true,
        provenance: {
          childId: parts[1]!,
          ideaId: parts[2] === "" ? null : parts[2]!,
          taskId: parts[3] === "" ? null : parts[3]!,
        },
      };
    },
  };

  const deps: RunDeps = {
    newId: () => `id-${++seq}`,
    now: () => nowMs,

    // The provenance chokepoint, faked. `hooks.verifyToken` lets a test present
    // a token that does not verify without reproducing the HMAC.
    // ⚠ THE STAFF ID IS RECORDED. The real verifier binds a token to the staff
    // member it was minted for, and it can only do that if `createRun` hands it
    // the caller's id — see the named test.
    verifySourceToken: (token, staffId) => {
      verifiedFor.push(staffId);
      return hooks.verifyToken(token);
    },
    isRealContentLive: () => hooks.realContentLive,

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
        resolvedPrompt: row.promptText,
        promptDerived: row.promptDerived,
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
      dispatched.push({ modelId: request.modelId, prompt: request.prompt });
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
    dispatched,
    setNow: (ms) => {
      nowMs = ms;
    },
    verifiedFor,
    hooks,
  };
}

/**
 * The ORDINARY compose: a staff-authored synthetic prompt, no picker involved.
 *
 * ⚠ `noChildContentAttested: true` IS THE PRODUCT'S REAL SHAPE HERE, not test
 * convenience. Without the attestation an OpenAI cell composes on the derived
 * vocabulary — the safe default — and hand-typed slot values are refused
 * outright. A test that wants to see its own wording dispatched to gpt-image-2
 * has to say what a staff member has to say.
 *
 * Slot values are left empty in the BASE fixture only because most of these
 * sequences do not need them; hand-typed slots under the attestation are a
 * supported path and have their own named tests below.
 */
const composeInput = (over: Record<string, unknown> = {}) => ({
  staffId: "staff-1",
  idempotencyKey: "compose-key-0001",
  template: "Draw sticker packs",
  slotValues: {},
  modelIds: ["gpt-image-2"],
  imageCount: 1,
  noChildContentAttested: true,
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
    // Slot values require the picker's token now, so this is the provenanced
    // shape. `resolvedPrompt` on the run is the AUTHORED resolution either way —
    // that is what the column holds, whatever any individual cell then sent.
    h.hooks.realContentLive = true;
    const created = await createRun(
      h.deps,
      composeInput({
        template: "Draw {{product}}",
        slotValues: { product: "sticker packs" },
        sourceToken: token("child-1", "idea-a"),
      })
    );
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
    h.hooks.realContentLive = true;
    const created = await createRun(
      h.deps,
      composeInput({
        sourceToken: token("child-1", "idea-2", "1.1.2"),
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

/**
 * ⚠ "REPORTED FAILED" IS NOT "DID NOT LAND" (C3).
 *
 * `bounded()` in run-loader races a 5s wall against every query and says in its
 * own docblock that giving up on the WAIT does not cancel the request — so the
 * caller must be safe under "reported failed, actually landed". The finalize
 * catch was not: it deleted the object on the reasoning "the row still says
 * requested, so no reader resolves this key", which is exactly the assumption
 * `bounded()` forbids. A `done` row pointing at a deleted object is counted by
 * Unit 6 as a completion, is Keep-able, and is served into the Kit as a
 * harvestable result with nothing behind it.
 */
describe("a finalize that TIMES OUT but LANDS must not lose its image", () => {
  it("KEEPS the object when the row finalized despite the throw", async () => {
    const h = makeHarness();
    const created = await seedOneCell(h);
    const imageId = created.cells[0]!.id;
    const key = `runs/${created.run.id}/${imageId}`;

    // The wall elapses and the caller throws — and then Postgres commits.
    h.hooks.beforeFinalize = () => {
      const row = h.cells.get(imageId)!;
      h.cells.set(imageId, { ...row, state: "done", storageKey: key, billed: true });
      throw new Error("finalize did not answer within 5000ms");
    };

    const outcome = await generateCell(h.deps, { staffId: "staff-1", imageId });
    expect(outcome).toEqual({ kind: "unavailable" });
    expect(h.journal).toContain("putObject");
    // ⚠ THE ASSERTION. The row is `done` and names this key, so the bytes stay.
    expect(h.journal).not.toContain("removeObject");
    expect(h.objects.has(key)).toBe(true);
    expect(h.cells.get(imageId)!.state).toBe("done");
  });

  it("STILL removes the object when the row is genuinely untouched", async () => {
    // The other half: a finalize that threw and did NOT land leaves a row still
    // `requested`, which nothing will ever resolve — so the orphan goes.
    const h = makeHarness();
    const created = await seedOneCell(h);
    const imageId = created.cells[0]!.id;
    const key = `runs/${created.run.id}/${imageId}`;

    h.hooks.beforeFinalize = () => {
      throw new Error("connection reset");
    };

    const outcome = await generateCell(h.deps, { staffId: "staff-1", imageId });
    expect(outcome).toEqual({ kind: "unavailable" });
    expect(h.journal).toContain("removeObject");
    expect(h.objects.has(key)).toBe(false);
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
    h.hooks.realContentLive = true;
    const created = await seedOneCell(h, {
      slotValues: { product: "secret sticker packs" },
      sourceToken: token("child-1", "idea-1", "1.1.2"),
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
  // Every test in this block presents provenance, which the consent flag gates.
  const liveHarness = () => {
    const h = makeHarness();
    h.hooks.realContentLive = true;
    return h;
  };

  it("removes the child's name from CLIENT-SUPPLIED slot values before resolving", async () => {
    // ⚠ THE SCRUB USED TO BE ADVISORY UI BEHAVIOUR. The prompt that reaches a
    // vendor is assembled HERE, from whatever slot values the client posted — so
    // a stale tab, a replayed action or a compromised session could send
    // unscrubbed child prose and still stamp `source.childId` on it.
    const h = liveHarness();
    const created = await createRun(
      h.deps,
      composeInput({
        template: "Draw {{product}} for Maya",
        slotValues: { product: "Maya's Street Cards" },
        sourceToken: token("child-1", "idea-a"),
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
    const h = liveHarness();
    const created = await createRun(
      h.deps,
      composeInput({ sourceToken: token("child-nope") })
    );
    expect(created.ok).toBe(false);
    if (created.ok || !("refusal" in created)) return;
    expect(created.refusal.reason).toBe("unknown_source_child");
    expect(h.runs.size).toBe(0);
    expect(h.cells.size).toBe(0);
  });

  it("REFUSES a test family's child, on the same predicate the picker uses", async () => {
    const h = liveHarness();
    h.hooks.childIdentity = async () => ({ ...MAYA_IDENTITY, isTest: true });
    const created = await createRun(
      h.deps,
      composeInput({ sourceToken: token("child-1") })
    );
    expect(created.ok).toBe(false);
    if (created.ok || !("refusal" in created)) return;
    expect(created.refusal.reason).toBe("unknown_source_child");
  });

  it("REFUSES a source id that is not an id", async () => {
    // `source_idea_id`/`source_task_id` are documented "internal ids ONLY —
    // never a name", and arrived as free 200-character client strings.
    const h = liveHarness();
    const created = await createRun(
      h.deps,
      composeInput({
        sourceToken: token("child-1", "Maya Chen's second idea"),
      })
    );
    expect(created.ok).toBe(false);
    if (created.ok || !("refusal" in created)) return;
    expect(created.refusal.reason).toBe("bad_source_id");
    expect(h.runs.size).toBe(0);
  });

  /**
   * ⚠ THE BYPASS THAT REPLACED THE FORGERY: DELETE THE FIELD.
   *
   * The whole chokepoint used to be `if (input.source && input.source.childId !==
   * null)`, over a `.nullable().optional()` schema field. So the threat model the
   * docblock names — "a stale tab, a replayed action or a compromised session
   * could POST unscrubbed child prose" — was defeated by OMITTING a field rather
   * than forging one, which is strictly easier. The run was then written with the
   * prose intact, `source_child_id` null, `dbContent=false` in the audit line
   * over a real child's pitch, and the row INVISIBLE to the consent-revocation
   * purge, which keys on `source_child_id`.
   */
  it("REFUSES picker-shaped child prose posted with NO token, and stores nothing", async () => {
    const h = liveHarness();
    const created = await createRun(
      h.deps,
      composeInput({
        template: "Draw {{product}}. Pitch: {{pitch}}",
        slotValues: {
          product: "Maya's Street Cards",
          pitch: "Hi, I'm Maya, and I make collectible cards.",
        },
        sourceToken: null,
        noChildContentAttested: false,
      })
    );

    expect(created.ok).toBe(false);
    if (created.ok || !("refusal" in created)) return;
    expect(created.refusal.reason).toBe("unverified_slot_source");
    // ⚠ THE ASSERTION THAT MATTERS IS ON THE STORE. Nothing was written, so there
    // is no `resolved_prompt` carrying a child's name and no row for the purge to
    // miss.
    expect(h.runs.size).toBe(0);
    expect(h.cells.size).toBe(0);
    expect([...h.runs.values()].map((r) => r.resolvedPrompt)).toEqual([]);
    // …and the roster was never touched either.
    expect(h.journal).not.toContain("loadChildIdentity");
  });

  it("REFUSES a token that does not verify — NEVER a silent downgrade", async () => {
    // Falling through to the unprovenanced path here would restore the exact
    // bypass the token replaces, reachable by flipping one character.
    const h = liveHarness();
    const created = await createRun(
      h.deps,
      composeInput({ sourceToken: INVALID_SOURCE_TOKEN })
    );
    expect(created.ok).toBe(false);
    if (created.ok || !("refusal" in created)) return;
    expect(created.refusal.reason).toBe("bad_source_token");
    expect(h.runs.size).toBe(0);
  });

  it("REFUSES provenance while the CONSENT FLAG is off (C6)", async () => {
    // `IMAGE_LAB_REAL_CONTENT_LIVE` gated only the picker's entry points and the
    // composer's render — so with generation on and consent OFF, a stale tab still
    // drove the service-role roster lookup, stamped `source_child_id` and logged
    // `dbContent=true` on a deployment whose operator believed the switch was off.
    const h = makeHarness(); // flag off, as production is by default
    const created = await createRun(h.deps, composeInput({ sourceToken: VALID_SOURCE_TOKEN }));
    expect(created.ok).toBe(false);
    if (created.ok || !("refusal" in created)) return;
    expect(created.refusal.reason).toBe("content_picker_off");
    expect(h.runs.size).toBe(0);
    expect(h.journal).not.toContain("loadChildIdentity");
  });

  /**
   * ⚠ REPLACES "still allows a HAND-TYPED slot compose while the picker is off".
   *
   * That test pinned an INVERTED SWITCH. The `unverified_slot_source` refusal was
   * `deps.isRealContentLive() && hasSlotContent(...)`, so turning
   * `IMAGE_LAB_REAL_CONTENT_LIVE` OFF — the action an operator takes to mean
   * "stop touching child content" — REMOVED the only refusal on this path, and a
   * POST carrying a child's prose in slot values with no token composed cleanly
   * and dispatched un-gated.
   *
   * The docblock defended it with "with the picker off, no child content is in
   * circulation at all". That premise is false: content served during a flag-on
   * window persists in staff notes, in earlier runs' `slot_values` (which History
   * and Kit both render), and in open tabs. Slot content with no token is at
   * least as suspect once the switch is off, not less.
   */
  it("REFUSES a token-less slot compose WITH THE PICKER OFF too — the switch is not a licence", async () => {
    const h = makeHarness(); // flag off, as production is by default
    const created = await createRun(
      h.deps,
      composeInput({
        template: "Draw {{product}}. Pitch: {{pitch}}",
        slotValues: {
          product: "Maya's Street Cards",
          pitch: "Hi, I'm Maya, and I make collectible cards.",
        },
        // ⚠ NOT ATTESTED. That is what makes this a refusal — see the pair of
        // tests below. The FLAG is what must not matter here.
        noChildContentAttested: false,
      })
    );
    expect(created.ok).toBe(false);
    if (created.ok || !("refusal" in created)) return;
    expect(created.refusal.reason).toBe("unverified_slot_source");
    expect(h.runs.size).toBe(0);
    expect(h.cells.size).toBe(0);
  });

  /**
   * ⚠ THE TOKEN IS VERIFIED AGAINST THE CALLER'S OWN STAFF ID.
   *
   * The signed payload carried `{c,i,t,at}` — no staff id, no nonce — so one
   * token was replayable for two hours by any staff session onto any compose.
   * That never let child text reach OpenAI (a token makes the gate stricter), but
   * it corrupted the CONSENT RECORD: `source_child_id` is what the revocation
   * purge keys on, and a floating token made it attachable to runs holding none
   * of that child's content. `createRun` can only bind it if it hands the
   * verifier the id from the ACTION'S GATE, which is what this asserts.
   */
  /**
   * ⚠ THE HAND-TYPED SLOT PATH, RESTORED — AND WHY IT IS NOT A REOPENED HOLE.
   *
   * Requiring a picker token for ANY slot content made slots picker-only on every
   * deployment forever: a staff member composing a synthetic test case ("dog
   * treats", "a lemonade stand") could no longer fill a slot by hand at all, for
   * any model. That is a capability removed from the exact thing this bench
   * exists to do, and the distinction it was bought with does not hold up. The
   * line that matters is ATTESTED vs UNATTESTED, not SLOTS vs TEMPLATE: one claim
   * ("no child content in this compose") must authorize the whole compose, or it
   * is arbitrary.
   */
  it("ALLOWS hand-typed slot values under the attestation, and dispatches them to OpenAI", async () => {
    const h = makeHarness();
    const created = await createRun(
      h.deps,
      composeInput({
        template: "Draw {{product}} at a stand",
        slotValues: { product: "dog treats" },
        noChildContentAttested: true,
      })
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(created.run.sourceChildId).toBeNull();
    expect(created.run.noChildContentAttested).toBe(true);
    expect(created.run.resolvedPrompt).toBe("Draw dog treats at a stand");

    const cell = created.cells[0]!;
    expect(cell.promptDerived).toBe(false);
    const outcome = await generateCell(h.deps, { staffId: "staff-1", imageId: cell.id });
    expect(outcome.kind).toBe("done");
    expect(h.dispatched).toEqual([
      { modelId: "gpt-image-2", prompt: "Draw dog treats at a stand" },
    ]);
  });

  /**
   * ⚠ AND THE PAIR THAT PROVES THE HOLE DID NOT REOPEN. The same compose, minus
   * the tick, is still refused — nothing stored, nothing sent, the roster never
   * touched. A hand-typed slot value and a replayed child's are the same POST;
   * the attestation is the only thing that tells them apart, so removing it must
   * put the refusal straight back.
   */
  it("REFUSES the SAME hand-typed slot compose when it is NOT attested", async () => {
    const h = makeHarness();
    const created = await createRun(
      h.deps,
      composeInput({
        template: "Draw {{product}} at a stand",
        slotValues: { product: "dog treats" },
        noChildContentAttested: false,
      })
    );
    expect(created.ok).toBe(false);
    if (created.ok || !("refusal" in created)) return;
    expect(created.refusal.reason).toBe("unverified_slot_source");
    expect(h.runs.size).toBe(0);
    expect(h.cells.size).toBe(0);
    expect(h.journal).not.toContain("loadChildIdentity");
  });

  /** ABSENT is FALSE on this leg too — a client that never sends the field gets
   *  the refusal, not the permission. */
  it("REFUSES a hand-typed slot compose whose attestation is ABSENT", async () => {
    const h = makeHarness();
    const input = composeInput({ slotValues: { product: "dog treats" } });
    delete (input as Record<string, unknown>).noChildContentAttested;
    const created = await createRun(h.deps, input);
    expect(created.ok).toBe(false);
    if (created.ok || !("refusal" in created)) return;
    expect(created.refusal.reason).toBe("unverified_slot_source");
  });

  /**
   * ⚠ AND THE ATTESTATION STILL CANNOT BUY OFF VERIFIED PROVENANCE, on the slot
   * leg exactly as on the template leg. Once the token has verified, the server
   * KNOWS the run carries a child's saved work and a staff opinion is not
   * admissible — the OpenAI cell derives regardless of the tick.
   */
  it("an attested compose WITH provenance still derives for OpenAI, slots and all", async () => {
    const h = liveHarness();
    const created = await createRun(
      h.deps,
      composeInput({
        template: "Draw {{product}}",
        slotValues: { product: "sticker packs" },
        sourceToken: VALID_SOURCE_TOKEN,
        noChildContentAttested: true,
      })
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(created.run.sourceChildId).toBe("child-1");
    expect(created.run.noChildContentAttested).toBe(true);
    const cell = created.cells[0]!;
    expect(cell.promptDerived).toBe(true);
    expect(cell.resolvedPrompt).not.toContain("sticker packs");
  });

  it("presents the CALLER'S staff id to the token verifier", async () => {
    const h = liveHarness();
    await createRun(
      h.deps,
      composeInput({ staffId: "staff-7", sourceToken: VALID_SOURCE_TOKEN })
    );
    expect(h.verifiedFor).toEqual(["staff-7"]);
  });

  it("SCRUBS the note as well — it is prose on the same row (P2 #12)", async () => {
    const h = liveHarness();
    const created = await createRun(
      h.deps,
      composeInput({
        note: "Maya's second attempt at the soap panel",
        sourceToken: VALID_SOURCE_TOKEN,
      })
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.run.note).not.toMatch(/maya/i);
  });

  it("records `iteratedOnModel` ONLY when it is a registry model id (P2 #12)", async () => {
    const h = makeHarness();
    const bad = await createRun(
      h.deps,
      composeInput({ iteratedOnModel: "Maya said this one looked best" })
    );
    if (!bad.ok) return;
    expect(bad.run.iteratedOnModel).toBeNull();

    const good = await createRun(
      h.deps,
      composeInput({ idempotencyKey: "k-good", iteratedOnModel: "gpt-image-2" })
    );
    if (!good.ok) return;
    expect(good.run.iteratedOnModel).toBe("gpt-image-2");
  });

  it("records source ids ONLY from the verified lookup", async () => {
    const h = liveHarness();
    const created = await createRun(
      h.deps,
      composeInput({ sourceToken: token("child-1", "idea-a", "1.1.2") })
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

  /**
   * ⚠ THE ATTESTATION IS PART OF THE COMPOSITION, AND LEAVING IT OUT WAS A REAL
   * HOLE — the only remaining way this repair could mint a MISMATCHED ROW.
   *
   * Template, resolved prompt and references all match here; the two composes
   * differ ONLY in whether the staff member vouched for the text. The stored run
   * is UNATTESTED, so its row arms the gate; the incoming compose is ATTESTED, so
   * ITS cells carry the authored words. The old equality check saw "same
   * composition" and inserted the second's cells against the first's run —
   * producing an authored OpenAI cell on a run that says "not attested", which
   * nothing but the dispatch-side gate then catches.
   *
   * The real composer cannot get here (`compositionSignature` in
   * `RunComposer.tsx` includes `noChildContentAttested`, so flipping it mints a
   * fresh key). A hand-rolled POST reusing a key can, and that is precisely the
   * threat model the gate exists for.
   */
  it("REFUSES a key collision whose ATTESTATION disagrees", async () => {
    const h = makeHarness();
    const first = await createRun(h.deps, composeInput({ noChildContentAttested: false }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.run.noChildContentAttested).toBe(false);
    // The first compose died between the two inserts — the state the repair
    // exists to fix, and the state that makes the mismatch reachable.
    for (const cell of first.cells) h.cells.delete(cell.id);

    const second = await createRun(h.deps, composeInput({ noChildContentAttested: true }));
    expect(second.ok).toBe(false);
    if (second.ok || !("refusal" in second)) return;
    expect(second.refusal.reason).toBe("idempotency_conflict");

    // And nothing was attached: the unattested run did not silently acquire
    // cells composed under a different claim about its own text.
    expect([...h.cells.values()].filter((c) => c.runId === first.run.id)).toHaveLength(0);
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

/**
 * LOG DISCIPLINE (origin R12; Unit 7's sweep, fixed in Unit 5's home).
 *
 * Two holes the sweep found and these assertions hold shut:
 *   * the adapter's own throw was logged as an OBJECT, and the AI SDK's
 *     `AI_APICallError` carries `requestBodyValues` — the prompt — as an own
 *     enumerable property that `console.error` inspects and prints;
 *   * the cross-staff refusal was completely silent.
 */
describe("log discipline on the paid path", () => {
  const SECRET_PROMPT = "Luna's Lavender Soap, a twelve-year-old founder at the market";

  it("NEVER logs the adapter's error object — a thrown APICallError carries the prompt", async () => {
    const h = makeHarness();
    const created = await seedOneCell(h);
    // Exactly the shape the AI SDK throws: the prompt hangs off the error as an
    // own enumerable property, so `console.error("…", e)` prints it.
    h.hooks.generate = async () => {
      const e = new Error("Bad Request") as Error & { requestBodyValues?: unknown };
      e.name = "AI_APICallError";
      e.requestBodyValues = { prompt: SECRET_PROMPT };
      throw e;
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const outcome = await generateCell(h.deps, {
        staffId: "staff-1",
        imageId: created.cells[0]!.id,
      });
      expect(outcome.kind).toBe("failed");
      const logged = spy.mock.calls.flat().map((arg) => JSON.stringify(arg)).join(" ");
      expect(logged).not.toContain("Luna");
      expect(logged).not.toContain("requestBodyValues");
      // Only ONE argument, and it is a string — an object argument is the bug.
      for (const call of spy.mock.calls) {
        expect(call).toHaveLength(1);
        expect(typeof call[0]).toBe("string");
      }
      // The name still reaches the operator, which is the whole diagnostic value.
      expect(logged).toContain("AI_APICallError");
    } finally {
      spy.mockRestore();
    }
  });

  it("LOGS the cross-staff refusal — it used to be silent", async () => {
    const h = makeHarness();
    const created = await seedOneCell(h);
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const outcome = await generateCell(h.deps, {
        staffId: "staff-2",
        imageId: created.cells[0]!.id,
      });
      expect(outcome.kind).toBe("not_found");
      const logged = spy.mock.calls.flat().join(" ");
      expect(logged).toContain("cross-staff");
      expect(logged).toContain("staff-2");
      expect(logged).toContain("staff-1");
      // Ids only — the run's template and resolved prompt are in scope here and
      // must not ride along.
      expect(logged).not.toContain(created.run.resolvedPrompt);
    } finally {
      spy.mockRestore();
    }
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

// ── 4. The per-cell prompt, and the ONE non-overridable gate ─────────────────

/**
 * THE RULE, AND THE THING IT IS DELIBERATELY *NOT*.
 *
 * It is NOT "child text never leaves the building". Google's paid tier is
 * confirmed no-training with no under-18 processing bar, so a Gemini cell may
 * carry a child's own wording whenever `IMAGE_LAB_REAL_CONTENT_LIVE` is on — and
 * over-restricting it would remove the experiment this bench exists to run.
 *
 * It IS "an OpenAI cell on a run built from a child's business content must carry
 * a prompt from the closed derived vocabulary", because OpenAI's own under-18
 * guidance bars processing an under-13's personal data without zero data
 * retention we do not have.
 *
 * Every test below corresponds to a specific way of breaking that, and each one
 * is named for the mutation it catches.
 */
describe("the per-cell prompt and the OpenAI child-text gate", () => {
  const provenanced = (over: Record<string, unknown> = {}) => {
    const h = makeHarness();
    h.hooks.realContentLive = true;
    return {
      h,
      input: composeInput({
        template: "Draw {{product}}",
        slotValues: { product: "sticker packs", pitch: "I draw my own stickers" },
        sourceToken: VALID_SOURCE_TOKEN,
        ...over,
      }),
    };
  };

  /**
   * ⚠ ALSO THE TEST THAT CATCHES MUTATION (a) AND MUTATION (c).
   *   (a) a classifier that fell back to the child's text would produce a string
   *       outside the closed vocabulary, which the gate refuses — this goes red.
   *   (c) a gate that read `run.template` ("Draw {{product}}") instead of the
   *       resolved dispatched string would refuse this perfectly lawful cell —
   *       this goes red too.
   */
  it("an OpenAI cell on a provenance run sends the DERIVED prompt, and it dispatches", async () => {
    const { h, input } = provenanced();
    const created = await createRun(h.deps, input);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const cell = created.cells[0]!;
    expect(cell.promptDerived).toBe(true);
    expect(isCategoryDerivedPrompt(cell.resolvedPrompt)).toBe(true);

    const outcome = await generateCell(h.deps, { staffId: "staff-1", imageId: cell.id });
    expect(outcome.kind).toBe("done");
    expect(h.dispatched).toEqual([
      { modelId: "gpt-image-2", prompt: cell.resolvedPrompt },
    ]);
    // The child's own words never reached the adapter.
    expect(h.dispatched[0]!.prompt).not.toContain("sticker packs");
    expect(h.dispatched[0]!.prompt).not.toContain("I draw my own stickers");
  });

  /**
   * ⚠ THE NAMED TEST FOR MUTATION (a), AT THE DISPATCH GATE.
   *
   * A business this vocabulary cannot classify is the exact moment a "just send
   * the text, we could not categorize it" fallback looks reasonable — and it is
   * the vulnerability itself. Under that mutation the fallback prompt IS the
   * child's text, the gate refuses it, and this test goes red on `outcome.kind`.
   * The unclassifiable case must still generate: a refused cell here would push
   * a staff member toward retyping the pitch into the template by hand.
   */
  it("an UNCLASSIFIABLE business still dispatches a derived prompt to OpenAI", async () => {
    const { h, input } = provenanced({
      slotValues: {
        product: "quorbling flurbulator",
        pitch: "zzqqx wibbleflam for the discerning zzqqx",
      },
    });
    const created = await createRun(h.deps, input);
    if (!created.ok) return;

    const cell = created.cells[0]!;
    expect(cell.promptDerived).toBe(true);
    expect(isCategoryDerivedPrompt(cell.resolvedPrompt)).toBe(true);

    const outcome = await generateCell(h.deps, { staffId: "staff-1", imageId: cell.id });
    expect(outcome.kind).toBe("done");
    expect(h.dispatched[0]!.prompt).not.toContain("quorbling");
    expect(h.dispatched[0]!.prompt).not.toContain("zzqqx");
    expect(h.dispatched[0]!.prompt).not.toContain("wibbleflam");
  });

  /**
   * ⚠ MUTATION (f). Applying the gate to a Google model reddens this, and that is
   * the point: over-restriction is a REAL DEFECT here, not a safe default. It
   * would block the prompt experimentation the Lab exists for, on a vendor whose
   * terms do not ask for it.
   */
  it("a Google cell on the SAME run sends the child's authored words", async () => {
    const { h, input } = provenanced({
      modelIds: ["gpt-image-2", "gemini-3-pro-image"],
    });
    const created = await createRun(h.deps, input);
    if (!created.ok) return;

    const google = created.cells.find((c) => c.modelId === "gemini-3-pro-image")!;
    expect(google.promptDerived).toBe(false);
    expect(google.resolvedPrompt).toBe("Draw sticker packs");

    const outcome = await generateCell(h.deps, { staffId: "staff-1", imageId: google.id });
    expect(outcome.kind).toBe("done");
    expect(h.dispatched).toEqual([
      { modelId: "gemini-3-pro-image", prompt: "Draw sticker packs" },
    ]);
  });

  /**
   * ⚠ AND THE TWO LEGS OF ONE RUN MAY DIFFER, ON PURPOSE. This is the correction
   * that reshaped this unit: the Lab is a PROMPT bench, not a model tournament,
   * so "the same run sent different text to different models" is a feature the
   * evidence has to be able to represent — not a confound to be normalized away.
   */
  it("one run can send two different prompts, and each row records its own", async () => {
    const { h, input } = provenanced({
      modelIds: ["gpt-image-2", "gemini-3-pro-image"],
    });
    const created = await createRun(h.deps, input);
    if (!created.ok) return;

    const byModel = new Map(created.cells.map((c) => [c.modelId, c]));
    const openai = byModel.get("gpt-image-2")!;
    const google = byModel.get("gemini-3-pro-image")!;
    expect(openai.resolvedPrompt).not.toBe(google.resolvedPrompt);

    await generateCell(h.deps, { staffId: "staff-1", imageId: openai.id });
    await generateCell(h.deps, { staffId: "staff-1", imageId: google.id });
    expect(h.dispatched).toEqual([
      { modelId: "gpt-image-2", prompt: openai.resolvedPrompt },
      { modelId: "gemini-3-pro-image", prompt: google.resolvedPrompt },
    ]);
  });

  /**
   * ⚠ MUTATION (b) AND MUTATION (d), TOGETHER.
   *   (b) moving the gate to the composer/client leaves this crafted ROW
   *       unguarded — the dispatch request never goes near the composer.
   *   (d) making the gate SUBSTITUTE the derived prompt instead of refusing turns
   *       `child_text_gate` into `done` and leaves a row whose `resolved_prompt`
   *       is not what the vendor received.
   *
   * ⚠ THE ROW IS CRAFTED DIRECTLY, NOT VIA `promptModes`. Asking for `authored`
   * on an OpenAI model no longer produces an authored row at all — `promptModeFor`
   * makes the forced mode win over an explicit entry, so the compose comes out
   * derived. That is the composer-lock fix, and it means the only remaining way to
   * present an authored string on this path is a row that did not come from
   * today's `createRun`: a stale build, a direct DB edit, a future regression. The
   * gate is what has to hold for those, so that is what this test hands it.
   */
  it("an OpenAI cell whose ROW carries authored text is REFUSED at dispatch, never rewritten", async () => {
    const { h, input } = provenanced();
    const created = await createRun(h.deps, input);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const cell = created.cells[0]!;
    // Composed derived, as it must be…
    expect(cell.promptDerived).toBe(true);
    // …and now forced back to the child's own words behind the composer's back.
    h.cells.set(cell.id, {
      ...h.cells.get(cell.id)!,
      resolvedPrompt: "Draw sticker packs",
      promptDerived: false,
    });

    const outcome = await generateCell(h.deps, { staffId: "staff-1", imageId: cell.id });
    expect(outcome).toEqual({ kind: "child_text_gate" });

    // NOTHING was dialled and nothing was billed…
    expect(h.dispatched).toEqual([]);
    expect(h.journal.some((entry) => entry.startsWith("ADAPTER"))).toBe(false);
    // …the cell is untouched, so fixing the prompt choice and composing again is
    // a real recovery rather than a wedged row…
    const row = h.cells.get(cell.id)!;
    expect(row.state).toBe("requested");
    expect(row.attemptedAtMs).toBeNull();
    expect(row.billed).toBe(false);
    // …and the row still reports the prompt it carried, NOT a derived one it
    // never sent.
    expect(row.resolvedPrompt).toBe("Draw sticker packs");
    expect(row.promptDerived).toBe(false);
  });

  /**
   * ⚠ THE DISPATCH GATE READS THE RUN'S ATTESTATION FROM THE ROW, AND THAT READ
   * IS THE DEFENCE-IN-DEPTH THIS UNIT CLAIMS.
   *
   * Hardcoding `noChildContentAttested: true` in `generateCell`'s gate call
   * survived the whole suite, because every other gate test either carries
   * verified provenance (which arms the gate on its own) or never gets an
   * authored string onto an unattested row — compose forces derived, so the row
   * the gate sees is already lawful.
   *
   * But the mismatched row is REACHABLE. `resolveExistingRun` compares template,
   * resolved prompt and reference ids; until this unit it did NOT compare the
   * attestation, so an idempotency-key collision between an unattested first
   * compose that died before its cell insert and an attested second one attached
   * AUTHORED cells to an UNATTESTED run. That compose-side door is now shut (see
   * the idempotency describe above) — and this test shuts the other half: the
   * row is constructed directly, and the gate has to refuse it on the strength of
   * `run.noChildContentAttested` alone, with NO provenance to fall back on.
   *
   * Defence in depth that is claimed but unverified is not defence.
   */
  it("an UNATTESTED run with an AUTHORED cell is refused at DISPATCH, on the row's attestation alone", async () => {
    const h = makeHarness();
    const created = await createRun(
      h.deps,
      composeInput({
        template: "Hi, I am Maya, and I make collectible cards on my street",
        noChildContentAttested: false,
      })
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // ⚠ NO PROVENANCE. If the gate leaned on `sourceChildId` here it would have
    // nothing to lean on — the run's attestation is the ONLY thing arming it.
    expect(created.run.sourceChildId).toBeNull();
    expect(created.run.noChildContentAttested).toBe(false);

    const cell = created.cells[0]!;
    expect(cell.promptDerived).toBe(true);

    // The mismatched row: authored text on a run that never vouched for it —
    // exactly what the un-compared attestation used to let the repair mint.
    h.cells.set(cell.id, {
      ...h.cells.get(cell.id)!,
      resolvedPrompt: "Hi, I am Maya, and I make collectible cards on my street",
      promptDerived: false,
    });

    const outcome = await generateCell(h.deps, { staffId: "staff-1", imageId: cell.id });
    expect(outcome).toEqual({ kind: "child_text_gate" });

    // Nothing dialled, nothing billed, and the cell still re-generatable.
    expect(h.dispatched).toEqual([]);
    const row = h.cells.get(cell.id)!;
    expect(row.state).toBe("requested");
    expect(row.attemptedAtMs).toBeNull();
    expect(row.billed).toBe(false);
  });

  /**
   * ⚠ THE OTHER FAILURE MODE: THE TOOL QUIETLY STOPS WORKING.
   *
   * `deriveCategoryPrompt(input.slotValues)` → `deriveCategoryPrompt({})` passed
   * every test in this repo. Every OpenAI cell degrades to the single generic
   * fallback string: membership in the closed vocabulary still holds, the gate
   * still passes, the preview still agrees with dispatch, and not one privacy
   * assertion notices. SAFE BUT USELESS — the OpenAI leg of a PROMPT BENCH stops
   * varying with its input, and the bench's whole output becomes one string.
   *
   * So the property is stated positively and end to end, through `createRun`:
   * two DIFFERENT classifiable businesses must dispatch DIFFERENT prompts. That
   * is the assertion that catches a classifier which has stopped classifying, as
   * opposed to one that has started leaking.
   */
  it("two different classifiable businesses DERIVE different prompts, end to end", async () => {
    const drinks = provenanced({
      slotValues: { product: "lemonade", pitch: "I sell fresh cold lemonade on hot days" },
    });
    const jewelry = provenanced({
      slotValues: {
        product: "friendship bracelets",
        pitch: "I make beaded bracelets and necklaces for my friends",
      },
    });

    const a = await createRun(drinks.h.deps, drinks.input);
    const b = await createRun(jewelry.h.deps, jewelry.input);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    const cellA = a.cells[0]!;
    const cellB = b.cells[0]!;
    // Both derived, both inside the closed vocabulary — the privacy property is
    // untouched…
    expect(cellA.promptDerived).toBe(true);
    expect(cellB.promptDerived).toBe(true);
    expect(isCategoryDerivedPrompt(cellA.resolvedPrompt)).toBe(true);
    expect(isCategoryDerivedPrompt(cellB.resolvedPrompt)).toBe(true);
    // …and the classifier is still a function of its input.
    expect(cellA.resolvedPrompt).not.toBe(cellB.resolvedPrompt);

    // Through the paid path too, so the difference is what the VENDOR sees and
    // not merely what the row records.
    await generateCell(drinks.h.deps, { staffId: "staff-1", imageId: cellA.id });
    await generateCell(jewelry.h.deps, { staffId: "staff-1", imageId: cellB.id });
    expect(drinks.h.dispatched[0]!.prompt).not.toBe(jewelry.h.dispatched[0]!.prompt);
  });

  /**
   * ⚠ THE COMPOSER-LOCK FIX, OBSERVED AT THE SEQUENCE LAYER.
   *
   * A caller asking for `authored` on OpenAI used to get an authored ROW that
   * composed cleanly, previewed the child's pitch as what would be sent, was
   * counted in the cost estimate, and then 403'd every cell at dispatch — with
   * the recovery instruction naming a control the UI had disabled. Now the forced
   * mode wins at compose, so the run is generatable and no cell is ever born
   * doomed.
   */
  it("an explicit `authored` request on an OpenAI cell composes DERIVED and generates", async () => {
    const { h, input } = provenanced({
      promptModes: { "gpt-image-2": "authored" as const },
    });
    const created = await createRun(h.deps, input);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const cell = created.cells[0]!;
    expect(cell.promptDerived).toBe(true);
    expect(isCategoryDerivedPrompt(cell.resolvedPrompt)).toBe(true);
    expect(cell.resolvedPrompt).not.toContain("sticker packs");

    const outcome = await generateCell(h.deps, { staffId: "staff-1", imageId: cell.id });
    expect(outcome.kind).toBe("done");
  });

  /**
   * ⚠ THE ATTESTATION CANNOT BUY OFF VERIFIED PROVENANCE.
   *
   * `noChildContentAttested` is a claim about text a staff member typed. Once the
   * picker's token has verified, the server KNOWS the run carries a child's saved
   * work, and a staff member's opinion about it is not admissible. If this ever
   * goes green with an authored prompt, the attestation has become a bypass
   * rather than a default.
   */
  it("an attested run WITH provenance still derives for OpenAI", async () => {
    const { h, input } = provenanced({ noChildContentAttested: true });
    const created = await createRun(h.deps, input);
    if (!created.ok) return;

    expect(created.run.noChildContentAttested).toBe(true);
    expect(created.cells[0]!.promptDerived).toBe(true);
    expect(isCategoryDerivedPrompt(created.cells[0]!.resolvedPrompt)).toBe(true);
  });

  /**
   * ⚠ MUTATION (e). Persisting the template but not the dispatched prompt reddens
   * this: without `resolved_prompt` on the row there is nothing to compare, and
   * "this phrasing beat that one on this model" becomes unanswerable.
   */
  it("every image row persists the exact text it will send, before anything is sent", async () => {
    const { h, input } = provenanced({
      modelIds: ["gpt-image-2", "gemini-3-pro-image"],
      imageCount: 2,
    });
    const created = await createRun(h.deps, input);
    if (!created.ok) return;

    expect(created.cells).toHaveLength(4);
    for (const cell of created.cells) {
      expect(typeof cell.resolvedPrompt).toBe("string");
      expect(cell.resolvedPrompt).not.toBe("");
      expect(cell.promptDerived).toBe(cell.modelId === "gpt-image-2");
    }
    // Written with the row, before any adapter call exists in the journal.
    expect(h.journal).toEqual([
      // The provenance chokepoint's roster lookup, then the two writes.
      "loadChildIdentity",
      "insertRun",
      "insertCells:4",
    ]);
  });

  /**
   * ⚠ THE PREVIEW IS NOT A SECOND OPINION. `previewRows` is what the composer
   * renders; this asserts it against what `createRun` actually put on the rows.
   * A composer that showed the authored text while dispatching the derived one —
   * or the reverse — reddens here.
   */
  it("the preview shows exactly the string each model is dispatched", async () => {
    const { h, input } = provenanced({
      modelIds: ["gpt-image-2", "gemini-3-pro-image"],
    });
    const created = await createRun(h.deps, input);
    if (!created.ok) return;

    const decision = decideRunComposition({
      template: input.template,
      slotValues: input.slotValues,
      modelIds: input.modelIds,
      imageCount: input.imageCount,
      childProvenance: true,
    });
    const preview = new Map(previewRows(decision).map((row) => [row.modelId, row.text]));

    for (const cell of created.cells) {
      expect(preview.get(cell.modelId)).toBe(cell.resolvedPrompt);
    }

    await generateCell(h.deps, { staffId: "staff-1", imageId: created.cells[0]!.id });
    expect(h.dispatched[0]!.prompt).toBe(preview.get(h.dispatched[0]!.modelId));
  });

  it("a retry carries the SAME prompt as the attempt it replaces", async () => {
    const { h, input } = provenanced();
    const created = await createRun(h.deps, input);
    if (!created.ok) return;
    const first = created.cells[0]!;

    h.hooks.generate = async () => ({ kind: "rate_limited" });
    await generateCell(h.deps, { staffId: "staff-1", imageId: first.id });
    const retry = await retryCell(h.deps, { imageId: first.id, staffId: "staff-1" });
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;

    // ⚠ RE-DERIVING HERE WOULD MAKE THE TWO ATTEMPTS INCOMPARABLE, which is the
    // one thing a retry at the same grid position must never do.
    const appended = h.cells.get(retry.imageId)!;
    expect(appended.resolvedPrompt).toBe(first.resolvedPrompt);
    expect(appended.promptDerived).toBe(first.promptDerived);
  });

  /**
   * ⚠ THIS REPLACES "a run WITHOUT provenance is unaffected — verbatim template,
   * even to OpenAI", WHICH PINNED THE HOLE AS INTENDED BEHAVIOUR.
   *
   * The gate arms on `run.sourceChildId !== null`, set only when a picker token
   * verifies — and the compensating `unverified_slot_source` refusal inspects
   * SLOT VALUES ONLY. So: put the child's pitch in the TEMPLATE, omit the token,
   * leave the slots empty. No refusal fires; `tokens` is empty so `scrubNames` is
   * skipped entirely; `sourceChildId` stays null; the gate returned `ok` on its
   * first line; and the child's verbatim, unscrubbed prose went to gpt-image-2.
   * The refusal copy literally instructed this ("…or put the wording straight
   * into the template instead"), and this test guaranteed nothing would ever go
   * red about it.
   *
   * Provenance is a property of the FETCH PATH, not of the CONTENT — the same
   * class as the optional client-asserted `source` field `source-token.ts`
   * replaced, defeated by DELETING a field rather than by forging one.
   *
   * The fix is an explicit staff attestation, defaulting OFF.
   */
  it("an UN-ATTESTED run derives for OpenAI even with no provenance — the template door is shut", async () => {
    const h = makeHarness();
    const created = await createRun(
      h.deps,
      composeInput({
        // A child's pitch, typed straight into the template. No token, no slots.
        template: "Hi, I am Maya, and I make collectible cards on my street",
        noChildContentAttested: false,
      })
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(created.run.sourceChildId).toBeNull();
    expect(created.run.noChildContentAttested).toBe(false);

    const cell = created.cells[0]!;
    expect(cell.promptDerived).toBe(true);
    expect(isCategoryDerivedPrompt(cell.resolvedPrompt)).toBe(true);

    const outcome = await generateCell(h.deps, { staffId: "staff-1", imageId: cell.id });
    expect(outcome.kind).toBe("done");
    // The one assertion that matters: not a syllable of it reached the vendor.
    expect(h.dispatched[0]!.prompt).not.toMatch(/maya/i);
    expect(h.dispatched[0]!.prompt).not.toContain("collectible cards");
  });

  /** ABSENT IS FALSE. A client that has never heard of the field gets the safe
   *  composition — that is the whole point of defaulting off rather than on. */
  it("an ABSENT attestation is the same as a false one", async () => {
    const h = makeHarness();
    const input = composeInput();
    delete (input as Record<string, unknown>).noChildContentAttested;
    const created = await createRun(h.deps, input);
    if (!created.ok) return;
    expect(created.run.noChildContentAttested).toBe(false);
    expect(created.cells[0]!.promptDerived).toBe(true);
  });

  /**
   * ⚠ AND THE ATTESTED PATH LOSES NOTHING. Over-restriction is a real defect
   * here: the bench exists to find the best prompt PER MODEL, and a gpt-image-2
   * that can only ever receive one of 200 fixed strings is not a prompt bench.
   * Ticking the box restores full experimentation, and the claim is RECORDED
   * against the staff id on the run row so it has an owner.
   */
  it("an ATTESTED run sends the staff member's own wording to OpenAI, and records who said so", async () => {
    const h = makeHarness();
    const created = await createRun(
      h.deps,
      composeInput({
        staffId: "staff-9",
        template: "A neon cyberpunk lemonade stand, wide angle",
        noChildContentAttested: true,
      })
    );
    if (!created.ok) return;

    expect(created.run.noChildContentAttested).toBe(true);
    expect(created.run.staffId).toBe("staff-9");
    const cell = created.cells[0]!;
    expect(cell.promptDerived).toBe(false);

    const outcome = await generateCell(h.deps, { staffId: "staff-9", imageId: cell.id });
    expect(outcome.kind).toBe("done");
    expect(h.dispatched).toEqual([
      { modelId: "gpt-image-2", prompt: "A neon cyberpunk lemonade stand, wide angle" },
    ]);
  });

  /** GOOGLE IS UNTOUCHED BY THE ATTESTATION, in both directions. */
  it("a Google cell on an UN-ATTESTED run still sends the authored template", async () => {
    const h = makeHarness();
    const created = await createRun(
      h.deps,
      composeInput({
        modelIds: ["gemini-3-pro-image"],
        template: "A neon cyberpunk lemonade stand",
        noChildContentAttested: false,
      })
    );
    if (!created.ok) return;
    expect(created.cells[0]!.promptDerived).toBe(false);

    const outcome = await generateCell(h.deps, {
      staffId: "staff-1",
      imageId: created.cells[0]!.id,
    });
    expect(outcome.kind).toBe("done");
    expect(h.dispatched).toEqual([
      { modelId: "gemini-3-pro-image", prompt: "A neon cyberpunk lemonade stand" },
    ]);
  });

  /**
   * ⚠ THE REFERENCE LEG. The gate was a TEXT gate — `{ modelId, childProvenance,
   * promptText }` — while `generateCell` loaded up to 16 reference objects and
   * handed them to gpt-image-2 on the very run whose text had just been forced
   * down to the vocabulary. The only control was copy in an upload dialog. A
   * photo of a child's hand-lettered stand sign carries their handwriting,
   * business name and possibly likeness — the exact things the derived prompt in
   * the same request is stripping — and references are append-only and
   * undeletable, so the mistake is permanent.
   */
  it("REFUSES an OpenAI cell that carries reference images on a provenance run", async () => {
    const { h, input } = provenanced({ referenceIds: ["ref-1"] });
    const created = await createRun(h.deps, input);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const cell = created.cells[0]!;
    // The TEXT is lawful — this is not the text gate firing.
    expect(isCategoryDerivedPrompt(cell.resolvedPrompt)).toBe(true);

    const outcome = await generateCell(h.deps, { staffId: "staff-1", imageId: cell.id });
    // ⚠ ITS OWN REASON, so History can separate the two. A single reason would
    // hide every reference refusal inside the text-refusal count.
    expect(outcome).toEqual({ kind: "child_reference_gate" });
    expect(h.dispatched).toEqual([]);
    // Before the CAS: nothing dialled, nothing billed, cell re-generatable.
    const row = h.cells.get(cell.id)!;
    expect(row.state).toBe("requested");
    expect(row.attemptedAtMs).toBeNull();
  });

  /** ⚠ AND NOT ON GOOGLE. Over-restriction is a defect: the reference library is
   *  how a character sheet gets carried, and Gemini is the model it is carried
   *  to. */
  it("does NOT refuse references on a Google cell of the same run", async () => {
    const { h, input } = provenanced({
      modelIds: ["gemini-3-pro-image"],
      referenceIds: ["ref-1"],
    });
    const created = await createRun(h.deps, input);
    if (!created.ok) return;

    const outcome = await generateCell(h.deps, {
      staffId: "staff-1",
      imageId: created.cells[0]!.id,
    });
    expect(outcome.kind).toBe("done");
    expect(h.dispatched).toHaveLength(1);
  });

  /** An un-attested run with no provenance keeps its references: the attestation
   *  is a claim about typed text, and references answer to provenance only. */
  it("leaves references alone on a run with no provenance", async () => {
    const h = makeHarness();
    const created = await createRun(
      h.deps,
      composeInput({ referenceIds: ["ref-1"], noChildContentAttested: false })
    );
    if (!created.ok) return;
    const outcome = await generateCell(h.deps, {
      staffId: "staff-1",
      imageId: created.cells[0]!.id,
    });
    expect(outcome.kind).toBe("done");
  });

  /**
   * ⚠ FAIL CLOSED ON AN UNKNOWN MODEL. The gate read
   * `provider = entry?.provider ?? null; if (provider !== "openai") return ok` —
   * so an unrecognized id took the GOOGLE exit and PASSED. Nothing escaped only
   * because `image-model.ts` does its own exact-match lookup and answers
   * `unconfigured`, which made this gate's safety borrowed from an unrelated
   * module. An unknown model cannot generate anyway, so refusing costs nothing.
   */
  it("REFUSES a cell naming a model the registry does not know", async () => {
    const { h, input } = provenanced();
    const created = await createRun(h.deps, input);
    if (!created.ok) return;
    const cell = created.cells[0]!;
    h.cells.set(cell.id, { ...h.cells.get(cell.id)!, modelId: "gpt-image-9-turbo" });

    const outcome = await generateCell(h.deps, { staffId: "staff-1", imageId: cell.id });
    expect(outcome).toEqual({ kind: "unknown_model_gate" });
    expect(h.dispatched).toEqual([]);
  });

  /**
   * ⚠ THE FALLBACK IS GONE. `dispatchPrompt = cell.resolvedPrompt ??
   * run.resolvedPrompt` covered a null cell prompt with the RUN's AUTHORED
   * resolution — the child's own words — for a cell that had been composed
   * derived. Under the old code this row would have dispatched the run's text;
   * now it refuses.
   */
  it("REFUSES a cell with no recorded prompt rather than falling back to the run's", async () => {
    const h = makeHarness();
    const created = await createRun(
      h.deps,
      composeInput({ template: "A neon cyberpunk lemonade stand" })
    );
    if (!created.ok) return;
    const cell = created.cells[0]!;
    h.cells.set(cell.id, { ...h.cells.get(cell.id)!, resolvedPrompt: "" });

    const outcome = await generateCell(h.deps, { staffId: "staff-1", imageId: cell.id });
    expect(outcome).toEqual({ kind: "prompt_missing" });
    expect(h.dispatched).toEqual([]);
    expect(h.cells.get(cell.id)!.attemptedAtMs).toBeNull();
  });
});
