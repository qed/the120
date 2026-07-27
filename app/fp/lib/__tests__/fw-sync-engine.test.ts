import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { runFwDrain, type FwDrainInput } from "../fw-sync-engine";
import { runFwCheckIn } from "../fw-checkin-core";
import { decideFwAction, type FwAction } from "../fw-rules";
import {
  FW_QUEUE_ENTRY_SCHEMA_VERSION,
  fwSignOutOutcomeCopy,
  isRecognizedFwEntry,
  runFwCacheOwnerReconcile,
  runFwSignOutFlow,
  shouldClearFwCaches,
  type FwDeviceEvidence,
  type FwQueueEntry,
  type FwReconcilePorts,
  type FwSignOutPorts,
} from "../fw-sync-rules";
import type { TaskState } from "../transition-table";

/**
 * The FW drain COMPOSITION (FW Unit 8), driven through a STATEFUL fake Supabase +
 * a seeded queue — the fold both adversarial reviews found live-event bugs in.
 *
 * The fake `fw_move_task` runs the REAL `decideFwAction` table against a real state
 * map and stamps `verified_by`, so a replay genuinely moves the row (or genuinely
 * no-ops), the same-actor guard reads an author the RPC actually wrote, and an
 * already-decided replay returns the same `already_done` the production RPC would.
 * The seeded queue carries every scenario the plan names: a cancel pair, an
 * `undo + decision` correction (same-actor lands / cross-actor rejects), an
 * already-decided replay (a no-op, not a reject), and a revoked-guide drain (all
 * rejects, none applied).
 */

const COHORT = "cohort-boston";
const OTHER_COHORT = "cohort-hamptons";
const GUIDE = "user-guide-a";
const OTHER_GUIDE = "user-guide-b";
const TASK = "1.2.4";
const NOW = Date.parse("2026-08-22T15:00:00.000Z");

type ProgressRow = { state: TaskState; verified_by: string | null };
type EventRow = { student_id: string; action: FwAction; captured_at: string; action_id: string; client_id: string | null };
type RejectRow = Record<string, unknown>;

type Seed = {
  members?: string[];
  /** (student|task) → progress row. Absent ⇒ the RPC reports `missing`. */
  progress?: Record<string, ProgressRow>;
  /** Tombstoned profiles (the anonymize guard) — id → [first,last]. */
  tombstoned?: string[];
  /** Pre-seed the idempotency ledger so a replay returns `replayed`. */
  seenClientIds?: string[];
  /** Force the progress read to error (a transient blip on the guard read). */
  progressReadError?: boolean;
  /** Force the reject insert to error. */
  rejectInsertError?: boolean;
  /** Force the reject insert to return a 23505 unique violation — models a genuinely
   *  concurrent drain having already recorded the same reject (the new DB backstop). */
  rejectInsertUniqueViolation?: boolean;
  /**
   * Model a concurrent cross-actor decision that lands AFTER the drain's same-actor
   * guard read but BEFORE the replay — the exact race the offline-only CAS closes.
   * The guard `maybeSingle` returns the PRE-swap author (so the guard applies); the
   * progress row is then rewritten to `verifiedBy`, so the replay's RPC sees the new
   * author and the CAS refuses it.
   */
  concurrentSwap?: { student: string; task: string; verifiedBy: string | null };
};

function makeFakeDb(seed: Seed) {
  const members = new Set(seed.members ?? []);
  const tombstoned = new Set(seed.tombstoned ?? []);
  const progress = new Map<string, ProgressRow>(Object.entries(seed.progress ?? {}));
  const seen = new Set<string>(seed.seenClientIds ?? []);
  const rejects: RejectRow[] = [];
  const events: EventRow[] = [];
  const rpcCalls: string[] = [];
  const rpcParams: Record<string, unknown>[] = [];

  const pkey = (s: string, t: string) => `${s}|${t}`;
  const cidKey = (s: string, t: string, c: string) => `${s}|${t}|${c}`;

  function fwMoveTask(p: Record<string, unknown>) {
    const student = p.p_student_id as string;
    const task = p.p_task_id as string;
    const action = p.p_action as FwAction;
    const actor = p.p_actor as string;
    const clientId = (p.p_client_id as string | null) ?? null;
    const expected = (p.p_expected_verified_by as string | null) ?? null;
    rpcCalls.push(`${action}:${student}`);
    rpcParams.push(p);

    if (!members.has(student)) return { outcome: "cohort_invalid", state: null, verified_by: null };
    const cur = progress.get(pkey(student, task));
    if (!cur) return { outcome: "missing", state: null, verified_by: null };
    if (clientId && seen.has(cidKey(student, task, clientId))) {
      return { outcome: "replayed", state: cur.state, verified_by: cur.verified_by };
    }

    const decision = decideFwAction({ action, from: cur.state });
    // The offline-only CAS (Unit 9): an undo whose UPDATE would apply, but whose
    // guarded author no longer matches, matches zero rows and is classified
    // `cross_actor_undo`. Mirrors the SQL's WHERE-clause CAS + classification arm.
    if (
      decision.kind === "apply" &&
      action === "undo" &&
      expected !== null &&
      cur.verified_by !== expected
    ) {
      return { outcome: "cross_actor_undo", state: cur.state, verified_by: cur.verified_by };
    }
    if (decision.kind === "apply") {
      const verifiedBy = action === "undo" ? null : actor;
      progress.set(pkey(student, task), { state: decision.to, verified_by: verifiedBy });
      if (clientId) seen.add(cidKey(student, task, clientId));
      events.push({
        student_id: student,
        action,
        captured_at: p.p_captured_at as string,
        action_id: p.p_action_id as string,
        client_id: clientId,
      });
      return { outcome: "applied", state: decision.to, verified_by: verifiedBy };
    }
    if (decision.kind === "re_attempt") {
      if (clientId) seen.add(cidKey(student, task, clientId));
      events.push({
        student_id: student,
        action,
        captured_at: p.p_captured_at as string,
        action_id: p.p_action_id as string,
        client_id: clientId,
      });
      return { outcome: "re_attempt", state: cur.state, verified_by: cur.verified_by };
    }
    if (decision.kind === "already_done") {
      return { outcome: "already_done", state: cur.state, verified_by: cur.verified_by };
    }
    return { outcome: "refused", state: cur.state, verified_by: cur.verified_by };
  }

  const db = {
    from(table: string) {
      const eqs: [string, unknown][] = [];
      let inFilter: [string, unknown[]] | null = null;
      let insertRow: Record<string, unknown> | null = null;
      const builder: Record<string, unknown> = {
        select() {
          return builder;
        },
        insert(row: Record<string, unknown>) {
          insertRow = row;
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
        limit() {
          return builder;
        },
        maybeSingle() {
          if (table === "path_task_progress" && seed.progressReadError) {
            return Promise.resolve({ data: null, error: { message: "read blip" } });
          }
          const student = eqs.find(([c]) => c === "student_id")?.[1] as string;
          const task = eqs.find(([c]) => c === "task_id")?.[1] as string;
          const row = progress.get(pkey(student, task));
          const snapshot = row ? { ...row } : null;
          // The guard read returns the PRE-swap author; a concurrent cross-actor
          // decision then rewrites the row, so the replay's RPC sees the new author.
          const swap = seed.concurrentSwap;
          if (swap && swap.student === student && swap.task === task && row) {
            progress.set(pkey(student, task), { ...row, verified_by: swap.verifiedBy });
          }
          return Promise.resolve({ data: snapshot, error: null });
        },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          let out: { data: unknown; error: { message: string; code?: string } | null };
          if (table === "path_cohort_members") {
            const ids = (inFilter?.[1] ?? []) as string[];
            out = {
              data: ids.filter((id) => members.has(id)).map((id) => ({ student_id: id })),
              error: null,
            };
          } else if (table === "path_student_profiles") {
            const ids = (inFilter?.[1] ?? []) as string[];
            out = {
              data: ids.map((id) =>
                tombstoned.has(id)
                  ? { id, first_name: "Removed", last_name: "student" }
                  : { id, first_name: "Real", last_name: "Kid" }
              ),
              error: null,
            };
          } else if (table === "path_fw_replay_rejects" && insertRow) {
            if (seed.rejectInsertError) out = { data: null, error: { message: "insert blip" } };
            else if (seed.rejectInsertUniqueViolation)
              out = { data: null, error: { code: "23505", message: "duplicate reject" } };
            else {
              rejects.push(insertRow);
              out = { data: [{ id: `rej-${rejects.length}` }], error: null };
            }
          } else if (table === "path_fw_replay_rejects") {
            // the probe: existing rejects with this client_id
            const cid = eqs.find(([c]) => c === "client_id")?.[1];
            out = {
              data: rejects.filter((r) => r.client_id === cid).map(() => ({ id: "x" })),
              error: null,
            };
          } else {
            out = { data: [], error: null };
          }
          return Promise.resolve(out).then(resolve, reject);
        },
      };
      return builder;
    },
    async rpc(name: string, params: Record<string, unknown>) {
      if (name !== "fw_move_task") return { data: null, error: { message: "unknown rpc" } };
      return { data: [fwMoveTask(params)], error: null };
    },
  };

  return { db: db as never, progress, rejects, events, rpcCalls, rpcParams, pkey };
}

