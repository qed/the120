import { describe, expect, it } from "vitest";

// Registering the real 2026-27 program (import side effect) so the version-scoped
// resolvers below read the actual committed curriculum, not a hand-built fixture.
import "@/app/path/content/generated/program-2026-27";
import { registerProgram } from "@/app/path/content/manifest";
import type { ProgramContent } from "@/app/path/content/types";

import {
  clampStudentTaskState,
  CRITERION_STATES,
  PHASE_STATES,
  STUDENT_REACHABLE_STATES,
  submitGateStatus,
  TASK_STATES,
  TRANSITIONS,
  type ActorClass,
  type CascadeEffect,
  type CriterionSnapshot,
  type PhaseCascade,
  type TaskCascade,
  type TaskSnapshot,
  type TaskState,
  type TransitionCtx,
  type TransitionName,
} from "../transition-table";
import {
  criterionTaskIds,
  effectiveBand,
  evaluateTransition,
  isDisplayBlocked,
  isSubmittable,
  reviewTriggerTaskId,
} from "../path-rules";

/* ----------------------------------------------------------------- builders */

function task(over: Partial<TaskSnapshot> = {}): TaskSnapshot {
  return {
    id: "1.1.1",
    seq: 1,
    state: "available",
    reviewOpenedAt: null,
    verifiedBy: null,
    snapshotBand: null,
    ...over,
  };
}

/** A criterion of `n` tasks, seq 1..n, every task in `state`. */
function criterionOf(
  n: number,
  state: TaskState,
  over: Partial<CriterionSnapshot> = {}
): CriterionSnapshot {
  const tasks: TaskSnapshot[] = Array.from({ length: n }, (_, i) =>
    task({ id: `c.${i + 1}`, seq: i + 1, state })
  );
  return { id: "c", state: "active", tasks, ...over };
}

function ctx(over: Partial<TransitionCtx> = {}): TransitionCtx {
  const criterion = over.criterion ?? criterionOf(3, "available");
  return {
    actorRole: "student",
    actorId: "student-1",
    task: over.task ?? criterion.tasks[0],
    criterion,
    ...over,
  };
}

/** Assert-and-narrow a cascade to its scope variant (the DU keeps taskTo/phaseTo
 *  off the wrong scope, so consumers narrow before reading them). */
function taskCascade(c: CascadeEffect): TaskCascade {
  expect(c.scope).toBe("task");
  if (c.scope !== "task") throw new Error("expected a task cascade");
  return c;
}
function phaseCascade(c: CascadeEffect): PhaseCascade {
  expect(c.scope).toBe("phase");
  if (c.scope !== "phase") throw new Error("expected a phase cascade");
  return c;
}

/* --------------------------------------------------- the table is coherent */

