import { describe, expect, it } from "vitest";

import { runFwDrain, type FwDrainInput } from "../fw-sync-engine";
import { runFwCheckIn } from "../fw-checkin-core";
import { decideFwAction, type FwAction } from "../fw-rules";
import {
  FW_QUEUE_ENTRY_SCHEMA_VERSION,
  fwSignOutOutcomeCopy,
  isRecognizedFwEntry,
  runFwSignOutFlow,
  type FwDeviceEvidence,
  type FwQueueEntry,
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
};

function device(over: Partial<FakeDevice> = {}): FakeDevice {
  return {
    store: [],
    online: true,
    authRequired: false,
    evidence: { kind: "read", cacheOwner: GUIDE, queueDbOpened: true },
    readFails: false,
    reads: 0,
    drains: 0,
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
    readEvidence: () => dev.evidence,
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
    clear: async (blocksClear) => {
      dev.beforeClear?.(dev);
      // Models `clearFwQueueIfEmpty`: count-then-clear in ONE transaction, under the
      // predicate the flow supplied — never a second, hand-written emptiness test.
      const blocking = dev.store.filter(blocksClear).length;
      if (blocking === 0) dev.store = [];
      return { cleared: blocking === 0 };
    },
  };
}

const signOut = (dev: FakeDevice, lock = makeFakeLockManager()) =>
  runFwSignOutFlow({ actorUserId: GUIDE, ports: portsFor(dev, lock) });

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

  it("one FOREIGN UNDRAINED entry refuses, names the other account, and is NOT destroyed", async () => {
    const foreign = entry("checkmark", { actorUserId: OTHER_GUIDE });
    const dev = device({ store: [foreign] });
    const outcome = await signOut(dev);

    expect(outcome).toEqual({
      kind: "refused",
      verdict: { ok: false, reason: "foreign_queue", queuedCount: 1 },
    });
    expect(fwSignOutOutcomeCopy(outcome)).toMatch(/another account/i);
    expect(dev.store).toEqual([foreign]); // un-landed work of a guide who is not here
    expect(dev.drains).toBe(0); // this session could never ship it anyway
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
      evidence: { kind: "read", cacheOwner: null, queueDbOpened: false },
    });
    expect(await signOut(dev, lock)).toEqual({ kind: "sign_out" });
    expect(dev.reads).toBe(0);
    expect(lock.acquisitions).toBe(0); // no lock, no IndexedDB, no side effects
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
