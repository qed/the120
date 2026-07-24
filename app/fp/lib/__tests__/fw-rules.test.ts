import { describe, expect, it } from "vitest";

import {
  clampFwCapturedAt,
  createFwClientIdLedger,
  foldFwSurfaceOutcome,
  fwResultsForFailedAction,
  stateForFwPrimary,
  EMPTY_FW_SURFACE,
  decideFwAction,
  fwActionTarget,
  fwFirstDollarStudents,
  fwRetryStudentIds,
  isFirstDollarTask,
  isFwAction,
  isFwResultSettled,
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
  type FwOutcome,
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

  it("ACCEPTED DEVIATION: the reverse order re-verifies, and says so honestly", () => {
    // The plan's Decision 2 says checkmark × undo on a `verified` row yields
    // "exactly one event", without qualifying the ordering. That holds for the
    // order above. It does NOT hold if the undo commits FIRST: the checkmark then
    // acts on a `locked` row, which is its primary legal source (every FW row
    // starts locked), so it applies — two events, ending at `verified`.
    //
    // This is a consequence of FW-D5, not a defect, and it cannot be fixed by
    // narrowing the legal-from set: excluding `locked` from checkmark would break
    // the ONLY path that matters (a guide checkmarking a fresh task). The
    // alternative — a caller-supplied `expected_from` CAS, as `move_path_task`
    // uses — was deliberately dropped from this RPC's signature by the plan.
    //
    // What IS guaranteed in every ordering is the invariant asserted below: an
    // event exists iff the row moved, and every event's from_state is the state
    // the writer actually saw. No ordering produces a lie, a lost update, or a
    // duplicate event for one decision. The Unit 4 surface reduces the exposure
    // further (post-tap the view stays in place, so a guide sees the current
    // state before tapping again).
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
      ["already_done", "applied", "cohort_invalid", "cross_actor_undo", "missing", "re_attempt", "refused", "replayed"].sort()
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
  /** A well-typed echo. `outcome` is FwOutcome so a typo'd outcome in a future
   *  test is a COMPILE error — `resultForFwEcho`'s switch has no default arm, so
   *  an off-union value would otherwise fall through to `undefined` at runtime
   *  and only surface as a confusing toEqual mismatch. */
  const echo = (
    outcome: FwOutcome,
    state: TaskState | null,
    verifiedBy: string | null = null
  ): FwEcho => ({ outcome, state, verifiedBy });

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
    expect(resultForFwEcho("s1", "checkmark", echo("missing", null))).toEqual({
      studentId: "s1",
      kind: "failed",
      reason: "missing_progress",
    });
  });

  it("a null state on a row-bearing outcome is a shape drift — failed, never 'applied'", () => {
    // The RPC held a row lock for each of these, so a state it cannot name means
    // the echo did not narrow. Reporting success here would tell a guide their
    // tap landed on a row nobody can describe.
    for (const outcome of ["applied", "re_attempt", "already_done", "replayed", "refused"] as const) {
      expect(
        resultForFwEcho("s1", "checkmark", echo(outcome, null)),
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
    for (const action of ["not_yet", "undo"] as const) {
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

/* ═════════════════════════════════ the exactly-once key, per tap (Unit 4) ══ */

describe("isFwResultSettled — which outcomes end the tap they name", () => {
  const settled = (r: FwStudentResult) => isFwResultSettled(r);

  it("settles on every outcome the server actually decided", () => {
    expect(settled({ studentId: "s", kind: "applied", state: "verified" })).toBe(true);
    expect(settled({ studentId: "s", kind: "re_attempt", state: "not_yet" })).toBe(true);
    expect(settled({ studentId: "s", kind: "already_done", state: "verified" })).toBe(true);
    expect(settled({ studentId: "s", kind: "replayed", state: "verified" })).toBe(true);
    expect(settled({ studentId: "s", kind: "refused", reason: "undo_first", state: "verified" })).toBe(true);
    expect(settled({ studentId: "s", kind: "skipped", reason: "not_in_cohort" })).toBe(true);
  });

  it("settles the two `failed` reasons that are DEFINITE facts, not ambiguity", () => {
    // A missing progress row and a bad cohort stamp are answers. Retrying them
    // with the same key buys nothing, and holding the key forever would make a
    // later, genuine tap on that task read as a replay.
    expect(settled({ studentId: "s", kind: "failed", reason: "missing_progress" })).toBe(true);
    expect(settled({ studentId: "s", kind: "failed", reason: "cohort_invalid" })).toBe(true);
  });

  it("does NOT settle on `unavailable` — the one outcome that proves nothing", () => {
    // A timeout or a thrown fetch is not proof the write failed and not proof it
    // landed. The key must survive so the retry is the SAME tap.
    expect(settled({ studentId: "s", kind: "failed", reason: "unavailable" })).toBe(false);
  });
});

describe("fwRetryStudentIds", () => {
  it("names only the students whose outcome was ambiguous", () => {
    expect(
      fwRetryStudentIds([
        { studentId: "s-a", kind: "applied", state: "verified" },
        { studentId: "s-b", kind: "failed", reason: "unavailable" },
        { studentId: "s-c", kind: "failed", reason: "missing_progress" },
        { studentId: "s-d", kind: "skipped", reason: "over_batch_max" },
      ])
    ).toEqual(["s-b"]);
  });

  it("is empty when everything settled — no retry affordance to render", () => {
    expect(fwRetryStudentIds([{ studentId: "s-a", kind: "applied", state: "verified" }])).toEqual([]);
  });
});

describe("the per-tap client-id ledger (carried from Unit 3)", () => {
  const ledgerWithCounter = () => {
    let n = 0;
    return createFwClientIdLedger(() => `id-${(n += 1)}`);
  };
  const intent = (over: Partial<{ taskId: string; action: FwAction; studentIds: string[] }> = {}) => ({
    taskId: "1.2.4",
    action: "not_yet" as FwAction,
    studentIds: ["s-a", "s-b"],
    ...over,
  });

  it("mints one distinct id per student in a tap", () => {
    const ids = ledgerWithCounter().idsFor(intent());
    expect(Object.keys(ids).sort()).toEqual(["s-a", "s-b"]);
    expect(new Set(Object.values(ids)).size).toBe(2);
  });

  it("REUSES the id when the same tap is submitted again — that is the whole point", () => {
    // The Unit 3 gap, closed. A not-yet retry after an ambiguous failure must
    // carry the first attempt's key, or the RPC cannot tell "the guide tapped
    // twice" (a real FW-D4 struggle signal) from "the first response was lost
    // over venue wifi", and the blocker data silently inflates.
    const ledger = ledgerWithCounter();
    const first = ledger.idsFor(intent());
    expect(ledger.idsFor(intent())).toEqual(first);
  });

  it("mints a FRESH id for a different action on the same task and student", () => {
    const ledger = ledgerWithCounter();
    const notYet = ledger.idsFor(intent({ action: "not_yet", studentIds: ["s-a"] }));
    const undo = ledger.idsFor(intent({ action: "undo", studentIds: ["s-a"] }));
    expect(undo["s-a"]).not.toBe(notYet["s-a"]);
  });

  it("mints a FRESH id for the same action on a different task", () => {
    const ledger = ledgerWithCounter();
    const a = ledger.idsFor(intent({ taskId: "1.2.4", studentIds: ["s-a"] }));
    const b = ledger.idsFor(intent({ taskId: "1.2.5", studentIds: ["s-a"] }));
    expect(b["s-a"]).not.toBe(a["s-a"]);
  });

  it("mints only what is missing when a teammate joins mid-selection", () => {
    const ledger = ledgerWithCounter();
    const solo = ledger.idsFor(intent({ studentIds: ["s-a"] }));
    const pair = ledger.idsFor(intent({ studentIds: ["s-a", "s-b"] }));
    expect(pair["s-a"]).toBe(solo["s-a"]);
    expect(pair["s-b"]).not.toBe(solo["s-a"]);
  });

  it("settling frees the key, so the guide's NEXT tap is a new tap", () => {
    // A deliberate second not-yet IS a re-attempt event. Holding the key would
    // turn the FW-D4 signal into a permanent no-op for that task.
    const ledger = ledgerWithCounter();
    const first = ledger.idsFor(intent({ studentIds: ["s-a"] }));
    ledger.settle(intent({ studentIds: ["s-a"] }), [
      { studentId: "s-a", kind: "re_attempt", state: "not_yet" },
    ]);
    expect(ledger.idsFor(intent({ studentIds: ["s-a"] }))["s-a"]).not.toBe(first["s-a"]);
  });

  it("settling KEEPS an ambiguous student's key while freeing their teammates'", () => {
    const ledger = ledgerWithCounter();
    const first = ledger.idsFor(intent());
    ledger.settle(intent(), [
      { studentId: "s-a", kind: "applied", state: "not_yet" },
      { studentId: "s-b", kind: "failed", reason: "unavailable" },
    ]);
    const next = ledger.idsFor(intent());
    expect(next["s-a"]).not.toBe(first["s-a"]);
    expect(next["s-b"]).toBe(first["s-b"]);
  });

  it("settles only the tap it names, never another task's live keys", () => {
    const ledger = ledgerWithCounter();
    const other = ledger.idsFor(intent({ taskId: "3.1.1", studentIds: ["s-a"] }));
    ledger.settle(intent({ studentIds: ["s-a"] }), [
      { studentId: "s-a", kind: "applied", state: "not_yet" },
    ]);
    expect(ledger.idsFor(intent({ taskId: "3.1.1", studentIds: ["s-a"] }))["s-a"]).toBe(other["s-a"]);
  });
});

/* ══════════════════════ what the surface shows after an action (Unit 4) ══ */

describe("stateForFwPrimary", () => {
  it("picks the caller's OWN echoed state out of a batch response", () => {
    expect(
      stateForFwPrimary(
        [
          { studentId: "s-a", kind: "applied", state: "verified" },
          { studentId: "s-me", kind: "already_done", state: "not_yet" },
        ],
        "s-me"
      )
    ).toBe("not_yet");
  });

  it("returns undefined for an outcome that carries no state", () => {
    // `skipped`/`failed` say nothing about where the row is. Leaving the control
    // alone is the truthful rendering of "we don't know that it moved";
    // inventing a state would show a checkmark for a write that never landed.
    expect(stateForFwPrimary([{ studentId: "s-me", kind: "skipped", reason: "not_in_cohort" }], "s-me")).toBeUndefined();
    expect(stateForFwPrimary([{ studentId: "s-me", kind: "failed", reason: "unavailable" }], "s-me")).toBeUndefined();
  });

  it("returns undefined when the response says nothing about this student", () => {
    // A narrowed retry for a teammate must not move the primary's control.
    expect(
      stateForFwPrimary([{ studentId: "s-other", kind: "applied", state: "verified" }], "s-me")
    ).toBeUndefined();
  });

  it("takes the RPC's echo even when it is not what the tap asked for", () => {
    // The echo was produced under a row lock, so it is authoritative — a refusal
    // caused by another guide's concurrent tap self-heals the stale local view.
    expect(
      stateForFwPrimary(
        [{ studentId: "s-me", kind: "refused", reason: "undo_first", state: "verified" }],
        "s-me"
      )
    ).toBe("verified");
  });
});

describe("foldFwSurfaceOutcome — the partial-retry merge", () => {
  const applied = (studentId: string): FwStudentResult => ({
    studentId,
    kind: "applied",
    state: "verified",
  });
  const unavailable = (studentId: string): FwStudentResult => ({
    studentId,
    kind: "failed",
    reason: "unavailable",
  });

  it("keeps a settled teammate's line when a NARROWED retry succeeds", () => {
    // The P1 the correctness review caught: assigning the retry's response over
    // the previous state erased the lines of students who had already succeeded.
    const first = foldFwSurfaceOutcome(
      EMPTY_FW_SURFACE,
      { outcomes: [applied("s-primary"), applied("s-a"), unavailable("s-b")], firstDollar: [] },
      ["s-primary", "s-a", "s-b"]
    );
    const afterRetry = foldFwSurfaceOutcome(
      first,
      { outcomes: [applied("s-b")], firstDollar: [] },
      ["s-b"]
    );
    expect(afterRetry.results.map((r) => `${r.studentId}:${r.kind}`)).toEqual([
      "s-primary:applied",
      "s-a:applied",
      "s-b:applied",
    ]);
  });

  it("keeps a STANDING first dollar when the retry is for somebody else", () => {
    // The worst half of the same bug: the retry's `firstDollar` was computed
    // over a set that no longer contained the child whose bell needed ringing.
    const first = foldFwSurfaceOutcome(
      EMPTY_FW_SURFACE,
      { outcomes: [applied("s-primary"), unavailable("s-b")], firstDollar: ["s-primary"] },
      ["s-primary", "s-b"]
    );
    expect(first.firstDollar).toEqual(["s-primary"]);
    const afterRetry = foldFwSurfaceOutcome(
      first,
      { outcomes: [applied("s-b")], firstDollar: [] },
      ["s-b"]
    );
    expect(afterRetry.firstDollar).toEqual(["s-primary"]);
  });

  it("RETRACTS a first dollar for a student who was submitted again and did not re-earn it", () => {
    // Undo is submitted for that student and yields no first dollar, so the
    // banner must go. A plain union would leave a bell standing for a check-in
    // the guide had just undone.
    const first = foldFwSurfaceOutcome(
      EMPTY_FW_SURFACE,
      { outcomes: [applied("s-primary")], firstDollar: ["s-primary"] },
      ["s-primary"]
    );
    const afterUndo = foldFwSurfaceOutcome(
      first,
      {
        outcomes: [{ studentId: "s-primary", kind: "applied", state: "locked" }],
        firstDollar: [],
      },
      ["s-primary"]
    );
    expect(afterUndo.firstDollar).toEqual([]);
  });

  it("replaces a student's line in place rather than appending a second one", () => {
    const first = foldFwSurfaceOutcome(
      EMPTY_FW_SURFACE,
      { outcomes: [unavailable("s-a")], firstDollar: [] },
      ["s-a"]
    );
    const second = foldFwSurfaceOutcome(first, { outcomes: [applied("s-a")], firstDollar: [] }, ["s-a"]);
    expect(second.results).toHaveLength(1);
    expect(second.results[0].kind).toBe("applied");
  });

  it("preserves existing line order and appends genuinely new students at the end", () => {
    const first = foldFwSurfaceOutcome(
      EMPTY_FW_SURFACE,
      { outcomes: [applied("s-a"), applied("s-b")], firstDollar: [] },
      ["s-a", "s-b"]
    );
    const second = foldFwSurfaceOutcome(
      first,
      { outcomes: [applied("s-c"), applied("s-a")], firstDollar: [] },
      ["s-c", "s-a"]
    );
    // The report must not reshuffle under a guide mid-glance.
    expect(second.results.map((r) => r.studentId)).toEqual(["s-a", "s-b", "s-c"]);
  });
});

describe("fwResultsForFailedAction", () => {
  it("reports every submitted student as unavailable, so no stale line survives", () => {
    expect(fwResultsForFailedAction(["s-a", "s-b"])).toEqual([
      { studentId: "s-a", kind: "failed", reason: "unavailable" },
      { studentId: "s-b", kind: "failed", reason: "unavailable" },
    ]);
  });

  it("produces results that keep their client-id keys alive for the retry", () => {
    // `unavailable` is the one outcome `isFwResultSettled` refuses to settle.
    for (const r of fwResultsForFailedAction(["s-a"])) expect(isFwResultSettled(r)).toBe(false);
  });
});
