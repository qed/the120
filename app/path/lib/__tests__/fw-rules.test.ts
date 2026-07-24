import { describe, expect, it } from "vitest";

import {
  clampFwCapturedAt,
  decideFwAction,
  fwActionTarget,
  fwFirstDollarStudents,
  isFirstDollarTask,
  isFwAction,
  narrowFwOutcome,
  planFwBatch,
  resultForFwEcho,
  FW_ACTIONS,
  FW_ACTION_LEGAL_FROM,
  FW_ACTION_TARGETS,
  FW_BATCH_MAX,
  FW_FIRST_DOLLAR_TASK_ID,
  FW_OUTCOMES,
  type FwAction,
  type FwEcho,
  type FwStudentResult,
} from "../fw-rules";
import { TASK_STATES, type TaskState } from "../transition-table";

/**
 * The FW check-in decision table (FW Unit 3) — written BEFORE the module, per
 * the plan's Execution note: "the decision table (action × current-state ×
 * batch × fresh-vs-replay) is the product's core logic."
 *
 * Every row here is also a row the SQL must implement identically;
 * fw-move-task-parity.test.ts pins the two together structurally.
 */

const GUIDE = "user-guide-a";

/* ═══════════════════════════════════════════════ the action set and targets ══ */

describe("the FW action vocabulary", () => {
  it("is exactly three actions — the guide's whole surface (FW-R17)", () => {
    expect([...FW_ACTIONS].sort()).toEqual(["checkmark", "not_yet", "undo"]);
  });

  it("hardcodes a target per action; the RPC never takes a caller-supplied state", () => {
    expect(FW_ACTION_TARGETS).toEqual({
      checkmark: "verified",
      not_yet: "not_yet",
      undo: "locked",
    });
    for (const a of FW_ACTIONS) expect(fwActionTarget(a)).toBe(FW_ACTION_TARGETS[a]);
  });

  it("every target is a real task state (no FW-only state is invented)", () => {
    for (const a of FW_ACTIONS) {
      expect(TASK_STATES as readonly string[]).toContain(FW_ACTION_TARGETS[a]);
    }
  });

  it("isFwAction refuses Path transition names — the two write paths share no vocabulary check", () => {
    expect(isFwAction("checkmark")).toBe(true);
    expect(isFwAction("not_yet")).toBe(true);
    expect(isFwAction("undo")).toBe(true);
    // Path transitions must never reach fw_move_task.
    for (const t of ["verify", "revoke", "submit", "unlock", "open", "withdraw", "resume"]) {
      expect(isFwAction(t), t).toBe(false);
    }
    expect(isFwAction("")).toBe(false);
  });
});

/* ═════════════════════════════════════════════════════ the legal-from sets ═══ */

describe("FW_ACTION_LEGAL_FROM — the set that IS the UPDATE's WHERE predicate", () => {
  it("checkmark is legal from every state EXCEPT its own target (FW-D5: no gating)", () => {
    expect([...FW_ACTION_LEGAL_FROM.checkmark].sort()).toEqual(
      TASK_STATES.filter((s) => s !== "verified")
        .slice()
        .sort()
    );
  });

  it("not-yet is legal from every state except `verified` (undo first) and its own target", () => {
    expect([...FW_ACTION_LEGAL_FROM.not_yet].sort()).toEqual(
      ["available", "in_progress", "locked", "submitted"].sort()
    );
  });

  it("undo is legal ONLY from the two decision states — it reverts decisions, not progress", () => {
    expect([...FW_ACTION_LEGAL_FROM.undo].sort()).toEqual(["not_yet", "verified"]);
  });

  it("no legal-from set contains its own action's target (a self-transition is never an UPDATE)", () => {
    for (const a of FW_ACTIONS) {
      expect(FW_ACTION_LEGAL_FROM[a], a).not.toContain(FW_ACTION_TARGETS[a]);
    }
  });

  it("every listed state is a real task state", () => {
    for (const a of FW_ACTIONS) {
      for (const s of FW_ACTION_LEGAL_FROM[a]) {
        expect(TASK_STATES as readonly string[], `${a} from ${s}`).toContain(s);
      }
    }
  });
});

