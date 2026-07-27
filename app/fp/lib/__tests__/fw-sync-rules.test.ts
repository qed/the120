import { describe, expect, it } from "vitest";

import {
  applyFwDrainOutcome,
  classifyFwSignOutQueue,
  countFwSignOutBlockers,
  decideFwSignOut,
  evaluateFwSameActorGuard,
  fwEntryBlocksSignOutClear,
  fwSignOutOutcomeCopy,
  fwSignOutRefusalCopy,
  fwResidueFullyCleared,
  decideFwCacheOwnerAction,
  hasFwDeviceEvidence,
  shouldClearFwCaches,
  projectFwPendingState,
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
  type FwDeviceEvidence,
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
  // A monotonic, always-valid stamp: base time + seq seconds. (Encoding seq as
  // minutes overflowed to an invalid time once the suite grew past 59 entries.)
  const stamp = new Date(Date.UTC(2026, 7, 21, 14, 0, 0) + seq * 1000).toISOString();
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

  it("CONSECUTIVE surviving undos COLLAPSE to one (idempotent — no unguarded trailing undo)", () => {
    // MUTATION GUARD (the adversarial residual): two raw back-to-back undos must not
    // both survive — only the leading undo is guarded by planFwStudentTask, so a
    // surviving trailing undo could revert a concurrent cross-actor decision with no
    // author check. At most one surviving undo reaches the pre-outage state.
    expect(actions(reduceFwOps([entry("undo"), entry("undo")]))).toEqual(["undo"]);
    expect(actions(reduceFwOps([entry("undo"), entry("undo"), entry("undo")]))).toEqual(["undo"]);
    // A decision after the collapsed undos still survives in order.
    expect(actions(reduceFwOps([entry("undo"), entry("undo"), entry("checkmark")]))).toEqual([
      "undo",
      "checkmark",
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

/* ══════════════════════════════════ pending-state projection (stale shell) ══ */

describe("projectFwPendingState — a revisit reflects the guide's own queued taps", () => {
  it("no pending ops → the server state, unchanged", () => {
    expect(projectFwPendingState("locked", [])).toBe("locked");
  });

  it("a pending checkmark on a stale-`locked` server state projects `verified` (so Undo shows)", () => {
    expect(projectFwPendingState("locked", [entry("checkmark")])).toBe("verified");
  });

  it("a pending checkmark+undo pair projects back to the server state (they cancel)", () => {
    expect(projectFwPendingState("locked", [entry("checkmark"), entry("undo")])).toBe("locked");
  });

  it("a leading undo is NOT projected (author-blind — a cross-actor undo would mislead)", () => {
    // Conservative: a reduced sequence starting with an undo shows the server state
    // unchanged, so the guide can't layer a fresh decision onto a wrongly-reverted
    // display and lose it to the same-actor guard's reject (adversarial re-review).
    expect(projectFwPendingState("verified", [entry("undo")])).toBe("verified");
    expect(projectFwPendingState("verified", [entry("undo"), entry("not_yet")])).toBe("verified");
  });

  it("an illegal pending op leaves the state where the decision table would (no second machine)", () => {
    // not_yet onto verified is refused by the table → no projection change.
    expect(projectFwPendingState("verified", [entry("not_yet")])).toBe("verified");
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

/**
 * ONE classifier, read by BOTH the verdict and the destructive clear.
 *
 * The regression this pins: the verdict counted only `drainable` while the clear
 * counted EVERYTHING (a bare `store.count()`), so a device holding exactly one
 * blocked or one foreign entry was told sign-out was allowed and then told a
 * check-in had raced in — forever, with no surface to act on. Every assertion below
 * that pairs `decideFwSignOut` with `fwEntryBlocksSignOutClear` is a check/act
 * agreement test: if the two ever diverge again, the pair reddens.
 */
describe("classifyFwSignOutQueue — the single sign-out partition", () => {
  const quarantineRecord = { id: "q-1", schemaVersion: 99, blocked: null };

  it("partitions own/foreign × drainable/blocked, and surfaces unrecognized records", () => {
    const ownDrainable = entry("checkmark");
    const ownBlocked = entry("checkmark", { blocked: { reason: "guard_refused", note: "n" } });
    const foreignDrainable = entry("checkmark", { actorUserId: OTHER_GUIDE });
    const foreignBlocked = entry("not_yet", {
      actorUserId: OTHER_GUIDE,
      blocked: { reason: "cross_actor_undo", note: "n" },
    });

    const c = classifyFwSignOutQueue(
      [ownDrainable, ownBlocked, foreignDrainable, foreignBlocked, quarantineRecord],
      GUIDE
    );

    expect(c.drainable.map((e) => e.id)).toEqual([ownDrainable.id]);
    expect(c.ownBlocked.map((e) => e.id)).toEqual([ownBlocked.id]);
    expect(c.foreignUndrained.map((e) => e.id)).toEqual([foreignDrainable.id]);
    expect(c.foreignBlocked.map((e) => e.id)).toEqual([foreignBlocked.id]);
    expect(c.quarantined).toEqual([{ id: "q-1", note: expect.any(String) }]);
  });

  it("only drainable, quarantined and foreign-UNDRAINED records block the clear", () => {
    // The check/act contract in one table. A blocked entry (own or foreign) already
    // has an authoritative `path_fw_replay_rejects` row server-side, so destroying
    // the local tombstone loses a note, not a child's check-in.
    const rows: [unknown, boolean][] = [
      [entry("checkmark"), true],
      [entry("checkmark", { blocked: { reason: "guard_refused", note: "n" } }), false],
      [entry("checkmark", { actorUserId: OTHER_GUIDE }), true],
      [
        entry("undo", {
          actorUserId: OTHER_GUIDE,
          blocked: { reason: "cross_actor_undo", note: "n" },
        }),
        false,
      ],
      [quarantineRecord, true],
    ];
    for (const [raw, blocks] of rows) {
      expect(fwEntryBlocksSignOutClear(raw, GUIDE)).toBe(blocks);
    }
  });

  it("the per-record predicate and the whole-queue blocker count are the SAME function", () => {
    // BY CONSTRUCTION, not by coincidence: the count over a queue must equal the
    // number of records the clear's predicate rejects, or check and act disagree
    // again. This is the mutation guard for the whole unit.
    const queue: unknown[] = [
      entry("checkmark"),
      entry("checkmark", { blocked: { reason: "guard_refused", note: "n" } }),
      entry("not_yet", { actorUserId: OTHER_GUIDE }),
      entry("undo", { actorUserId: OTHER_GUIDE, blocked: { reason: "guard_refused", note: "n" } }),
      quarantineRecord,
    ];
    const perRecord = queue.filter((raw) => fwEntryBlocksSignOutClear(raw, GUIDE)).length;
    expect(countFwSignOutBlockers(classifyFwSignOutQueue(queue, GUIDE))).toBe(perRecord);
    expect(perRecord).toBe(3);
  });

  it("an unrecognized record with no usable id neither surfaces nor blocks (nothing to preserve)", () => {
    expect(classifyFwSignOutQueue([{ nope: true }], GUIDE).quarantined).toEqual([]);
    expect(fwEntryBlocksSignOutClear({ nope: true }, GUIDE)).toBe(false);
  });
});

describe("decideFwSignOut — block-until-drained (Decision 8 / gap G1)", () => {
  const classify = (raw: unknown[]) => classifyFwSignOutQueue(raw, GUIDE);
  const blocked = (over: Partial<FwQueueEntry> = {}) =>
    entry("checkmark", { blocked: { reason: "guard_refused", note: "n" }, ...over });

  it("an empty queue allows sign-out (clear the residue)", () => {
    expect(decideFwSignOut({ queue: classify([]), online: false })).toEqual({ ok: true });
    expect(decideFwSignOut({ queue: classify([]), online: true })).toEqual({ ok: true });
  });

  it("a queue of ONLY blocked entries allows sign-out — and the clear agrees", () => {
    // THE PRIMARY REGRESSION. One blocked entry used to produce ok:true from the
    // verdict and cleared:false from the clear, wedging the device forever.
    const only = blocked();
    expect(decideFwSignOut({ queue: classify([only]), online: true })).toEqual({ ok: true });
    expect(fwEntryBlocksSignOutClear(only, GUIDE)).toBe(false);
  });

  it("a FOREIGN blocked entry allows sign-out — and the clear agrees", () => {
    const foreign = blocked({ actorUserId: OTHER_GUIDE });
    expect(decideFwSignOut({ queue: classify([foreign]), online: true })).toEqual({ ok: true });
    expect(fwEntryBlocksSignOutClear(foreign, GUIDE)).toBe(false);
  });

  it("a foreign UNDRAINED entry REFUSES — this session can never send another account's work", () => {
    const foreign = entry("checkmark", { actorUserId: OTHER_GUIDE });
    expect(decideFwSignOut({ queue: classify([foreign]), online: true })).toEqual({
      ok: false,
      reason: "foreign_queue",
      queuedCount: 1,
    });
    // ...and it must survive the clear, or the refusal would be destroying the very
    // captures it exists to protect.
    expect(fwEntryBlocksSignOutClear(foreign, GUIDE)).toBe(true);
  });

  it("a foreign undrained entry outranks this guide's own drainable work", () => {
    // No drain under THIS session can ship the other account's tap, so naming the
    // drain first would send the guide round a loop that cannot close.
    const queue = classify([entry("checkmark"), entry("not_yet", { actorUserId: OTHER_GUIDE })]);
    expect(decideFwSignOut({ queue, online: true })).toEqual({
      ok: false,
      reason: "foreign_queue",
      queuedCount: 1,
    });
  });

  it("sign-out with 3 queued items OFFLINE is REFUSED with the count", () => {
    // MUTATION GUARD (the plan's named row): a verdict that returned ok:true here
    // would let a 20-minute outage's captures evaporate on sign-out — the exact
    // permanent-loss failure Decision 8 exists to prevent.
    const queue = classify([entry("checkmark"), entry("checkmark"), entry("not_yet")]);
    expect(decideFwSignOut({ queue, online: false })).toEqual({
      ok: false,
      reason: "queued_offline",
      queuedCount: 3,
    });
  });

  it("sign-out with queued items ONLINE says drain first (the drain can run)", () => {
    const queue = classify([entry("checkmark"), entry("checkmark"), entry("not_yet")]);
    expect(decideFwSignOut({ queue, online: true })).toEqual({
      ok: false,
      reason: "drain_first",
      queuedCount: 3,
    });
  });

  it("queued items that SURVIVED a waited drain escalate to drain_stalled (captive portal)", () => {
    // `navigator.onLine` is true on a hotel/venue captive portal, so `drain_first`
    // would repeat "still sending — try again in a moment" indefinitely against a
    // network that will never answer. Once a drain has run and changed nothing, the
    // verdict must say something DIFFERENT and actionable.
    const queue = classify([entry("checkmark")]);
    expect(decideFwSignOut({ queue, online: true, drainAttempted: true })).toEqual({
      ok: false,
      reason: "drain_stalled",
      queuedCount: 1,
    });
  });

  it("an expired session refuses with session_expired rather than looping on drain_first", () => {
    // A drain that returned `no_session` sets the client's auth-required flag; without
    // this branch the verdict returns drain_first forever while the copy claims the
    // check-ins are "still sending."
    const queue = classify([entry("checkmark")]);
    expect(decideFwSignOut({ queue, online: true, authRequired: true })).toEqual({
      ok: false,
      reason: "session_expired",
      queuedCount: 1,
    });
    expect(
      decideFwSignOut({ queue, online: true, authRequired: true, drainAttempted: true })
    ).toEqual({ ok: false, reason: "session_expired", queuedCount: 1 });
  });

  it("OFFLINE outranks an expired session (re-authenticating is impossible offline)", () => {
    const queue = classify([entry("checkmark")]);
    expect(decideFwSignOut({ queue, online: false, authRequired: true })).toEqual({
      ok: false,
      reason: "queued_offline",
      queuedCount: 1,
    });
  });

  it("sign-out with only QUARANTINED entries is refused needs_attention (never silently wiped)", () => {
    // kieran-typescript / reliability review: a shape this build can't drain is an
    // un-landed capture; sign-out must surface it for dismissal, not destroy it.
    const queue = classify([
      { id: "q-1", schemaVersion: 99 },
      { id: "q-2", schemaVersion: 99 },
    ]);
    expect(decideFwSignOut({ queue, online: true })).toEqual({
      ok: false,
      reason: "needs_attention",
      queuedCount: 2,
    });
  });

  it("drainable entries take precedence over quarantined in the verdict", () => {
    const queue = classify([entry("checkmark"), { id: "q-1", schemaVersion: 99 }]);
    expect(decideFwSignOut({ queue, online: false })).toEqual({
      ok: false,
      reason: "queued_offline",
      queuedCount: 1,
    });
  });

  it("blocked entries never inflate a refusal's count", () => {
    const queue = classify([entry("checkmark"), blocked(), blocked()]);
    expect(decideFwSignOut({ queue, online: false })).toEqual({
      ok: false,
      reason: "queued_offline",
      queuedCount: 1,
    });
  });
});

describe("fwSignOutRefusalCopy — every refusal names an action the guide can take", () => {
  it("names re-authentication when the session expired", () => {
    // The plan asks for the STRING: the old copy said "still sending", which is a
    // lie the guide cannot act on.
    const copy = fwSignOutRefusalCopy("session_expired", 1);
    expect(copy).toMatch(/sign in again/i);
    expect(copy).not.toMatch(/still sending/i);
  });

  it("names the other ACCOUNT when foreign work is on the device", () => {
    const copy = fwSignOutRefusalCopy("foreign_queue", 2);
    expect(copy).toMatch(/another account/i);
    expect(copy).toContain("2");
  });

  it("escalates when a drain already ran and changed nothing", () => {
    const first = fwSignOutRefusalCopy("drain_first", 1);
    const stalled = fwSignOutRefusalCopy("drain_stalled", 1);
    expect(stalled).not.toEqual(first);
    // "try again in a moment" is precisely the loop the captive portal never exits.
    expect(stalled).not.toMatch(/try again in a moment/i);
    expect(stalled).toMatch(/wi-?fi|network|connect/i);
  });

  it("names STAYING SIGNED IN when the device is offline with its own work", () => {
    // The action is "keep the device"; a copy edit that drops it leaves a guide
    // who has been refused with no idea what to do next.
    const copy = fwSignOutRefusalCopy("queued_offline", 1);
    expect(copy).toMatch(/stay signed in/i);
    expect(copy).toMatch(/automatically/i);
  });

  it("names WAITING while its own work is still sending", () => {
    const copy = fwSignOutRefusalCopy("drain_first", 2);
    expect(copy).toMatch(/still sending/i);
    expect(copy).toMatch(/try again/i);
  });

  it("names the DISMISS control for quarantined records", () => {
    // The one refusal whose action lives on another surface: the banner is
    // rendered by FwPwa across the /fp/fw (app) group. Mounting the sign-out
    // control outside that group makes this sentence unactionable, so pin the
    // wording that ties it to the banner.
    const copy = fwSignOutRefusalCopy("needs_attention", 1);
    expect(copy).toMatch(/dismiss/i);
    expect(copy).toMatch(/banner/i);
  });

  it("agrees with itself on singular/plural for every reason", () => {
    const reasons = [
      "queued_offline",
      "drain_first",
      "drain_stalled",
      "needs_attention",
      "foreign_queue",
      "session_expired",
      "unreadable",
    ] as const;
    for (const reason of reasons) {
      expect(fwSignOutRefusalCopy(reason, 1)).not.toMatch(/\b1 check-ins\b/);
      expect(fwSignOutRefusalCopy(reason, 2)).not.toMatch(/\b2 check-in\b/);
    }
  });

  it("maps every outcome the flow can return to copy (or to silence on success)", () => {
    expect(fwSignOutOutcomeCopy({ kind: "sign_out" })).toBeNull();
    expect(fwSignOutOutcomeCopy({ kind: "raced" })).toMatch(/just came in/i);
    expect(
      fwSignOutOutcomeCopy({
        kind: "refused",
        verdict: { ok: false, reason: "unreadable", queuedCount: 0 },
      })
    ).toMatch(/try again/i);
  });

  it("B3: clear_failed says the session is STILL OPEN and names the remedy", () => {
    // The failure this replaces was reported to the guide as a successful sign-out.
    // The copy has to contradict that belief explicitly, because the guide is about to
    // hand the device to someone else.
    const copy = fwSignOutOutcomeCopy({ kind: "clear_failed" }) ?? "";
    expect(copy).toMatch(/still signed in/i);
    expect(copy).toMatch(/site data/i);
    expect(copy).not.toMatch(/signed out|success/i);
  });

  it("needs_attention names the BANNER on /fp/fw and Founders Weekend everywhere else", () => {
    // Unit 1 left this open on purpose and named it: the dismiss control is the
    // queued-indicator banner, which `FwPwa` renders on `/fp/fw` only. The staff bar
    // is what puts this refusal on `/staff` and `/crm`, so it is the unit that owes
    // the fix.
    expect(fwSignOutRefusalCopy("needs_attention", 2, "fw")).toMatch(/in the banner/i);

    const elsewhere = fwSignOutRefusalCopy("needs_attention", 2, "elsewhere");
    expect(elsewhere).not.toMatch(/banner/i);
    expect(elsewhere).toMatch(/founders weekend/i);
    expect(elsewhere).toMatch(/\b2 saved check-ins\b/);
  });

  it("every OTHER reason reads identically on both surfaces — only that one moved", () => {
    const reasons = [
      "queued_offline",
      "drain_first",
      "drain_stalled",
      "session_expired",
      "foreign_queue",
      "unreadable",
    ] as const;
    for (const reason of reasons) {
      expect(fwSignOutRefusalCopy(reason, 2, "elsewhere")).toBe(
        fwSignOutRefusalCopy(reason, 2, "fw")
      );
    }
  });

  it("the surface variant is pluralized too", () => {
    expect(fwSignOutRefusalCopy("needs_attention", 1, "elsewhere")).not.toMatch(
      /\b1 saved check-ins\b/
    );
    expect(fwSignOutRefusalCopy("needs_attention", 2, "elsewhere")).not.toMatch(
      /\b2 saved check-in\b/
    );
  });
});

describe("hasFwDeviceEvidence — never CREATE a queue db on a browser that never ran FW", () => {
  /** Every field explicit: this gate's whole failure mode is a field being absent and
   *  reading as "nothing here", so no helper is allowed to default one in. */
  const read = (over: {
    cacheOwner?: string | null;
    queueDbOpened?: boolean;
    queueDbExists?: boolean | null;
  }): FwDeviceEvidence => ({
    kind: "read",
    cacheOwner: over.cacheOwner ?? null,
    queueDbOpened: over.queueDbOpened ?? false,
    queueDbExists: over.queueDbExists ?? null,
  });

  it("B1: a SERVER-KNOWN guide is checked whatever the device's storage says", () => {
    // The blocker. `cacheOwner === null && !queueDbOpened` is exactly what a fresh
    // document on a device whose localStorage was evicted looks like — and also
    // exactly what a device holding three undrained check-ins looks like. The two are
    // indistinguishable from the client, so the answer comes from the server.
    expect(
      hasFwDeviceEvidence({
        evidence: read({ cacheOwner: null, queueDbOpened: false, queueDbExists: null }),
        actorIsFwGuide: true,
      })
    ).toBe(true);
  });

  it("B1: …and it outranks even a negative database probe read", () => {
    expect(
      hasFwDeviceEvidence({ evidence: read({ queueDbExists: false }), actorIsFwGuide: true })
    ).toBe(true);
  });

  it("a non-guide with the SAME evidence still skips — the server signal is a real branch", () => {
    // Deleting `actorIsFwGuide` must redden something. This is the pair that makes it
    // do so: identical evidence, opposite answers, and the ONLY difference is the
    // server's. (Unit 2's headline finding: a branch that returns what its fallback
    // returns has no behavioural signature.)
    expect(
      hasFwDeviceEvidence({
        evidence: read({ cacheOwner: null, queueDbOpened: false, queueDbExists: null }),
        actorIsFwGuide: false,
      })
    ).toBe(false);
  });

  it("an evidence read that THREW fails CLOSED — unknown is not proof of absence", () => {
    // Safari's storage policy can throw on localStorage. "I could not look" must
    // never be treated as "there is nothing here" — that is how a queue gets wiped.
    expect(hasFwDeviceEvidence({ evidence: { kind: "unknown" }, actorIsFwGuide: false })).toBe(true);
  });

  it("the database probe is AUTHORITATIVE when it answered, in both directions", () => {
    // It exists → opening it creates nothing, so checking is free.
    expect(
      hasFwDeviceEvidence({ evidence: read({ queueDbExists: true }), actorIsFwGuide: false })
    ).toBe(true);
    // It does not exist → there is definitionally no queue, and opening would CREATE
    // the database this gate exists to keep off a CRM-only staff member's browser.
    expect(
      hasFwDeviceEvidence({ evidence: read({ queueDbExists: false }), actorIsFwGuide: false })
    ).toBe(false);
  });

  it("the probe overrides the stale localStorage heuristic when the two disagree", () => {
    // A signed-out guide's `fw.cacheOwner` can outlive the database. The old gate
    // would have opened IndexedDB on the strength of a key naming nobody.
    expect(
      hasFwDeviceEvidence({
        evidence: read({ cacheOwner: GUIDE, queueDbOpened: true, queueDbExists: false }),
        actorIsFwGuide: false,
      })
    ).toBe(false);
  });

  it("with no probe available the legacy heuristic still answers — either signal alone", () => {
    // Pre-2024 browsers have no `indexedDB.databases()`. The heuristic is unsound
    // (that is B1) but it is bounded to non-guides on those browsers, and it is
    // strictly better than nothing there.
    expect(
      hasFwDeviceEvidence({
        evidence: read({ cacheOwner: GUIDE, queueDbExists: null }),
        actorIsFwGuide: false,
      })
    ).toBe(true);
    expect(
      hasFwDeviceEvidence({
        evidence: read({ queueDbOpened: true, queueDbExists: null }),
        actorIsFwGuide: false,
      })
    ).toBe(true);
  });
});

/* ═══════════════════════════════ residue clearing (Unit 3, B2 + B3) ══ */

describe("fwResidueFullyCleared — the queue step is NOT the whole answer (B3)", () => {
  it("all three cleared is the only success", () => {
    expect(
      fwResidueFullyCleared({ queueCleared: true, rosterCleared: true, shellCleared: true })
    ).toBe(true);
  });

  it("a surviving ROSTER cache is a failure — it holds children's first and last names", () => {
    expect(
      fwResidueFullyCleared({ queueCleared: true, rosterCleared: false, shellCleared: true })
    ).toBe(false);
  });

  it("a surviving SHELL cache is a failure — it holds the authenticated roster HTML", () => {
    expect(
      fwResidueFullyCleared({ queueCleared: true, rosterCleared: true, shellCleared: false })
    ).toBe(false);
  });

  it("a surviving queue is a failure too", () => {
    expect(
      fwResidueFullyCleared({ queueCleared: false, rosterCleared: true, shellCleared: true })
    ).toBe(false);
  });
});

describe("shouldClearFwCaches — the two callers want opposite things on a stuck queue", () => {
  it("sign-out keeps all three together, so an aborted sign-out leaves no degraded shell", () => {
    expect(shouldClearFwCaches("sign_out", false)).toBe(false);
    expect(shouldClearFwCaches("sign_out", true)).toBe(true);
  });

  it("a handover clears the caches whatever the queue did — they are the PRIOR account's", () => {
    expect(shouldClearFwCaches("handover", false)).toBe(true);
    expect(shouldClearFwCaches("handover", true)).toBe(true);
  });
});

describe("decideFwCacheOwnerAction — who may claim the fw.cacheOwner key", () => {
  it("the same account is a no-op", () => {
    expect(
      decideFwCacheOwnerAction({ prior: GUIDE, actorUserId: GUIDE, surfaceCreatesResidue: true })
    ).toBe("none");
  });

  it("a different account is a reconcile, on any surface", () => {
    expect(
      decideFwCacheOwnerAction({ prior: OTHER_GUIDE, actorUserId: GUIDE, surfaceCreatesResidue: true })
    ).toBe("reconcile");
    expect(
      decideFwCacheOwnerAction({ prior: OTHER_GUIDE, actorUserId: GUIDE, surfaceCreatesResidue: false })
    ).toBe("reconcile");
  });

  it("an unclaimed key is adopted on an FW surface", () => {
    expect(
      decideFwCacheOwnerAction({ prior: null, actorUserId: GUIDE, surfaceCreatesResidue: true })
    ).toBe("adopt");
  });

  it("…but NOT on /crm or /staff — the bar must not manufacture the evidence it reads", () => {
    // The key is an input to `hasFwDeviceEvidence`'s legacy branch. A bar that wrote
    // it on a browser which has never run Founders Weekend would mark that browser as
    // holding FW residue and then trust its own mark.
    expect(
      decideFwCacheOwnerAction({ prior: null, actorUserId: GUIDE, surfaceCreatesResidue: false })
    ).toBe("none");
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

  it("a malformed lastAttemptAt is not recognized (the predicate guards EVERY field)", () => {
    // api-contract review: the predicate claims `x is FwQueueEntry`, and the server's
    // zod requires lastAttemptAt — a client-recognized entry that skipped it would
    // stall the whole drain batch. undefined (not string|null) must fail.
    expect(isRecognizedFwEntry({ ...entry("checkmark"), lastAttemptAt: undefined })).toBe(false);
    expect(isRecognizedFwEntry({ ...entry("checkmark"), lastAttemptAt: 123 })).toBe(false);
    expect(isRecognizedFwEntry({ ...entry("checkmark"), lastAttemptAt: null })).toBe(true);
  });

  it("a malformed blocked field is not recognized (a blank staff note otherwise)", () => {
    expect(isRecognizedFwEntry({ ...entry("checkmark"), blocked: {} })).toBe(false);
    expect(isRecognizedFwEntry({ ...entry("checkmark"), blocked: { reason: "x" } })).toBe(false);
    expect(
      isRecognizedFwEntry({ ...entry("checkmark"), blocked: { reason: "guard_refused", note: "n" } })
    ).toBe(true);
  });
});

/* ═══════════════════════════════════════════ the client apply-outcome mutation ══ */

describe("applyFwDrainOutcome — the outcome → IndexedDB mutation (exhaustive)", () => {
  const NOW_ISO = "2026-08-22T15:00:00.000Z";
  const e = entry("checkmark", { attempts: 2 });

  it("a settled outcome deletes the entry", () => {
    expect(
      applyFwDrainOutcome(e, { entryId: e.id, clientId: e.clientId, disposition: "settled" }, NOW_ISO)
    ).toEqual({ op: "delete" });
  });

  it("a rejected outcome tombstones the entry with the note", () => {
    const m = applyFwDrainOutcome(
      e,
      { entryId: e.id, clientId: e.clientId, disposition: "rejected", reason: "cross_actor_undo", note: "held" },
      NOW_ISO
    );
    expect(m).toEqual({ op: "put", entry: { ...e, blocked: { reason: "cross_actor_undo", note: "held" } } });
  });

  it("a retry outcome advances attempts and stamps the time", () => {
    const m = applyFwDrainOutcome(e, { entryId: e.id, clientId: e.clientId, disposition: "retry" }, NOW_ISO);
    expect(m).toEqual({ op: "put", entry: { ...e, attempts: 3, lastAttemptAt: NOW_ISO } });
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
    expect(isFwAppShellPath("/fp/fw")).toBe(true);
    expect(isFwAppShellPath("/fp/fw/cohort/abc")).toBe(true);
    expect(isFwAppShellPath("/fp/fw/cohort/abc/student/xyz/task/1.2.4")).toBe(true);
    expect(isFwAppShellPath("/fp/fw/sign-in")).toBe(true);
  });

  it("the board token subtree is EXCLUDED (a live no-store poll surface)", () => {
    // MUTATION GUARD (delete class): dropping the board exclusion would cache a
    // token URL's shell — this reddens.
    expect(isFwAppShellPath("/fp/fw/board")).toBe(false);
    expect(isFwAppShellPath("/fp/fw/board/some-token")).toBe(false);
    expect(isFwAppShellPath("/fp/fw/board/some-token/feed")).toBe(false);
  });

  it("the staff ops subtree is EXCLUDED (cross-cohort authed HTML, never the offline target)", () => {
    // Security review: staff ops pages must not be cached on a shared iPad.
    expect(isFwAppShellPath("/fp/fw/ops")).toBe(false);
    expect(isFwAppShellPath("/fp/fw/ops/cohort/abc")).toBe(false);
    expect(isFwAppShellPath("/fp/fw/ops/cohort/abc/import")).toBe(false);
  });

  it("a PATH navigation is never cacheable (the pin holds outside /fp/fw)", () => {
    // MUTATION GUARD (substitute class): a predicate relaxed to accept a non-FW
    // /fp path would cache main-app navigations — the invariant this exception must not break.
    expect(isFwAppShellPath("/fp")).toBe(false);
    expect(isFwAppShellPath("/fp/sign-in")).toBe(false);
    expect(isFwAppShellPath("/fp/fworks")).toBe(false); // prefix must be a segment boundary
    expect(isFwAppShellPath("/")).toBe(false);
  });
});
