import { describe, expect, it, vi } from "vitest";

import {
  FW_CALL_TIMEOUT_MS,
  fwMoveTask,
  loadFwCohortMemberIds,
  runFwCheckIn,
  type RunFwCheckInResult,
} from "../fw-checkin-core";
import { FW_BATCH_MAX } from "../fw-rules";

/**
 * The FW check-in COMPOSITION (FW Unit 3), driven through a fake Supabase client.
 *
 * Unit 2's review found a P1 in an action that composed two individually-correct,
 * individually-tested cores, and the lesson it wrote down is the reason this file
 * exists: "both halves are correct and tested" quietly becomes "the flow is
 * correct", and the layer where the wrong assumption actually lives is the one
 * nothing unit-tests (docs/solutions/logic-errors/idempotent-primitive-plus-
 * unconditional-caller-rotated-a-live-credential-…-2026-07-23.md).
 *
 * The composition here is the same shape: an idempotent primitive (`fw_move_task`
 * is a deliberate no-op on an already-decided task) with an effect chained onto
 * its success (the First Dollar bell). So the flow gets its own harness, and the
 * `"use server"` file above it is left with nothing decision-bearing in it.
 */

const COHORT = "cohort-boston";
const GUIDE = "user-guide-a";
const TASK = "1.1.1";
const FIRST_DOLLAR = "1.2.4";
const NOW = Date.parse("2026-08-22T15:00:00.000Z");

type Row = Record<string, unknown>;
type RpcReply = { outcome: string; state: string | null; verified_by?: string | null };

type Seed = {
  /** student ids present in path_cohort_members for COHORT. */
  members?: string[];
  /** Per-student scripted RPC replies, consumed in order. */
  replies?: Record<string, RpcReply[]>;
  /** Force the membership select to error. */
  membershipError?: string | null;
  /** Force every RPC call to error. */
  rpcError?: string | null;
  /** Force a single named student's RPC call to error. */
  rpcErrorFor?: string | null;
  /** Return a completely empty rpc result (no row). */
  rpcEmpty?: boolean;
  /** Make one student's RPC call THROW rather than resolve with an error field —
   *  supabase-js reports most failures in-band, but a network abort can throw. */
  rpcThrowsFor?: string | null;
  /** Make one student's RPC call never settle, to exercise the timeout. */
  rpcHangsFor?: string | null;
};

function makeFakeDb(seed: Seed) {
  const members: Row[] = (seed.members ?? []).map((student_id) => ({
    student_id,
    cohort_id: COHORT,
  }));
  const rpcCalls: Record<string, unknown>[] = [];
  const replies: Record<string, RpcReply[]> = JSON.parse(JSON.stringify(seed.replies ?? {}));

  const db = {
    from(table: string) {
      const eqs: [string, unknown][] = [];
      let inFilter: [string, unknown[]] | null = null;
      const builder = {
        select() {
          return builder;
        },
        eq(col: string, val: unknown) {
          eqs.push([col, val]);
          return builder;
        },
        in(col: string, vals: unknown[]) {
          inFilter = [col, vals];
          return builder;
        },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          if (table === "path_cohort_members" && seed.membershipError) {
            return Promise.resolve({ data: null, error: { message: seed.membershipError } }).then(
              resolve,
              reject
            );
          }
          const rows = members.filter(
            (r) =>
              eqs.every(([c, v]) => r[c] === v) &&
              (!inFilter || inFilter[1].includes(r[inFilter[0]]))
          );
          return Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null }).then(
            resolve,
            reject
          );
        },
      };
      return builder;
    },
    async rpc(name: string, params: Record<string, unknown>) {
      rpcCalls.push({ name, ...params });
      const student = params.p_student_id as string;
      if (seed.rpcThrowsFor === student) throw new TypeError("fetch failed");
      if (seed.rpcHangsFor === student) return new Promise(() => {}) as never;
      if (seed.rpcError) return { data: null, error: { message: seed.rpcError } };
      if (seed.rpcErrorFor === student) return { data: null, error: { message: "boom" } };
      if (seed.rpcEmpty) return { data: [], error: null };
      const queue = replies[student];
      const reply = queue && queue.length > 0 ? queue.shift()! : { outcome: "applied", state: "verified" };
      return { data: [{ verified_by: GUIDE, ...reply }], error: null };
    },
  };

  return { db: db as never, rpcCalls };
}