/* ═══════════════════════════════ decideFwAction — the single "already decided?" ══ */

describe("decideFwAction — the ONE predicate for 'is this task already decided?'", () => {
  it("applies from every state in the action's legal-from set, and only those", () => {
    for (const a of FW_ACTIONS) {
      for (const from of TASK_STATES) {
        const decision = decideFwAction({ action: a, from });
        const legal = FW_ACTION_LEGAL_FROM[a].includes(from);
        expect(decision.kind === "apply", `${a} from ${from}`).toBe(legal);
        if (decision.kind === "apply") expect(decision.to).toBe(FW_ACTION_TARGETS[a]);
      }
    }
  });

  /* ── the Decision-2 semantics, one test per named rule ── */

  it("checkmark onto `verified` is a FULL no-op — no event, so the bell cannot ring twice", () => {
    expect(decideFwAction({ action: "checkmark", from: "verified" })).toEqual({
      kind: "already_done",
    });
  });

  it("a not-yet tap onto `not_yet` is a RE-ATTEMPT — an event with no state change", () => {
    // Repeat struggle is exactly the blocker signal FW-D4 exists to capture, and
    // FW-R17 calls Not-yet a recorded state, so the second tap is data, not noise.
    expect(decideFwAction({ action: "not_yet", from: "not_yet" })).toEqual({ kind: "re_attempt" });
  });

  it("not-yet onto `verified` is REFUSED — undo first, never a silent downgrade", () => {
    expect(decideFwAction({ action: "not_yet", from: "verified" })).toEqual({
      kind: "refused",
      reason: "undo_first",
    });
  });

  it("undo from `locked` is a no-op — there is no decision left to revert", () => {
    expect(decideFwAction({ action: "undo", from: "locked" })).toEqual({ kind: "already_done" });
  });

  it("undo from a Path work state is REFUSED, never a silent reset to locked", () => {
    // available/in_progress/submitted are states only the PATH write path
    // produces. An FW undo has no decision to revert there, and quietly
    // stamping `locked` would erase a Path student's real position.
    for (const from of ["available", "in_progress", "submitted"] as const) {
      expect(decideFwAction({ action: "undo", from }), from).toEqual({
        kind: "refused",
        reason: "not_a_decision",
      });
    }
  });

  it("checkmark and not-yet are legal from each other's state — a correction needs no undo", () => {
    expect(decideFwAction({ action: "checkmark", from: "not_yet" })).toEqual({
      kind: "apply",
      to: "verified",
    });
    // …but the reverse is NOT symmetric: verified → not_yet is refused above.
    // That asymmetry is deliberate and is the whole of the undo-first rule.
  });

  it("classifies every (action, state) pair — the table is total, never undefined", () => {
    for (const a of FW_ACTIONS) {
      for (const from of TASK_STATES) {
        const d = decideFwAction({ action: a, from });
        expect(["apply", "re_attempt", "already_done", "refused"], `${a}/${from}`).toContain(d.kind);
      }
    }
  });

  it("only `not_yet` ever yields a re-attempt — the other two actions have no such arm", () => {
    for (const a of FW_ACTIONS) {
      for (const from of TASK_STATES) {
        if (decideFwAction({ action: a, from }).kind === "re_attempt") {
          expect(a).toBe("not_yet");
          expect(from).toBe("not_yet");
        }
      }
    }
  });
});

/* ═════════════════════════════════ the race: interleaving at the pure layer ══ */

/**
 * A tiny serial simulator over `decideFwAction`. The node-only test setup cannot
 * run true concurrency, so race safety is asserted two ways: STRUCTURALLY (the
 * parity test proves the guard lives in the UPDATE's WHERE clause, which is what
 * makes the DB serialize) and BEHAVIOURALLY here — every serialization order of a
 * concurrent pair is enumerated and its events counted.
 */
