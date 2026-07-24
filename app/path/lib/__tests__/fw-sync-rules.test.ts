import { describe, expect, it } from "vitest";

import {
  decideFwSignOut,
  evaluateFwSameActorGuard,
  FW_QUEUE_ENTRY_SCHEMA_VERSION,
  FW_ROSTER_CACHE_SCHEMA_VERSION,
  fwStudentTaskKey,
  groupFwEntriesByStudentTask,
  interpretFwReplayResult,
  isFwAppShellPath,
  isFwRosterCacheUsable,
  isRecognizedFwEntry,
  orderFwEntries,
  planFwStudentTask,
  reduceFwOps,
  selectFwDrainable,
  summarizeFwQueue,
  type FwQueueEntry,
  type FwRosterCache,
  type FwServerRow,
} from "../fw-sync-rules";
import type { FwStudentResult } from "../fw-rules";
import type { TaskState } from "../transition-table";

/**
 * The reduction × same-actor-guard × rejection matrix (FW Unit 8; Decisions 8, 9,
 * 14, 15). Both adversarial reviews found live-event bugs in exactly this fold —
 * the queue-reduction/undo-correction conflict and the authorless undo guard — so
 * every named row is pinned here, and the three assertions the plan calls out
 * (the reduction, the same-actor guard, the sign-out verdict) are mutation-checked
 * across classes: a reduction that collapses an `undo + decision` correction, a
 * guard that ignores the author, and a sign-out that lets an offline queue evaporate
 * each redden a test.
 */

const STUDENT_A = "11111111-1111-4111-8111-111111111111";
const STUDENT_B = "22222222-2222-4222-8222-222222222222";
const TASK = "1.2.4";
const COHORT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GUIDE = "gggggggg-gggg-4ggg-8ggg-gggggggggggg";
const OTHER_GUIDE = "hhhhhhhh-hhhh-4hhh-8hhh-hhhhhhhhhhhh";