describe("transition table — structural invariants", () => {
  it("every transition name maps to exactly one row", () => {
    const names = TRANSITIONS.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every one of the ten TransitionName values has exactly one row", () => {
    const NAMES: TransitionName[] = [
      "unlock",
      "open",
      "submit",
      "withdraw",
      "verify",
      "not_yet",
      "resume",
      "revoke",
      "criterion_return",
      "phase_return",
    ];
    for (const name of NAMES) {
      expect(TRANSITIONS.filter((r) => r.name === name)).toHaveLength(1);
    }
    expect(TRANSITIONS).toHaveLength(NAMES.length);
  });

  it("every row's from and to are legal states for its scope (all three scopes, independently)", () => {
    const legal: Record<string, readonly string[]> = {
      task: TASK_STATES,
      criterion: CRITERION_STATES,
      phase: PHASE_STATES,
    };
    for (const row of TRANSITIONS) {
      expect(legal[row.scope]).toContain(row.from);
      expect(legal[row.scope]).toContain(row.to);
    }
  });

  it("every row's cascade reports its own scope, and taskTo/phaseTo appear only on their scope", () => {
    // Enumerate the whole table (not spot-checks): call each row's cascade with a
    // context it can consume and assert the scope/field pairing the DU promises.
    for (const row of TRANSITIONS) {
      const c = ctxForRow(row.name, row.actor === "system" ? "system" : "adult");
      const cascade = row.cascade(c);
      expect(cascade.scope).toBe(row.scope);
      if (cascade.scope === "task") {
        expect(cascade.taskTo).toBeDefined();
      } else if (cascade.scope === "phase") {
        expect(cascade.phaseTo).toBe("returned");
      }
    }
  });

  it("covers withdraw, revoke, criterion_return and phase_return (the four the plan names)", () => {
    for (const name of ["withdraw", "revoke", "criterion_return", "phase_return"] as const) {
      expect(TRANSITIONS.some((r) => r.name === name)).toBe(true);
    }
  });

  it("no task-scope transition targets a state unreachable by any row (no orphan target)", () => {
    const taskRows = TRANSITIONS.filter((r) => r.scope === "task");
    const froms = new Set(taskRows.map((r) => r.from));
    for (const r of taskRows) {
      const terminal = r.to === "verified" || r.to === "locked";
      expect(terminal || froms.has(r.to)).toBe(true);
    }
  });

  it("evaluateTransition NEVER throws — every row reached with well-formed AND malformed contexts", () => {
    // Includes task states `submitted`/`in_progress` so submit/withdraw/verify/
    // not_yet preconditions are actually executed (not short-circuited on the
    // state guard), and a phase ctx with returnedCriterionIds OMITTED.
    const wild: TransitionCtx[] = [
      ctx(),
      { actorRole: "system", actorId: null, task: task({ state: "locked" }), criterion: criterionOf(1, "locked") },
      { actorRole: "adult", actorId: null, task: task({ state: "verified", verifiedBy: null }), criterion: criterionOf(2, "verified", { state: "returned" }) },
      { actorRole: "student", actorId: "", task: task({ state: "not_yet" }), criterion: criterionOf(4, "not_yet") },
      { actorRole: "student", actorId: "s", task: task({ state: "in_progress" }), criterion: criterionOf(3, "in_progress") },
      { actorRole: "adult", actorId: "mum", task: task({ state: "submitted" }), criterion: criterionOf(3, "submitted") },
      { actorRole: "adult", actorId: "mum", task: task({ state: "submitted", verifiedBy: null }), criterion: criterionOf(3, "submitted") }, // note omitted
      { actorRole: "adult", actorId: "mum", task: task(), criterion: criterionOf(3, "verified", { state: "review_underway" }), returnedTaskIds: [] },
      { actorRole: "adult", actorId: "mum", task: task(), criterion: criterionOf(3, "verified", { state: "review_underway" }), returnedTaskIds: ["nope"], note: "x" },
      { actorRole: "adult", actorId: "mum", task: task(), criterion: criterionOf(3, "verified"), phase: { id: "01", state: "review_underway", criterionIds: ["c"] }, returnedCriterionIds: [] },
      { actorRole: "adult", actorId: "mum", task: task(), criterion: criterionOf(3, "verified"), phase: { id: "01", state: "review_underway", criterionIds: ["c"] } }, // returnedCriterionIds omitted
    ];
    for (const row of TRANSITIONS) {
      for (const c of wild) {
        expect(() => evaluateTransition(row.name, c)).not.toThrow();
      }
    }
  });
});

/* ------------------------------------------------- R6: the pure clamp + gate */