function runSerial(
  start: TaskState,
  taps: readonly FwAction[]
): { state: TaskState; events: { action: FwAction; from: TaskState; to: TaskState }[]; echoes: string[] } {
  let state = start;
  const events: { action: FwAction; from: TaskState; to: TaskState }[] = [];
  const echoes: string[] = [];
  for (const action of taps) {
    const d = decideFwAction({ action, from: state });
    echoes.push(d.kind);
    if (d.kind === "apply") {
      events.push({ action, from: state, to: d.to });
      state = d.to;
    } else if (d.kind === "re_attempt") {
      events.push({ action, from: state, to: state });
    }
  }
  return { state, events, echoes };
}

describe("named race scenario — checkmark × undo on one `verified` row", () => {
  it("the mis-tap order (checkmark first): exactly ONE event and two truthful echoes", () => {
    const run = runSerial("verified", ["checkmark", "undo"]);
    expect(run.events).toHaveLength(1);
    expect(run.events[0]).toEqual({ action: "undo", from: "verified", to: "locked" });
    // Truthful: the checkmark is told the task was already done, the undo is
    // told it applied. Neither is told a fiction about the other.
    expect(run.echoes).toEqual(["already_done", "apply"]);
    expect(run.state).toBe("locked");
  });

  it("the reverse order re-verifies honestly — and never lies about it", () => {
    // If the undo genuinely commits first, the checkmark now acts on a `locked`
    // row and IS a real decision. Two events is the correct answer here, not a
    // double-ring: each event's from_state matches the row it actually saw.
    const run = runSerial("verified", ["undo", "checkmark"]);
    expect(run.events).toEqual([
      { action: "undo", from: "verified", to: "locked" },
      { action: "checkmark", from: "locked", to: "verified" },
    ]);
    expect(run.echoes).toEqual(["apply", "apply"]);
    expect(run.state).toBe("verified");
  });

  it("the order-independent invariant: an event exists iff the row moved, and every from_state is real", () => {
    for (const order of [
      ["checkmark", "undo"],
      ["undo", "checkmark"],
    ] as const) {
      const run = runSerial("verified", order);
      let cursor: TaskState = "verified";
      for (const e of run.events) {
        expect(e.from, `from_state of ${e.action} in ${order.join("×")}`).toBe(cursor);
        cursor = e.to;
      }
      expect(run.state).toBe(cursor);
    }
  });

  it("checkmark × checkmark on a locked row → ONE event ever", () => {
    const run = runSerial("locked", ["checkmark", "checkmark"]);
    expect(run.events).toHaveLength(1);
    expect(run.echoes).toEqual(["apply", "already_done"]);
    expect(run.state).toBe("verified");
  });

  it("undo × undo on a verified row → ONE event ever", () => {
    const run = runSerial("verified", ["undo", "undo"]);
    expect(run.events).toHaveLength(1);
    expect(run.echoes).toEqual(["apply", "already_done"]);
  });

  it("repeat not-yet taps append an event each — struggle is counted, state is not churned", () => {
    const run = runSerial("locked", ["not_yet", "not_yet", "not_yet"]);
    expect(run.events).toEqual([
      { action: "not_yet", from: "locked", to: "not_yet" },
      { action: "not_yet", from: "not_yet", to: "not_yet" },
      { action: "not_yet", from: "not_yet", to: "not_yet" },
    ]);
    expect(run.echoes).toEqual(["apply", "re_attempt", "re_attempt"]);
    expect(run.state).toBe("not_yet");
  });

  it("a re-attempt event is recognizable by from_state === to_state (the board's signal)", () => {
    const run = runSerial("not_yet", ["not_yet"]);
    expect(run.events[0].from).toBe(run.events[0].to);
  });
});

/* ═══════════════════════════════════════════════════════ the RPC echo union ══ */