let seq = 0;
function entry(action: FwAction, overrides: Partial<FwQueueEntry> = {}): FwQueueEntry {
  seq += 1;
  const stamp = new Date(Date.UTC(2026, 7, 22, 14, 0, 0) + seq * 1000).toISOString();
  const clientId = overrides.clientId ?? `client-${seq}`;
  return {
    id: overrides.id ?? clientId,
    schemaVersion: FW_QUEUE_ENTRY_SCHEMA_VERSION,
    clientId,
    actionId: overrides.actionId ?? `action-${seq}`,
    studentId: overrides.studentId ?? "s1",
    taskId: overrides.taskId ?? TASK,
    action,
    cohortId: overrides.cohortId ?? COHORT,
    capturedAt: overrides.capturedAt ?? stamp,
    actorUserId: overrides.actorUserId ?? GUIDE,
    enqueuedAt: overrides.enqueuedAt ?? stamp,
    attempts: overrides.attempts ?? 0,
    lastAttemptAt: overrides.lastAttemptAt ?? null,
    blocked: overrides.blocked ?? null,
  };
}

const drain = (db: never, entries: FwQueueEntry[], over: Partial<FwDrainInput> = {}) =>
  runFwDrain(db, {
    entries,
    sessionUserId: GUIDE,
    authorizedCohortIds: [COHORT],
    now: NOW,
    ...over,
  });

const dispositionOf = (outcomes: { clientId: string; disposition: string }[], clientId: string) =>
  outcomes.find((o) => o.clientId === clientId)?.disposition;

/* ══════════════════════════════════════════════════════════════ happy path ══ */

describe("runFwDrain — happy path", () => {
  it("three queued check-ins drain, capture times preserved, one shared action id per tap", async () => {
    const { db, progress, events, rejects, pkey } = makeFakeDb({
      members: ["s1", "s2", "s3"],
      progress: {
        "s1|1.2.4": { state: "locked", verified_by: null },
        "s2|1.2.4": { state: "locked", verified_by: null },
        "s3|1.2.4": { state: "locked", verified_by: null },
      },
    });
    const es = [
      entry("checkmark", { studentId: "s1", actionId: "batch-1", capturedAt: "2026-08-22T14:01:00.000Z" }),
      entry("checkmark", { studentId: "s2", actionId: "batch-1", capturedAt: "2026-08-22T14:01:00.000Z" }),
      entry("checkmark", { studentId: "s3", actionId: "batch-1", capturedAt: "2026-08-22T14:01:00.000Z" }),
    ];
    const { outcomes } = await drain(db, es);

    expect(outcomes.every((o) => o.disposition === "settled")).toBe(true);
    expect(progress.get(pkey("s1", TASK))).toEqual({ state: "verified", verified_by: GUIDE });
    expect(rejects).toHaveLength(0);
    // Capture time preserved onto the event; the batch shares one action id.
    expect(events.map((e) => e.captured_at)).toEqual([
      "2026-08-22T14:01:00.000Z",
      "2026-08-22T14:01:00.000Z",
      "2026-08-22T14:01:00.000Z",
    ]);
    expect(new Set(events.map((e) => e.action_id))).toEqual(new Set(["batch-1"]));
  });
});

/* ═══════════════════════════════════════════════════ the cancel pair (P1) ══ */

describe("runFwDrain — offline checkmark+undo pair cancels locally", () => {
  it("settles both entries with NO server call and NO reject", async () => {
    const { db, progress, rejects, rpcCalls, pkey } = makeFakeDb({
      members: ["s1"],
      progress: { "s1|1.2.4": { state: "locked", verified_by: null } },
    });
    const c = entry("checkmark", { studentId: "s1" });
    const u = entry("undo", { studentId: "s1" });
    const { outcomes } = await drain(db, [c, u]);

    expect(dispositionOf(outcomes, c.clientId)).toBe("settled");
    expect(dispositionOf(outcomes, u.clientId)).toBe("settled");
    // The pair never touched the network — the reduction cancelled it.
    expect(rpcCalls).toHaveLength(0);
    expect(progress.get(pkey("s1", TASK))).toEqual({ state: "locked", verified_by: null });
    expect(rejects).toHaveLength(0);
  });
});

/* ═══════════════════════════════ the undo + decision correction (corrected P1) ══ */

describe("runFwDrain — undo + not_yet correction on a pre-outage verified", () => {
  it("SAME actor → replays in order, lands not_yet, no reject", async () => {
    const { db, progress, rejects, pkey } = makeFakeDb({
      members: ["s1"],
      progress: { "s1|1.2.4": { state: "verified", verified_by: GUIDE } },
    });
    const u = entry("undo", { studentId: "s1", enqueuedAt: "2026-08-22T14:01:00.000Z" });
    const n = entry("not_yet", { studentId: "s1", enqueuedAt: "2026-08-22T14:02:00.000Z" });
    const { outcomes } = await drain(db, [u, n]);

    expect(dispositionOf(outcomes, u.clientId)).toBe("settled");
    expect(dispositionOf(outcomes, n.clientId)).toBe("settled");
    expect(progress.get(pkey("s1", TASK))).toEqual({ state: "not_yet", verified_by: GUIDE });
    expect(rejects).toHaveLength(0);
  });

  it("CROSS actor → the whole correction rejects to staff, nothing applied", async () => {
    const { db, progress, rejects, rpcCalls, pkey } = makeFakeDb({
      members: ["s1"],
      progress: { "s1|1.2.4": { state: "verified", verified_by: OTHER_GUIDE } },
    });
    const u = entry("undo", { studentId: "s1", enqueuedAt: "2026-08-22T14:01:00.000Z" });
    const n = entry("not_yet", { studentId: "s1", enqueuedAt: "2026-08-22T14:02:00.000Z" });
    const { outcomes } = await drain(db, [u, n]);

    expect(dispositionOf(outcomes, u.clientId)).toBe("rejected");
    expect(dispositionOf(outcomes, n.clientId)).toBe("rejected");
    // The guard held the correction BEFORE any replay — the row never moved.
    expect(rpcCalls).toHaveLength(0);
    expect(progress.get(pkey("s1", TASK))).toEqual({ state: "verified", verified_by: OTHER_GUIDE });
    expect(rejects).toHaveLength(2);
    expect(rejects.every((r) => r.reason === "cross_actor_undo")).toBe(true);
    expect(rejects[0]).toMatchObject({ student_id: "s1", task_id: TASK, cohort_id: COHORT, actor: GUIDE });
  });
});

describe("runFwDrain — undo-of-not_yet (the named matrix row, end-to-end)", () => {
  it("SAME actor → undoes the not_yet cleanly, lands locked, no reject", async () => {
    const { db, progress, rejects, pkey } = makeFakeDb({
      members: ["s1"],
      progress: { "s1|1.2.4": { state: "not_yet", verified_by: GUIDE } },
    });
    const { outcomes } = await drain(db, [entry("undo", { studentId: "s1" })]);
    expect(outcomes[0].disposition).toBe("settled");
    expect(progress.get(pkey("s1", TASK))).toEqual({ state: "locked", verified_by: null });
    expect(rejects).toHaveLength(0);
  });

  it("CROSS actor → the same-actor guard rejects, the not_yet row is untouched", async () => {
    const { db, progress, rejects, pkey } = makeFakeDb({
      members: ["s1"],
      progress: { "s1|1.2.4": { state: "not_yet", verified_by: OTHER_GUIDE } },
    });
    const { outcomes } = await drain(db, [entry("undo", { studentId: "s1" })]);
    expect(outcomes[0].disposition).toBe("rejected");
    expect(progress.get(pkey("s1", TASK))).toEqual({ state: "not_yet", verified_by: OTHER_GUIDE });
    expect(rejects[0].reason).toBe("cross_actor_undo");
  });
});

