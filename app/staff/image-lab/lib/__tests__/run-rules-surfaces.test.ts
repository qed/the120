import { describe, expect, it } from "vitest";
import { IMAGE_LAB_EVIDENCE_COPY } from "../history-rules";
import {
  buildGrid,
  canRetryCell,
  cellRenderState,
  cellsFingerprint,
  clockOffsetFor,
  hashSignature,
  idempotencyStorageKey,
  isRecordableSourceId,
  modelIdsFromCells,
  newestAttempt,
  releaseIdempotencyKey,
  resolveIdempotencyKey,
  runWithConcurrency,
  serverNowFrom,
  shouldPollCells,
  IMAGE_LAB_CELL_POLL_MS,
  IMAGE_LAB_CLIENT_FAN_CONCURRENCY,
  IMAGE_LAB_MAX_CELLS_PER_RUN,
  IMAGE_LAB_MAX_IDLE_POLLS,
  IMAGE_LAB_PRE_ADAPTER_BUDGET_MS,
  IMAGE_LAB_RUN_COPY,
  type CellRow,
  type IdempotencyStore,
} from "../run-rules";
import { IMAGE_LAB_MODELS, IMAGE_LAB_ROUTE_BUDGET_MS } from "../model-registry";
import { IMAGE_LAB_STALE_AFTER_MS } from "../image-lab-rules";

/**
 * THE DECISIONS THAT USED TO LIVE INSIDE `.tsx` FILES
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 5).
 *
 * This suite is `environment: "node"` with NO jsdom, so nothing in `RunComposer`
 * or `ResultGrid` can be rendered by a test — and Unit 4's review proved that
 * source-scan greps over a component survive DELETING the behaviour they claim
 * to cover (nine of them did, at once). Two things were written inline in those
 * components and were therefore invisible to CI:
 *
 *   * THE COMPOSER'S CLOCK-OFFSET ARITHMETIC. A sign error offers Retry on a
 *     vendor call that is still running, and pays twice.
 *   * THE GRID'S ATTEMPT GROUPING AND NEWEST-ATTEMPT SELECTION. `ResultGrid.tsx`
 *     had no test reference of any kind.
 *
 * Both now live in `run-rules` and are asserted here, along with the other
 * client-side money defences: the bounded fan, the remount-surviving idempotency
 * key, the poll that makes the recovery loop reachable, and the retry rules for
 * a never-attempted row and a billed-unknown abort.
 */

const cell = (over: Partial<CellRow> = {}): CellRow => ({
  id: "img-1",
  runId: "run-1",
  modelId: "gpt-image-2",
  cellOrdinal: 0,
  state: "requested",
  attemptedAtMs: null,
  createdAtMs: 1_000,
  resolvedPrompt: "A bright panel.",
  promptDerived: false,
  failureReason: null,
  failureDetail: null,
  storageKey: null,
  billed: false,
  costEstimatedUsd: null,
  costReportedUsd: null,
  ...over,
});

describe("the clock-offset arithmetic (a sign error pays twice)", () => {
  it("reconstructs the SERVER's clock from a later local reading", () => {
    // A browser fifteen minutes FAST. Without the anchor, every cell reads stale
    // the instant it is minted and Retry is offered on a running vendor call.
    const serverNow = 1_000_000;
    const localAtReceipt = serverNow + 15 * 60_000;
    const offset = clockOffsetFor(serverNow, localAtReceipt);
    expect(offset).toBe(-15 * 60_000);
    // Five seconds later, by the browser's own (wrong) clock:
    expect(serverNowFrom(offset, localAtReceipt + 5_000)).toBe(serverNow + 5_000);
  });

  it("works for a SLOW clock too, and the SIGN is what is asserted", () => {
    const serverNow = 1_000_000;
    const localAtReceipt = serverNow - 20 * 60_000;
    const offset = clockOffsetFor(serverNow, localAtReceipt);
    expect(serverNowFrom(offset, localAtReceipt)).toBe(serverNow);
    // Subtracting the offset instead of adding it DOUBLES the browser's error.
    expect(serverNowFrom(offset, localAtReceipt)).not.toBe(localAtReceipt - offset);
  });
});