describe("narrowFwOutcome — fail-closed narrowing at the service-role boundary", () => {
  it("accepts exactly the outcomes the RPC can return", () => {
    expect([...FW_OUTCOMES].sort()).toEqual(
      ["already_done", "applied", "cohort_invalid", "missing", "re_attempt", "refused", "replayed"].sort()
    );
    for (const o of FW_OUTCOMES) expect(narrowFwOutcome(o)).toBe(o);
  });

  it("returns null for anything else — never an `as` cast on a value that gates a write path", () => {
    for (const junk of ["", "ok", "APPLIED", "verified", 1, null, undefined, {}, ["applied"]]) {
      expect(narrowFwOutcome(junk), String(junk)).toBeNull();
    }
  });
});

describe("resultForFwEcho — the RPC echo becomes a per-student result", () => {
  const echo = (outcome: string, state: TaskState, verifiedBy: string | null = null): FwEcho =>
    ({ outcome, state, verifiedBy }) as FwEcho;

  it("applied carries the winning state", () => {
    expect(resultForFwEcho("s1", "checkmark", echo("applied", "verified", GUIDE))).toEqual({
      studentId: "s1",
      kind: "applied",
      state: "verified",
    });
  });

  it("re_attempt reports the unchanged state — the guide sees their tap registered", () => {
    expect(resultForFwEcho("s1", "not_yet", echo("re_attempt", "not_yet", GUIDE))).toEqual({
      studentId: "s1",
      kind: "re_attempt",
      state: "not_yet",
    });
  });

  it("already_done is a success shape, not an error — nothing was needed", () => {
    expect(resultForFwEcho("s1", "checkmark", echo("already_done", "verified", GUIDE))).toEqual({
      studentId: "s1",
      kind: "already_done",
      state: "verified",
    });
  });

  it("replayed is distinct from already_done — the tap was recorded, just not twice", () => {
    expect(resultForFwEcho("s1", "not_yet", echo("replayed", "not_yet"))).toEqual({
      studentId: "s1",
      kind: "replayed",
      state: "not_yet",
    });
  });

  it("a refusal's REASON is re-derived from the echoed state by decideFwAction, not invented", () => {
    // The RPC answers "refused"; the truthful reason lives in the same decision
    // table both sides share, so the copy shown to the guide can never disagree
    // with the rule that produced it.
    expect(resultForFwEcho("s1", "not_yet", echo("refused", "verified", GUIDE))).toEqual({
      studentId: "s1",
      kind: "refused",
      reason: "undo_first",
      state: "verified",
    });
    expect(resultForFwEcho("s1", "undo", echo("refused", "in_progress"))).toEqual({
      studentId: "s1",
      kind: "refused",
      reason: "not_a_decision",
      state: "in_progress",
    });
  });

  it("missing progress is a FAILURE, never a silent success — a tap-dead tree must surface", () => {
    expect(resultForFwEcho("s1", "checkmark", echo("missing", "locked"))).toEqual({
      studentId: "s1",
      kind: "failed",
      reason: "missing_progress",
    });
  });

  it("cohort_invalid is a failure — the RPC refused to stamp an unverifiable cohort", () => {
    expect(resultForFwEcho("s1", "checkmark", echo("cohort_invalid", "locked"))).toEqual({
      studentId: "s1",
      kind: "failed",
      reason: "cohort_invalid",
    });
  });

  it("a null echo (RPC error or unparseable row) fails closed, never optimistically applied", () => {
    expect(resultForFwEcho("s1", "checkmark", null)).toEqual({
      studentId: "s1",
      kind: "failed",
      reason: "unavailable",
    });
  });

  it("`missing` is the ONLY outcome allowed to carry a null state", () => {
    expect(resultForFwEcho("s1", "checkmark", echo("missing", null as never))).toEqual({
      studentId: "s1",
      kind: "failed",
      reason: "missing_progress",
    });
  });

  it("a null state on a row-bearing outcome is a shape drift — failed, never 'applied'", () => {
    // The RPC held a row lock for each of these, so a state it cannot name means
    // the echo did not narrow. Reporting success here would tell a guide their
    // tap landed on a row nobody can describe.
    for (const outcome of ["applied", "re_attempt", "already_done", "replayed", "refused"]) {
      expect(
        resultForFwEcho("s1", "checkmark", echo(outcome, null as never)),
        outcome
      ).toEqual({ studentId: "s1", kind: "failed", reason: "unavailable" });
    }
  });
});