const run = (seed: Seed, over: Partial<Parameters<typeof runFwCheckIn>[1]> = {}) => {
  const { db, rpcCalls } = makeFakeDb(seed);
  return {
    rpcCalls,
    result: runFwCheckIn(db, {
      actorUserId: GUIDE,
      cohortId: COHORT,
      taskId: TASK,
      action: "checkmark",
      studentIds: ["s1"],
      now: NOW,
      ...over,
    }),
  };
};

const kinds = (r: RunFwCheckInResult) =>
  r.ok ? r.outcomes.map((o) => `${o.studentId}:${o.kind}`) : [`FAIL:${r.reason}`];

/* ══════════════════════════════════════════════════════════ the RPC caller ══ */

describe("fwMoveTask — fail-closed narrowing at the service-role boundary", () => {
  it("passes every parameter the RPC declares, under its p_ names", async () => {
    const { db, rpcCalls } = makeFakeDb({ members: ["s1"] });
    await fwMoveTask(db, {
      studentId: "s1",
      taskId: TASK,
      action: "not_yet",
      actor: GUIDE,
      cohortId: COHORT,
      capturedAt: "2026-08-22T14:40:00.000Z",
      actionId: "action-1",
      clientId: "client-1",
    });
    expect(rpcCalls[0]).toEqual({
      name: "fw_move_task",
      p_student_id: "s1",
      p_task_id: TASK,
      p_action: "not_yet",
      p_actor: GUIDE,
      p_cohort_id: COHORT,
      p_captured_at: "2026-08-22T14:40:00.000Z",
      p_action_id: "action-1",
      p_client_id: "client-1",
    });
  });

  it("returns null on an RPC error rather than a fabricated echo", async () => {
    const { db } = makeFakeDb({ rpcError: "connection reset" });
    expect(
      await fwMoveTask(db, {
        studentId: "s1",
        taskId: TASK,
        action: "checkmark",
        actor: GUIDE,
        cohortId: COHORT,
        capturedAt: "2026-08-22T15:00:00.000Z",
        actionId: "a",
        clientId: null,
      })
    ).toBeNull();
  });

  it("returns null on an empty result set", async () => {
    const { db } = makeFakeDb({ rpcEmpty: true });
    expect(
      await fwMoveTask(db, {
        studentId: "s1",
        taskId: TASK,
        action: "checkmark",
        actor: GUIDE,
        cohortId: COHORT,
        capturedAt: "2026-08-22T15:00:00.000Z",
        actionId: "a",
        clientId: null,
      })
    ).toBeNull();
  });

  it("returns null on an outcome outside the union — never an `as` cast", async () => {
    const { db } = makeFakeDb({ replies: { s1: [{ outcome: "definitely_fine", state: "verified" }] } });
    expect(
      await fwMoveTask(db, {
        studentId: "s1",
        taskId: TASK,
        action: "checkmark",
        actor: GUIDE,
        cohortId: COHORT,
        capturedAt: "2026-08-22T15:00:00.000Z",
        actionId: "a",
        clientId: null,
      })
    ).toBeNull();
  });

  it("keeps a null state for `missing` — the one outcome with no row to describe", async () => {
    const { db } = makeFakeDb({ replies: { s1: [{ outcome: "missing", state: null }] } });
    const echo = await fwMoveTask(db, {
      studentId: "s1",
      taskId: TASK,
      action: "checkmark",
      actor: GUIDE,
      cohortId: COHORT,
      capturedAt: "2026-08-22T15:00:00.000Z",
      actionId: "a",
      clientId: null,
    });
    expect(echo).toEqual({ outcome: "missing", state: null, verifiedBy: GUIDE });
  });

  it("drops an unrecognized STATE to null rather than trusting it", async () => {
    const { db } = makeFakeDb({ replies: { s1: [{ outcome: "applied", state: "ascended" }] } });
    const echo = await fwMoveTask(db, {
      studentId: "s1",
      taskId: TASK,
      action: "checkmark",
      actor: GUIDE,
      cohortId: COHORT,
      capturedAt: "2026-08-22T15:00:00.000Z",
      actionId: "a",
      clientId: null,
    });
    expect(echo!.state).toBeNull();
  });
});

/* ═══════════════════════════════════════════════ the membership read ══ */