describe("the grid's attempt selection (ResultGrid takes no decisions of its own)", () => {
  it("newestAttempt is the one buildGrid put on top", () => {
    const rows = [
      cell({ id: "a", createdAtMs: 100, state: "failed" }),
      cell({ id: "b", createdAtMs: 200 }),
      cell({ id: "c", createdAtMs: 150 }),
    ];
    const [group] = buildGrid(rows, ["gpt-image-2"]);
    expect(group!.attemptCount).toBe(3);
    expect(newestAttempt(group!).id).toBe("b");
  });

  it("resolves a created_at TIE the same way twice", () => {
    // Every cell of one run shares `created_at` byte-for-byte (transaction
    // timestamp), so the tie-break is what decides which attempt is "newest" —
    // and without it the grid shows a stale attempt on top after a re-render
    // with no data change.
    const rows = [cell({ id: "aaa", createdAtMs: 100 }), cell({ id: "zzz", createdAtMs: 100 })];
    expect(newestAttempt(buildGrid(rows, ["gpt-image-2"])[0]!).id).toBe("zzz");
    expect(newestAttempt(buildGrid([...rows].reverse(), ["gpt-image-2"])[0]!).id).toBe("zzz");
  });

  it("derives a run's columns from the ROWS IT MINTED, order preserved", () => {
    // ⚠ NOT THE LIVE CHIP SELECTION. Deselecting a model mid-fan used to erase
    // its live, billing cells from the only surface that could show or retry
    // them, and toggling a chip reordered the compare columns.
    expect(
      modelIdsFromCells([{ modelId: "b" }, { modelId: "a" }, { modelId: "b" }])
    ).toEqual(["b", "a"]);
  });
});

describe("retry is refused on a row nothing has ever attempted", () => {
  const now = 10_000_000;

  it("REFUSES a never-attempted requested row however old it is", () => {
    // Staleness ages such a row from created_at — correctly, so the grid stops
    // showing it as pending. But retrying appends a SECOND live `requested` row
    // for one intended image, and both are generatable and billable.
    const orphan = cell({
      createdAtMs: now - 10 * IMAGE_LAB_STALE_AFTER_MS,
      attemptedAtMs: null,
    });
    expect(cellRenderState(orphan, now)).toBe("stale");
    expect(canRetryCell(orphan, now)).toBe(false);
    expect(IMAGE_LAB_RUN_COPY.outcomes.notAttempted).toMatch(/generate/i);
  });

  it("still allows retry on a row that WAS attempted and went stale", () => {
    const latched = cell({
      createdAtMs: now - IMAGE_LAB_STALE_AFTER_MS,
      attemptedAtMs: now - IMAGE_LAB_STALE_AFTER_MS,
    });
    expect(canRetryCell(latched, now)).toBe(true);
  });
});

describe("a billed-unknown caller abort is gated like an in-flight cell", () => {
  const now = 10_000_000;
  const aborted = (over: Partial<CellRow>) =>
    cell({
      state: "failed",
      failureReason: "timeout",
      failureDetail: "caller_aborted",
      createdAtMs: now,
      attemptedAtMs: now,
      ...over,
    });

  it("REFUSES immediate retry on a BILLED caller_aborted failure", () => {
    // An abort at t=200s has almost certainly billed, and the vendor call may
    // still finalize over this row. Recording it not-billed and immediately
    // retryable made a second payment the DESIGNED behaviour.
    const row = aborted({ billed: true });
    expect(canRetryCell(row, now)).toBe(false);
    expect(canRetryCell(row, now + IMAGE_LAB_STALE_AFTER_MS)).toBe(true);
  });

  it("allows an UNBILLED abort — one that arrived before dispatch — immediately", () => {
    expect(canRetryCell(aborted({ billed: false }), now)).toBe(true);
  });

  it("leaves an ordinary failure immediately retryable", () => {
    const failed = cell({
      state: "failed",
      failureReason: "safety_blocked",
      createdAtMs: now,
      attemptedAtMs: now,
    });
    expect(canRetryCell(failed, now)).toBe(true);
  });
});

/**
 * ⚠ THE RETRY GUARD WAS ON THE WRONG CAUSE (C4).
 *
 * It keyed on `failureDetail === "caller_aborted" && billed === true` — but the
 * Unit 2 taxonomy classifies `caller_aborted` as NOT billed and `adapter_timeout`
 * as billed BY DEFINITION ("our AbortSignal fired: the vendor was still
 * working"). So the billed, provably-still-running case was instantly retryable
 * and the unbilled one was held for ten minutes. The reasoning quoted for the
 * guarded case is strictly MORE true of the unguarded one.
 */