/* ═══════════════════════════════════════════════════════════ batch planning ══ */

describe("planFwBatch — the batch is N plans sharing one action, minus the ineligible", () => {
  it("keeps only students the cohort membership actually contains (Decision 3)", () => {
    const plan = planFwBatch({
      studentIds: ["s1", "s2", "s3"],
      cohortMemberIds: ["s1", "s3"],
    });
    expect(plan.targets.map((t) => t.studentId)).toEqual(["s1", "s3"]);
    expect(plan.skipped).toEqual([{ studentId: "s2", reason: "not_in_cohort" }]);
  });

  it("preserves the guide's selection order — the result list reads like the picker", () => {
    const plan = planFwBatch({
      studentIds: ["s3", "s1", "s2"],
      cohortMemberIds: ["s1", "s2", "s3"],
    });
    expect(plan.targets.map((t) => t.studentId)).toEqual(["s3", "s1", "s2"]);
  });

  it("de-duplicates a repeated student — two RPC calls with one client_id would read as a replay", () => {
    const plan = planFwBatch({
      studentIds: ["s1", "s1", "s2"],
      cohortMemberIds: ["s1", "s2"],
    });
    expect(plan.targets.map((t) => t.studentId)).toEqual(["s1", "s2"]);
    expect(plan.skipped).toEqual([]);
  });

  it("carries a per-student client id when the caller supplied one (offline replay keying)", () => {
    const plan = planFwBatch({
      studentIds: ["s1", "s2"],
      cohortMemberIds: ["s1", "s2"],
      clientIds: { s1: "cid-1" },
    });
    expect(plan.targets).toEqual([
      { studentId: "s1", clientId: "cid-1" },
      { studentId: "s2", clientId: null },
    ]);
  });

  it("an empty membership skips everyone rather than writing anything", () => {
    const plan = planFwBatch({ studentIds: ["s1"], cohortMemberIds: [] });
    expect(plan.targets).toEqual([]);
    expect(plan.skipped).toEqual([{ studentId: "s1", reason: "not_in_cohort" }]);
  });

  it("caps the batch at FW_BATCH_MAX and reports the overflow rather than truncating silently", () => {
    expect(FW_BATCH_MAX).toBe(3);
    const plan = planFwBatch({
      studentIds: ["s1", "s2", "s3", "s4"],
      cohortMemberIds: ["s1", "s2", "s3", "s4"],
    });
    expect(plan.targets.map((t) => t.studentId)).toEqual(["s1", "s2", "s3"]);
    expect(plan.skipped).toEqual([{ studentId: "s4", reason: "over_batch_max" }]);
  });

  it("the cap counts DE-DUPLICATED students, not raw taps", () => {
    const plan = planFwBatch({
      studentIds: ["s1", "s1", "s2", "s2", "s3"],
      cohortMemberIds: ["s1", "s2", "s3"],
    });
    expect(plan.targets).toHaveLength(3);
    expect(plan.skipped).toEqual([]);
  });
});

/* ══════════════════════════════════════════════ First Dollar — the bell gate ══ */