describe("loadFwCohortMemberIds — a read failure is not an empty roster", () => {
  it("returns the members that matched", async () => {
    const { db } = makeFakeDb({ members: ["s1", "s3"] });
    expect(await loadFwCohortMemberIds(db, COHORT, ["s1", "s2", "s3"])).toEqual({
      ok: true,
      memberIds: ["s1", "s3"],
    });
  });

  it("reports a read FAILURE distinctly — collapsing it to [] would be a confident lie", async () => {
    const { db } = makeFakeDb({ members: ["s1"], membershipError: "timeout" });
    expect(await loadFwCohortMemberIds(db, COHORT, ["s1"])).toEqual({ ok: false });
  });

  it("short-circuits an empty request without a query", async () => {
    const { db } = makeFakeDb({ membershipError: "would have thrown" });
    expect(await loadFwCohortMemberIds(db, COHORT, [])).toEqual({ ok: true, memberIds: [] });
  });
});

/* ════════════════════════════════════════════ the orchestration: happy paths ══ */

describe("runFwCheckIn — the single-student loop", () => {
  it("verifies membership, calls the RPC once, and reports the applied state", async () => {
    const { result, rpcCalls } = run({ members: ["s1"] });
    const r = await result;
    expect(kinds(r)).toEqual(["s1:applied"]);
    expect(rpcCalls).toHaveLength(1);
  });

  it("stamps ONE action id across the whole batch (FW-D16's grouping)", async () => {
    const { result, rpcCalls } = run(
      { members: ["s1", "s2", "s3"] },
      { studentIds: ["s1", "s2", "s3"] }
    );
    const r = await result;
    expect(r.ok && r.actionId).toBeTruthy();
    const ids = new Set(rpcCalls.map((c) => c.p_action_id));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toBe(r.ok ? r.actionId : null);
  });

  it("accepts a caller-supplied action id — an offline batch rings ONE bell on drain", async () => {
    const { result, rpcCalls } = run(
      { members: ["s1", "s2"] },
      { studentIds: ["s1", "s2"], actionId: "replayed-action-7" }
    );
    expect((await result).ok && (await result).ok).toBe(true);
    expect(new Set(rpcCalls.map((c) => c.p_action_id))).toEqual(new Set(["replayed-action-7"]));
  });

  it("threads each student's own client id, and null for the ones without", async () => {
    const { result, rpcCalls } = run(
      { members: ["s1", "s2"] },
      { studentIds: ["s1", "s2"], clientIds: { s1: "cid-1" } }
    );
    await result;
    expect(rpcCalls.map((c) => [c.p_student_id, c.p_client_id])).toEqual([
      ["s1", "cid-1"],
      ["s2", null],
    ]);
  });

  it("clamps the capture time before the RPC sees it, and flags that it clamped", async () => {
    const { result, rpcCalls } = run(
      { members: ["s1"] },
      { capturedAt: new Date(NOW + 3_600_000).toISOString() }
    );
    const r = await result;
    expect(r.ok && r.capturedAtClamped).toBe(true);
    expect(rpcCalls[0].p_captured_at).toBe(new Date(NOW).toISOString());
  });

  it("passes an honest offline capture time through unclamped", async () => {
    const twentyAgo = new Date(NOW - 20 * 60_000).toISOString();
    const { result, rpcCalls } = run({ members: ["s1"] }, { capturedAt: twentyAgo });
    const r = await result;
    expect(r.ok && r.capturedAtClamped).toBe(false);
    expect(rpcCalls[0].p_captured_at).toBe(twentyAgo);
  });
});

/* ══════════════════════════════════════════════ batch partiality ══ */