describe("R6 — a student can never drive a verifying transition (enumerated)", () => {
  it("every `verifying` row refuses a student actor — the whole table, not named cases", () => {
    const verifyingRows = TRANSITIONS.filter((r) => r.verifying);
    expect(verifyingRows.map((r) => r.name).sort()).toEqual(
      ["criterion_return", "not_yet", "phase_return", "revoke", "verify"].sort()
    );

    for (const row of verifyingRows) {
      const c = ctxForRow(row.name, "student");
      const out = evaluateTransition(row.name, c);
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.reason).toBe("actor_not_permitted");
    }
  });

  it("a student verifying an ALREADY-verified task is refused for R6, not masked as already_in_target_state", () => {
    // R6 runs before the state match, so the authz signal always wins.
    const out = evaluateTransition("verify", ctx({ task: task({ state: "verified" }), actorRole: "student" }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("actor_not_permitted");
  });

  it("clampStudentTaskState coerces a forged verifying target back to current (mirrors effectiveReviewStatus)", () => {
    expect(clampStudentTaskState("verified", "submitted")).toBe("submitted");
    expect(clampStudentTaskState("not_yet", "submitted")).toBe("submitted");
    expect(clampStudentTaskState("locked", "in_progress")).toBe("in_progress");
    for (const s of STUDENT_REACHABLE_STATES) {
      expect(clampStudentTaskState(s, "in_progress")).toBe(s);
    }
  });

  it("STUDENT_REACHABLE_STATES excludes verified, not_yet and locked", () => {
    expect(STUDENT_REACHABLE_STATES).not.toContain("verified");
    expect(STUDENT_REACHABLE_STATES).not.toContain("not_yet");
    expect(STUDENT_REACHABLE_STATES).not.toContain("locked");
  });
});

/** Build a ctx whose scope-state matches the row's `from`, with a chosen actor.
 *  Relies on discriminated-union narrowing (no `as` casts needed). */
function ctxForRow(name: TransitionName, actorRole: ActorClass): TransitionCtx {
  const row = TRANSITIONS.find((r) => r.name === name)!;
  if (row.scope === "task") {
    const c = criterionOf(3, "verified");
    const t = task({ id: "c.2", seq: 2, state: row.from, verifiedBy: "mum" });
    c.tasks[1] = t;
    return {
      actorRole,
      actorId: "mum",
      task: t,
      criterion: c,
      note: "needs another run",
      returnedTaskIds: ["c.2"],
    };
  }
  if (row.scope === "criterion") {
    const c = criterionOf(3, "verified", { state: row.from });
    return {
      actorRole,
      actorId: "mum",
      task: c.tasks[0],
      criterion: c,
      note: "review exposed a soft verification",
      returnedTaskIds: ["c.1"],
    };
  }
  // phase scope
  const c = criterionOf(3, "verified", { state: "review_underway" });
  return {
    actorRole,
    actorId: "mum",
    task: c.tasks[0],
    criterion: c,
    phase: { id: "01", state: "review_underway", criterionIds: ["c"] },
    returnedCriterionIds: ["c"],
  };
}

/* -------------------------------------------------- actor-class enforcement */

describe("actor-class gate", () => {
  it("unlock is system-only — a student cannot manually unlock a task", () => {
    const c = criterionOf(2, "verified");
    const locked = task({ id: "c.2", seq: 2, state: "locked" });
    c.tasks[1] = locked;
    const out = evaluateTransition("unlock", ctx({ task: locked, criterion: c, actorRole: "student" }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("actor_not_permitted");
  });

  it("an adult cannot drive a student transition — open OR submit — those happen in the child's own session", () => {
    const openOut = evaluateTransition("open", ctx({ task: task({ state: "available" }), actorRole: "adult", actorId: "dad" }));
    expect(openOut.ok).toBe(false);
    if (!openOut.ok) expect(openOut.reason).toBe("actor_not_permitted");

    const submitOut = evaluateTransition("submit", ctx({ task: task({ state: "in_progress" }), actorRole: "adult", actorId: "dad" }));
    expect(submitOut.ok).toBe(false);
    if (!submitOut.ok) expect(submitOut.reason).toBe("actor_not_permitted");
  });
});

/* ----------------------------------------- state-match: behind vs ahead */

describe("state match — behind (no_such_transition) vs ahead (already_in_target_state)", () => {
  it("a task transition from the wrong from-state is no_such_transition (behind)", () => {
    const out = evaluateTransition("verify", ctx({ task: task({ state: "available" }), actorRole: "adult", actorId: "mum" }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("no_such_transition");
  });

  it("a TASK transition whose target equals the current state is already_in_target_state (idempotent)", () => {
    const out = evaluateTransition("verify", ctx({ task: task({ state: "verified" }), actorRole: "adult", actorId: "mum" }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("already_in_target_state");

    const out2 = evaluateTransition("submit", ctx({ task: task({ state: "submitted" }) }));
    expect(out2.ok).toBe(false);
    if (!out2.ok) expect(out2.reason).toBe("already_in_target_state");
  });

  it("a CRITERION already at `returned` is NOT already_in_target_state — a second return is no_such_transition", () => {
    // `returned` is not "the return you asked for already happened" (it may be an
    // earlier, different return), so criterion_return out of review_underway is a
    // plain no_such_transition Unit 8 must not silently adopt.
    const c = criterionOf(3, "verified", { state: "returned" });
    const out = evaluateTransition(
      "criterion_return",
      ctx({ task: c.tasks[0], criterion: c, actorRole: "adult", actorId: "mum", returnedTaskIds: ["c.1"], note: "found another" })
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("no_such_transition");
  });
});

/* ------------------------------------------------------ the forward loop */

describe("forward transitions (student)", () => {
  it("open moves available → in_progress", () => {
    const out = evaluateTransition("open", ctx({ task: task({ state: "available" }) }));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.to).toBe("in_progress");
  });

  it("submit moves in_progress → submitted and notifies the parents", () => {
    const out = evaluateTransition("submit", ctx({ task: task({ state: "in_progress" }) }));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.to).toBe("submitted");
      expect(taskCascade(out.cascade).taskTo).toBe("submitted");
      expect(out.cascade.notifications).toContainEqual({ audience: "parents", kind: "submitted" });
    }
  });

  it("resume moves not_yet → in_progress (evidence intact)", () => {
    const out = evaluateTransition("resume", ctx({ task: task({ state: "not_yet" }) }));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.to).toBe("in_progress");
  });
});

/* ------------------------------------------------------ the submit gate seam */

describe("submit gate hook (D — additive T3 math gate)", () => {
  it("open by default in T1 (no submitGate on ctx)", () => {
    expect(submitGateStatus(ctx({ task: task({ state: "in_progress" }) })).open).toBe(true);
  });

  it("submit succeeds through the engine when the gate is open", () => {
    const out = evaluateTransition("submit", ctx({ task: task({ state: "in_progress" }) }));
    expect(out.ok).toBe(true);
  });

  it("submit is refused with gate_closed when ctx.submitGate is closed (the T3 seam)", () => {
    const out = evaluateTransition(
      "submit",
      ctx({ task: task({ state: "in_progress" }), submitGate: { open: false, reason: "math gate not cleared" } })
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("gate_closed");
  });
});

/* ---------------------------------------------------------------- verify */

describe("verify", () => {
  it("verifying a non-last task unlocks the next and does not open the review", () => {
    const c = criterionOf(3, "verified", { state: "active" });
    c.tasks[0] = task({ id: "c.1", seq: 1, state: "submitted" });
    c.tasks[1] = task({ id: "c.2", seq: 2, state: "locked" });
    c.tasks[2] = task({ id: "c.3", seq: 3, state: "locked" });
    const out = evaluateTransition(
      "verify",
      ctx({ task: c.tasks[0], criterion: c, actorRole: "adult", actorId: "mum" })
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.to).toBe("verified");
      expect(out.cascade.successors).toContainEqual({ taskId: "c.2", to: "available" });
      expect(out.cascade.criterionTo).toBe("active");
      expect(out.cascade.notifications).toContainEqual({ audience: "student", kind: "verified" });
    }
  });

  it("verifying the LAST task of a criterion opens review_underway", () => {
    const c = criterionOf(3, "verified", { state: "active" });
    c.tasks[2] = task({ id: "c.3", seq: 3, state: "submitted" });
    const out = evaluateTransition(
      "verify",
      ctx({ task: c.tasks[2], criterion: c, actorRole: "adult", actorId: "mum" })
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.to).toBe("verified");
      expect(out.cascade.criterionTo).toBe("review_underway");
      expect(out.cascade.notifications).toContainEqual({ audience: "student", kind: "review_underway" });
    }
  });

  it("verifying a task whose immediate predecessor is unverified is refused", () => {
    const c = criterionOf(3, "locked", { state: "active" });
    c.tasks[0] = task({ id: "c.1", seq: 1, state: "in_progress" });
    c.tasks[1] = task({ id: "c.2", seq: 2, state: "submitted" });
    const out = evaluateTransition(
      "verify",
      ctx({ task: c.tasks[1], criterion: c, actorRole: "adult", actorId: "mum" })
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("predecessor_unverified");
  });
});

/* --------------------------------------------------------------- not_yet */

describe("not_yet", () => {
  it("Not Yet without a note is refused before anything else", () => {
    const out = evaluateTransition(
      "not_yet",
      ctx({ task: task({ state: "submitted" }), actorRole: "adult", actorId: "mum", note: "" })
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("note_required");
  });

  it("Not Yet with a note moves submitted → not_yet and notifies the student", () => {
    const out = evaluateTransition(
      "not_yet",
      ctx({ task: task({ state: "submitted" }), actorRole: "adult", actorId: "mum", note: "needs three clean runs in a row" })
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.to).toBe("not_yet");
      expect(out.cascade.notifications).toContainEqual({ audience: "student", kind: "not_yet" });
    }
  });
});

/* -------------------------------------------------------------- unlock */

describe("unlock (system)", () => {
  it("unlocking a task whose predecessor is unverified is refused", () => {
    const c = criterionOf(2, "verified");
    c.tasks[0] = task({ id: "c.1", seq: 1, state: "submitted" });
    const locked = task({ id: "c.2", seq: 2, state: "locked" });
    c.tasks[1] = locked;
    const out = evaluateTransition("unlock", ctx({ task: locked, criterion: c, actorRole: "system", actorId: null }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("predecessor_unverified");
  });
});

/* -------------------------------------------------------------- withdraw */

describe("withdraw (D6 — legal only before the review is opened)", () => {
  it("withdraw with reviewOpenedAt null succeeds (submitted → in_progress)", () => {
    const out = evaluateTransition("withdraw", ctx({ task: task({ state: "submitted", reviewOpenedAt: null }) }));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.to).toBe("in_progress");
  });

  it("withdraw with reviewOpenedAt set is refused", () => {
    const out = evaluateTransition(
      "withdraw",
      ctx({ task: task({ state: "submitted", reviewOpenedAt: "2026-07-21T19:42:00.000Z" }) })
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("review_already_opened");
  });

  it("withdraw treats an empty-string reviewOpenedAt as NOT opened (fail-safe on a resolver slip)", () => {
    const out = evaluateTransition("withdraw", ctx({ task: task({ state: "submitted", reviewOpenedAt: "" }) }));
    expect(out.ok).toBe(true);
  });
});

/* ------------------------------------------------ revoke (§9.5 actor-scoped) */

describe("revoke (§9.5 — only the verifier who made it)", () => {
  const verified = (state: CriterionSnapshot["state"] = "review_underway") =>
    criterionOf(3, "verified", { state });

  it("revoke by the ORIGINAL verifier succeeds and renders the crest provisional (D23)", () => {
    const c = verified();
    const t = task({ id: "c.2", seq: 2, state: "verified", verifiedBy: "mum" });
    c.tasks[1] = t;
    const out = evaluateTransition("revoke", ctx({ task: t, criterion: c, actorRole: "adult", actorId: "mum" }));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.to).toBe("not_yet");
      expect(out.cascade.awards).toBe("provisional");
      expect(out.cascade.criterionTo).toBe("returned");
    }
  });

  it("revoke is legal while the criterion is still `active` (before the whole criterion reaches review)", () => {
    // §9.5: a verifier may revoke their own verification any time before the
    // criterion review clears — including before it has even opened.
    const c = verified("active");
    const t = task({ id: "c.2", seq: 2, state: "verified", verifiedBy: "mum" });
    c.tasks[1] = t;
    const out = evaluateTransition("revoke", ctx({ task: t, criterion: c, actorRole: "adult", actorId: "mum" }));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.cascade.criterionTo).toBe("active");
  });

  it("revoke by the OTHER parent is refused (not the original verifier)", () => {
    const c = verified();
    const t = task({ id: "c.2", seq: 2, state: "verified", verifiedBy: "mum" });
    c.tasks[1] = t;
    const out = evaluateTransition("revoke", ctx({ task: t, criterion: c, actorRole: "adult", actorId: "dad" }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("not_original_verifier");
  });

  it("revoke fails closed on degenerate identities: empty, whitespace-only, or null", () => {
    const cases: { actorId: string | null; verifiedBy: string | null }[] = [
      { actorId: "", verifiedBy: "" },
      { actorId: "   ", verifiedBy: "   " }, // whitespace-only both sides must NOT match
      { actorId: "mum", verifiedBy: null },
    ];
    for (const { actorId, verifiedBy } of cases) {
      const c = verified();
      c.tasks[1] = task({ id: "c.2", seq: 2, state: "verified", verifiedBy });
      const out = evaluateTransition("revoke", ctx({ task: c.tasks[1], criterion: c, actorRole: "adult", actorId }));
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.reason).toBe("not_original_verifier");
    }
  });

  it("revoke is NOT gated by display-block — a reviewer may reopen a verified task even behind an earlier return", () => {
    // Deliberate asymmetry: display-block gates STUDENT forward progress, not a
    // reviewer's correction. c.4 is verified but sits behind returned c.2.
    const c = criterionOf(5, "verified", { state: "returned" });
    c.tasks[1] = task({ id: "c.2", seq: 2, state: "not_yet" });
    c.tasks[3] = task({ id: "c.4", seq: 4, state: "verified", verifiedBy: "mum" });
    expect(isDisplayBlocked(c.tasks[3], c)).toBe(true);
    const out = evaluateTransition("revoke", ctx({ task: c.tasks[3], criterion: c, actorRole: "adult", actorId: "mum" }));
    expect(out.ok).toBe(true);
  });
});

/* -------------------------------------------- criterion_return */

describe("criterion_return", () => {
  it("returns named tasks to not_yet and leaves later verified tasks verified but display-blocked & un-submittable", () => {
    const c = criterionOf(5, "verified", { state: "review_underway" });
    const out = evaluateTransition(
      "criterion_return",
      ctx({ task: c.tasks[0], criterion: c, actorRole: "adult", actorId: "mum", note: "the funnel math doesn't hold up", returnedTaskIds: ["c.2"] })
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.cascade.scope).toBe("criterion");
    expect(out.cascade.criterionTo).toBe("returned");
    expect(out.cascade.successors).toContainEqual({ taskId: "c.2", to: "not_yet" });
    expect(out.cascade.notifications).toContainEqual({ audience: "student", kind: "criterion_returned" });

    const projected: CriterionSnapshot = {
      ...c,
      state: "returned",
      tasks: c.tasks.map((t) => (t.id === "c.2" ? { ...t, state: "not_yet" as TaskState } : t)),
    };
    const task5 = projected.tasks[4];
    expect(task5.state).toBe("verified");
    expect(isDisplayBlocked(task5, projected)).toBe(true);
    expect(isSubmittable(task5, projected)).toBe(false);
    expect(projected.tasks[1].state).toBe("not_yet");
    expect(isDisplayBlocked(projected.tasks[0], projected)).toBe(false);
  });

  it("duplicate ids in returnedTaskIds collapse to one successor (harmless)", () => {
    const c = criterionOf(3, "verified", { state: "review_underway" });
    const out = evaluateTransition(
      "criterion_return",
      ctx({ task: c.tasks[0], criterion: c, actorRole: "adult", actorId: "mum", returnedTaskIds: ["c.2", "c.2"], note: "x" })
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.cascade.successors).toEqual([{ taskId: "c.2", to: "not_yet" }]);
    }
  });

  it("refuses an empty return list (nothing_to_return)", () => {
    const c = criterionOf(3, "verified", { state: "review_underway" });
    const out = evaluateTransition(
      "criterion_return",
      ctx({ task: c.tasks[0], criterion: c, actorRole: "adult", actorId: "mum", returnedTaskIds: [], note: "x" })
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("nothing_to_return");
  });

  it("refuses a return with no note (note_required)", () => {
    const c = criterionOf(3, "verified", { state: "review_underway" });
    const out = evaluateTransition(
      "criterion_return",
      ctx({ task: c.tasks[0], criterion: c, actorRole: "adult", actorId: "mum", returnedTaskIds: ["c.1"], note: "" })
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("note_required");
  });

  it("refuses a return naming a non-member task (unknown_returned_task) — no stuck 'returned' with zero successors", () => {
    const c = criterionOf(3, "verified", { state: "review_underway" });
    const out = evaluateTransition(
      "criterion_return",
      ctx({ task: c.tasks[0], criterion: c, actorRole: "adult", actorId: "mum", returnedTaskIds: ["c.99"], note: "stale id" })
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("unknown_returned_task");
  });
});

/* -------------------------------------------- phase_return (modeled; T2 trigger) */

describe("phase_return (§9.4 returned outcome — modeled in T1, triggered in T2)", () => {
  const phaseCtx = (over: Partial<TransitionCtx> = {}): TransitionCtx => {
    const c = criterionOf(3, "verified", { id: "c", state: "review_underway" });
    return {
      actorRole: "adult",
      actorId: "mum",
      task: c.tasks[0],
      criterion: c,
      phase: { id: "01", state: "review_underway", criterionIds: ["c", "d"] },
      returnedCriterionIds: ["c"],
      ...over,
    };
  };

  it("an adult reopens a named criterion: phaseTo returned, criterionTo returned only for the named criterion, crest provisional", () => {
    const out = evaluateTransition("phase_return", phaseCtx());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(phaseCascade(out.cascade).phaseTo).toBe("returned");
    expect(out.cascade.criterionTo).toBe("returned");
    expect(out.cascade.awards).toBe("provisional");
    expect(out.cascade.notifications).toContainEqual({ audience: "student", kind: "phase_returned" });
  });

  it("a criterion NOT in the reopened list keeps its state", () => {
    // 'd' is a real member of the phase but is not the criterion in this call's ctx.
    const c = criterionOf(3, "verified", { id: "d", state: "review_underway" });
    const out = evaluateTransition(
      "phase_return",
      phaseCtx({ criterion: c, task: c.tasks[0], returnedCriterionIds: ["c"] })
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.cascade.criterionTo).toBe("review_underway");
  });

  it("refuses an empty reopen list (nothing_to_return)", () => {
    const out = evaluateTransition("phase_return", phaseCtx({ returnedCriterionIds: [] }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("nothing_to_return");
  });

  it("refuses a reopen naming a criterion not in the phase (unknown_returned_criterion) — mirrors criterion_return", () => {
    const out = evaluateTransition("phase_return", phaseCtx({ returnedCriterionIds: ["ghost-999"] }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("unknown_returned_criterion");
  });

  it("FAILS CLOSED when ctx.phase is omitted — no_such_transition, never a silent match on a default state", () => {
    const out = evaluateTransition("phase_return", phaseCtx({ phase: undefined }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("no_such_transition");
  });

  it("refuses when the phase is not actually in review_underway", () => {
    const out = evaluateTransition("phase_return", phaseCtx({ phase: { id: "01", state: "locked", criterionIds: ["c"] } }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("no_such_transition");
  });
});

/* ------------------------------- display-block enforcement (post-return rework) */

describe("display-block enforcement — the engine, not just the UI, blocks out-of-order work after a return", () => {
  const returnedCriterion = (c4State: TaskState): CriterionSnapshot => {
    const c = criterionOf(5, "verified", { state: "returned" });
    c.tasks[1] = task({ id: "c.2", seq: 2, state: "not_yet" });
    c.tasks[3] = task({ id: "c.4", seq: 4, state: c4State });
    return c;
  };

  it("submit on a display-blocked task is refused (display_blocked)", () => {
    const c = returnedCriterion("in_progress");
    const out = evaluateTransition("submit", ctx({ task: c.tasks[3], criterion: c, actorRole: "student" }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("display_blocked");
  });

  it("open on a display-blocked task is refused (display_blocked)", () => {
    const c = returnedCriterion("available");
    const out = evaluateTransition("open", ctx({ task: c.tasks[3], criterion: c, actorRole: "student" }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("display_blocked");
  });

  it("resume on a display-blocked later task is refused, but the EARLIEST returned task is workable", () => {
    const c = returnedCriterion("not_yet");
    const blocked = evaluateTransition("resume", ctx({ task: c.tasks[3], criterion: c, actorRole: "student" }));
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toBe("display_blocked");

    const workable = evaluateTransition("resume", ctx({ task: c.tasks[1], criterion: c, actorRole: "student" }));
    expect(workable.ok).toBe(true);
  });

  it("verify on a display-blocked task is refused even though its IMMEDIATE predecessor is verified (the multi-task-return gap)", () => {
    const c = criterionOf(5, "verified", { state: "returned" });
    c.tasks[1] = task({ id: "c.2", seq: 2, state: "not_yet" });
    c.tasks[3] = task({ id: "c.4", seq: 4, state: "submitted" });
    const out = evaluateTransition("verify", ctx({ task: c.tasks[3], criterion: c, actorRole: "adult", actorId: "mum" }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("predecessor_unverified");
  });
});

/* ------------------------- criterion holds `returned` until every task re-verifies */

describe("a returned criterion stays returned until every task re-verifies", () => {
  it("re-verifying a non-final outstanding task keeps criterionTo returned; the last flips it to review_underway", () => {
    const c = criterionOf(5, "verified", { state: "returned" });
    c.tasks[1] = task({ id: "c.2", seq: 2, state: "submitted" });
    c.tasks[2] = task({ id: "c.3", seq: 3, state: "submitted" });

    const first = evaluateTransition("verify", ctx({ task: c.tasks[1], criterion: c, actorRole: "adult", actorId: "mum" }));
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.cascade.criterionTo).toBe("returned");

    c.tasks[1] = { ...c.tasks[1], state: "verified", verifiedBy: "mum" };
    const last = evaluateTransition("verify", ctx({ task: c.tasks[2], criterion: c, actorRole: "adult", actorId: "mum" }));
    expect(last.ok).toBe(true);
    if (last.ok) expect(last.cascade.criterionTo).toBe("review_underway");
  });
});

/* --------------------------------------------------------------- band snapshot */

describe("band snapshot at first available", () => {
  it("unlock freezes the student's band onto the task", () => {
    const c = criterionOf(2, "verified");
    const locked = task({ id: "c.2", seq: 2, state: "locked", snapshotBand: null });
    c.tasks[0] = task({ id: "c.1", seq: 1, state: "verified" });
    c.tasks[1] = locked;
    const out = evaluateTransition(
      "unlock",
      ctx({ task: locked, criterion: c, actorRole: "system", actorId: null, studentBand: "g6_8" })
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.to).toBe("available");
      expect(taskCascade(out.cascade).snapshotBand).toBe("g6_8");
    }
  });

  it("effectiveBand reads the snapshot, so a later StudentProfile.band change does not move the variant", () => {
    const snapped = task({ state: "available", snapshotBand: "g3_5" });
    expect(effectiveBand(snapped, "g6_8")).toBe("g3_5");
    expect(effectiveBand(task({ snapshotBand: null }), "g9_12")).toBe("g9_12");
  });
});

/* --------------------------------------------- concurrency (§9.2 parallel criteria) */

describe("concurrency — criteria within a phase run in parallel (§9.2)", () => {
  it("a transition does not mutate the criterion snapshot it was handed (nor the phase's siblings)", () => {
    const phase = ["1.1", "1.2", "1.3"].map((id) => {
      const c = criterionOf(3, "available", { id });
      c.tasks[0] = task({ id: `${id}.1`, seq: 1, state: "in_progress" });
      return c;
    });
    const before = structuredClone(phase);

    const out = evaluateTransition("submit", ctx({ task: phase[0].tasks[0], criterion: phase[0], actorRole: "student" }));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.cascade.successors).toEqual([]);

    // Purity: the ACTED-ON criterion's own input snapshot is unchanged (the cascade
    // returns state changes for the applier; it never mutates ctx.criterion) — the
    // property a future applyChanges/cascade refactor could actually violate.
    expect(phase[0]).toEqual(before[0]);
    // And the untouched siblings are of course unchanged.
    expect(phase[1]).toEqual(before[1]);
    expect(phase[2]).toEqual(before[2]);
  });
});

/* ------------------------------------------------- version pinning (D27) */

describe("version pinning (D27) — every lookup routes through the pinned program_version_id", () => {
  it("criterion 2.3's SIXTH task, not its fifth, triggers the review", () => {
    expect(criterionTaskIds("2026-27", "2.3")).toHaveLength(6);
    expect(reviewTriggerTaskId("2026-27", "2.3")).toBe("2.3.6");
    expect(reviewTriggerTaskId("2026-27", "2.3")).not.toBe("2.3.5");
  });

  it("criterion 1.1 has five tasks and its closer is 1.1.5", () => {
    expect(criterionTaskIds("2026-27", "1.1")).toEqual(["1.1.1", "1.1.2", "1.1.3", "1.1.4", "1.1.5"]);
    expect(reviewTriggerTaskId("2026-27", "1.1")).toBe("1.1.5");
  });

  it("publishing a newer version does not alter a pinned student's task set; a sibling pinned later resolves the newer set", () => {
    const revised: ProgramContent = {
      versionId: "2099-99",
      phases: [
        {
          num: "01",
          key: "SELL",
          subtitle: "revised",
          seq: 1,
          criteria: [
            {
              id: "1.1",
              seq: 1,
              passCriterion: "revised",
              tasks: [1, 2, 3].map((n) => ({
                id: `1.1.${n}`,
                seq: n,
                title: `t${n}`,
                body: "b",
                doneWhen: "d",
                bandVariants: {},
                completesCriterion: n === 3,
              })),
            },
          ],
        },
      ],
    };
    registerProgram(revised);

    expect(criterionTaskIds("2026-27", "1.1")).toHaveLength(5);
    expect(criterionTaskIds("2099-99", "1.1")).toHaveLength(3);
    expect(reviewTriggerTaskId("2099-99", "1.1")).toBe("1.1.3");
  });

  it("an unknown version id fails loudly, never falling back to a 'current' global", () => {
    expect(() => criterionTaskIds("2050-00", "1.1")).toThrow();
  });
});

/* --------------------------------------------- integration: the 1.1 walkthrough */

describe("integration — a full criterion 1.1 walkthrough ends in review_underway with five verifications", () => {
  it("drives all five tasks open → submit → verify and lands the criterion in review", () => {
    const ids = criterionTaskIds("2026-27", "1.1");
    const tasks: TaskSnapshot[] = ids.map((id, i) =>
      task({ id, seq: i + 1, state: i === 0 ? "available" : "locked" })
    );
    const criterion: CriterionSnapshot = { id: "1.1", state: "active", tasks };
    const verifications: { taskId: string; by: string }[] = [];

    for (let i = 0; i < tasks.length; i++) {
      const opened = evaluateTransition("open", ctx({ task: criterion.tasks[i], criterion, actorRole: "student" }));
      expect(opened.ok).toBe(true);
      criterion.tasks[i] = { ...criterion.tasks[i], state: "in_progress" };

      const submitted = evaluateTransition("submit", ctx({ task: criterion.tasks[i], criterion, actorRole: "student" }));
      expect(submitted.ok).toBe(true);
      criterion.tasks[i] = { ...criterion.tasks[i], state: "submitted" };

      const verifyOut = evaluateTransition("verify", ctx({ task: criterion.tasks[i], criterion, actorRole: "adult", actorId: "mum" }));
      expect(verifyOut.ok).toBe(true);
      if (!verifyOut.ok) return;
      verifications.push({ taskId: criterion.tasks[i].id, by: "mum" });
      criterion.tasks[i] = { ...criterion.tasks[i], state: "verified", verifiedBy: "mum" };

      for (const s of verifyOut.cascade.successors) {
        const idx = criterion.tasks.findIndex((x) => x.id === s.taskId);
        if (idx >= 0) criterion.tasks[idx] = { ...criterion.tasks[idx], state: s.to };
      }

      if (i < tasks.length - 1) {
        expect(verifyOut.cascade.criterionTo).toBe("active");
      } else {
        expect(verifyOut.cascade.criterionTo).toBe("review_underway");
      }
    }

    expect(verifications).toHaveLength(5);
    expect(criterion.tasks.every((t) => t.state === "verified")).toBe(true);
  });
});