describe("First Dollar (FW-D16, Decision 6) — the bell rings on a NEW verify only", () => {
  it("names the task the whole ceremony hangs on", () => {
    expect(FW_FIRST_DOLLAR_TASK_ID).toBe("1.2.4");
    expect(isFirstDollarTask("1.2.4")).toBe(true);
    expect(isFirstDollarTask("1.2.5")).toBe(false);
    expect(isFirstDollarTask("1.2.40")).toBe(false);
  });

  const applied = (id: string): FwStudentResult => ({ studentId: id, kind: "applied", state: "verified" });

  it("fires for every student whose checkmark PROVABLY applied", () => {
    expect(
      fwFirstDollarStudents({
        taskId: "1.2.4",
        action: "checkmark",
        results: [applied("s1"), applied("s2")],
      })
    ).toEqual(["s1", "s2"]);
  });

  it("does NOT fire on already_done — bell safety, the room already rang it once", () => {
    expect(
      fwFirstDollarStudents({
        taskId: "1.2.4",
        action: "checkmark",
        results: [{ studentId: "s1", kind: "already_done", state: "verified" }],
      })
    ).toEqual([]);
  });

  it("does NOT fire on a replayed client id — a drained outage tap rings nothing", () => {
    expect(
      fwFirstDollarStudents({
        taskId: "1.2.4",
        action: "checkmark",
        results: [{ studentId: "s1", kind: "replayed", state: "verified" }],
      })
    ).toEqual([]);
  });

  it("does NOT fire for not-yet or undo, whatever the task", () => {
    for (const action of ["not_yet", "undo"] as FwAction[]) {
      expect(
        fwFirstDollarStudents({ taskId: "1.2.4", action, results: [applied("s1")] }),
        action
      ).toEqual([]);
    }
  });

  it("does NOT fire for any other task", () => {
    expect(
      fwFirstDollarStudents({ taskId: "1.2.3", action: "checkmark", results: [applied("s1")] })
    ).toEqual([]);
  });

  it("in a partial batch, names ONLY the students who actually crossed — never the whole selection", () => {
    // The composition trap this test exists for: a batch that "succeeded" is not
    // a batch in which every student newly verified.
    expect(
      fwFirstDollarStudents({
        taskId: "1.2.4",
        action: "checkmark",
        results: [
          applied("s1"),
          { studentId: "s2", kind: "already_done", state: "verified" },
          { studentId: "s3", kind: "skipped", reason: "not_in_cohort" },
          { studentId: "s4", kind: "failed", reason: "unavailable" },
        ],
      })
    ).toEqual(["s1"]);
  });
});

/* ═══════════════════════════════════════════════════ capture-time clamping ══ */

describe("clampFwCapturedAt — reuses the Path's capture clamp, does not re-derive one", () => {
  const now = Date.parse("2026-08-22T15:00:00.000Z");

  it("passes an honest offline capture time through untouched", () => {
    const twentyMinutesAgo = new Date(now - 20 * 60_000).toISOString();
    expect(clampFwCapturedAt(twentyMinutesAgo, now)).toEqual({
      value: twentyMinutesAgo,
      clamped: false,
    });
  });

  it("clamps a future capture time to receipt and records that it clamped", () => {
    const ahead = new Date(now + 60 * 60_000).toISOString();
    const res = clampFwCapturedAt(ahead, now);
    expect(res.value).toBe(new Date(now).toISOString());
    expect(res.clamped).toBe(true);
  });

  it("clamps a dead-clock 1970 value rather than trusting it", () => {
    const res = clampFwCapturedAt("1970-01-01T00:00:00.000Z", now);
    expect(res.value).toBe(new Date(now).toISOString());
    expect(res.clamped).toBe(true);
  });

  it("degrades an unparseable value to receipt time — a corrupt clock never aborts a check-in", () => {
    expect(clampFwCapturedAt("not-a-date", now).clamped).toBe(true);
  });

  it("treats an absent capture time as `now`, unclamped — the online path supplies none", () => {
    expect(clampFwCapturedAt(null, now)).toEqual({
      value: new Date(now).toISOString(),
      clamped: false,
    });
    expect(clampFwCapturedAt(undefined, now).clamped).toBe(false);
  });
});