describe("retry is held for a BILLED TIMEOUT, whatever its detail", () => {
  const now = 10_000_000;
  const failedTimeout = (over: Record<string, unknown> = {}) => ({
    state: "failed" as const,
    createdAtMs: now - 1000,
    attemptedAtMs: now - 1000,
    failureReason: "timeout" as const,
    failureDetail: "adapter_timeout",
    billed: true,
    ...over,
  });

  it("HOLDS an adapter_timeout that billed — the gpt-image-2 240s abort", () => {
    // The reproduction: the row lands failed/timeout/adapter_timeout/billed/$0.21,
    // Retry lit up at once, the staff member clicked, and the original call
    // completed and billed. Two charges, one intent.
    expect(canRetryCell(failedTimeout(), now)).toBe(false);
  });

  it("HOLDS a billed caller_aborted too — the case that WAS guarded", () => {
    expect(canRetryCell(failedTimeout({ failureDetail: "caller_aborted" }), now)).toBe(false);
  });

  it("OPENS once the staleness window has passed", () => {
    expect(canRetryCell(failedTimeout(), now + IMAGE_LAB_STALE_AFTER_MS + 1)).toBe(true);
  });

  it("does NOT hold an UNBILLED timeout — nothing was paid for", () => {
    expect(canRetryCell(failedTimeout({ billed: false }), now)).toBe(true);
  });

  it("does NOT hold a settled vendor answer, however it failed", () => {
    // A provider_error or a safety_blocked is a finished conversation: there is
    // no call still running for a retry to double.
    for (const reason of ["provider_error", "safety_blocked", "unconfigured"] as const) {
      expect(
        canRetryCell(failedTimeout({ failureReason: reason, failureDetail: null }), now),
        reason
      ).toBe(true);
    }
  });
});

/**
 * ⚠ THE POLL WAS UNBOUNDED, AND A RUN CAN BE PERMANENTLY WEDGED (C8).
 *
 * A run naming a reference whose OBJECT has gone fails loud before the CAS, so
 * every attempt returns `reference_unavailable` with the cell untouched —
 * `requested`, `attempted_at` NULL, forever. Nothing can repair it: the reference
 * row is append-only and `reference_ids` is snapshotted with no edit path.
 */
describe("the cell poll is BOUNDED", () => {
  const wedged = [
    { state: "requested" as const, attemptedAtMs: null, createdAtMs: 0, id: "a" },
  ];

  it("polls while something is non-final and the picture keeps changing", () => {
    expect(shouldPollCells(wedged, 0)).toBe(true);
    expect(shouldPollCells(wedged, IMAGE_LAB_MAX_IDLE_POLLS - 1)).toBe(true);
  });

  it("STOPS after enough consecutive unchanged reads", () => {
    expect(shouldPollCells(wedged, IMAGE_LAB_MAX_IDLE_POLLS)).toBe(false);
  });

  it("still stops immediately when everything is final", () => {
    expect(
      shouldPollCells([{ state: "done", attemptedAtMs: 1, createdAtMs: 0 }], 0)
    ).toBe(false);
  });

  it("the bound outlasts the whole staleness window", () => {
    // A genuinely pending cell DOES change at the end of it — the derived `stale`
    // label flips and Retry appears — so the bound must not fire first.
    expect(IMAGE_LAB_MAX_IDLE_POLLS * IMAGE_LAB_CELL_POLL_MS).toBeGreaterThan(
      IMAGE_LAB_STALE_AFTER_MS
    );
  });

  it("the fingerprint ignores a re-minted signed URL, and sees a state change", () => {
    // Comparing whole rows would count every poll as a change and make the bound
    // unreachable, which is the failure this exists to avoid.
    const a = [{ id: "x", state: "requested", attemptedAtMs: null }];
    const b = [{ id: "x", state: "requested", attemptedAtMs: null }];
    expect(cellsFingerprint(a)).toBe(cellsFingerprint(b));
    expect(cellsFingerprint(a)).not.toBe(
      cellsFingerprint([{ id: "x", state: "done", attemptedAtMs: 5 }])
    );
    // Order-independent: the loader's ordering is not a change.
    expect(
      cellsFingerprint([
        { id: "a", state: "done", attemptedAtMs: 1 },
        { id: "b", state: "failed", attemptedAtMs: 2 },
      ])
    ).toBe(
      cellsFingerprint([
        { id: "b", state: "failed", attemptedAtMs: 2 },
        { id: "a", state: "done", attemptedAtMs: 1 },
      ])
    );
  });
});