describe("runFwCheckIn — a partial batch is a designed, REPORTED state", () => {
  it("skips a non-member by name and still writes for the rest", async () => {
    const { result, rpcCalls } = run(
      { members: ["s1", "s3"] },
      { studentIds: ["s1", "s2", "s3"] }
    );
    const r = await result;
    expect(kinds(r)).toEqual(["s1:applied", "s2:skipped", "s3:applied"]);
    // The non-member is never sent to the RPC at all.
    expect(rpcCalls.map((c) => c.p_student_id)).toEqual(["s1", "s3"]);
  });

  it("names the already-verified teammate rather than failing the batch", async () => {
    const { result } = run(
      {
        members: ["s1", "s2", "s3"],
        replies: { s2: [{ outcome: "already_done", state: "verified" }] },
      },
      { studentIds: ["s1", "s2", "s3"] }
    );
    expect(kinds(await result)).toEqual(["s1:applied", "s2:already_done", "s3:applied"]);
  });

  it("one student's RPC failure NEVER aborts the others", async () => {
    const { result, rpcCalls } = run(
      { members: ["s1", "s2", "s3"], rpcErrorFor: "s2" },
      { studentIds: ["s1", "s2", "s3"] }
    );
    expect(kinds(await result)).toEqual(["s1:applied", "s2:failed", "s3:applied"]);
    expect(rpcCalls).toHaveLength(3);
  });

  it("preserves the guide's selection order in the report, writes and skips interleaved", async () => {
    const { result } = run(
      { members: ["s2"] },
      { studentIds: ["s3", "s2", "s1"] }
    );
    expect(kinds(await result)).toEqual(["s3:skipped", "s2:applied", "s1:skipped"]);
  });

  it("de-duplicates a repeated student — one RPC call, one result line", async () => {
    const { result, rpcCalls } = run(
      { members: ["s1"] },
      { studentIds: ["s1", "s1", "s1"] }
    );
    expect(kinds(await result)).toEqual(["s1:applied"]);
    expect(rpcCalls).toHaveLength(1);
  });

  it("reports an over-cap student as skipped rather than silently dropping it", async () => {
    const many = ["s1", "s2", "s3", "s4"];
    const { result, rpcCalls } = run({ members: many }, { studentIds: many });
    const r = await result;
    expect(rpcCalls).toHaveLength(FW_BATCH_MAX);
    expect(kinds(r)).toEqual(["s1:applied", "s2:applied", "s3:applied", "s4:skipped"]);
    expect(r.ok && r.outcomes[3]).toEqual({
      studentId: "s4",
      kind: "skipped",
      reason: "over_batch_max",
    });
  });
});

/* ══════════════════════════════════ the membership read gates the whole write ══ */

describe("runFwCheckIn — an unverifiable cohort refuses the ACTION, never writes", () => {
  it("a membership read failure refuses everything and calls no RPC", async () => {
    const { result, rpcCalls } = run(
      { members: ["s1", "s2"], membershipError: "statement timeout" },
      { studentIds: ["s1", "s2"] }
    );
    expect(await result).toEqual({ ok: false, reason: "unavailable" });
    // The point: a cohort stamp we could not verify is a PERMANENT lie in an
    // append-only log, so nothing is written at all.
    expect(rpcCalls).toHaveLength(0);
  });

  it("an empty membership skips everyone rather than writing an unverified stamp", async () => {
    const { result, rpcCalls } = run({ members: [] }, { studentIds: ["s1", "s2"] });
    expect(kinds(await result)).toEqual(["s1:skipped", "s2:skipped"]);
    expect(rpcCalls).toHaveLength(0);
  });

  it("a `cohort_invalid` echo (the RPC's own re-assertion) surfaces as a failure", async () => {
    const { result } = run({
      members: ["s1"],
      replies: { s1: [{ outcome: "cohort_invalid", state: "locked" }] },
    });
    const r = await result;
    expect(r.ok && r.outcomes[0]).toEqual({
      studentId: "s1",
      kind: "failed",
      reason: "cohort_invalid",
    });
  });
});

/* ═══════════════════════════════════ THE composition trap: the bell ══ */

