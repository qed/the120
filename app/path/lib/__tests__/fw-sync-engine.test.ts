import { describe, expect, it } from "vitest";

import { runFwDrain, type FwDrainInput } from "../fw-sync-engine";
import { decideFwAction, type FwAction } from "../fw-rules";
import {
  FW_QUEUE_ENTRY_SCHEMA_VERSION,
  type FwQueueEntry,
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
};

function makeFakeDb(seed: Seed) {
  const members = new Set(seed.members ?? []);
  const tombstoned = new Set(seed.tombstoned ?? []);
  const progress = new Map<string, ProgressRow>(Object.entries(seed.progress ?? {}));
  const seen = new Set<string>(seed.seenClientIds ?? []);
  const rejects: RejectRow[] = [];
  const events: EventRow[] = [];
  const rpcCalls: string[] = [];

  const pkey = (s: string, t: string) => `${s}|${t}`;
  const cidKey = (s: string, t: string, c: string) => `${s}|${t}|${c}`;

  function fwMoveTask(p: Record<string, unknown>) {
    const student = p.p_student_id as string;
    const task = p.p_task_id as string;
    const action = p.p_action as FwAction;
    const actor = p.p_actor as string;
    const clientId = (p.p_client_id as string | null) ?? null;
    rpcCalls.push(`${action}:${student}`);

    if (!members.has(student)) return { outcome: "cohort_invalid", state: null, verified_by: null };
    const cur = progress.get(pkey(student, task));
    if (!cur) return { outcome: "missing", state: null, verified_by: null };
    if (clientId && seen.has(cidKey(student, task, clientId))) {
      return { outcome: "replayed", state: cur.state, verified_by: cur.verified_by };
    }

    const decision = decideFwAction({ action, from: cur.state });
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
          return Promise.resolve({ data: row ? { ...row } : null, error: null });
        },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          let out: { data: unknown; error: { message: string } | null };
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

  return { db: db as never, progress, rejects, events, rpcCalls, pkey };
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