describe("runFwDrain — a bare undo of another guide's live checkmark (the original P1)", () => {
  it("the same-actor guard rejects it and the board stays intact", async () => {
    const { db, progress, rejects, pkey } = makeFakeDb({
      members: ["s1"],
      progress: { "s1|1.2.4": { state: "verified", verified_by: OTHER_GUIDE } },
    });
    const u = entry("undo", { studentId: "s1" });
    const { outcomes } = await drain(db, [u]);

    expect(outcomes[0].disposition).toBe("rejected");
    expect(progress.get(pkey("s1", TASK))).toEqual({ state: "verified", verified_by: OTHER_GUIDE });
    expect(rejects).toHaveLength(1);
    expect(rejects[0].reason).toBe("cross_actor_undo");
  });

  it("of the guide's OWN checkmark → undoes cleanly, no reject", async () => {
    const { db, progress, rejects, pkey } = makeFakeDb({
      members: ["s1"],
      progress: { "s1|1.2.4": { state: "verified", verified_by: GUIDE } },
    });
    const { outcomes } = await drain(db, [entry("undo", { studentId: "s1" })]);
    expect(outcomes[0].disposition).toBe("settled");
    expect(progress.get(pkey("s1", TASK))).toEqual({ state: "locked", verified_by: null });
    expect(rejects).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════ G14 ══ */

describe("runFwDrain — check → undo → check offline (G14)", () => {
  it("reduces to ONE checkmark; the cancelled pair settles without a call", async () => {
    const { db, progress, rpcCalls, pkey } = makeFakeDb({
      members: ["s1"],
      progress: { "s1|1.2.4": { state: "locked", verified_by: null } },
    });
    const c1 = entry("checkmark", { studentId: "s1", enqueuedAt: "2026-08-22T14:01:00.000Z" });
    const u = entry("undo", { studentId: "s1", enqueuedAt: "2026-08-22T14:02:00.000Z" });
    const c2 = entry("checkmark", { studentId: "s1", enqueuedAt: "2026-08-22T14:03:00.000Z" });
    const { outcomes } = await drain(db, [c1, u, c2]);

    expect(outcomes.every((o) => o.disposition === "settled")).toBe(true);
    // Exactly one write — the surviving checkmark.
    expect(rpcCalls).toEqual(["checkmark:s1"]);
    expect(progress.get(pkey("s1", TASK))).toEqual({ state: "verified", verified_by: GUIDE });
  });
});

/* ═══════════════════════════════════ already-decided replay (error scenario) ══ */

describe("runFwDrain — an already-decided replay is a no-op, NOT a reject", () => {
  it("a checkmark onto an already-verified task → already_done → settled", async () => {
    const { db, rejects } = makeFakeDb({
      members: ["s1"],
      progress: { "s1|1.2.4": { state: "verified", verified_by: GUIDE } },
    });
    const { outcomes } = await drain(db, [entry("checkmark", { studentId: "s1" })]);
    expect(outcomes[0].disposition).toBe("settled");
    expect(rejects).toHaveLength(0);
  });

  it("a re-drained tap whose client_id already landed → replayed → settled", async () => {
    const c = entry("checkmark", { studentId: "s1", clientId: "cid-x" });
    const { db, rejects } = makeFakeDb({
      members: ["s1"],
      progress: { "s1|1.2.4": { state: "verified", verified_by: GUIDE } },
      seenClientIds: [`s1|${TASK}|cid-x`],
    });
    const { outcomes } = await drain(db, [c]);
    expect(outcomes[0].disposition).toBe("settled");
    expect(rejects).toHaveLength(0);
  });
});

/* ═══════════════════════════════════════════════ the revoked-guide drain ══ */

describe("runFwDrain — a revoked guide's drain", () => {
  it("records all rejects server-side and applies NOTHING", async () => {
    const { db, progress, rejects, rpcCalls, pkey } = makeFakeDb({
      members: ["s1", "s2"],
      progress: {
        "s1|1.2.4": { state: "locked", verified_by: null },
        "s2|1.2.4": { state: "locked", verified_by: null },
      },
    });
    const es = [
      entry("checkmark", { studentId: "s1" }),
      entry("not_yet", { studentId: "s2" }),
    ];
    // The guide can no longer act in COHORT.
    const { outcomes } = await drain(db, es, { authorizedCohortIds: [] });

    expect(outcomes.every((o) => o.disposition === "rejected")).toBe(true);
    expect(rpcCalls).toHaveLength(0);
    expect(progress.get(pkey("s1", TASK))).toEqual({ state: "locked", verified_by: null });
    expect(rejects).toHaveLength(2);
    expect(rejects.every((r) => r.reason === "reauth_failed")).toBe(true);
  });

  it("an UNKNOWN cohort (auth-read blip, not a revoke) → RETRY, never a permanent reject", async () => {
    // reliability review's P1: on venue wifi a transient auth-read failure must not be
    // treated as a revoke, or a guide's real captures are silently discarded to a
    // staff-only reject. Unknown → retry (kept for the next drain), zero rejects.
    const { db, progress, rejects, rpcCalls, pkey } = makeFakeDb({
      members: ["s1"],
      progress: { "s1|1.2.4": { state: "locked", verified_by: null } },
    });
    const { outcomes } = await drain(db, [entry("checkmark", { studentId: "s1" })], {
      authorizedCohortIds: [],
      unknownCohortIds: [COHORT],
    });
    expect(outcomes[0].disposition).toBe("retry");
    expect(rpcCalls).toHaveLength(0);
    expect(progress.get(pkey("s1", TASK))).toEqual({ state: "locked", verified_by: null });
    expect(rejects).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════ the anonymized-student guard ══ */

describe("runFwDrain — a replay against an anonymized student", () => {
  it("is excluded at the write choke point and rejects cohort_unresolved (Decision 10 at drain)", async () => {
    const { db, progress, rejects, pkey } = makeFakeDb({
      members: ["s1"],
      tombstoned: ["s1"],
      progress: { "s1|1.2.4": { state: "locked", verified_by: null } },
    });
    const { outcomes } = await drain(db, [entry("checkmark", { studentId: "s1" })]);
    expect(outcomes[0].disposition).toBe("rejected");
    // Never written to the retired identity.
    expect(progress.get(pkey("s1", TASK))).toEqual({ state: "locked", verified_by: null });
    expect(rejects[0].reason).toBe("cohort_unresolved");
  });
});

/* ═══════════════════════════════════════════════════ transient failure paths ══ */

describe("runFwDrain — transient failures retry, never reject", () => {
  it("a guard-read blip on a leading undo → retry, no reject, no state change", async () => {
    const { db, rejects } = makeFakeDb({
      members: ["s1"],
      progress: { "s1|1.2.4": { state: "verified", verified_by: GUIDE } },
      progressReadError: true,
    });
    const { outcomes } = await drain(db, [entry("undo", { studentId: "s1" })]);
    expect(outcomes[0].disposition).toBe("retry");
    expect(rejects).toHaveLength(0);
  });

  it("a reject-write failure → retry (the entry stays queued so the reject is never lost)", async () => {
    const { db } = makeFakeDb({
      members: ["s1"],
      progress: { "s1|1.2.4": { state: "verified", verified_by: OTHER_GUIDE } },
      rejectInsertError: true,
    });
    const { outcomes } = await drain(db, [entry("undo", { studentId: "s1" })]);
    expect(outcomes[0].disposition).toBe("retry");
  });

  it("a missing progress row → reject missing_progress (a provisioning gap, terminal)", async () => {
    const { db, rejects } = makeFakeDb({ members: ["s1"], progress: {} });
    const { outcomes } = await drain(db, [entry("checkmark", { studentId: "s1" })]);
    expect(outcomes[0].disposition).toBe("rejected");
    expect(rejects[0].reason).toBe("missing_progress");
  });
});

/* ═══════════════════════════════════════════════ idempotent reject recording ══ */

describe("runFwDrain — reject recording is idempotent by client_id", () => {
  it("re-draining a cross-actor undo does not stack a second reject row", async () => {
    const { db, rejects } = makeFakeDb({
      members: ["s1"],
      progress: { "s1|1.2.4": { state: "verified", verified_by: OTHER_GUIDE } },
    });
    const u = entry("undo", { studentId: "s1", clientId: "cid-dup" });
    await drain(db, [u]);
    await drain(db, [u]); // the client never heard back and re-shipped
    expect(rejects).toHaveLength(1);
  });
});

/* ═══════════════════════════════════════════════ cross-cohort authorization ══ */

describe("runFwDrain — only authorized cohorts replay", () => {
  it("drains an authorized cohort while rejecting an unauthorized one in the same queue", async () => {
    const { db, progress, rejects, pkey } = makeFakeDb({
      members: ["s1", "s2"],
      progress: {
        "s1|1.2.4": { state: "locked", verified_by: null },
        "s2|1.2.4": { state: "locked", verified_by: null },
      },
    });
    const ok = entry("checkmark", { studentId: "s1", cohortId: COHORT });
    const no = entry("checkmark", { studentId: "s2", cohortId: OTHER_COHORT });
    const { outcomes } = await drain(db, [ok, no], { authorizedCohortIds: [COHORT] });

    expect(dispositionOf(outcomes, ok.clientId)).toBe("settled");
    expect(dispositionOf(outcomes, no.clientId)).toBe("rejected");
    expect(progress.get(pkey("s1", TASK))).toEqual({ state: "verified", verified_by: GUIDE });
    expect(progress.get(pkey("s2", TASK))).toEqual({ state: "locked", verified_by: null });
    expect(rejects.map((r) => r.reason)).toEqual(["reauth_failed"]);
  });
});

/* ═══════════════════════════════ the offline-only undo CAS (Unit 9 / Decision 9) ══ */

describe("the offline-only undo CAS — online preserved, offline replay made atomic", () => {
  it("ONLINE cross-actor undo still APPLIES — no expectedVerifiedBy, no CAS", async () => {
    // Decision 9: any guide may undo any decision LIVE. The online write path passes
    // no expectedVerifiedBy, so the CAS never engages — a guide undoes another guide's
    // checkmark exactly as before.
    const { db, progress, pkey } = makeFakeDb({
      members: ["s1"],
      progress: { "s1|1.2.4": { state: "verified", verified_by: OTHER_GUIDE } },
    });
    const r = await runFwCheckIn(db as never, {
      actorUserId: GUIDE,
      cohortId: COHORT,
      taskId: TASK,
      action: "undo",
      studentIds: ["s1"],
      now: NOW,
    });
    expect(r.ok && r.outcomes[0].kind).toBe("applied");
    expect(progress.get(pkey("s1", TASK))).toEqual({ state: "locked", verified_by: null });
  });

  it("OFFLINE undo replay is REFUSED when the guarded author no longer matches", async () => {
    // The same call WITH the guard-checked author (GUIDE) against a row now authored by
    // OTHER_GUIDE: the CAS refuses, the result is failed:cross_actor_undo, and the
    // concurrent decision stands untouched.
    const { db, progress, pkey } = makeFakeDb({
      members: ["s1"],
      progress: { "s1|1.2.4": { state: "verified", verified_by: OTHER_GUIDE } },
    });
    const r = await runFwCheckIn(db as never, {
      actorUserId: GUIDE,
      cohortId: COHORT,
      taskId: TASK,
      action: "undo",
      studentIds: ["s1"],
      expectedVerifiedBy: GUIDE,
      now: NOW,
    });
    expect(r.ok && r.outcomes[0]).toEqual({
      studentId: "s1",
      kind: "failed",
      reason: "cross_actor_undo",
    });
    expect(progress.get(pkey("s1", TASK))).toEqual({ state: "verified", verified_by: OTHER_GUIDE });
  });

  it("END-TO-END: a decision landing between the guard read and the replay → cross_actor_undo reject", async () => {
    // The race the CAS exists for. The client-side same-actor guard PASSES (the row is
    // GUIDE's own at read time); a concurrent cross-actor decision then wins the row
    // before the replay. Without the CAS the stale undo would revert it UNGUARDED.
    const { db, progress, rejects, rpcCalls, pkey } = makeFakeDb({
      members: ["s1"],
      progress: { "s1|1.2.4": { state: "verified", verified_by: GUIDE } },
      concurrentSwap: { student: "s1", task: TASK, verifiedBy: OTHER_GUIDE },
    });
    const { outcomes } = await drain(db, [entry("undo", { studentId: "s1" })]);

    // The guard let it through (its read saw GUIDE), so the replay DID fire…
    expect(rpcCalls).toEqual(["undo:s1"]);
    // …and the RPC's CAS caught it.
    expect(outcomes[0].disposition).toBe("rejected");
    expect(rejects[0].reason).toBe("cross_actor_undo");
    // The concurrent cross-actor decision is intact — never reverted.
    expect(progress.get(pkey("s1", TASK))).toEqual({ state: "verified", verified_by: OTHER_GUIDE });
  });

  it("a same-actor offline undo replay still APPLIES when nobody raced (the CAS passes)", async () => {
    const { db, progress, rejects, pkey } = makeFakeDb({
      members: ["s1"],
      progress: { "s1|1.2.4": { state: "verified", verified_by: GUIDE } },
    });
    const { outcomes } = await drain(db, [entry("undo", { studentId: "s1" })]);
    expect(outcomes[0].disposition).toBe("settled");
    expect(progress.get(pkey("s1", TASK))).toEqual({ state: "locked", verified_by: null });
    expect(rejects).toHaveLength(0);
  });

  it("END-TO-END on a NOT_YET row: a decision landing between guard read and replay → cross_actor_undo", async () => {
    // The SQL's CAS classification arm gates on `v_from in ('verified', 'not_yet')`; the
    // behavioral matrix above only seeded `verified`. This drives the race on a not_yet row
    // (the undo-of-not_yet path) so the CAS is exercised behaviorally, not just at the text
    // level, for both decision states.
    const { db, progress, rejects, rpcCalls, pkey } = makeFakeDb({
      members: ["s1"],
      progress: { "s1|1.2.4": { state: "not_yet", verified_by: GUIDE } },
      concurrentSwap: { student: "s1", task: TASK, verifiedBy: OTHER_GUIDE },
    });
    const { outcomes } = await drain(db, [entry("undo", { studentId: "s1" })]);

    expect(rpcCalls).toEqual(["undo:s1"]); // the guard let it through (read saw GUIDE)…
    expect(outcomes[0].disposition).toBe("rejected"); // …and the CAS caught it.
    expect(rejects[0].reason).toBe("cross_actor_undo");
    // The concurrent cross-actor not_yet is intact — never reverted.
    expect(progress.get(pkey("s1", TASK))).toEqual({ state: "not_yet", verified_by: OTHER_GUIDE });
  });

  it("a concurrent reject insert's UNIQUE VIOLATION is treated as recorded, not retried (the new DB backstop)", async () => {
    // Two genuinely concurrent drains recording the same reject: the loser's insert hits the
    // path_fw_replay_rejects_client_scope_key unique index (23505). writeFwReject treats that
    // as "already recorded" (the row IS the reject), so the entry tombstones as `rejected`,
    // never spins on a retry.
    const { db, rejects } = makeFakeDb({
      members: ["s1"],
      progress: { "s1|1.2.4": { state: "verified", verified_by: OTHER_GUIDE } },
      rejectInsertUniqueViolation: true,
    });
    const { outcomes } = await drain(db, [entry("undo", { studentId: "s1" })]);

    expect(outcomes[0].disposition).toBe("rejected"); // recorded (by the concurrent drain), not retried
    expect(rejects).toHaveLength(0); // our own insert collided — the row is the other drain's
  });

  it("the drain carries expectedVerifiedBy ONLY for the leading undo, null for a following decision", async () => {
    // undo + not_yet correction (same actor): the undo carries the guarded author; the
    // not_yet that follows it is a FRESH decision and must pass null — the CAS gates undo
    // only, and a decision has no author to compare against.
    const { db, rpcParams } = makeFakeDb({
      members: ["s1"],
      progress: { "s1|1.2.4": { state: "verified", verified_by: GUIDE } },
    });
    const u = entry("undo", { studentId: "s1", enqueuedAt: "2026-08-22T14:01:00.000Z" });
    const n = entry("not_yet", { studentId: "s1", enqueuedAt: "2026-08-22T14:02:00.000Z" });
    await drain(db, [u, n]);

    expect(rpcParams.map((p) => [p.p_action, p.p_expected_verified_by])).toEqual([
      ["undo", GUIDE],
      ["not_yet", null],
    ]);
  });
});

/* ══════════════════════════════ the sign-out SEQUENCE (verdict → drain → clear) ══ */

/**
 * The sign-out sequence driven end-to-end through a fake device.
 *
 * The sequence is the composition the live defect lived in: `fwSignOutVerdict` counted
 * only DRAINABLE entries while `clearFwQueueIfEmpty` counted EVERYTHING, so one blocked
 * or one foreign entry produced `ok` from the check and `cleared:false` from the act —
 * an unescapable "a check-in just came in" loop. `runFwSignOutFlow` is pure and
 * port-injected precisely so that composition is testable here (this repo runs node-only
 * tests; a sequence written inline in the button is invisible to CI), and so the SAME
 * predicate the verdict classified with is the one handed to the clear.
 *
 * The lock is a PORT, not a `navigator.locks` call, for the same reason — and the fake
 * below is a genuinely NON-REENTRANT mutex, so a sequence that took the lock twice (or
 * whose drain port took it again) would deadlock the test rather than pass it.
 */

/** One origin's `fw-offline-drain` lock, shared by every "document" in a test. */
function makeFakeLockManager() {
  let tail: Promise<unknown> = Promise.resolve();
  let held = 0;
  let acquisitions = 0;
  return {
    get held() {
      return held;
    },
    get acquisitions() {
      return acquisitions;
    },
    request<T>(fn: () => Promise<T>): Promise<T> {
      acquisitions += 1;
      const turn = tail.then(async () => {
        held += 1;
        try {
          return await fn();
        } finally {
          held -= 1;
        }
      });
      tail = turn.catch(() => {});
      return turn;
    },
  };
}

type FakeDevice = {
  store: unknown[];
  online: boolean;
  authRequired: boolean;
  evidence: FwDeviceEvidence;
  /** Model an IndexedDB read that rejects (Safari storage policy, onblocked, …). */
  readFails: boolean;
  reads: number;
  drains: number;
  /** What one drain does to the store. Default: every own un-blocked tap lands. */
  onDrain: (dev: FakeDevice) => void;
  /** A tap that lands in the window between the verdict and the clear. */
  beforeClear: ((dev: FakeDevice) => void) | null;
  /** Models the QUEUE clear transaction itself throwing (openFwDb reject, tx.onabort)
   *  -- distinct from a disposition-driven abort, which resolves normally. */
  queueClearThrows: boolean;
  /** The roster cache, and whether clearing it throws (B3). */
  rosterCached: boolean;
  rosterClearFails: boolean;
  /** The SW app-shell cache, and whether deleting it throws (B3). */
  shellCached: boolean;
  shellClearFails: boolean;
  /** The `fw.cacheOwner` key. `undefined` models a localStorage read that threw. */
  owner: string | null | undefined;
  ownerWrites: number;
};

function device(over: Partial<FakeDevice> = {}): FakeDevice {
  return {
    store: [],
    online: true,
    authRequired: false,
    evidence: { kind: "read", cacheOwner: GUIDE, queueDbOpened: true, queueDbExists: true },
    readFails: false,
    queueClearThrows: false,
    reads: 0,
    drains: 0,
    rosterCached: true,
    rosterClearFails: false,
    shellCached: true,
    shellClearFails: false,
    owner: GUIDE,
    ownerWrites: 0,
    onDrain: (dev) => {
      dev.store = dev.store.filter(
        (r) => !isRecognizedFwEntry(r) || r.actorUserId !== GUIDE || r.blocked !== null
      );
    },
    beforeClear: null,
    ...over,
  };
}

function portsFor(
  dev: FakeDevice,
  lock: ReturnType<typeof makeFakeLockManager>
): FwSignOutPorts {
  return {
    readEvidence: async () => dev.evidence,
    readQueue: async () => {
      dev.reads += 1;
      if (dev.readFails) throw new Error("fw queue db open blocked");
      return [...dev.store];
    },
    isOnline: () => dev.online,
    isAuthRequired: () => dev.authRequired,
    withDrainLock: (fn) => lock.request(fn),
    drain: async () => {
      dev.drains += 1;
      // The drain MUST run inside the sequence's own acquisition — a drain that
      // re-acquired `fw-offline-drain` would hang here forever, not fail.
      expect(lock.held).toBe(1);
      dev.onDrain(dev);
    },
    clear: async (disposition, policy) => {
      dev.beforeClear?.(dev);
      // A THROWN queue clear reports `queueRemaining: null` -- "could not determine" --
      // exactly as `clearFwResidue`'s catch does. Never a number: a fabricated count
      // is what let a real IndexedDB fault reach the reconcile disguised as a
      // legitimate preserve.
      if (dev.queueClearThrows) {
        const rosterCleared = !dev.rosterClearFails;
        if (rosterCleared) dev.rosterCached = false;
        const shellCleared = !dev.shellClearFails;
        if (shellCleared) dev.shellCached = false;
        return { queueCleared: false, queueRemaining: null, rosterCleared, shellCleared };
      }
      // Models `clearFwQueueUnlessBlocked`: classify-then-delete in ONE transaction,
      // under the disposition the flow supplied — never a second, hand-written
      // emptiness test. `abort` stops the whole clear (a tap raced in since the
      // verdict); `preserve` survives it; everything else goes.
      const dispositions = dev.store.map(disposition);
      const queueCleared = !dispositions.includes("abort");
      if (queueCleared) {
        dev.store = dev.store.filter((_, i) => dispositions[i] === "preserve");
      }
      const queueRemaining = dev.store.length;
      // …and `clearFwResidue`'s cache policy: all three together on sign-out, caches
      // unconditionally on a handover (they are the PRIOR account's names).
      if (!shouldClearFwCaches(policy, queueCleared)) {
        return { queueCleared, queueRemaining, rosterCleared: true, shellCleared: true };
      }
      const rosterCleared = !dev.rosterClearFails;
      if (rosterCleared) dev.rosterCached = false;
      const shellCleared = !dev.shellClearFails;
      if (shellCleared) dev.shellCached = false;
      return { queueCleared, queueRemaining, rosterCleared, shellCleared };
    },
  };
}

function reconcilePortsFor(
  dev: FakeDevice,
  lock: ReturnType<typeof makeFakeLockManager>
): FwReconcilePorts {
  return {
    ...portsFor(dev, lock),
    readOwner: () => dev.owner,
    writeOwner: (owner) => {
      dev.owner = owner;
      dev.ownerWrites += 1;
      return true;
    },
  };
}

const reconcile = (
  dev: FakeDevice,
  lock = makeFakeLockManager(),
  over: { actorUserId?: string; surfaceCreatesResidue?: boolean } = {}
) =>
  runFwCacheOwnerReconcile({
    actorUserId: over.actorUserId ?? GUIDE,
    surfaceCreatesResidue: over.surfaceCreatesResidue ?? true,
    ports: reconcilePortsFor(dev, lock),
  });

const signOut = (
  dev: FakeDevice,
  lock = makeFakeLockManager(),
  over: { actorIsFwGuide?: boolean } = {}
) =>
  runFwSignOutFlow({
    actorUserId: GUIDE,
    actorIsFwGuide: over.actorIsFwGuide ?? false,
    ports: portsFor(dev, lock),
  });

const rejected = { reason: "guard_refused" as const, note: "Staff will follow up." };

describe("runFwSignOutFlow — check and act observe ONE predicate", () => {
  it("an empty queue signs out, and the clear runs", async () => {
    const dev = device();
    expect(await signOut(dev)).toEqual({ kind: "sign_out" });
    expect(dev.reads).toBe(1); // one verdict; no drain was needed
    expect(dev.drains).toBe(0);
  });

  it("three own drainable entries online drain first, then sign out", async () => {
    const dev = device({ store: [entry("checkmark"), entry("checkmark"), entry("not_yet")] });
    expect(await signOut(dev)).toEqual({ kind: "sign_out" });
    expect(dev.drains).toBe(1);
    expect(dev.reads).toBe(2); // the verdict said drain_first, and the flow RE-CHECKED
    expect(dev.store).toEqual([]);
  });

  it("exactly ONE BLOCKED entry signs out AND the clear SUCCEEDS", async () => {
    // THE REGRESSION. Before this unit the verdict returned ok (blocked entries were
    // filtered out of the count) and the clear returned cleared:false (a bare
    // store.count() saw the blocked entry), so the button said "a check-in just came
    // in — try again in a moment" on a device where nothing would ever change.
    const dev = device({ store: [entry("checkmark", { blocked: rejected })] });
    expect(await signOut(dev)).toEqual({ kind: "sign_out" });
    expect(dev.drains).toBe(0); // a tombstoned entry is not drainable
    expect(dev.store).toEqual([]); // …and it did not survive the clear
  });

  it("R16: one FOREIGN UNDRAINED entry SIGNS OUT and is preserved, not destroyed", async () => {
    // Staff Front Door Unit 4. This used to refuse, which exceeded R16 ("undrained
    // captures FOR THE SIGNING-OUT ACCOUNT") and stranded whoever was holding a shared
    // iPad after a guide walked off without signing out. Both halves are asserted
    // together on purpose: the session ends AND the departed guide's tap is still
    // there. Asserting only the first is how the fix becomes a data-loss bug.
    const foreign = entry("checkmark", { actorUserId: OTHER_GUIDE });
    const dev = device({ store: [foreign] });

    expect(await signOut(dev)).toEqual({ kind: "sign_out" });
    expect(dev.store).toEqual([foreign]); // un-landed work of a guide who is not here
    expect(dev.drains).toBe(0); // this session could never ship it anyway
    // The caches DID go — they hold this account's names and authed HTML.
    expect(dev.rosterCached).toBe(false);
    expect(dev.shellCached).toBe(false);
  });

  it("…and the departed guide's tap survives alongside this account's own clear", async () => {
    // The mixed queue is where a fix that "filters foreign out" instead of preserving
    // it goes wrong: this account's own entries and tombstones must go, the other
    // account's must not, in ONE clear.
    const foreign = entry("checkmark", { actorUserId: OTHER_GUIDE });
    const dev = device({
      store: [entry("checkmark"), entry("not_yet", { blocked: rejected }), foreign],
    });

    expect(await signOut(dev)).toEqual({ kind: "sign_out" });
    expect(dev.drains).toBe(1); // its own drainable tap shipped first
    expect(dev.store).toEqual([foreign]);
  });

  it("a tap racing in from THIS account still aborts the clear, foreign entries or not", async () => {
    // The adversarial-review P0 that the three-way split must not weaken: `preserve`
    // means "leave it and carry on", `abort` still means "stop". A queue holding both
    // must stop.
    const foreign = entry("checkmark", { actorUserId: OTHER_GUIDE });
    const raced = entry("checkmark");
    const dev = device({
      store: [foreign],
      beforeClear: (d) => {
        d.store = [...d.store, raced];
      },
    });

    expect(await signOut(dev)).toEqual({ kind: "raced" });
    expect(dev.store).toEqual([foreign, raced]); // nothing destroyed
  });

  it("one FOREIGN BLOCKED entry does not wedge — it clears with the rest", async () => {
    // Its `path_fw_replay_rejects` row is the authoritative record; the local copy is
    // a note for a guide who is no longer signed in on this device.
    const dev = device({
      store: [entry("undo", { actorUserId: OTHER_GUIDE, blocked: rejected })],
    });
    expect(await signOut(dev)).toEqual({ kind: "sign_out" });
    expect(dev.store).toEqual([]);
  });

  it("one QUARANTINED record refuses with needs_attention and a count", async () => {
    const dev = device({ store: [{ id: "q-1", schemaVersion: 99 }] });
    const outcome = await signOut(dev);
    expect(outcome).toEqual({
      kind: "refused",
      verdict: { ok: false, reason: "needs_attention", queuedCount: 1 },
    });
    expect(dev.store).toHaveLength(1); // never silently wiped
  });

  it("a queue read that THROWS with FW evidence present fails CLOSED", async () => {
    const dev = device({ readFails: true });
    expect(await signOut(dev)).toEqual({
      kind: "refused",
      verdict: { ok: false, reason: "unreadable", queuedCount: 0 },
    });
  });

  it("with NO FW evidence the queue is never opened at all and sign-out completes", async () => {
    // A CRM-only staff member has never run Founders Weekend. `openFwDb()` would
    // CREATE the queue database on their browser just to ask whether it is empty —
    // and if that open rejects, they could never sign out again.
    const lock = makeFakeLockManager();
    const dev = device({
      readFails: true,
      evidence: { kind: "read", cacheOwner: null, queueDbOpened: false, queueDbExists: false },
    });
    expect(await signOut(dev, lock)).toEqual({ kind: "sign_out" });
    expect(dev.reads).toBe(0);
    expect(lock.acquisitions).toBe(0); // no lock, no IndexedDB, no side effects
  });

  it("a CRM-only staffer signing out BEFORE identity resolves still never opens the queue db", async () => {
    // THE UNIT 4 REGRESSION, end to end. The bar's sign-out is live from first paint
    // (R23), but its `actorIsFwGuide` is `staffBarSignOutActorIsFwGuide(live)`, which
    // fails CLOSED to `true` until the identity Server Action answers. Before the
    // evidence gate was reordered, that fail-closed guess short-circuited the whole
    // gate, and a tap on `/crm` in that window reached `openFwDb()` — creating the FW
    // queue database on an admissions staffer's browser, permanently, because nothing
    // deletes it and `fwQueueDbExists()` answers `true` for that origin ever after.
    //
    // `actorIsFwGuide: true` here is NOT "this person is a guide" — it is the
    // unresolved default, which is exactly the point.
    const lock = makeFakeLockManager();
    const dev = device({
      readFails: true,
      evidence: { kind: "read", cacheOwner: null, queueDbOpened: false, queueDbExists: false },
    });

    expect(await signOut(dev, lock, { actorIsFwGuide: true })).toEqual({ kind: "sign_out" });
    expect(dev.reads).toBe(0); // never read, therefore never opened, therefore never created
    expect(lock.acquisitions).toBe(0);
  });

  it("an evidence read that threw still checks the queue (unknown is not absence)", async () => {
    const dev = device({ readFails: true, evidence: { kind: "unknown" } });
    expect(await signOut(dev)).toEqual({
      kind: "refused",
      verdict: { ok: false, reason: "unreadable", queuedCount: 0 },
    });
    expect(dev.reads).toBe(1);
  });

  it("a drain that hits no_session refuses naming RE-AUTHENTICATION, not 'still sending'", async () => {
    const dev = device({
      store: [entry("checkmark")],
      onDrain: (d) => {
        d.authRequired = true; // what `drainFwQueue` → {ok:false, reason:"no_session"} sets
      },
    });
    const outcome = await signOut(dev);

    expect(outcome).toEqual({
      kind: "refused",
      verdict: { ok: false, reason: "session_expired", queuedCount: 1 },
    });
    expect(fwSignOutOutcomeCopy(outcome)).toBe(
      "Your session expired before 1 check-in could send. Sign in again to send it, then sign out."
    );
    expect(dev.store).toHaveLength(1);
  });

  it("a captive portal (onLine true, drain changes nothing) ESCALATES instead of looping", async () => {
    const dev = device({ store: [entry("checkmark")], onDrain: () => {} });
    const outcome = await signOut(dev);

    expect(outcome).toEqual({
      kind: "refused",
      verdict: { ok: false, reason: "drain_stalled", queuedCount: 1 },
    });
    expect(dev.drains).toBe(1); // exactly one attempt — not a spin
    expect(fwSignOutOutcomeCopy(outcome)).not.toMatch(/try again in a moment/i);
  });

  it("a capture enqueued between the verdict and the clear aborts the sign-out", async () => {
    const raced = entry("checkmark");
    const dev = device({ beforeClear: (d) => d.store.push(raced) });
    expect(await signOut(dev)).toEqual({ kind: "raced" });
    expect(dev.store).toEqual([raced]); // the tap that raced in is intact
  });

  it("does not deadlock: the lock is acquired EXACTLY once and the drain runs inside it", async () => {
    // Web Locks are not reentrant. If `runFwClientDrain`'s lock-acquiring wrapper were
    // wired in as the flow's drain port, the `expect(lock.held).toBe(1)` inside the
    // drain port would never be reached — the test would time out instead of failing.
    const lock = makeFakeLockManager();
    const dev = device({ store: [entry("checkmark"), entry("not_yet")] });
    expect(await signOut(dev, lock)).toEqual({ kind: "sign_out" });
    expect(lock.acquisitions).toBe(1);
    expect(lock.held).toBe(0); // released
    expect(dev.drains).toBe(1);
  });

  it("B1: a guide's REAL undrained queue is checked even when fw.cacheOwner was evicted", async () => {
    // THE P0 STAFF-FRONT-DOOR-UNIT-3 BLOCKER (four reviewers converged).
    //
    // `cacheOwner === null && !queueDbOpened` is indistinguishable from "this device
    // holds an undrained queue but localStorage was evicted" — localStorage and
    // IndexedDB evict independently, and `queueDbOpened` is per-DOCUMENT and false on
    // every fresh load. The old gate read that state as "no FW residue here" and
    // skipped the queue check entirely, so sign-out completed and three verified
    // check-ins were abandoned on a shared iPad.
    //
    // It was unreachable only because `FwPwa` opened the database on every mount of
    // the layout that rendered the sign-out button. The staff bar mounts OUTSIDE that
    // group, which is what makes it reachable — so the gate now takes the
    // SERVER-KNOWN fact instead of hardening the client-storage heuristic.
    const dev = device({
      store: [entry("checkmark"), entry("checkmark"), entry("checkmark")],
      online: false,
      evidence: { kind: "read", cacheOwner: null, queueDbOpened: false, queueDbExists: null },
    });
    const outcome = await signOut(dev, makeFakeLockManager(), { actorIsFwGuide: true });

    expect(outcome).toEqual({
      kind: "refused",
      verdict: { ok: false, reason: "queued_offline", queuedCount: 3 },
    });
    expect(dev.reads).toBe(1); // the queue was READ, not assumed absent
    expect(dev.store).toHaveLength(3); // …and the captures survive
  });

  it("B1: the same device with the same evidence still skips when the actor is NOT a guide", async () => {
    // The other side of the branch — without this the server signal would be inert
    // (it would return exactly what the fallback returns) and deleting it would leave
    // the suite green. A CRM-only staff member must still never create the database.
    const lock = makeFakeLockManager();
    const dev = device({
      store: [entry("checkmark")],
      online: false,
      evidence: { kind: "read", cacheOwner: null, queueDbOpened: false, queueDbExists: null },
    });
    expect(await signOut(dev, lock, { actorIsFwGuide: false })).toEqual({ kind: "sign_out" });
    expect(dev.reads).toBe(0);
    expect(lock.acquisitions).toBe(0);
  });

  it("B3: a throwing ROSTER clear does NOT report a successful sign-out", async () => {
    // The roster cache holds children's first and last names. `clearFwResidue` used
    // to compute `cleared` from the queue step alone and log-and-swallow this, so the
    // guide was told sign-out worked while the names stayed for the next operator.
    const dev = device({ rosterClearFails: true });
    expect(await signOut(dev)).toEqual({ kind: "clear_failed" });
    expect(dev.rosterCached).toBe(true);
    expect(fwSignOutOutcomeCopy({ kind: "clear_failed" })).toMatch(/still signed in/i);
  });

  it("B3: a throwing SHELL-cache delete does NOT report a successful sign-out", async () => {
    const dev = device({ shellClearFails: true });
    expect(await signOut(dev)).toEqual({ kind: "clear_failed" });
    expect(dev.shellCached).toBe(true);
  });

  it("B3: the queue still goes first, so the captures are not held hostage to a cache fault", async () => {
    const dev = device({ store: [entry("checkmark")], rosterClearFails: true });
    expect(await signOut(dev)).toEqual({ kind: "clear_failed" });
    expect(dev.store).toEqual([]); // drained and cleared — nothing was lost
  });

  it("two documents — a drain in one, sign-out in the other — leave no entry behind", async () => {
    const lock = makeFakeLockManager();
    const dev = device({ store: [entry("checkmark"), entry("checkmark")] });

    let releaseDocA!: () => void;
    const docAWorking = new Promise<void>((r) => {
      releaseDocA = r;
    });
    // Document A: a background drain, which goes through the SAME named lock.
    const docA = lock.request(async () => {
      await docAWorking;
      dev.store = []; // its two taps landed
    });
    // Document B: the sign-out sequence, started while A still holds the lock.
    const docB = signOut(dev, lock);
    await Promise.resolve();
    await Promise.resolve();
    expect(dev.reads).toBe(0); // B is genuinely BLOCKED on the lock, not racing A

    releaseDocA();
    await docA;
    expect(await docB).toEqual({ kind: "sign_out" });
    expect(dev.store).toEqual([]); // nothing survived, and nothing was lost
    expect(dev.drains).toBe(0); // B found an empty queue — A had already sent it
    expect(lock.acquisitions).toBe(2); // one per document, never twice in one
  });
});

/* ══════════════════════════════ the device-handover reconcile (Unit 3, B2) ══ */

/**
 * The shared-iPad handover, driven end-to-end through the same fake device.
 *
 * WHAT THIS REPLACES. `reconcileFwCacheOwner` called an unconditional purge —
 * `clearFwQueue()` with no verdict — on EVERY mount where identity differed, which is
 * the ordinary handover after a crash, a revoked grant, or a forgotten sign-out. The
 * outgoing guide's verified check-ins were destroyed, the purge swallowed every
 * failure, and the owner key advanced regardless, so a failed purge could never
 * recur. Moving that code to a bar mounted on `/staff` and `/crm` would have fired it
 * far more often, which is why it is rewritten before the bar mounts, not after.
 *
 * The prior owner's captures are `foreignUndrained` to this session and no drain
 * under this session can ever ship them (`selectFwDrainable` scopes to the actor, and
 * the server action re-authes as them). So the assertion that matters is not "the
 * reconcile succeeded" — it is "the captures still exist".
 */
describe("runFwCacheOwnerReconcile — a device that changed hands", () => {
  it("same owner: no lock, no reads, no clears", async () => {
    const lock = makeFakeLockManager();
    const dev = device({ owner: GUIDE, store: [entry("checkmark")] });
    expect(await reconcile(dev, lock)).toEqual({ kind: "none" });
    expect(lock.acquisitions).toBe(0);
    expect(dev.store).toHaveLength(1);
    expect(dev.rosterCached).toBe(true);
  });

  it("an unclaimed key is ADOPTED on an FW surface — nothing is destroyed", async () => {
    const dev = device({
      owner: null,
      store: [entry("checkmark")],
      // A genuinely clean device: no FW database, so nothing unattributed can be here.
      evidence: { kind: "read", cacheOwner: null, queueDbOpened: false, queueDbExists: false },
    });
    expect(await reconcile(dev)).toEqual({ kind: "adopted" });
    expect(dev.owner).toBe(GUIDE);
    expect(dev.store).toHaveLength(1);
  });

  it("an unclaimed key is NOT claimed from /crm or /staff", async () => {
    // The key feeds `hasFwDeviceEvidence`'s legacy branch. A bar that wrote it on a
    // browser which has never run FW would manufacture the evidence it later trusts.
    const dev = device({
      owner: null,
      evidence: { kind: "read", cacheOwner: null, queueDbOpened: false, queueDbExists: false },
    });
    expect(await reconcile(dev, makeFakeLockManager(), { surfaceCreatesResidue: false })).toEqual({
      kind: "none",
    });
    expect(dev.owner).toBeNull();
    expect(dev.ownerWrites).toBe(0);
  });

  it("B2: a handover with the PRIOR guide's undrained captures and NO connectivity preserves them", async () => {
    // THE P0. The old code wiped these three check-ins on mount, silently, with no
    // way to recover them — a guide's verified record of three children.
    const theirs = [
      entry("checkmark", { actorUserId: OTHER_GUIDE }),
      entry("checkmark", { actorUserId: OTHER_GUIDE }),
      entry("not_yet", { actorUserId: OTHER_GUIDE }),
    ];
    const dev = device({ owner: OTHER_GUIDE, store: [...theirs], online: false });

    expect(await reconcile(dev)).toEqual({ kind: "queue_preserved", preservedCount: 3 });
    expect(dev.store).toEqual(theirs); // the captures SURVIVE
    expect(dev.drains).toBe(0); // …and no drain was even attempted: offline
    // The caches DO go — they are the prior guide's children's names and authed HTML,
    // and preserving them protects nobody.
    expect(dev.rosterCached).toBe(false);
    expect(dev.shellCached).toBe(false);
    // The key DOES advance, because the key describes the CACHES and those genuinely
    // went. Holding it back would re-run this destructive clear on every later mount
    // for as long as the departed guide's queue sits there — which is forever, since
    // no session but theirs can drain it. See the regression test below.
    expect(dev.owner).toBe(GUIDE);
  });

  it("B2: a preserved foreign queue does NOT re-wipe the current guide's caches on every mount", async () => {
    // The adversarial finding. Guide B leaves the event with one unsent tap that can
    // never drain (the drain scopes to the signed-in actor). Guide A takes the device.
    // If the owner key stayed at B, every reload — including the reloads A does to
    // fight the flaky wifi their offline roster cache exists to survive — would run a
    // fresh handover clear and destroy A's OWN roster cache, forever, for no gain.
    const theirs = entry("checkmark", { actorUserId: OTHER_GUIDE });
    const dev = device({ owner: OTHER_GUIDE, store: [theirs], online: false });
    await reconcile(dev);

    // A works, and rebuilds their own offline caches.
    dev.rosterCached = true;
    dev.shellCached = true;

    // A reloads. Same still-stuck foreign entry, same device.
    expect(await reconcile(dev)).toEqual({ kind: "none" });
    expect(dev.rosterCached).toBe(true); // A's roster cache SURVIVES
    expect(dev.shellCached).toBe(true);
    expect(dev.store).toEqual([theirs]); // …and B's capture still survives too
  });

  it("B2: a handover WITH connectivity drains this session's own entries, then clears", async () => {
    const dev = device({ owner: OTHER_GUIDE, store: [entry("checkmark"), entry("not_yet")] });
    expect(await reconcile(dev)).toEqual({ kind: "reconciled" });
    expect(dev.drains).toBe(1); // these are THIS actor's — a drain can ship them
    expect(dev.store).toEqual([]);
    expect(dev.owner).toBe(GUIDE);
  });

  it("B2: an empty queue reconciles cleanly and advances the key", async () => {
    const dev = device({ owner: OTHER_GUIDE });
    expect(await reconcile(dev)).toEqual({ kind: "reconciled" });
    expect(dev.drains).toBe(0);
    expect(dev.owner).toBe(GUIDE);
    expect(dev.rosterCached).toBe(false);
    expect(dev.shellCached).toBe(false);
  });

  it("B2: a FAILED clear does not advance the key, so it is retried instead of masked", async () => {
    // The P1 half. The purge returned `Promise<void>` and the caller advanced the
    // owner regardless — after which the mismatch never recurred and the failure was
    // permanent and invisible.
    const dev = device({ owner: OTHER_GUIDE, rosterClearFails: true });
    expect(await reconcile(dev)).toEqual({ kind: "clear_failed" });
    // A FAULT still holds the key back — that is the half of B2 that stops a failure
    // being masked. Only a deliberately preserved queue advances it.
    expect(dev.owner).toBe(OTHER_GUIDE);
    expect(dev.ownerWrites).toBe(0);

    // The next mount tries again — and succeeds once the fault clears.
    dev.rosterClearFails = false;
    expect(await reconcile(dev)).toEqual({ kind: "reconciled" });
    expect(dev.owner).toBe(GUIDE);
  });

  it("B2: a thrown clear outranks a preserved queue — a fault is not a policy", async () => {
    const theirs = entry("checkmark", { actorUserId: OTHER_GUIDE });
    const dev = device({
      owner: OTHER_GUIDE,
      store: [theirs],
      online: false,
      shellClearFails: true,
    });
    expect(await reconcile(dev)).toEqual({ kind: "clear_failed" });
    expect(dev.store).toEqual([theirs]);
  });

  it("B2: a THROWN queue clear is clear_failed, not a preserve with an invented count", async () => {
    // Two reviewers traced this independently. The queue clear throwing (openFwDb
    // rejecting, tx.onabort) is a FAULT; a preserved foreign capture is a POLICY. The
    // first draft reported the fault as `queue_preserved` with a stand-in count of 1
    // and then advanced the owner key over it -- which is the B2 defect exactly, one
    // layer down: the failure becomes invisible and is never retried, because the key
    // now matches and the mismatch never recurs.
    const theirs = entry("checkmark", { actorUserId: OTHER_GUIDE });
    const dev = device({ owner: OTHER_GUIDE, store: [theirs], queueClearThrows: true });

    expect(await reconcile(dev)).toEqual({ kind: "clear_failed" });
    expect(dev.owner).toBe(OTHER_GUIDE); // NOT advanced -- the next mount retries
    expect(dev.ownerWrites).toBe(0);
    expect(dev.store).toEqual([theirs]);
  });

  it("B2: the prior guide's BLOCKED entries are clearable — their reject row is authoritative", async () => {
    const dev = device({
      owner: OTHER_GUIDE,
      store: [entry("undo", { actorUserId: OTHER_GUIDE, blocked: rejected })],
    });
    expect(await reconcile(dev)).toEqual({ kind: "reconciled" });
    expect(dev.store).toEqual([]);
  });

  it("B2: a QUARANTINED record blocks the queue clear — an un-landed capture, unread", async () => {
    const quarantined = { id: "q-1", schemaVersion: 99 };
    const dev = device({ owner: OTHER_GUIDE, store: [quarantined], online: false });
    expect(await reconcile(dev)).toEqual({ kind: "queue_preserved", preservedCount: 1 });
    expect(dev.store).toEqual([quarantined]);
  });

  it("B2: the reconcile takes the drain lock EXACTLY once and does not deadlock", async () => {
    const lock = makeFakeLockManager();
    const dev = device({ owner: OTHER_GUIDE, store: [entry("checkmark")] });
    expect(await reconcile(dev, lock)).toEqual({ kind: "reconciled" });
    expect(lock.acquisitions).toBe(1);
    expect(lock.held).toBe(0);
  });

  it("B2 + R16 end to end: after a handover the new guide signs out, and the survivors survive", async () => {
    // The scenario the whole preserve/refuse design exists for, run as one sequence:
    // guide A leaves undrained captures on a shared iPad, B picks it up, works, and
    // signs out. B's session must END (Unit 4 — refusing here was outside R16's scope
    // and outside B's control to fix) and A's captures must still BE THERE.
    //
    // Both assertions in one test on purpose. They are the two ways this can be got
    // wrong, and each is the other's guard: pass the first alone and you have a
    // data-loss bug, pass the second alone and you have the wedge B had before.
    const theirs = entry("checkmark", { actorUserId: OTHER_GUIDE });
    const dev = device({ owner: OTHER_GUIDE, store: [theirs], online: false });
    expect(await reconcile(dev)).toEqual({ kind: "queue_preserved", preservedCount: 1 });

    expect(await signOut(dev, makeFakeLockManager(), { actorIsFwGuide: true })).toEqual({
      kind: "sign_out",
    });
    expect(dev.store).toEqual([theirs]);
  });

  it("a localStorage read that THREW on a clean device is treated as no prior owner", async () => {
    const dev = device({
      owner: undefined,
      store: [entry("checkmark")],
      evidence: { kind: "read", cacheOwner: null, queueDbOpened: false, queueDbExists: false },
    });
    expect(await reconcile(dev)).toEqual({ kind: "adopted" });
    expect(dev.store).toHaveLength(1);
  });

  it("UNATTRIBUTED residue reconciles instead of adopting — the prior guide's caches go", async () => {
    // localStorage and IndexedDB evict independently, so a null owner key is not proof
    // of a clean device. The old code adopted here, silently leaving the previous
    // guide's cached roster (children's names) and authenticated shell for the next
    // operator — the exact leak the reconcile exists to close.
    const dev = device({
      owner: null,
      evidence: { kind: "read", cacheOwner: null, queueDbOpened: false, queueDbExists: true },
    });
    expect(await reconcile(dev)).toEqual({ kind: "reconciled" });
    expect(dev.rosterCached).toBe(false);
    expect(dev.shellCached).toBe(false);
  });

  it("…and reconciles on /crm and /staff too, where it may not otherwise claim the key", async () => {
    const dev = device({
      owner: null,
      evidence: { kind: "read", cacheOwner: null, queueDbOpened: false, queueDbExists: true },
    });
    expect(await reconcile(dev, makeFakeLockManager(), { surfaceCreatesResidue: false })).toEqual({
      kind: "reconciled",
    });
    expect(dev.rosterCached).toBe(false);
  });
});

/* ═══════════════ what only a source scan can reach in fw-sync-client.ts ══ */

/**
 * `app/fp/lib/fw-sync-client.ts` binds browser seams — IndexedDB, `navigator.locks`,
 * `caches` — so node-only CI can import it but can never execute the branches that
 * matter. Everything decidable was pushed into `fw-sync-rules.ts` for exactly that
 * reason, and the harness above drives the sequence through fake ports.
 *
 * ONE thing is left that no fake can reach: how the real `clearFwResidue` disposes of
 * its own thrown clear. Two reviewers traced that reporting a NUMBER there makes a
 * genuine IndexedDB fault arrive at the handover reconcile looking exactly like a
 * legitimate "one foreign capture preserved" — the owner key advances, the failure is
 * masked forever, and that is the B2 defect one layer down. The fix is one word, and
 * a future "simplify" pass would undo it with nothing going red. So it is pinned here,
 * in the file that owns this stack, over comment-stripped source.
 */
describe("clearFwResidue reports a thrown queue clear as UNKNOWN, never as a count", () => {
  const dir = fileURLToPath(new URL(".", import.meta.url));
  const source = readFileSync(new URL("../fw-sync-client.ts", `file://${dir}`), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("assigns null in the catch, and never a numeric stand-in", () => {
    const start = source.indexOf("export async function clearFwResidue");
    expect(start).toBeGreaterThan(0);
    const body = source.slice(start, source.indexOf("\n}", start));
    const catchBlock = body.slice(body.indexOf("} catch"));

    expect(catchBlock).toMatch(/queueRemaining\s*=\s*null/);
    expect(catchBlock).not.toMatch(/queueRemaining\s*=\s*\d/);
  });
});