describe("First Dollar — the effect chained onto an idempotent primitive's success", () => {
  it("rings for a student who newly verified 1.2.4", async () => {
    const { result } = run({ members: ["s1"] }, { taskId: FIRST_DOLLAR });
    const r = await result;
    expect(r.ok && r.firstDollar).toEqual(["s1"]);
  });

  it("does NOT ring when the checkmark was a no-op on an already-verified task", async () => {
    // THE Unit-2 bug, transplanted: `already_done` is a SUCCESS of the idempotent
    // primitive. Chaining the effect on "the call succeeded" instead of "this
    // student newly crossed" would ring a bell for a child who already rang it.
    const { result } = run(
      { members: ["s1"], replies: { s1: [{ outcome: "already_done", state: "verified" }] } },
      { taskId: FIRST_DOLLAR }
    );
    const r = await result;
    expect(r.ok && r.firstDollar).toEqual([]);
  });

  it("does NOT ring for a replayed offline tap — the physical bell already rang", async () => {
    const { result } = run(
      { members: ["s1"], replies: { s1: [{ outcome: "replayed", state: "verified" }] } },
      { taskId: FIRST_DOLLAR, clientIds: { s1: "cid-1" } }
    );
    const r = await result;
    expect(r.ok && r.firstDollar).toEqual([]);
  });

  it("in a mixed batch, names ONLY the children who actually crossed", async () => {
    const { result } = run(
      {
        members: ["s1", "s2", "s3"],
        replies: {
          s2: [{ outcome: "already_done", state: "verified" }],
          s3: [{ outcome: "applied", state: "verified" }],
        },
      },
      { taskId: FIRST_DOLLAR, studentIds: ["s1", "s2", "s3"] }
    );
    const r = await result;
    expect(r.ok && r.firstDollar).toEqual(["s1", "s3"]);
  });

  it("never rings for not-yet or undo on 1.2.4", async () => {
    for (const action of ["not_yet", "undo"] as const) {
      const { result } = run(
        { members: ["s1"], replies: { s1: [{ outcome: "applied", state: "not_yet" }] } },
        { taskId: FIRST_DOLLAR, action }
      );
      const r = await result;
      expect(r.ok && r.firstDollar, action).toEqual([]);
    }
  });

  it("never rings for any other task, however applied", async () => {
    const { result } = run({ members: ["s1"] }, { taskId: "1.2.3" });
    const r = await result;
    expect(r.ok && r.firstDollar).toEqual([]);
  });

  it("never rings for a student whose write FAILED", async () => {
    const { result } = run(
      { members: ["s1"], rpcErrorFor: "s1" },
      { taskId: FIRST_DOLLAR }
    );
    const r = await result;
    expect(r.ok && r.firstDollar).toEqual([]);
  });

  it("never rings for a student skipped as a non-member", async () => {
    const { result } = run({ members: [] }, { taskId: FIRST_DOLLAR });
    const r = await result;
    expect(r.ok && r.firstDollar).toEqual([]);
  });
});

/* ══════════════════════════════════════ hostile transports: hang and throw ══ */