describe("the idempotency key survives a remount", () => {
  const makeStore = (): IdempotencyStore => {
    const data = new Map<string, string>();
    return {
      get: (key) => data.get(key) ?? null,
      set: (key, value) => void data.set(key, value),
      clear: (key) => void data.delete(key),
    };
  };

  it("TWO composes of an IDENTICAL composition collide on one key", () => {
    // ⚠ THE WHOLE POINT. The key lived in React state, which a reload destroys —
    // so the reload and second-tab cases the design doc names both minted a
    // fresh key, a whole new run, and a second full 12-cell fan for one intent.
    const store = makeStore();
    const signature = JSON.stringify(["Draw {{product}}", { product: "kites" }, ["a"], 4]);
    let minted = 0;
    const mint = () => `key-${++minted}`;

    const first = resolveIdempotencyKey(store, signature, mint);
    // A remount: fresh component, same store.
    const second = resolveIdempotencyKey(store, signature, mint);

    expect(second).toBe(first);
    expect(minted).toBe(1);
  });

  it("a DIFFERENT composition gets a different key, so intent is never discarded", () => {
    const store = makeStore();
    let minted = 0;
    const mint = () => `key-${++minted}`;
    const a = resolveIdempotencyKey(store, "composition-A", mint);
    const b = resolveIdempotencyKey(store, "composition-B", mint);
    expect(b).not.toBe(a);
    expect(minted).toBe(2);
  });

  it("keys by a HASH, never by the composition itself", () => {
    // The signature carries the template AND a child's slot values; that is not
    // something to park in a storage key.
    const signature = "Hi, I'm Maya, and I make collectible cards.";
    const key = idempotencyStorageKey(signature);
    expect(key).not.toContain("Maya");
    expect(key).toBe(idempotencyStorageKey(signature));
    expect(hashSignature("a")).not.toBe(hashSignature("b"));
  });

  /**
   * ⚠ AND NOTHING EVER CLEARED IT, SO THE SAME PROMPT COULD NEVER BE RUN TWICE
   * IN A SESSION — WHICH IS THE CONSISTENCY DRILL (C5).
   *
   * The signature carries no nonce, so pressing Generate again on an UNCHANGED
   * composition — the standard variance check, and the whole basis of R11's "this
   * hero sheet across N runs" — resent the same key, collided with the unique
   * index, returned the existing run as a duplicate, and fanned ZERO cells. The
   * only escape a user finds by experiment is editing the template, which changes
   * the one thing the drill holds constant.
   */
  it("a SECOND compose of an unchanged composition mints a NEW key once released", () => {
    const store = makeStore();
    const signature = JSON.stringify(["Draw {{product}}", { product: "kites" }, ["a"], 4]);
    let minted = 0;
    const mint = () => `key-${++minted}`;

    const first = resolveIdempotencyKey(store, signature, mint);
    // …the server answers, so the resubmit window this key covers is over.
    releaseIdempotencyKey(store, signature);
    const second = resolveIdempotencyKey(store, signature, mint);

    expect(second).not.toBe(first);
    expect(minted).toBe(2);
  });

  it("the key STILL covers the resubmit window before the answer arrives", () => {
    // The release happens only once `createImageLabRun` has answered. Until then
    // a reload or a second tab must land on the same key, or the bench pays twice.
    const store = makeStore();
    const signature = "sig";
    let minted = 0;
    const mint = () => `key-${++minted}`;
    expect(resolveIdempotencyKey(store, signature, mint)).toBe(
      resolveIdempotencyKey(store, signature, mint)
    );
    expect(minted).toBe(1);
  });

  it("releasing one signature leaves another alone", () => {
    const store = makeStore();
    let minted = 0;
    const mint = () => `key-${++minted}`;
    const a = resolveIdempotencyKey(store, "A", mint);
    resolveIdempotencyKey(store, "B", mint);
    releaseIdempotencyKey(store, "B");
    expect(resolveIdempotencyKey(store, "A", mint)).toBe(a);
  });

  it("degrades to a fresh key when the store cannot hold anything", () => {
    const dead: IdempotencyStore = { get: () => null, set: () => {}, clear: () => {} };
    let minted = 0;
    const mint = () => `key-${++minted}`;
    expect(resolveIdempotencyKey(dead, "sig", mint)).toBe("key-1");
    expect(resolveIdempotencyKey(dead, "sig", mint)).toBe("key-2");
  });
});

