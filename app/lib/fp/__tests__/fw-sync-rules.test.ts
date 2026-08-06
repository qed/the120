import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  applyFwDrainOutcome,
  classifyFwSignOutQueue,
  countFwSignOutBlockers,
  decideFwSignOut,
  evaluateFwSameActorGuard,
  fwEntryClearDisposition,
  fwResidueBeacon,
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
  runFwSignOutFlow,
  selectFwDrainable,
  summarizeFwQueue,
  type FwDeviceEvidence,
  type FwQueueEntry,
  type FwSignOutRefusal,
  type FwRosterCache,
  type FwServerRow,
  createFwEnqueueClock,
  fwFlipLeg1Verdict,
  fwPendingMarker,
  planFwFlipEntries,
  type FwFlipLeg,
} from "../fw-sync-rules";
import { createFwClientIdLedger, fwTapKey, type FwStudentResult } from "../fw-rules";
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

  it("gives every record exactly one clear disposition: abort, preserve, or remove", () => {
    // The check/act contract in one table, and the THREE-way split Staff Front Door
    // Unit 4 introduced. It used to be two-way ("blocks the clear" / "does not"),
    // which forced one value to answer two different questions:
    //
    //   abort    — THIS account's un-landed work, plus anything unrecognized. Its
    //              presence means the destructive clear must not run at all, because a
    //              tap may have raced in since the verdict.
    //   preserve — ANOTHER account's un-landed work. Never destroyed, and (Unit 4)
    //              never a reason to refuse this account's sign-out either: no drain,
    //              reconnect or re-auth by this session can ever ship it, so refusing
    //              stranded a staff member on a shared iPad over someone else's queue.
    //   remove   — already-rejected tombstones, own or foreign. Their authoritative
    //              `path_fw_replay_rejects` row is server-side, so destroying the local
    //              copy loses a note, not a child's check-in.
    const rows: [string, unknown, "abort" | "preserve" | "remove"][] = [
      ["own drainable", entry("checkmark"), "abort"],
      ["own blocked", entry("checkmark", { blocked: { reason: "guard_refused", note: "n" } }), "remove"],
      ["foreign undrained", entry("checkmark", { actorUserId: OTHER_GUIDE }), "preserve"],
      [
        "foreign blocked",
        entry("undo", {
          actorUserId: OTHER_GUIDE,
          blocked: { reason: "cross_actor_undo", note: "n" },
        }),
        "remove",
      ],
      // Unit 5: was "abort". A record this build cannot read has no readable
      // `actorUserId`, so Unit 4's scope-it-to-the-actor remedy is inapplicable, not
      // merely incomplete — it refused whoever happened to be holding the device.
      // PRESERVE, not remove: they stop blocking, they do not stop mattering.
      ["quarantined", quarantineRecord, "preserve"],
    ];
    for (const [label, raw, disposition] of rows) {
      expect(fwEntryClearDisposition(raw, GUIDE), label).toBe(disposition);
    }
  });

  it("the per-record disposition and the whole-queue blocker count are the SAME function", () => {
    // BY CONSTRUCTION, not by coincidence: the count over a queue must equal the
    // number of records whose disposition is `abort`, or check and act disagree
    // again. This is the mutation guard for the whole unit, and it is what stops the
    // Unit 4 split from being made in one place and not the other.
    const queue: unknown[] = [
      entry("checkmark"),
      entry("checkmark", { blocked: { reason: "guard_refused", note: "n" } }),
      entry("not_yet", { actorUserId: OTHER_GUIDE }),
      entry("undo", { actorUserId: OTHER_GUIDE, blocked: { reason: "guard_refused", note: "n" } }),
      quarantineRecord,
    ];
    const aborts = queue.filter((raw) => fwEntryClearDisposition(raw, GUIDE) === "abort").length;
    expect(countFwSignOutBlockers(classifyFwSignOutQueue(queue, GUIDE))).toBe(aborts);
    // Unit 5: ONE. Own drainable only — not the foreign entry (Unit 4) and no longer
    // the quarantined record either. Both are `preserve`, and the equality asserted
    // above is what stops the count and the clear drifting apart as each was removed.
    expect(aborts).toBe(1);
  });

  it("counts foreign undrained work separately — preserved, never a blocker", () => {
    // The number that must NOT be folded back into `countFwSignOutBlockers`. Folding
    // them is what made a departed guide's queue refuse an unrelated account's
    // sign-out; keeping them counted separately is what still stops the clear
    // destroying them.
    const queue = classifyFwSignOutQueue(
      [entry("checkmark"), entry("not_yet", { actorUserId: OTHER_GUIDE })],
      GUIDE
    );
    expect(countFwSignOutBlockers(queue)).toBe(1);
    expect(queue.foreignUndrained).toHaveLength(1);
  });

  it("an unrecognized record with no usable id neither surfaces nor aborts (nothing to preserve)", () => {
    expect(classifyFwSignOutQueue([{ nope: true }], GUIDE).quarantined).toEqual([]);
    expect(fwEntryClearDisposition({ nope: true }, GUIDE)).toBe("remove");
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
    expect(fwEntryClearDisposition(only, GUIDE)).toBe("remove");
  });

  it("a FOREIGN blocked entry allows sign-out — and the clear removes it", () => {
    const foreign = blocked({ actorUserId: OTHER_GUIDE });
    expect(decideFwSignOut({ queue: classify([foreign]), online: true })).toEqual({ ok: true });
    expect(fwEntryClearDisposition(foreign, GUIDE)).toBe("remove");
  });

  it("R16: a foreign UNDRAINED entry ALLOWS sign-out — and is preserved, not destroyed", () => {
    // THE UNIT 4 CHANGE, and it is a requirement-conformance fix rather than a
    // preference. R16 scopes the constraint to "undrained captures FOR THE SIGNING-OUT
    // ACCOUNT". Refusing here exceeded that: a guide who walked off without signing
    // out could leave a shared iPad on which nobody else could ever end their session,
    // with the remedy — "that guide has to come back and sign in" — entirely outside
    // the refused person's control. Nothing is at risk in allowing it, because the
    // preserved disposition below is what keeps the other account's work alive; the
    // refusal was never the thing protecting it.
    const foreign = entry("checkmark", { actorUserId: OTHER_GUIDE });
    expect(decideFwSignOut({ queue: classify([foreign]), online: true })).toEqual({ ok: true });
    expect(decideFwSignOut({ queue: classify([foreign]), online: false })).toEqual({ ok: true });
    expect(fwEntryClearDisposition(foreign, GUIDE)).toBe("preserve");
  });

  it("this guide's OWN drainable work still governs, foreign entries alongside it or not", () => {
    // The foreign entry used to outrank the guide's own queue and answer for it. Now
    // it is simply not consulted — so the verdict, and its COUNT, describe only work
    // this session can actually do something about.
    const queue = classify([entry("checkmark"), entry("not_yet", { actorUserId: OTHER_GUIDE })]);
    expect(decideFwSignOut({ queue, online: true })).toEqual({
      ok: false,
      reason: "drain_first",
      queuedCount: 1,
    });
    expect(decideFwSignOut({ queue, online: false })).toEqual({
      ok: false,
      reason: "queued_offline",
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

  it("sign-out with only QUARANTINED entries is ALLOWED (Unit 5) — they refuse nobody", () => {
    // Peter, 2026-07-27. Unit 4 scoped the interlock to the signing-out account for
    // FOREIGN captures; a quarantined record cannot be scoped at all, because a record
    // this build cannot read has no readable `actorUserId`. So one corrupted record
    // left by a departed guide used to refuse an unrelated admissions staffer's
    // sign-out and tell them to open an app they have never used.
    const queue = classify([
      { id: "q-1", schemaVersion: 99 },
      { id: "q-2", schemaVersion: 99 },
    ]);
    expect(decideFwSignOut({ queue, online: true })).toEqual({ ok: true });
    // OFFLINE too — there is no branch where they come back as a blocker.
    expect(decideFwSignOut({ queue, online: false })).toEqual({ ok: true });
  });

  it("...and they are PRESERVED by the clear, never removed — the half that must not drift", () => {
    // THE MUTATION THIS KILLS is the one the change itself created. Before Unit 5 a
    // quarantined record reached `abort` through `countFwSignOutBlockers`. Dropping it
    // from that count without adding the explicit `preserve` branch would have let it
    // fall through to the `remove` tail — silently DESTROYING the one class of record
    // defined as "un-landed work this build cannot even read". Allowing sign-out over
    // them and keeping them are two separate claims; this is the second one.
    expect(fwEntryClearDisposition({ id: "q-1", schemaVersion: 99 }, GUIDE)).toBe("preserve");
    // And the count that feeds the chip still sees them, so the fact stays visible.
    const queue = classify([{ id: "q-1", schemaVersion: 99 }]);
    expect(queue.quarantined).toHaveLength(1);
    expect(countFwSignOutBlockers(queue)).toBe(0);
  });

  it("a quarantined record alongside a drainable one neither refuses nor inflates the count", () => {
    const queue = classify([entry("checkmark"), { id: "q-1", schemaVersion: 99 }]);
    // The refusal is entirely about the DRAINABLE entry, and the count says 1, not 2 —
    // a guide told "2 check-ins haven't sent yet" would wait for a second one that no
    // drain will ever ship.
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

/**
 * Every refusal reason, with COMPILE-TIME completeness.
 *
 * `satisfies Record<…>` makes a missing key and a stray key both type errors, so a
 * reason added later cannot quietly skip the pluralization and surface-parity sweeps
 * below — and a reason REMOVED (Unit 4 removed `foreign_queue`) cannot be left in the
 * list as a string literal that no longer means anything.
 */
const ALL_REFUSAL_REASONS = Object.keys({
  queued_offline: 0,
  drain_first: 0,
  drain_stalled: 0,
  session_expired: 0,
  unreadable: 0,
} satisfies Record<FwSignOutRefusal["reason"], number>) as FwSignOutRefusal["reason"][];

describe("fwSignOutRefusalCopy — every refusal names an action the guide can take", () => {
  it("names re-authentication when the session expired", () => {
    // The plan asks for the STRING: the old copy said "still sending", which is a
    // lie the guide cannot act on.
    const copy = fwSignOutRefusalCopy("session_expired", 1);
    expect(copy).toMatch(/sign in again/i);
    expect(copy).not.toMatch(/still sending/i);
  });

  it("R16: no refusal blames another account, because none is a refusal any more", () => {
    // `foreign_queue` was deleted from the union in Unit 4 rather than left unreachable
    // — an unreachable variant with copy behind it is the "inert defensive branch" that
    // survives review by looking defensive. The behavioural signature that it is gone:
    // no reason this function accepts can produce the sentence that stranded people.
    // (Its type-level removal is enforced separately: the switch is `default`-less, so
    // re-adding the member without copy is TS2366.)
    for (const reason of ALL_REFUSAL_REASONS) {
      expect(fwSignOutRefusalCopy(reason, 2), reason).not.toMatch(/another account/i);
    }
    // The device state itself is still surfaced — by the bar's queue chip, which
    // reports it without blocking anyone. That copy lives in `bar-rules.ts`.
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

  it("Unit 5: NO refusal sends the reader to another app or to a dismiss control", () => {
    // The `needs_attention` sentence is gone with its reason. It was the only copy in
    // this function that named a control on a surface the reader might not be on
    // ("Open Founders Weekend and dismiss them there"), and that unactionability is
    // exactly why the refusal was retired rather than reworded. Behavioural signature,
    // over the whole union — the type-level removal is enforced by the `satisfies`
    // above and by the `default`-less switch (TS2366).
    for (const reason of ALL_REFUSAL_REASONS) {
      const copy = fwSignOutRefusalCopy(reason, 2);
      expect(copy, reason).not.toMatch(/banner/i);
      expect(copy, reason).not.toMatch(/founders weekend/i);
      expect(copy, reason).not.toMatch(/dismiss/i);
    }
  });

  it("agrees with itself on singular/plural for every reason", () => {
    for (const reason of ALL_REFUSAL_REASONS) {
      expect(fwSignOutRefusalCopy(reason, 1)).not.toMatch(/\b1 check-ins\b/);
      expect(fwSignOutRefusalCopy(reason, 2)).not.toMatch(/\b2 check-in\b/);
    }
  });

  it("maps every outcome the flow can return to copy (or to silence on success)", () => {
    expect(fwSignOutOutcomeCopy({ kind: "sign_out", queueRemaining: 0 })).toBeNull();
    // …at ANY count: the leftover work is reported by the beacon, off-device, not by
    // a sentence blocking the person who was allowed to leave (Unit 6).
    expect(fwSignOutOutcomeCopy({ kind: "sign_out", queueRemaining: 3 })).toBeNull();
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

  it("Unit 5: the copy no longer varies by SURFACE, because nothing left varies", () => {
    // `fwSignOutRefusalCopy` took a third `surface` argument for exactly one reason:
    // `needs_attention` had to name a different control on `/fp/fw` than off it. With
    // that reason gone the parameter, the `FwSignOutSurface` type and
    // `staffBarSignOutSurface` were all deleted rather than left defaulted.
    //
    // NOT `Function.prototype.length` — that stops counting at the first defaulted
    // parameter, so `(reason, count, surface = "fw")` reports 2 and the deleted
    // parameter could return wearing a default (testing review). The SIGNATURE in
    // source is what is pinned: the parameter list between the declaration's parens
    // must contain exactly `reason` and `count`, nothing after.
    const rulesSource = readFileSync(
      new URL("../fw-sync-rules.ts", import.meta.url),
      "utf8"
    );
    const refusalSig = /export function fwSignOutRefusalCopy\(([^)]*)\)/.exec(rulesSource);
    expect(refusalSig).not.toBeNull();
    const params = (refusalSig?.[1] ?? "")
      .split(",")
      .map((p) => p.split(":")[0].trim())
      .filter(Boolean);
    expect(params).toEqual(["reason", "count"]);
    const outcomeSig = /export function fwSignOutOutcomeCopy\(([^)]*)\)/.exec(rulesSource);
    const outcomeParams = (outcomeSig?.[1] ?? "")
      .split(",")
      .map((p) => p.split(":")[0].trim())
      .filter(Boolean);
    expect(outcomeParams).toEqual(["outcome"]);
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

  it("Unit 4: a NEGATIVE database probe outranks the guide signal — the fact beats the guess", () => {
    // REVERSED FROM UNIT 3, deliberately, and this test is the record of why.
    //
    // Unit 3 checked `actorIsFwGuide` first. That was safe only while the value was a
    // SERVER-RENDERED PROP on `FwSignOutButton`, correct from first paint. Unit 4
    // deletes that component; the only sign-out left is the staff bar's, where the
    // value is `staffBarSignOutActorIsFwGuide(live)` — which fails CLOSED to `true`
    // while the identity round trip is in flight, and R23 keeps the button live
    // throughout. Checking the guess first therefore let a CRM-only staffer who tapped
    // sign-out early short-circuit past this probe into `openFwDb()`, CREATING the FW
    // queue database on a browser that had never run Founders Weekend — permanently,
    // since nothing deletes it and the probe then answers `true` forever after.
    //
    // Nothing is lost by the reversal: `queueDbExists === false` means there is no
    // database, therefore no queue, therefore nothing a guide could lose.
    expect(
      hasFwDeviceEvidence({ evidence: read({ queueDbExists: false }), actorIsFwGuide: true })
    ).toBe(false);
  });

  it("…but the guide signal still answers when the probe could NOT (B1 intact)", () => {
    // The half of B1 that must survive the reversal: `databases()` unavailable
    // (pre-2024 Safari) or throwing gives `null`, and there the storage heuristic
    // fails OPEN — so the server-known signal is what stops a guide whose localStorage
    // was evicted from skipping their own queue check.
    expect(
      hasFwDeviceEvidence({
        evidence: read({ cacheOwner: null, queueDbOpened: false, queueDbExists: null }),
        actorIsFwGuide: true,
      })
    ).toBe(true);
  });

  it("a guide with a REAL queue is still checked — eviction cannot hide a database", () => {
    // The scenario B1 exists for, end to end: localStorage evicted, fresh document, but
    // the queue database is still there holding their captures.
    expect(
      hasFwDeviceEvidence({
        evidence: read({ cacheOwner: null, queueDbOpened: false, queueDbExists: true }),
        actorIsFwGuide: true,
      })
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
      fwResidueFullyCleared({
        queueCleared: true,
        queueRemaining: 0,
        rosterCleared: true,
        shellCleared: true,
      })
    ).toBe(true);
  });

  it("a surviving ROSTER cache is a failure — it holds children's first and last names", () => {
    expect(
      fwResidueFullyCleared({
        queueCleared: true,
        queueRemaining: 0,
        rosterCleared: false,
        shellCleared: true,
      })
    ).toBe(false);
  });

  it("a surviving SHELL cache is a failure — it holds the authenticated roster HTML", () => {
    expect(
      fwResidueFullyCleared({
        queueCleared: true,
        queueRemaining: 0,
        rosterCleared: true,
        shellCleared: false,
      })
    ).toBe(false);
  });

  it("an ABORTED queue clear is a failure too", () => {
    expect(
      fwResidueFullyCleared({
        queueCleared: false,
        queueRemaining: 3,
        rosterCleared: true,
        shellCleared: true,
      })
    ).toBe(false);
  });

  it("…but PRESERVED foreign captures are not (Unit 4) — they are the correct outcome", () => {
    // The distinction the `queueRemaining` field exists to carry. A clear that
    // deliberately left another account's un-landed work behind did its whole job;
    // holding the session open over it would strand whoever is holding the device
    // for a queue only its absent owner can ever finish.
    expect(
      fwResidueFullyCleared({
        queueCleared: true,
        queueRemaining: 2,
        rosterCleared: true,
        shellCleared: true,
      })
    ).toBe(true);
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
  const decide = (over: {
    prior: string | null;
    surfaceCreatesResidue?: boolean;
    residuePresent?: boolean | null;
  }) =>
    decideFwCacheOwnerAction({
      prior: over.prior,
      actorUserId: GUIDE,
      surfaceCreatesResidue: over.surfaceCreatesResidue ?? true,
      // NOT `?? false` — `null` is a meaningful value here ("could not look") and the
      // nullish default would swallow it, quietly turning the fail-closed test into a
      // second copy of the clean-device one.
      residuePresent: "residuePresent" in over ? (over.residuePresent as boolean | null) : false,
    });

  it("the same account is a no-op", () => {
    expect(decide({ prior: GUIDE })).toBe("none");
  });

  it("a different account is a reconcile, on any surface", () => {
    expect(decide({ prior: OTHER_GUIDE, surfaceCreatesResidue: true })).toBe("reconcile");
    expect(decide({ prior: OTHER_GUIDE, surfaceCreatesResidue: false })).toBe("reconcile");
  });

  it("an unclaimed key on a genuinely CLEAN device is adopted on an FW surface", () => {
    expect(decide({ prior: null, residuePresent: false })).toBe("adopt");
  });

  it("…but NOT on /crm or /staff — the bar must not manufacture the evidence it reads", () => {
    // The key is an input to `hasFwDeviceEvidence`'s legacy branch. A bar that wrote
    // it on a browser which has never run Founders Weekend would mark that browser as
    // holding FW residue and then trust its own mark.
    expect(decide({ prior: null, surfaceCreatesResidue: false, residuePresent: false })).toBe(
      "none"
    );
  });

  it("UNATTRIBUTED residue reconciles rather than adopting — B1's shape, one function over", () => {
    // A null key is not proof of a clean device. localStorage and IndexedDB evict
    // independently, so "nobody has claimed this device" and "a prior guide's roster
    // cache and authed shell are still here, but the key naming them was evicted" look
    // identical. Adopting in the second case silently hands the incoming guide the
    // previous one's cached authenticated HTML.
    expect(decide({ prior: null, residuePresent: true })).toBe("reconcile");
    expect(decide({ prior: null, residuePresent: true, surfaceCreatesResidue: false })).toBe(
      "reconcile"
    );
  });

  it("residue that could not be determined reconciles too — fails CLOSED", () => {
    expect(decide({ prior: null, residuePresent: null })).toBe("reconcile");
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

describe("fwResidueBeacon — the off-device report of un-landed work (Unit 5)", () => {
  const base = { actorUserId: GUIDE, application: "fw" as const };

  it("reports queue_preserved WITH its count", () => {
    expect(fwResidueBeacon({ ...base, outcome: { kind: "queue_preserved", preservedCount: 3 } }))
      .toEqual({
        outcome: "queue_preserved",
        queueRemaining: 3,
        actorUserId: GUIDE,
        application: "fw",
      });
  });

  it("reports clear_failed with a NULL count, never zero", () => {
    // Item 5 of the offline-drain solution doc, applied: a sentinel must not be an
    // in-range value of the type it stands in for. `clear_failed` is minted when a
    // clear threw or a cache survived, so the queue's size is exactly what could not
    // be established — and `0` would read at a desk as "nothing was left behind" on
    // precisely the outcome where nothing is known.
    const beacon = fwResidueBeacon({ ...base, outcome: { kind: "clear_failed" } });
    expect(beacon?.queueRemaining).toBeNull();
    expect(beacon?.queueRemaining).not.toBe(0);
  });

  it("is SILENT for every outcome that left nothing behind", () => {
    // Returning null rather than an "empty" payload keeps "nothing to report"
    // un-sendable by construction. Beaconing routine mounts would bury the two
    // outcomes that matter in a stream of noise, which is how a signal becomes
    // ignorable — the failure mode this beacon exists to fix, recreated one layer up.
    const silent = [
      { kind: "sign_out", queueRemaining: 0 },
      { kind: "raced" },
      { kind: "refused", verdict: { ok: false, reason: "drain_first", queuedCount: 2 } },
      { kind: "none" },
      { kind: "adopted" },
      { kind: "reconciled" },
    ] as const;
    for (const outcome of silent) {
      expect(fwResidueBeacon({ ...base, outcome }), outcome.kind).toBeNull();
    }
  });

  it("covers BOTH outcome unions — sign-out's and the reconcile's", () => {
    // `clear_failed` is a member of both `FwSignOutOutcome` and `FwReconcileOutcome`,
    // and `queue_preserved` only of the second. The reconcile is the path that runs far
    // more often (every fresh mount of a device that changed hands), so a beacon wired
    // only to the sign-out button would miss the common case entirely.
    expect(fwResidueBeacon({ ...base, outcome: { kind: "clear_failed" } })).not.toBeNull();
    expect(
      fwResidueBeacon({ ...base, outcome: { kind: "queue_preserved", preservedCount: 1 } })
    ).not.toBeNull();
  });

  it("carries the application, so a desk can tell which surface the device was on", () => {
    for (const application of ["fw", "crm", "staff"] as const) {
      const beacon = fwResidueBeacon({
        actorUserId: GUIDE,
        application,
        outcome: { kind: "clear_failed" },
      });
      expect(beacon?.application).toBe(application);
    }
  });

  it("carries the SIGNING-OUT account, which is not necessarily whose captures these are", () => {
    // Pinned because the field name invites the opposite reading. On the
    // `queue_preserved` path the two are usually DIFFERENT people — that is what
    // "preserved" means. This field answers "who was holding the device", which is what
    // locates the iPad; whose work it is lives on each queue entry's own `actorUserId`
    // and is deliberately not copied here.
    const beacon = fwResidueBeacon({
      actorUserId: OTHER_GUIDE,
      application: "fw",
      outcome: { kind: "queue_preserved", preservedCount: 2 },
    });
    expect(beacon?.actorUserId).toBe(OTHER_GUIDE);
  });
});

describe("Unit 6: an orderly sign-out over preserved work now beacons (Peter, 2026-07-27)", () => {
  const base = { actorUserId: GUIDE, application: "fw" as const };

  it("sign_out with a positive count reports as queue_preserved", () => {
    // The gap this closes: the MOST COMMON residue-leaving path — sign out normally
    // of a device still holding a departed guide's captures — produced no off-device
    // record, because the success kind carried no count and the beacon had nothing to
    // fire on. Same payload kind as the reconcile's, deliberately: it is the same
    // fact reached through the other door, and a desk query should not need two
    // vocabularies for one situation.
    expect(fwResidueBeacon({ ...base, outcome: { kind: "sign_out", queueRemaining: 2 } }))
      .toEqual({
        outcome: "queue_preserved",
        queueRemaining: 2,
        actorUserId: GUIDE,
        application: "fw",
      });
  });

  it("a CLEAN sign-out stays silent — zero is the ordinary case, not a report", () => {
    expect(fwResidueBeacon({ ...base, outcome: { kind: "sign_out", queueRemaining: 0 } }))
      .toBeNull();
  });

  it("the flow reports the count the CLEAR preserved, from its own snapshot", async () => {
    // Through runFwSignOutFlow with a foreign entry: sign-out is allowed (R16), the
    // clear preserves it, and the outcome now says so instead of a bare success.
    // (The engine test exercises the same through the fake ports; this pins the
    // rules-level composition.)
    const foreign = entry("checkmark", { actorUserId: OTHER_GUIDE });
    const store: unknown[] = [foreign];
    const outcome = await runFwSignOutFlow({
      actorUserId: GUIDE,
      actorIsFwGuide: true,
      ports: {
        readEvidence: async () => ({
          kind: "read" as const,
          cacheOwner: GUIDE,
          queueDbOpened: true,
          queueDbExists: true,
        }),
        readQueue: async () => [...store],
        isOnline: () => true,
        isAuthRequired: () => false,
        drain: async () => {},
        clear: async (disposition) => {
          const keep = store.filter((raw) => disposition(raw) === "preserve");
          store.length = 0;
          store.push(...keep);
          return {
            queueCleared: true,
            rosterCleared: true,
            shellCleared: true,
            queueRemaining: keep.length,
          };
        },
        withDrainLock: async (fn) => fn(),
      },
    });
    expect(outcome).toEqual({ kind: "sign_out", queueRemaining: 1 });
    expect(store).toHaveLength(1); // and the foreign capture genuinely survived
  });

  it("a NULL count under an otherwise-clean clear is clear_failed, never a fabricated success", () => {
    // The sentinel rule one layer up: null means the queue step threw, so claiming
    // "signed out, 0 left behind" would report a fault as the clean case.
    return runFwSignOutFlow({
      actorUserId: GUIDE,
      actorIsFwGuide: true,
      ports: {
        readEvidence: async () => ({
          kind: "read" as const,
          cacheOwner: GUIDE,
          queueDbOpened: true,
          queueDbExists: true,
        }),
        readQueue: async () => [],
        isOnline: () => true,
        isAuthRequired: () => false,
        drain: async () => {},
        clear: async () => ({
          queueCleared: true,
          rosterCleared: true,
          shellCleared: true,
          queueRemaining: null,
        }),
        withDrainLock: async (fn) => fn(),
      },
    }).then((outcome) => {
      expect(outcome).toEqual({ kind: "clear_failed" });
    });
  });
});

/* ══════════════════════════════ the composed flip (ops-guide redesign Unit 9) ══ */

describe("createFwEnqueueClock — strictly increasing enqueuedAt, document-wide", () => {
  it("take(2) on a frozen wall clock yields strictly increasing stamps (the flip's legs)", () => {
    const clock = createFwEnqueueClock(() => Date.parse("2026-08-22T14:00:00.000Z"));
    const [a, b] = clock.take(2);
    expect(Date.parse(b)).toBeGreaterThan(Date.parse(a));
    expect(Date.parse(b) - Date.parse(a)).toBe(1); // stamp-and-increment: +1ms
  });

  it("a THIRD real tap in the same wall millisecond stamps strictly AFTER both legs — it can never interleave between them", () => {
    // The hazard stamp-and-increment alone leaves open: a same-ms third entry
    // would TIE with leg 1 and could sort between the legs on the random-UUID
    // tiebreak. The shared clock closes it: the tap's stamp is
    // max(now, last + 1) = leg2 + 1.
    const clock = createFwEnqueueClock(() => Date.parse("2026-08-22T14:00:00.000Z"));
    const [leg1, leg2] = clock.take(2);
    const tap = clock.next();
    expect(Date.parse(tap)).toBeGreaterThan(Date.parse(leg2));
    expect(Date.parse(leg2)).toBeGreaterThan(Date.parse(leg1));
  });

  it("never goes backwards even when the wall clock does (NTP step)", () => {
    let now = Date.parse("2026-08-22T14:00:00.000Z");
    const clock = createFwEnqueueClock(() => now);
    const a = clock.next();
    now -= 60_000; // the device clock steps back a minute
    const b = clock.next();
    expect(Date.parse(b)).toBeGreaterThan(Date.parse(a));
  });

  it("tracks a moving wall clock rather than creeping by 1ms forever", () => {
    let now = Date.parse("2026-08-22T14:00:00.000Z");
    const clock = createFwEnqueueClock(() => now);
    clock.next();
    now += 5_000;
    expect(clock.next()).toBe(new Date(now).toISOString());
  });
});

describe("planFwFlipEntries — two ORDINARY entries, client-sequenced", () => {
  const FLIP_NOW = Date.parse("2026-08-22T14:00:00.000Z");
  const flipLegs = (): FwFlipLeg[] => [
    { action: "undo", actionId: "action-undo", clientId: "cid-undo" },
    { action: "not_yet", actionId: "action-notyet", clientId: "cid-notyet" },
  ];
  const plan = (legs = flipLegs(), stamps?: readonly string[]) =>
    planFwFlipEntries({
      cohortId: COHORT,
      studentId: STUDENT_A,
      taskId: TASK,
      actorUserId: GUIDE,
      capturedAt: new Date(FLIP_NOW).toISOString(),
      legs,
      enqueuedAts: stamps ?? createFwEnqueueClock(() => FLIP_NOW).take(legs.length),
    });

  it("builds two recognized, ordinary FwQueueEntry records — no new op kind, no shape change", () => {
    const [undoLeg, notYetLeg] = plan();
    expect(undoLeg.action).toBe("undo");
    expect(notYetLeg.action).toBe("not_yet");
    // Ordinary entries: the cross-deploy reader recognizes them as-is, so
    // FW_QUEUE_ENTRY_SCHEMA_VERSION stays 1.
    expect(isRecognizedFwEntry(undoLeg)).toBe(true);
    expect(isRecognizedFwEntry(notYetLeg)).toBe(true);
    expect(undoLeg.schemaVersion).toBe(FW_QUEUE_ENTRY_SCHEMA_VERSION);
    // id === clientId, one entry per leg (the queue's own construction rule).
    expect(undoLeg.id).toBe("cid-undo");
    expect(notYetLeg.id).toBe("cid-notyet");
    // Legs never share an action id (board celebration grouping is per action).
    expect(undoLeg.actionId).not.toBe(notYetLeg.actionId);
    // Strictly increasing enqueuedAt.
    expect(Date.parse(notYetLeg.enqueuedAt)).toBeGreaterThan(Date.parse(undoLeg.enqueuedAt));
  });

  it("flip legs NEVER reduce as a cancel pair — replay order undo → not_yet, however the queue is read back", () => {
    const [undoLeg, notYetLeg] = plan();
    // Fed in both orders: enqueuedAt (not input order, not the random-UUID
    // tiebreak) decides, so the pair survives as the ordered correction.
    expect(reduceFwOps([undoLeg, notYetLeg]).map((o) => o.action)).toEqual(["undo", "not_yet"]);
    expect(reduceFwOps([notYetLeg, undoLeg]).map((o) => o.action)).toEqual(["undo", "not_yet"]);
  });

  it("same-millisecond stamps are REFUSED — they would fall to the random-UUID tiebreak and could cancel the flip", () => {
    const stamp = new Date(FLIP_NOW).toISOString();
    expect(() => plan(flipLegs(), [stamp, stamp])).toThrow(/strictly increasing/);
  });

  it("legs sharing a clientId are REFUSED — the RPC's replay probe would swallow leg 2 as `replayed`", () => {
    // THE NEGATIVE PIN (Key Decision, pin 2): the replay probe dedupes on the
    // client id. If the not_yet leg rode the undo leg's id, the undo's landing
    // would make leg 2 echo `replayed` — "already recorded" — and the flip's
    // second half would never be written.
    const legs = flipLegs().map((l) => ({ ...l, clientId: "cid-shared" }));
    expect(() => plan(legs)).toThrow(/distinct clientIds/);
  });

  it("legs sharing an actionId are REFUSED", () => {
    const legs = flipLegs().map((l) => ({ ...l, actionId: "action-shared" }));
    expect(() => plan(legs)).toThrow(/distinct actionIds/);
  });

  it("a flip followed by a real undo tap reduces [undo, not_yet, undo] → [undo] (cancel-pair logic composes)", () => {
    const [undoLeg, notYetLeg] = plan();
    const clock = createFwEnqueueClock(() => FLIP_NOW);
    clock.take(2); // the flip's reservation
    const laterUndo = entry("undo", { enqueuedAt: clock.next(), clientId: "cid-later-undo" });
    const reduced = reduceFwOps([undoLeg, notYetLeg, laterUndo]);
    expect(reduced.map((o) => o.action)).toEqual(["undo"]);
    // The SURVIVOR is the flip's own leading undo — the not_yet and its undo
    // cancelled; the pre-outage decision still gets reverted.
    expect(reduced[0].clientId).toBe("cid-undo");
  });

  it("a same-ms third tap from the shared clock orders after BOTH legs (never interleaves)", () => {
    const clock = createFwEnqueueClock(() => FLIP_NOW);
    const [undoLeg, notYetLeg] = plan(flipLegs(), clock.take(2));
    const tap = entry("checkmark", { enqueuedAt: clock.next(), clientId: "cid-tap" });
    const ordered = orderFwEntries([tap, notYetLeg, undoLeg]);
    expect(ordered.map((o) => o.clientId)).toEqual(["cid-undo", "cid-notyet", "cid-tap"]);
  });

  it("a cross-actor flip rejects AS A UNIT — cross_actor_undo on both legs, no lone not_yet", () => {
    const [undoLeg, notYetLeg] = plan();
    const result = planFwStudentTask({
      ops: [undoLeg, notYetLeg],
      server: { state: "verified", verifiedBy: OTHER_GUIDE },
    });
    expect(result.replay).toEqual([]);
    expect(result.reject.map((r) => r.entry.clientId)).toEqual(["cid-undo", "cid-notyet"]);
    expect(result.reject.every((r) => r.reason === "cross_actor_undo")).toBe(true);
  });

  it("a SAME-actor flip replays whole, in order", () => {
    const [undoLeg, notYetLeg] = plan();
    const result = planFwStudentTask({
      ops: [undoLeg, notYetLeg],
      server: { state: "verified", verifiedBy: GUIDE },
    });
    expect(result.reject).toEqual([]);
    expect(result.replay.map((o) => o.action)).toEqual(["undo", "not_yet"]);
  });
});

describe("fwPendingMarker + projectFwPendingState — the pending-flip row", () => {
  it("a pending flip projects the server state UNCHANGED and marks pending_flip — never a premature not_yet paint", () => {
    const clock = createFwEnqueueClock(() => Date.parse("2026-08-22T14:00:00.000Z"));
    const legs = planFwFlipEntries({
      cohortId: COHORT,
      studentId: STUDENT_A,
      taskId: TASK,
      actorUserId: GUIDE,
      capturedAt: "2026-08-22T14:00:00.000Z",
      legs: [
        { action: "undo", actionId: "a1", clientId: "c1" },
        { action: "not_yet", actionId: "a2", clientId: "c2" },
      ],
      enqueuedAts: clock.take(2),
    });
    // The existing conservatism: author-blind, the leading undo might be held
    // at drain (cross_actor_undo), so the projection must not move.
    expect(projectFwPendingState("verified", legs)).toBe("verified");
    // ...and the marker is what tells the row to say "pending flip".
    expect(fwPendingMarker(legs)).toBe("pending_flip");
  });

  it("a lone queued undo is also pending_flip (same conservatism)", () => {
    expect(fwPendingMarker([entry("undo")])).toBe("pending_flip");
  });

  it("a decision-led pending sequence is plain `pending` (the projection moves)", () => {
    const ops = [entry("checkmark")];
    expect(fwPendingMarker(ops)).toBe("pending");
    expect(projectFwPendingState("locked", ops)).toBe("verified");
  });

  it("nothing pending — or a fully-cancelled pair — is `none`", () => {
    expect(fwPendingMarker([])).toBe("none");
    expect(fwPendingMarker([entry("checkmark"), entry("undo")])).toBe("none");
  });
});

describe("fwFlipLeg1Verdict — the online leg-2 gate", () => {
  const rs = (kind: "applied" | "already_done" | "replayed" | "re_attempt"): FwStudentResult => ({
    studentId: STUDENT_A,
    kind,
    state: "locked",
  });

  it("applied / already_done / REPLAYED release leg 2 (replayed = leg-success)", () => {
    expect(fwFlipLeg1Verdict(rs("applied"))).toBe("proceed");
    expect(fwFlipLeg1Verdict(rs("already_done"))).toBe("proceed");
    // A landed-but-unanswered undo from an earlier attempt still releases the
    // flip's second half — the Key Decision's third pin.
    expect(fwFlipLeg1Verdict(rs("replayed"))).toBe("proceed");
  });

  it("refused: not_a_decision releases leg 2 (not_yet is legal from work states)", () => {
    expect(
      fwFlipLeg1Verdict({ studentId: STUDENT_A, kind: "refused", reason: "not_a_decision", state: "locked" })
    ).toBe("proceed");
    expect(
      fwFlipLeg1Verdict({ studentId: STUDENT_A, kind: "refused", reason: "undo_first", state: "verified" })
    ).toBe("halt");
  });

  it("unavailable — or a response silent about the student — backstops BOTH legs", () => {
    expect(
      fwFlipLeg1Verdict({ studentId: STUDENT_A, kind: "failed", reason: "unavailable" })
    ).toBe("backstop");
    expect(fwFlipLeg1Verdict(undefined)).toBe("backstop");
  });

  it("definite failures and skips halt the flip", () => {
    expect(
      fwFlipLeg1Verdict({ studentId: STUDENT_A, kind: "failed", reason: "missing_progress" })
    ).toBe("halt");
    expect(
      fwFlipLeg1Verdict({ studentId: STUDENT_A, kind: "failed", reason: "cohort_invalid" })
    ).toBe("halt");
    expect(
      fwFlipLeg1Verdict({ studentId: STUDENT_A, kind: "failed", reason: "cross_actor_undo" })
    ).toBe("halt");
    expect(
      fwFlipLeg1Verdict({ studentId: STUDENT_A, kind: "skipped", reason: "not_in_cohort" })
    ).toBe("halt");
    expect(fwFlipLeg1Verdict(rs("re_attempt"))).toBe("halt"); // unreachable for undo — fail closed
  });
});

describe("the flip's per-leg client ids — distinct, and stable across retries", () => {
  it("the ledger keys per (task, student, ACTION), so the two legs hold distinct ids that survive re-minting", () => {
    let n = 0;
    const ledger = createFwClientIdLedger(() => `mint-${(n += 1)}`);
    const intentUndo = { taskId: TASK, action: "undo" as const, studentIds: [STUDENT_A] };
    const intentNotYet = { taskId: TASK, action: "not_yet" as const, studentIds: [STUDENT_A] };

    const undoId = ledger.idsFor(intentUndo)[STUDENT_A];
    const notYetId = ledger.idsFor(intentNotYet)[STUDENT_A];
    // Distinct per leg: fwTapKey carries the action, so no key change was needed.
    // (A SHARED id is the swallowed-leg-2 hazard planFwFlipEntries refuses.)
    expect(undoId).not.toBe(notYetId);
    expect(fwTapKey(TASK, STUDENT_A, "undo")).not.toBe(fwTapKey(TASK, STUDENT_A, "not_yet"));
    // Stable across a retry of the same flip — the exactly-once contract.
    expect(ledger.idsFor(intentUndo)[STUDENT_A]).toBe(undoId);
    expect(ledger.idsFor(intentNotYet)[STUDENT_A]).toBe(notYetId);
  });

  it("a settled leg releases its id; the ambiguous leg keeps its own", () => {
    let n = 0;
    const ledger = createFwClientIdLedger(() => `mint-${(n += 1)}`);
    const undoId = ledger.idsFor({ taskId: TASK, action: "undo", studentIds: [STUDENT_A] })[STUDENT_A];
    const notYetId = ledger.idsFor({ taskId: TASK, action: "not_yet", studentIds: [STUDENT_A] })[
      STUDENT_A
    ];
    ledger.settle({ taskId: TASK, action: "undo" }, [
      { studentId: STUDENT_A, kind: "applied", state: "locked" },
    ]);
    // The undo settled → a NEW undo tap mints fresh; the unsettled not_yet
    // still holds its key for the retry.
    expect(
      ledger.idsFor({ taskId: TASK, action: "undo", studentIds: [STUDENT_A] })[STUDENT_A]
    ).not.toBe(undoId);
    expect(
      ledger.idsFor({ taskId: TASK, action: "not_yet", studentIds: [STUDENT_A] })[STUDENT_A]
    ).toBe(notYetId);
  });
});