describe("runFwCheckIn — a bad transport degrades to a typed failure, never a hang or a crash", () => {
  it("a hung RPC times out and reports `failed` instead of waiting forever", async () => {
    vi.useFakeTimers();
    try {
      const { result } = run({ members: ["s1"], rpcHangsFor: "s1" });
      await vi.advanceTimersByTimeAsync(FW_CALL_TIMEOUT_MS + 10);
      const r = await result;
      expect(r.ok && r.outcomes[0]).toEqual({
        studentId: "s1",
        kind: "failed",
        reason: "unavailable",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("one student's hung call does not stop the others from being written", async () => {
    // The batch is issued concurrently, so a stall on s2 must not delay or
    // cancel s1 and s3 — before the concurrency fix this was a sequential block.
    vi.useFakeTimers();
    try {
      const { result, rpcCalls } = run(
        { members: ["s1", "s2", "s3"], rpcHangsFor: "s2" },
        { studentIds: ["s1", "s2", "s3"] }
      );
      await vi.advanceTimersByTimeAsync(FW_CALL_TIMEOUT_MS + 10);
      const r = await result;
      expect(kinds(r)).toEqual(["s1:applied", "s2:failed", "s3:applied"]);
      expect(rpcCalls).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a THROWING rpc is caught — the batch still reports every student", async () => {
    // An exception escaping fwMoveTask would unwind the whole batch and hide
    // writes that already committed for the other students.
    const { result, rpcCalls } = run(
      { members: ["s1", "s2", "s3"], rpcThrowsFor: "s2" },
      { studentIds: ["s1", "s2", "s3"] }
    );
    const r = await result;
    expect(kinds(r)).toEqual(["s1:applied", "s2:failed", "s3:applied"]);
    expect(rpcCalls).toHaveLength(3);
  });

  it("maps every echo back to the RIGHT student, not to completion order", async () => {
    // The concurrent batch indexes results positionally; pin that the mapping
    // survives interleaving.
    const { result } = run(
      {
        members: ["s1", "s2", "s3"],
        replies: {
          s1: [{ outcome: "already_done", state: "not_yet" }],
          s2: [{ outcome: "refused", state: "verified" }],
          s3: [{ outcome: "applied", state: "not_yet" }],
        },
      },
      { studentIds: ["s1", "s2", "s3"], action: "not_yet" }
    );
    const r = await result;
    expect(r.ok && r.outcomes).toEqual([
      { studentId: "s1", kind: "already_done", state: "not_yet" },
      { studentId: "s2", kind: "refused", reason: "undo_first", state: "verified" },
      { studentId: "s3", kind: "applied", state: "not_yet" },
    ]);
  });
});

/* ═══════════════════ retry safety is NOT uniform across the three actions ══ */

describe("retry after an ambiguous failure — the property Unit 4 must close", () => {
  it("checkmark is idempotent by state: the retry lands on already_done, ringing nothing", async () => {
    const { result } = run(
      { members: ["s1"], replies: { s1: [{ outcome: "already_done", state: "verified" }] } },
      { taskId: FIRST_DOLLAR }
    );
    const r = await result;
    expect(kinds(r)).toEqual(["s1:already_done"]);
    expect(r.ok && r.firstDollar).toEqual([]);
  });

  it("undo is idempotent by state likewise", async () => {
    const { result } = run(
      { members: ["s1"], replies: { s1: [{ outcome: "already_done", state: "locked" }] } },
      { action: "undo" }
    );
    expect(kinds(await result)).toEqual(["s1:already_done"]);
  });

  it("KNOWN GAP: not-yet WITHOUT a client id cannot be deduped on an ambiguous retry", async () => {
    // Documented rather than fixed here, because the fix is a Unit 4 wiring
    // decision (mint a client id per tap ONLINE too) and the whole path already
    // exists. The RPC cannot distinguish "the guide genuinely tapped twice" —
    // a real FW-D4 repeat-struggle signal — from "the first response was lost
    // over venue wifi" unless the tap carries the exactly-once key.
    const { result, rpcCalls } = run(
      { members: ["s1"], replies: { s1: [{ outcome: "re_attempt", state: "not_yet" }] } },
      { action: "not_yet" }
    );
    expect(kinds(await result)).toEqual(["s1:re_attempt"]);
    expect(rpcCalls[0].p_client_id).toBeNull();
  });

  it("…and WITH a client id the same retry is a no-op, proving the fix works end to end", async () => {
    const { result, rpcCalls } = run(
      { members: ["s1"], replies: { s1: [{ outcome: "replayed", state: "not_yet" }] } },
      { action: "not_yet", clientIds: { s1: "tap-abc" } }
    );
    expect(kinds(await result)).toEqual(["s1:replayed"]);
    expect(rpcCalls[0].p_client_id).toBe("tap-abc");
  });
});

/* ═══════════════════════════════════════════════ the not-yet arms end-to-end ══ */

describe("runFwCheckIn — the not-yet arms round-trip through the report", () => {
  it("a re-attempt reports as its own kind, distinct from applied", async () => {
    const { result } = run(
      { members: ["s1"], replies: { s1: [{ outcome: "re_attempt", state: "not_yet" }] } },
      { action: "not_yet" }
    );
    expect(kinds(await result)).toEqual(["s1:re_attempt"]);
  });

  it("a refusal carries the reason re-derived from the echoed state", async () => {
    const { result } = run(
      { members: ["s1"], replies: { s1: [{ outcome: "refused", state: "verified" }] } },
      { action: "not_yet" }
    );
    const r = await result;
    expect(r.ok && r.outcomes[0]).toEqual({
      studentId: "s1",
      kind: "refused",
      reason: "undo_first",
      state: "verified",
    });
  });

  it("an undo of a Path work state is refused with the other reason", async () => {
    const { result } = run(
      { members: ["s1"], replies: { s1: [{ outcome: "refused", state: "in_progress" }] } },
      { action: "undo" }
    );
    const r = await result;
    expect(r.ok && r.outcomes[0]).toEqual({
      studentId: "s1",
      kind: "refused",
      reason: "not_a_decision",
      state: "in_progress",
    });
  });

  it("a missing progress row surfaces as a failure, not a silent success", async () => {
    const { result } = run({
      members: ["s1"],
      replies: { s1: [{ outcome: "missing", state: null }] },
    });
    const r = await result;
    expect(r.ok && r.outcomes[0]).toEqual({
      studentId: "s1",
      kind: "failed",
      reason: "missing_progress",
    });
  });
});