describe("the client fan is BOUNDED", () => {
  it("never exceeds the concurrency limit, and keeps INPUT order", async () => {
    expect(IMAGE_LAB_CLIENT_FAN_CONCURRENCY).toBeGreaterThanOrEqual(3);
    expect(IMAGE_LAB_CLIENT_FAN_CONCURRENCY).toBeLessThanOrEqual(4);

    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: IMAGE_LAB_MAX_CELLS_PER_RUN }, (_, i) => i);
    const out = await runWithConcurrency(items, IMAGE_LAB_CLIENT_FAN_CONCURRENCY, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return n * 2;
    });

    expect(peak).toBeLessThanOrEqual(IMAGE_LAB_CLIENT_FAN_CONCURRENCY);
    // Twelve at once co-located a whole fan on one Fluid instance and started
    // twelve abort clocks against requests that were still queued.
    expect(peak).toBeLessThan(IMAGE_LAB_MAX_CELLS_PER_RUN);
    expect(out).toEqual(items.map((n) => n * 2));
  });

  it("does nothing at all for an empty fan", async () => {
    expect(await runWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});

describe("polling, so the recovery loop is reachable at all", () => {
  it("polls while ANY attempt is non-final and stops when all are", () => {
    // Without a poll, `serverNowMs` only ever advanced at createRun — so a cell
    // left pending could never reach staleness, Retry stayed disabled forever,
    // and the fan looked hung for four or five minutes.
    expect(shouldPollCells([cell({ state: "requested" })])).toBe(true);
    expect(
      shouldPollCells([cell({ state: "done" }), cell({ id: "b", state: "requested" })])
    ).toBe(true);
    expect(
      shouldPollCells([cell({ state: "done" }), cell({ id: "b", state: "failed" })])
    ).toBe(false);
    expect(shouldPollCells([])).toBe(false);
  });
});

describe("provenance ids are a CLOSED shape", () => {
  it("accepts the ids the picker mints and refuses prose", () => {
    expect(isRecordableSourceId("idea:2")).toBe(true);
    // The curriculum's own task ids are dotted (`1.1.2`).
    expect(isRecordableSourceId("1.1.2")).toBe(true);
    expect(isRecordableSourceId("9f1c8b2e-0000-4000-8000-000000000000")).toBe(true);
    expect(isRecordableSourceId(null)).toBe(true);
    expect(isRecordableSourceId(undefined)).toBe(true);
    // These columns are documented "internal ids ONLY — never a name", and they
    // arrived as free 200-character client strings.
    expect(isRecordableSourceId("Maya Chen")).toBe(false);
    expect(isRecordableSourceId("x".repeat(65))).toBe(false);
    expect(isRecordableSourceId("")).toBe(false);
  });
});

describe("the pre-adapter budget is part of the route's arithmetic", () => {
  it("leaves the slowest model AND the reference load inside the ceiling", () => {
    // The reference load was not in the budget at all: sixteen SEQUENTIAL
    // downloads after the CAS, on a function whose slowest model already claims
    // 240 of 300 seconds.
    const slowest = Math.max(...IMAGE_LAB_MODELS.map((entry) => entry.timeoutMs));
    expect(IMAGE_LAB_PRE_ADAPTER_BUDGET_MS).toBeGreaterThan(0);
    expect(slowest + IMAGE_LAB_PRE_ADAPTER_BUDGET_MS).toBeLessThan(IMAGE_LAB_ROUTE_BUDGET_MS);
  });
});

/**
 * ⚠ A SURFACE THAT ASSERTS A VENDOR CALL HAPPENED IS AN EVIDENCE CLAIM.
 *
 * `resolved_prompt` is written at COMPOSE time, before dispatch. A gate-refused
 * cell returns BEFORE the CAS, so it sits at `state='requested'` with
 * `attempted_at` null, holding the text — and both surfaces labelled it "Prompt
 * sent", with the child's pitch beneath it, for a call that was never dialled and
 * never billed. Every freshly composed cell said the same. `attempted_at` is the
 * only fact that separates the two, so the label reads it.
 */
describe("the prompt heading is read from the LIFECYCLE, not asserted", () => {
  it("says `Prompt to send` until an attempt has actually been made", () => {
    expect(IMAGE_LAB_RUN_COPY.grid.cellPromptHeading(false)).toBe("Prompt to send");
    expect(IMAGE_LAB_RUN_COPY.grid.cellPromptHeading(true)).toBe("Prompt sent");
    // The two must differ — a heading that ignores its argument is the bug.
    expect(IMAGE_LAB_RUN_COPY.grid.cellPromptHeading(false)).not.toBe(
      IMAGE_LAB_RUN_COPY.grid.cellPromptHeading(true)
    );
  });

  it("History's per-image heading follows the same rule", () => {
    expect(IMAGE_LAB_EVIDENCE_COPY.runs.imagePrompt(false)).toBe("Prompt to send");
    expect(IMAGE_LAB_EVIDENCE_COPY.runs.imagePrompt(true)).toBe("Prompt sent");
  });
});

/**
 * ⚠ THE RETRY HINT STATED THE OPPOSITE OF WHAT RETRY DOES.
 *
 * `sentHint` read "Stored on the run. Retry re-sends exactly this, not the
 * template above", rendered beneath the run-level `resolvedPrompt` — which is the
 * AUTHORED resolution, i.e. the child's own words, present even on a run whose
 * every OpenAI cell sent derived text. But `retryCell` carries forward the CELL's
 * prompt. So the surface a human uses to VERIFY THE GATE WORKED displayed the
 * child's prose labelled as what would be re-sent, on a run composed precisely so
 * that text would never be dispatched — a false alarm in the direction most
 * likely to cause a wrong escalation.
 */
describe("the run-level prompt is labelled as evidence, not as what retry sends", () => {
  it("does not claim retry re-sends the run-level text", () => {
    const hint = IMAGE_LAB_RUN_COPY.composer.preview.sentHint;
    expect(hint).not.toMatch(/re-sends exactly this/i);
    // It must point the reader at the per-attempt text instead.
    expect(hint).toMatch(/each attempt|its card|card below/i);
  });

  it("the heading no longer asserts the whole run sent it", () => {
    expect(IMAGE_LAB_RUN_COPY.composer.preview.sentHeading).not.toMatch(/what this run sent/i);
    expect(IMAGE_LAB_EVIDENCE_COPY.runs.resolvedPrompt).not.toMatch(/what this run sent/i);
  });
});

/**
 * ⚠ THE REFUSAL COPY MUST NOT PRINT THE BYPASS.
 *
 * `unverified_slot_source` used to end "…or put the wording straight into the
 * template instead" — an instruction for the exact door the attestation now
 * closes: the template was never examined by that refusal, was not scrubbed
 * without tokens, and left `source_child_id` null so nothing armed. A product
 * must not point at its own hole.
 */
describe("no refusal recommends routing around itself", () => {
  it("the unverified-slot refusal does not name the template as an escape hatch", () => {
    const copy = IMAGE_LAB_RUN_COPY.refusals.unverifiedSlotSource;
    expect(copy).not.toMatch(/straight into the template/i);
    expect(copy).not.toMatch(/into the template instead/i);
    // It still has to say what TO do.
    expect(copy).toMatch(/picker/i);
  });

  /**
   * ⚠ THE SLOT HINT MUST TEACH THE RULE, NOT JUST THE PERMISSION. Hand-typed slot
   * values are allowed again — composing a synthetic test case is core bench work
   * — but only under the attestation, because a hand-typed slot value and a
   * replayed child's are the same POST. A hint that offered hand-typing without
   * naming the requirement would send staff straight into a refusal they could
   * not explain; one that denied hand-typing altogether would be describing a
   * capability the bench has.
   */
  it("the slot hint offers hand-typing AND names the attestation it needs", () => {
    const hint = IMAGE_LAB_RUN_COPY.composer.slots.manualHint;
    expect(hint).toMatch(/by hand/i);
    expect(hint).toMatch(/no-child-content|box/i);
  });

  it("the two gate refusals read differently, so History can tell them apart", () => {
    const text = IMAGE_LAB_RUN_COPY.outcomes.childTextGate;
    const refs = IMAGE_LAB_RUN_COPY.outcomes.childReferenceGate;
    expect(refs).not.toBe(text);
    // The reference copy must talk about references, or staff will go and change
    // the prompt in response to a refusal about an attached PNG.
    expect(refs).toMatch(/reference/i);
    expect(refs).toMatch(/google/i);
  });
});