let seq = 0;
function entry(
  action: FwQueueEntry["action"],
  overrides: Partial<FwQueueEntry> = {}
): FwQueueEntry {
  seq += 1;
  const stamp = `2026-08-21T14:${String(seq).padStart(2, "0")}:00.000Z`;
  const clientId = overrides.clientId ?? `client-${seq}`;
  return {
    id: overrides.id ?? clientId,
    schemaVersion: FW_QUEUE_ENTRY_SCHEMA_VERSION,
    clientId,
    actionId: overrides.actionId ?? `action-${seq}`,
    studentId: overrides.studentId ?? STUDENT_A,
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

const actions = (ops: readonly FwQueueEntry[]) => ops.map((o) => o.action);

/* ════════════════════════════════════════════════ the minimal-legal reduction ══ */

describe("reduceFwOps — minimal legal op-sequence (Decision 9)", () => {
  it("an empty queue reduces to nothing", () => {
    expect(reduceFwOps([])).toEqual([]);
  });

  it("a lone decision survives", () => {
    expect(actions(reduceFwOps([entry("checkmark")]))).toEqual(["checkmark"]);
    expect(actions(reduceFwOps([entry("not_yet")]))).toEqual(["not_yet"]);
  });

  it("a checkmark + undo PAIR cancels to nothing (the original P1)", () => {
    expect(reduceFwOps([entry("checkmark"), entry("undo")])).toEqual([]);
  });

  it("a not_yet + undo pair cancels to nothing", () => {
    expect(reduceFwOps([entry("not_yet"), entry("undo")])).toEqual([]);
  });

  it("check → undo → check reduces to ONE checkmark (G14)", () => {
    expect(actions(reduceFwOps([entry("checkmark"), entry("undo"), entry("checkmark")]))).toEqual([
      "checkmark",
    ]);
  });

  it("check → undo → not_yet reduces to a lone not_yet", () => {
    expect(actions(reduceFwOps([entry("checkmark"), entry("undo"), entry("not_yet")]))).toEqual([
      "not_yet",
    ]);
  });

  it("a lone undo SURVIVES so the guard can evaluate it (undo-of-pre-outage, G14)", () => {
    expect(actions(reduceFwOps([entry("undo")]))).toEqual(["undo"]);
  });

  it("an undo + decision CORRECTION is preserved in order — never collapsed to the bare decision (the corrected P1)", () => {
    // This is the row the plan-review correction turns on: collapsing [undo,
    // not_yet] to [not_yet] would produce a not_yet the write path rightly
    // refuses (undo_first). The reduction must keep BOTH and their order.
    const reduced = reduceFwOps([entry("undo"), entry("not_yet")]);
    expect(actions(reduced)).toEqual(["undo", "not_yet"]);
    // MUTATION GUARD (relocate/drop class): a reducer that dropped the undo, or
    // reordered, fails here — length and order both asserted.
    expect(reduced).toHaveLength(2);
    expect(reduced[0].action).toBe("undo");
    expect(reduced[1].action).toBe("not_yet");
  });

  it("an undo + checkmark correction is preserved in order", () => {
    expect(actions(reduceFwOps([entry("undo"), entry("checkmark")]))).toEqual(["undo", "checkmark"]);
  });

  it("two not_yet re-attempts are BOTH preserved (FW-D4 struggle signal; distinct client ids)", () => {
    const reduced = reduceFwOps([entry("not_yet"), entry("not_yet")]);
    expect(actions(reduced)).toEqual(["not_yet", "not_yet"]);
    // Distinct entries, not one collapsed — each carries its own exactly-once key.
    expect(new Set(reduced.map((r) => r.clientId)).size).toBe(2);
  });

  it("a cancelled pair followed by a trailing undo leaves the trailing undo (check,undo,undo)", () => {
    expect(actions(reduceFwOps([entry("checkmark"), entry("undo"), entry("undo")]))).toEqual([
      "undo",
    ]);
  });

  it("reduces in CAPTURE order regardless of input order (enqueuedAt is the clock)", () => {
    const first = entry("checkmark", { enqueuedAt: "2026-08-21T14:00:00.000Z" });
    const second = entry("undo", { enqueuedAt: "2026-08-21T14:05:00.000Z" });
    // Fed out of order; the reduction must sort by capture time before folding.
    expect(reduceFwOps([second, first])).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════ the same-actor undo guard ══ */

describe("evaluateFwSameActorGuard — reads the author column (Decision 9)", () => {
  const guard = (server: FwServerRow | null, undoActor = GUIDE) =>
    evaluateFwSameActorGuard({ server, undoActor });

  it("no server row → apply (the RPC will classify missing/no-op)", () => {
    expect(guard(null)).toBe("apply");
  });

  it.each<TaskState>(["locked", "available", "in_progress", "submitted"])(
    "a non-decision server state (%s) → apply (the undo no-ops)",
    (state) => {
      expect(guard({ state, verifiedBy: OTHER_GUIDE })).toBe("apply");
    }
  );

  it("verified by the SAME actor → apply", () => {
    expect(guard({ state: "verified", verifiedBy: GUIDE })).toBe("apply");
  });

  it("verified by ANOTHER actor → reject (cross-actor undo)", () => {
    expect(guard({ state: "verified", verifiedBy: OTHER_GUIDE })).toBe("reject");
  });

  it("not_yet by the SAME actor → apply (undo-of-not_yet, same actor)", () => {
    expect(guard({ state: "not_yet", verifiedBy: GUIDE })).toBe("apply");
  });

  it("not_yet by ANOTHER actor → reject (undo-of-not_yet, cross actor)", () => {
    expect(guard({ state: "not_yet", verifiedBy: OTHER_GUIDE })).toBe("reject");
  });

  it("a decision with a NULL author fails CLOSED → reject (never assume same-actor)", () => {
    // MUTATION GUARD (substitute class): a guard that treated a null author as a
    // pass — `verifiedBy === undoActor || verifiedBy === null` — would let a
    // cross-actor undo through on a shape drift. Fail closed.
    expect(guard({ state: "verified", verifiedBy: null })).toBe("reject");
  });
});

/* ══════════════════════════════ the composed per-student-task drain plan ══ */

describe("planFwStudentTask — reduce × guard × reject composition", () => {
  it("a cancel pair yields nothing to replay and nothing to reject", () => {
    expect(planFwStudentTask({ ops: [entry("checkmark"), entry("undo")], server: null })).toEqual({
      replay: [],
      reject: [],
    });
  });

  it("undo + not_yet, SAME actor on a pre-outage verified → both replay in order, no reject", () => {
    const ops = [entry("undo"), entry("not_yet")];
    const plan = planFwStudentTask({
      ops,
      server: { state: "verified", verifiedBy: GUIDE },
    });
    expect(actions(plan.replay)).toEqual(["undo", "not_yet"]);
    expect(plan.reject).toEqual([]);
  });

  it("undo + not_yet, CROSS actor on a pre-outage verified → the whole correction rejects to staff", () => {
    const ops = [entry("undo"), entry("not_yet")];
    const plan = planFwStudentTask({
      ops,
      server: { state: "verified", verifiedBy: OTHER_GUIDE },
    });
    expect(plan.replay).toEqual([]);
    expect(plan.reject).toHaveLength(2);
    expect(plan.reject.every((r) => r.reason === "cross_actor_undo")).toBe(true);
  });

  it("a bare undo of ANOTHER guide's live checkmark → same-actor guard rejects (the original P1)", () => {
    const plan = planFwStudentTask({
      ops: [entry("undo")],
      server: { state: "verified", verifiedBy: OTHER_GUIDE },
    });
    expect(plan.replay).toEqual([]);
    expect(plan.reject).toHaveLength(1);
    expect(plan.reject[0].reason).toBe("cross_actor_undo");
  });

  it("a bare undo of the guide's OWN checkmark → replays", () => {
    const plan = planFwStudentTask({
      ops: [entry("undo")],
      server: { state: "verified", verifiedBy: GUIDE },
    });
    expect(actions(plan.replay)).toEqual(["undo"]);
    expect(plan.reject).toEqual([]);
  });

  it("undo of a pre-outage checkmark already undone live (server locked) → replays and will no-op", () => {
    const plan = planFwStudentTask({
      ops: [entry("undo")],
      server: { state: "locked", verifiedBy: null },
    });
    expect(actions(plan.replay)).toEqual(["undo"]);
    expect(plan.reject).toEqual([]);
  });

  it("undo-of-not_yet cross actor → rejects", () => {
    const plan = planFwStudentTask({
      ops: [entry("undo")],
      server: { state: "not_yet", verifiedBy: OTHER_GUIDE },
    });
    expect(plan.reject.map((r) => r.reason)).toEqual(["cross_actor_undo"]);
  });

  it("a leading DECISION never triggers the guard even when the server was verified by another (check→undo→check)", () => {
    const plan = planFwStudentTask({
      ops: [entry("checkmark"), entry("undo"), entry("checkmark")],
      server: { state: "verified", verifiedBy: OTHER_GUIDE },
    });
    // Reduces to a lone checkmark, whose leading op is not an undo, so the guard
    // is never consulted and the checkmark replays.
    expect(actions(plan.replay)).toEqual(["checkmark"]);
    expect(plan.reject).toEqual([]);
  });
});

/* ═══════════════════════════════════════════ replay-outcome interpretation ══ */

describe("interpretFwReplayResult — settled vs reject vs retry", () => {
  const res = (r: FwStudentResult): FwStudentResult => r;

  it.each<[FwStudentResult["kind"], TaskState]>([
    ["applied", "verified"],
    ["re_attempt", "not_yet"],
    ["already_done", "verified"],
    ["replayed", "verified"],
  ])("a successful %s outcome settles (delete the entry)", (kind, state) => {
    expect(
      interpretFwReplayResult(res({ studentId: STUDENT_A, kind, state } as FwStudentResult))
    ).toEqual({ kind: "settled" });
  });

  it("an already-verified replay is `already_done` → a settle NO-OP, NOT a reject (error scenario)", () => {
    expect(
      interpretFwReplayResult({ studentId: STUDENT_A, kind: "already_done", state: "verified" })
    ).toEqual({ kind: "settled" });
  });

  it("a write-path refusal (undo_first) → reject `guard_refused`", () => {
    expect(
      interpretFwReplayResult({
        studentId: STUDENT_A,
        kind: "refused",
        reason: "undo_first",
        state: "verified",
      })
    ).toEqual({ kind: "reject", reason: "guard_refused" });
  });

  it("a write-path refusal (not_a_decision) → reject `guard_refused`", () => {
    expect(
      interpretFwReplayResult({
        studentId: STUDENT_A,
        kind: "refused",
        reason: "not_a_decision",
        state: "locked",
      })
    ).toEqual({ kind: "reject", reason: "guard_refused" });
  });

  it("missing progress → reject `missing_progress`", () => {
    expect(
      interpretFwReplayResult({ studentId: STUDENT_A, kind: "failed", reason: "missing_progress" })
    ).toEqual({ kind: "reject", reason: "missing_progress" });
  });

  it("cohort_invalid → reject `cohort_unresolved`", () => {
    expect(
      interpretFwReplayResult({ studentId: STUDENT_A, kind: "failed", reason: "cohort_invalid" })
    ).toEqual({ kind: "reject", reason: "cohort_unresolved" });
  });

  it("a not_in_cohort skip → reject `cohort_unresolved`", () => {
    expect(
      interpretFwReplayResult({ studentId: STUDENT_A, kind: "skipped", reason: "not_in_cohort" })
    ).toEqual({ kind: "reject", reason: "cohort_unresolved" });
  });

  it("an unavailable failure is TRANSIENT → retry (never a reject, never a settle)", () => {
    // MUTATION GUARD: a mapping that rejected `unavailable` would record a
    // permanent reject for a transient venue-wifi blip; one that settled it would
    // silently drop the capture. It must retry.
    expect(
      interpretFwReplayResult({ studentId: STUDENT_A, kind: "failed", reason: "unavailable" })
    ).toEqual({ kind: "retry" });
  });
});

/* ══════════════════════════════════ block-until-drained sign-out (Decision 8) ══ */

describe("decideFwSignOut — block-until-drained (Decision 8 / gap G1)", () => {
  it("an empty queue allows sign-out (clear the residue)", () => {
    expect(decideFwSignOut({ queuedCount: 0, online: false })).toEqual({ ok: true });
    expect(decideFwSignOut({ queuedCount: 0, online: true })).toEqual({ ok: true });
  });

  it("sign-out with 3 queued items OFFLINE is REFUSED with the count", () => {
    // MUTATION GUARD (the plan's named row): a verdict that returned ok:true here
    // would let a 20-minute outage's captures evaporate on sign-out — the exact
    // permanent-loss failure Decision 8 exists to prevent.
    expect(decideFwSignOut({ queuedCount: 3, online: false })).toEqual({
      ok: false,
      reason: "queued_offline",
      queuedCount: 3,
    });
  });

  it("sign-out with queued items ONLINE says drain first (the drain can run)", () => {
    expect(decideFwSignOut({ queuedCount: 3, online: true })).toEqual({
      ok: false,
      reason: "drain_first",
      queuedCount: 3,
    });
  });
});

/* ═══════════════════════════════════════════ roster cache policy (Decision 15) ══ */

describe("isFwRosterCacheUsable — versioned across a mid-weekend deploy (Decision 15)", () => {
  const cache = (overrides: Partial<FwRosterCache> = {}): FwRosterCache => ({
    schemaVersion: FW_ROSTER_CACHE_SCHEMA_VERSION,
    buildId: "build-abc",
    cohortId: COHORT,
    students: [],
    cachedAt: "2026-08-21T14:00:00.000Z",
    ...overrides,
  });

  it("no cache → not usable", () => {
    expect(isFwRosterCacheUsable(null, { cohortId: COHORT, schemaVersion: FW_ROSTER_CACHE_SCHEMA_VERSION })).toBe(
      false
    );
  });

  it("a fresh same-cohort cache is usable", () => {
    expect(
      isFwRosterCacheUsable(cache(), { cohortId: COHORT, schemaVersion: FW_ROSTER_CACHE_SCHEMA_VERSION })
    ).toBe(true);
  });

  it("a schema-version mismatch is NOT usable (a shape change must never feed the shell raw)", () => {
    expect(
      isFwRosterCacheUsable(cache({ schemaVersion: FW_ROSTER_CACHE_SCHEMA_VERSION + 1 }), {
        cohortId: COHORT,
        schemaVersion: FW_ROSTER_CACHE_SCHEMA_VERSION,
      })
    ).toBe(false);
  });

  it("a DIFFERENT cohort's cache is not usable for this cohort", () => {
    expect(
      isFwRosterCacheUsable(cache({ cohortId: STUDENT_B }), {
        cohortId: COHORT,
        schemaVersion: FW_ROSTER_CACHE_SCHEMA_VERSION,
      })
    ).toBe(false);
  });

  it("a DEPLOY (buildId changes, schema does not) does NOT wedge the shell — the cache stays usable", () => {
    // The version test the plan names: a content-only redeploy changes buildId
    // but not the entry shape, and the roster the guide is mid-loop with must
    // survive it. Only a schemaVersion bump invalidates.
    expect(
      isFwRosterCacheUsable(cache({ buildId: "build-xyz-after-deploy" }), {
        cohortId: COHORT,
        schemaVersion: FW_ROSTER_CACHE_SCHEMA_VERSION,
      })
    ).toBe(true);
  });
});

/* ══════════════════════════════════════════ cross-deploy tolerant entry reader ══ */

describe("isRecognizedFwEntry — never feed an unknown shape into the typed drain", () => {
  it("a well-formed entry is recognized", () => {
    expect(isRecognizedFwEntry(entry("checkmark"))).toBe(true);
  });

  it("a non-object is not", () => {
    expect(isRecognizedFwEntry(null)).toBe(false);
    expect(isRecognizedFwEntry("x")).toBe(false);
  });

  it("a missing required field is not recognized", () => {
    const { actorUserId: _drop, ...rest } = entry("checkmark");
    void _drop;
    expect(isRecognizedFwEntry(rest)).toBe(false);
  });

  it("an unknown action is not recognized", () => {
    expect(isRecognizedFwEntry({ ...entry("checkmark"), action: "delete" })).toBe(false);
  });

  it("a FUTURE schema version is not recognized (routes to the surfaced tombstone)", () => {
    expect(
      isRecognizedFwEntry({ ...entry("checkmark"), schemaVersion: FW_QUEUE_ENTRY_SCHEMA_VERSION + 1 })
    ).toBe(false);
  });
});

/* ═══════════════════════════════════════════════ grouping, ordering, scope ══ */

describe("grouping and drain ordering", () => {
  it("groups by (cohort, student, task) and orders each group by capture time", () => {
    const a1 = entry("checkmark", { studentId: STUDENT_A, enqueuedAt: "2026-08-21T14:02:00.000Z" });
    const a2 = entry("undo", { studentId: STUDENT_A, enqueuedAt: "2026-08-21T14:01:00.000Z" });
    const b1 = entry("checkmark", { studentId: STUDENT_B });
    const groups = groupFwEntriesByStudentTask([a1, b1, a2]);
    expect(groups.size).toBe(2);
    const aGroup = groups.get(fwStudentTaskKey(a1))!;
    // Ordered by enqueuedAt — a2 (14:01) before a1 (14:02) even though a1 was first in the array.
    expect(aGroup.map((e) => e.action)).toEqual(["undo", "checkmark"]);
  });

  it("orders the whole queue FIFO by enqueuedAt with an id tiebreak (total, stable)", () => {
    const same = "2026-08-21T14:00:00.000Z";
    const x = entry("checkmark", { id: "id-b", enqueuedAt: same });
    const y = entry("checkmark", { id: "id-a", enqueuedAt: same });
    expect(orderFwEntries([x, y]).map((e) => e.id)).toEqual(["id-a", "id-b"]);
  });

  it("selectFwDrainable keeps only the signed-in guide's own captures (defense in depth)", () => {
    const mine = entry("checkmark", { actorUserId: GUIDE });
    const theirs = entry("checkmark", { actorUserId: OTHER_GUIDE });
    expect(selectFwDrainable([mine, theirs], GUIDE)).toEqual([mine]);
  });

  it("summarizeFwQueue counts pending and separates blocked (needs-attention) entries", () => {
    const pending = entry("checkmark");
    const blocked = entry("undo", { blocked: { reason: "cross_actor_undo", note: "held for staff" } });
    const summary = summarizeFwQueue([pending, blocked]);
    expect(summary.queuedCount).toBe(1);
    expect(summary.attention).toEqual([{ id: blocked.id, note: "held for staff" }]);
  });
});

/* ═══════════════════════════════════ the SW app-shell scope (Decision 15) ══ */

describe("isFwAppShellPath — the never-cache-navigations exception is scoped", () => {
  it("a FW guide route is cacheable", () => {
    expect(isFwAppShellPath("/path/fw")).toBe(true);
    expect(isFwAppShellPath("/path/fw/cohort/abc")).toBe(true);
    expect(isFwAppShellPath("/path/fw/cohort/abc/student/xyz/task/1.2.4")).toBe(true);
    expect(isFwAppShellPath("/path/fw/ops")).toBe(true);
  });

  it("the board token subtree is EXCLUDED (a live no-store poll surface)", () => {
    // MUTATION GUARD (delete class): dropping the board exclusion would cache a
    // token URL's shell — this reddens.
    expect(isFwAppShellPath("/path/fw/board")).toBe(false);
    expect(isFwAppShellPath("/path/fw/board/some-token")).toBe(false);
    expect(isFwAppShellPath("/path/fw/board/some-token/feed")).toBe(false);
  });

  it("a PATH navigation is never cacheable (the pin holds outside /path/fw)", () => {
    // MUTATION GUARD (substitute class): a predicate relaxed to accept /path would
    // cache Path navigations — the invariant this exception must not break.
    expect(isFwAppShellPath("/path")).toBe(false);
    expect(isFwAppShellPath("/path/sign-in")).toBe(false);
    expect(isFwAppShellPath("/path/fworks")).toBe(false); // prefix must be a segment boundary
    expect(isFwAppShellPath("/")).toBe(false);
  });
});
