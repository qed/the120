import { describe, expect, it } from "vitest";
import {
  classifyActionFailure,
  decisionFromEvents,
  deriveCriterionView,
  deriveMutability,
  derivePhaseViews,
  journeyPresentation,
  latestReviewStateByCriterion,
  pinCookieName,
  resolveCriterionNow,
  resolveTaskInProgram,
  sanitizePinnedTaskId,
  selectNowCard,
  skinForBand,
  splitCriterionLabel,
  transitionsAfterCapture,
  transitionsBeforeSubmit,
  unwrapActionResult,
  type NowCandidate,
} from "../now-card-rules";
import type { DeepReadonly, ProgramContent } from "@/app/path/content/types";
import type { TaskState } from "../transition-table";

/** Build a candidate with sane defaults; tests override what they exercise. */
function task(
  taskId: string,
  state: TaskState,
  lastTouchedAt: string | null = null,
  overrides: Partial<NowCandidate> = {}
): NowCandidate {
  const [phase, criterion, seq] = taskId.split(".").map(Number);
  return {
    taskId,
    criterionId: `${phase}.${criterion}`,
    criterionSeq: criterion,
    seq,
    state,
    lastTouchedAt,
    ...overrides,
  };
}

/** A whole criterion of five tasks: `states[i]` is task seq i+1. */
function criterion(criterionId: string, states: TaskState[], touched: (string | null)[] = []): NowCandidate[] {
  return states.map((state, i) => task(`${criterionId}.${i + 1}`, state, touched[i] ?? null));
}

const T = (h: number) => `2026-07-22T${String(h).padStart(2, "0")}:00:00.000Z`;

describe("selectNowCard", () => {
  it("with three criteria open, resolves to the most recently touched task (plan happy path)", () => {
    const candidates = [
      ...criterion("1.1", ["verified", "verified", "in_progress", "locked", "locked"], [T(1), T(2), T(3)]),
      ...criterion("1.2", ["verified", "in_progress", "locked", "locked", "locked"], [T(1), T(9)]),
      ...criterion("1.3", ["in_progress", "locked", "locked", "locked", "locked"], [T(5)]),
    ];
    const sel = selectNowCard({ candidates, pinnedTaskId: null });
    expect(sel).toEqual({ kind: "task", taskId: "1.2.2", pinned: false });
  });

  it("a student pin overrides recency until cleared (plan edge case)", () => {
    const candidates = [
      ...criterion("1.1", ["in_progress", "locked", "locked", "locked", "locked"], [T(9)]),
      ...criterion("1.2", ["available", "locked", "locked", "locked", "locked"], [T(1)]),
    ];
    expect(selectNowCard({ candidates, pinnedTaskId: "1.2.1" })).toEqual({
      kind: "task",
      taskId: "1.2.1",
      pinned: true,
    });
    // Pin cleared → recency resumes.
    expect(selectNowCard({ candidates, pinnedTaskId: null })).toEqual({
      kind: "task",
      taskId: "1.1.1",
      pinned: false,
    });
  });

  it("ignores a stale pin on a verified task", () => {
    const candidates = [
      ...criterion("1.1", ["verified", "in_progress", "locked", "locked", "locked"], [T(1), T(2)]),
    ];
    expect(selectNowCard({ candidates, pinnedTaskId: "1.1.1" })).toEqual({
      kind: "task",
      taskId: "1.1.2",
      pinned: false,
    });
  });

  it("ignores a stale pin on a locked task and on an unknown task id", () => {
    const candidates = [
      ...criterion("1.1", ["in_progress", "locked", "locked", "locked", "locked"], [T(2)]),
    ];
    expect(selectNowCard({ candidates, pinnedTaskId: "1.1.4" })).toEqual({
      kind: "task",
      taskId: "1.1.1",
      pinned: false,
    });
    expect(selectNowCard({ candidates, pinnedTaskId: "9.9.9" })).toEqual({
      kind: "task",
      taskId: "1.1.1",
      pinned: false,
    });
  });

  it("a submitted task is still eligible — the Now card renders the waiting state", () => {
    const candidates = [
      ...criterion("1.1", ["verified", "submitted", "locked", "locked", "locked"], [T(1), T(4)]),
      ...criterion("1.2", ["available", "locked", "locked", "locked", "locked"], [T(2)]),
    ];
    expect(selectNowCard({ candidates, pinnedTaskId: null })).toEqual({
      kind: "task",
      taskId: "1.1.2",
      pinned: false,
    });
  });

  it("a not_yet task is eligible and can win on recency", () => {
    const candidates = [
      ...criterion("1.1", ["verified", "not_yet", "locked", "locked", "locked"], [T(1), T(8)]),
      ...criterion("1.2", ["in_progress", "locked", "locked", "locked", "locked"], [T(3)]),
    ];
    expect(selectNowCard({ candidates, pinnedTaskId: null })).toEqual({
      kind: "task",
      taskId: "1.1.2",
      pinned: false,
    });
  });

  it("returns none when nothing is open (all locked or verified)", () => {
    const candidates = [
      ...criterion("1.1", ["verified", "verified", "verified", "verified", "verified"]),
      ...criterion("1.2", ["locked", "locked", "locked", "locked", "locked"]),
    ];
    expect(selectNowCard({ candidates, pinnedTaskId: null })).toEqual({ kind: "none" });
  });

  it("breaks timestamp ties by criterion order then task order (day-one determinism)", () => {
    // Provisioning stamps all five initial availables with the same instant.
    const candidates = [
      ...criterion("1.3", ["available", "locked", "locked", "locked", "locked"], [T(0)]),
      ...criterion("1.1", ["available", "locked", "locked", "locked", "locked"], [T(0)]),
      ...criterion("1.2", ["available", "locked", "locked", "locked", "locked"], [T(0)]),
    ];
    expect(selectNowCard({ candidates, pinnedTaskId: null })).toEqual({
      kind: "task",
      taskId: "1.1.1",
      pinned: false,
    });
  });

  it("sorts null lastTouchedAt after any real timestamp, and falls back to order when all null", () => {
    const withOneTouched = [
      ...criterion("1.1", ["available", "locked", "locked", "locked", "locked"]),
      ...criterion("1.2", ["available", "locked", "locked", "locked", "locked"], [T(1)]),
    ];
    expect(selectNowCard({ candidates: withOneTouched, pinnedTaskId: null })).toEqual({
      kind: "task",
      taskId: "1.2.1",
      pinned: false,
    });

    const allNull = [
      ...criterion("1.2", ["available", "locked", "locked", "locked", "locked"]),
      ...criterion("1.1", ["available", "locked", "locked", "locked", "locked"]),
    ];
    expect(selectNowCard({ candidates: allNull, pinnedTaskId: null })).toEqual({
      kind: "task",
      taskId: "1.1.1",
      pinned: false,
    });
  });

  it("treats an unparseable timestamp as null, never NaN-wins (fail closed)", () => {
    const candidates = [
      ...criterion("1.1", ["in_progress", "locked", "locked", "locked", "locked"], ["not-a-date"]),
      ...criterion("1.2", ["in_progress", "locked", "locked", "locked", "locked"], [T(1)]),
    ];
    expect(selectNowCard({ candidates, pinnedTaskId: null })).toEqual({
      kind: "task",
      taskId: "1.2.1",
      pinned: false,
    });
  });

  describe("display-blocked successors (revoke / criterion-return aftermath)", () => {
    it("excludes an open task whose earlier sibling is not verified", () => {
      // Task 2 was revoked to not_yet while task 3 sat submitted: task 3 is
      // display-blocked (un-submittable) and must not be the Now card even
      // though it was touched more recently.
      const candidates = [
        ...criterion("1.1", ["verified", "not_yet", "submitted", "locked", "locked"], [T(1), T(2), T(9)]),
      ];
      expect(selectNowCard({ candidates, pinnedTaskId: null })).toEqual({
        kind: "task",
        taskId: "1.1.2",
        pinned: false,
      });
    });

    it("a pin on a display-blocked task is ignored", () => {
      const candidates = [
        ...criterion("1.1", ["verified", "not_yet", "submitted", "locked", "locked"], [T(1), T(2), T(9)]),
      ];
      expect(selectNowCard({ candidates, pinnedTaskId: "1.1.3" })).toEqual({
        kind: "task",
        taskId: "1.1.2",
        pinned: false,
      });
    });

    it("normal forward flow is never display-blocked", () => {
      const candidates = [
        ...criterion("1.1", ["verified", "verified", "in_progress", "locked", "locked"], [T(1), T(2), T(3)]),
      ];
      expect(selectNowCard({ candidates, pinnedTaskId: null })).toEqual({
        kind: "task",
        taskId: "1.1.3",
        pinned: false,
      });
    });

    it("a MISSING earlier sibling fails closed — the later task never wins (partial-data guard)", () => {
      // Only seq 2-5 present: task 2's seq-1 sibling is absent from the list
      // entirely, so it must be treated as blocked, not eligible.
      const partial = criterion("1.1", ["in_progress", "locked", "locked", "locked", "locked"], [T(9)])
        .map((c) => ({ ...c, seq: c.seq + 1, taskId: `1.1.${c.seq + 1}` }));
      const other = criterion("1.2", ["available", "locked", "locked", "locked", "locked"], [T(1)]);
      expect(selectNowCard({ candidates: [...partial, ...other], pinnedTaskId: null })).toEqual({
        kind: "task",
        taskId: "1.2.1",
        pinned: false,
      });
    });
  });
});

describe("journeyPresentation", () => {
  it("day one — locked/available rows with at least one available → first_run (plan edge case)", () => {
    const candidates = [
      ...criterion("1.1", ["available", "locked", "locked", "locked", "locked"], [T(0)]),
      ...criterion("1.2", ["available", "locked", "locked", "locked", "locked"], [T(0)]),
    ];
    expect(journeyPresentation({ candidates, verifiedTotal: 0, evidenceCount: 0 })).toBe("first_run");
  });

  it("an opened task ends first-run", () => {
    const candidates = [
      ...criterion("1.1", ["in_progress", "locked", "locked", "locked", "locked"], [T(1)]),
    ];
    expect(journeyPresentation({ candidates, verifiedTotal: 0, evidenceCount: 0 })).toBe("mid_program");
  });

  it("any evidence ends first-run even before a transition", () => {
    const candidates = [
      ...criterion("1.1", ["available", "locked", "locked", "locked", "locked"], [T(0)]),
    ];
    expect(journeyPresentation({ candidates, verifiedTotal: 0, evidenceCount: 1 })).toBe("mid_program");
  });

  it("any verified task ends first-run", () => {
    const candidates = [
      ...criterion("1.1", ["verified", "available", "locked", "locked", "locked"], [T(0), T(1)]),
    ];
    expect(journeyPresentation({ candidates, verifiedTotal: 1, evidenceCount: 0 })).toBe("mid_program");
  });

  it("EVERY task locked → not_ready, never a healthy-looking day one (stranded-student shape)", () => {
    // A partially-failed ensureStudentProgress run leaves rows all-locked with
    // nothing clickable; rendering FirstRunHero would look intentional.
    const candidates = [
      ...criterion("1.1", ["locked", "locked", "locked", "locked", "locked"]),
      ...criterion("1.2", ["locked", "locked", "locked", "locked", "locked"]),
    ];
    expect(journeyPresentation({ candidates, verifiedTotal: 0, evidenceCount: 0 })).toBe("not_ready");
  });

  it("an empty candidate list is not_ready (progress never materialized)", () => {
    expect(journeyPresentation({ candidates: [], verifiedTotal: 0, evidenceCount: 0 })).toBe("not_ready");
  });
});

describe("deriveMutability", () => {
  it("locked → locked (no capture surface)", () => {
    expect(deriveMutability("locked", null)).toBe("locked");
  });

  it("available / in_progress / not_yet → editable", () => {
    expect(deriveMutability("available", null)).toBe("editable");
    expect(deriveMutability("in_progress", null)).toBe("editable");
    expect(deriveMutability("not_yet", null)).toBe("editable");
  });

  it("submitted with review not opened → locked_submitted (withdraw legal, plan edge case)", () => {
    expect(deriveMutability("submitted", null)).toBe("locked_submitted");
  });

  it("submitted with review opened → locked_review (withdraw illegal)", () => {
    expect(deriveMutability("submitted", T(3))).toBe("locked_review");
  });

  it("treats an empty-string reviewOpenedAt as unset (sentinel guard, D6)", () => {
    // The loader contract is null-never-"" (Unit 7 carry-forward); defend anyway.
    expect(deriveMutability("submitted", "")).toBe("locked_submitted");
  });

  it("verified → append_only (plan edge case)", () => {
    expect(deriveMutability("verified", null)).toBe("append_only");
  });
});

describe("deriveCriterionView", () => {
  it("all locked → locked with zero counts", () => {
    expect(
      deriveCriterionView({ id: "2.1", taskStates: ["locked", "locked", "locked", "locked", "locked"], review: "none" })
    ).toEqual({ id: "2.1", verifiedCount: 0, taskTotal: 5, status: "locked" });
  });

  it("any open task → active with honest counts", () => {
    expect(
      deriveCriterionView({
        id: "1.1",
        taskStates: ["verified", "verified", "in_progress", "locked", "locked"],
        review: "none",
      })
    ).toEqual({ id: "1.1", verifiedCount: 2, taskTotal: 5, status: "active" });
  });

  it("all verified with an open review → in_review", () => {
    expect(
      deriveCriterionView({
        id: "1.1",
        taskStates: ["verified", "verified", "verified", "verified", "verified"],
        review: "review_underway",
      })
    ).toEqual({ id: "1.1", verifiedCount: 5, taskTotal: 5, status: "in_review" });
  });

  it("a returned review → returned, even with all tasks re-verified pending re-review", () => {
    expect(
      deriveCriterionView({
        id: "1.1",
        taskStates: ["verified", "verified", "not_yet", "verified", "verified"],
        review: "returned",
      })
    ).toEqual({ id: "1.1", verifiedCount: 4, taskTotal: 5, status: "returned" });
  });

  it("a cleared review → cleared (T2 sets it; the shape is total now)", () => {
    expect(
      deriveCriterionView({
        id: "1.1",
        taskStates: ["verified", "verified", "verified", "verified", "verified"],
        review: "cleared",
      })
    ).toEqual({ id: "1.1", verifiedCount: 5, taskTotal: 5, status: "cleared" });
  });

  it("handles criterion 2.3's six tasks — never a hard-coded five", () => {
    expect(
      deriveCriterionView({
        id: "2.3",
        taskStates: ["verified", "verified", "verified", "in_progress", "locked", "locked"],
        review: "none",
      })
    ).toEqual({ id: "2.3", verifiedCount: 3, taskTotal: 6, status: "active" });
  });
});

describe("derivePhaseViews", () => {
  const phase = (id: string, criteria: Parameters<typeof deriveCriterionView>[0][]) => ({
    id,
    criteria: criteria.map(deriveCriterionView),
  });

  it("first phase active, later phases locked, counts aggregated (0/125 day one)", () => {
    const views = derivePhaseViews([
      phase("01", [
        { id: "1.1", taskStates: ["available", "locked", "locked", "locked", "locked"], review: "none" },
        { id: "1.2", taskStates: ["available", "locked", "locked", "locked", "locked"], review: "none" },
      ]),
      phase("02", [{ id: "2.1", taskStates: ["locked", "locked", "locked", "locked", "locked"], review: "none" }]),
    ]);
    expect(views[0]).toMatchObject({ id: "01", tasksVerified: 0, tasksTotal: 10, criteriaComplete: 0, status: "active" });
    expect(views[1]).toMatchObject({ id: "02", tasksVerified: 0, tasksTotal: 5, criteriaComplete: 0, status: "locked" });
  });

  it("a fully verified phase reads complete; the next becomes active", () => {
    const views = derivePhaseViews([
      phase("01", [
        { id: "1.1", taskStates: ["verified", "verified", "verified", "verified", "verified"], review: "review_underway" },
      ]),
      phase("02", [{ id: "2.1", taskStates: ["available", "locked", "locked", "locked", "locked"], review: "none" }]),
      phase("03", [{ id: "3.1", taskStates: ["locked", "locked", "locked", "locked", "locked"], review: "none" }]),
    ]);
    expect(views[0]).toMatchObject({ id: "01", tasksVerified: 5, criteriaComplete: 1, status: "complete" });
    expect(views[1]).toMatchObject({ id: "02", status: "active" });
    expect(views[2]).toMatchObject({ id: "03", status: "locked" });
  });

  it("everything verified → last phase complete, none active", () => {
    const views = derivePhaseViews([
      phase("01", [{ id: "1.1", taskStates: ["verified", "verified", "verified", "verified", "verified"], review: "cleared" }]),
      phase("02", [{ id: "2.1", taskStates: ["verified", "verified", "verified", "verified", "verified"], review: "cleared" }]),
    ]);
    expect(views.map((v) => v.status)).toEqual(["complete", "complete"]);
  });

  it("an in-review criterion counts toward criteriaComplete (progress, not award)", () => {
    const views = derivePhaseViews([
      phase("01", [
        { id: "1.1", taskStates: ["verified", "verified", "verified", "verified", "verified"], review: "review_underway" },
        { id: "1.2", taskStates: ["in_progress", "locked", "locked", "locked", "locked"], review: "none" },
      ]),
    ]);
    expect(views[0]).toMatchObject({ criteriaComplete: 1, status: "active" });
  });
});

describe("classifyActionFailure", () => {
  it("transient outages and rate limits are retryable", () => {
    expect(classifyActionFailure("unavailable")).toBe("retryable");
    expect(classifyActionFailure("retry")).toBe("retryable");
    expect(classifyActionFailure("rate_limited")).toBe("retryable");
  });

  it("state moved elsewhere → refresh, never a dead-end error", () => {
    expect(classifyActionFailure("diverged")).toBe("refresh");
    expect(classifyActionFailure("superseded")).toBe("refresh");
  });

  it("login is its own class (session expired → sign-in)", () => {
    expect(classifyActionFailure("login")).toBe("login");
  });

  it("everything else is terminal — quota, forbidden, caps, validation", () => {
    for (const reason of [
      "forbidden",
      "quota_exceeded",
      "link_overflow",
      "append_only_latched",
      "not_found",
      "invalid_input",
      "unsupported_type",
      "unknown_transition",
      "review_already_opened",
      "display_blocked",
      "gate_closed",
      "predecessor_unverified",
      "note_required",
      "something_never_seen_before",
    ]) {
      expect(classifyActionFailure(reason)).toBe("terminal");
    }
  });
});

describe("splitCriterionLabel", () => {
  it("splits the lead clause as the title and the remainder as detail", () => {
    expect(splitCriterionLabel("Make a real sale: a real customer who isn't family, real money changing hands")).toEqual({
      title: "Make a real sale",
      detail: "a real customer who isn't family, real money changing hands",
    });
  });

  it("a colon-less criterion is all title, no detail", () => {
    expect(splitCriterionLabel("Pitch a product in 60 seconds to an adult who isn't family, without notes")).toEqual({
      title: "Pitch a product in 60 seconds to an adult who isn't family, without notes",
      detail: null,
    });
  });

  it("degenerate shapes fail safe (never an empty title)", () => {
    expect(splitCriterionLabel(": just detail")).toEqual({ title: ": just detail", detail: "just detail" });
    expect(splitCriterionLabel("Title only:")).toEqual({ title: "Title only", detail: null });
  });
});

describe("pin cookie helpers", () => {
  it("pinCookieName is scoped per student (a shared tablet must not leak a sibling's pin)", () => {
    expect(pinCookieName("abc")).toBe("path-pin-abc");
    expect(pinCookieName("abc")).not.toBe(pinCookieName("def"));
  });

  it("sanitizePinnedTaskId accepts a well-formed id and fails closed on junk", () => {
    expect(sanitizePinnedTaskId("1.2.4")).toBe("1.2.4");
    expect(sanitizePinnedTaskId("10.2.14")).toBe("10.2.14");
    expect(sanitizePinnedTaskId("")).toBeNull();
    expect(sanitizePinnedTaskId(null)).toBeNull();
    expect(sanitizePinnedTaskId(undefined)).toBeNull();
    expect(sanitizePinnedTaskId("1.2")).toBeNull();
    expect(sanitizePinnedTaskId("../../etc")).toBeNull();
    expect(sanitizePinnedTaskId("1.2.4<script>")).toBeNull();
  });
});

describe("skinForBand", () => {
  it("Grades 3–5 default to Trail; 6–8 and 9–12 to HQ (handoff onboarding rule)", () => {
    expect(skinForBand("g3_5")).toBe("trail");
    expect(skinForBand("g6_8")).toBe("hq");
    expect(skinForBand("g9_12")).toBe("hq");
  });

  it("a null band (grade-less roster row) falls back to HQ — the grounded default", () => {
    expect(skinForBand(null)).toBe("hq");
  });
});

describe("unwrapActionResult", () => {
  it("normalizes the {ok,reason} family", () => {
    expect(unwrapActionResult({ ok: true })).toEqual({ ok: true });
    expect(unwrapActionResult({ ok: false, reason: "forbidden" })).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });

  it("normalizes the Unit 6 {success,error} family into the same shape", () => {
    expect(unwrapActionResult({ success: true })).toEqual({ ok: true });
    expect(unwrapActionResult({ success: false, error: "That password doesn't match." })).toEqual({
      ok: false,
      reason: "action_failed",
      message: "That password doesn't match.",
    });
    // A failure with no error text still fails — no message field, no success.
    expect(unwrapActionResult({ success: false })).toEqual({ ok: false, reason: "action_failed" });
  });

  it("an unrecognized shape fails closed", () => {
    expect(unwrapActionResult({} as never)).toEqual({ ok: false, reason: "action_failed" });
    expect(unwrapActionResult(null as never)).toEqual({ ok: false, reason: "action_failed" });
  });
});

/* -------------------------------------------- review-pass extractions (Unit 14) */

function miniProgram(): DeepReadonly<ProgramContent> {
  return {
    versionId: "test",
    phases: [
      {
        num: "01",
        key: "SELL",
        subtitle: "s",
        seq: 1,
        criteria: [
          {
            id: "1.1",
            seq: 1,
            passCriterion: "Pitch: no notes",
            tasks: [
              { id: "1.1.1", seq: 1, title: "a", body: "b", doneWhen: "d", bandVariants: {}, completesCriterion: false },
              { id: "1.1.2", seq: 2, title: "a2", body: "b2", doneWhen: "d2", bandVariants: {}, completesCriterion: true },
            ],
          },
        ],
      },
    ],
  } as DeepReadonly<ProgramContent>;
}

describe("resolveTaskInProgram — the not-found contract the pages map to 404", () => {
  it("resolves a known task with its phase and criterion", () => {
    const hit = resolveTaskInProgram(miniProgram(), "1.1.2");
    expect(hit).not.toBeNull();
    expect(hit!.phase.num).toBe("01");
    expect(hit!.criterion.id).toBe("1.1");
    expect(hit!.task.title).toBe("a2");
  });

  it("a well-formed but absent task id returns null (removed/renumbered content)", () => {
    expect(resolveTaskInProgram(miniProgram(), "1.1.9")).toBeNull();
  });

  it("a criterion absent from the program returns null", () => {
    expect(resolveTaskInProgram(miniProgram(), "9.9.1")).toBeNull();
  });
});

describe("resolveCriterionNow — the current step within one criterion", () => {
  const scoped = [
    ...criterion("1.1", ["verified", "in_progress", "locked", "locked", "locked"], [T(1), T(2)]),
  ];

  it("the journey-wide Now wins when it lives in this criterion", () => {
    expect(resolveCriterionNow("1.1.2", scoped)).toBe("1.1.2");
  });

  it("a journey Now living elsewhere falls back to the criterion's own selection", () => {
    expect(resolveCriterionNow("2.3.1", scoped)).toBe("1.1.2");
  });

  it("neither applies → null (everything verified or locked)", () => {
    const done = criterion("1.1", ["verified", "verified", "verified", "verified", "verified"]);
    expect(resolveCriterionNow(null, done)).toBeNull();
  });
});

describe("latestReviewStateByCriterion", () => {
  it("highest attempt wins regardless of input order", () => {
    const { states, dropped } = latestReviewStateByCriterion([
      { scopeId: "1.1", attempt: 2, state: "returned" },
      { scopeId: "1.1", attempt: 3, state: "review_underway" },
      { scopeId: "1.1", attempt: 1, state: "cleared" },
      { scopeId: "1.2", attempt: 1, state: "review_underway" },
    ]);
    expect(states).toEqual({ "1.1": "review_underway", "1.2": "review_underway" });
    expect(dropped).toEqual([]);
  });

  it("an unrecognized state is dropped fail-closed and reported, never coerced", () => {
    const { states, dropped } = latestReviewStateByCriterion([
      { scopeId: "1.1", attempt: 1, state: "cleared" },
      { scopeId: "1.2", attempt: 1, state: "garbage" },
    ]);
    expect(states).toEqual({ "1.1": "cleared" });
    expect(dropped).toEqual(["1.2:garbage"]);
  });
});

describe("decisionFromEvents — the reviewer's words on the task page", () => {
  it("a verify with a comment renders as verified", () => {
    expect(decisionFromEvents([{ transition: "verify", note: "Real sale, Maya." }])).toEqual({
      kind: "verified",
      note: "Real sale, Maya.",
    });
  });

  it("a not_yet note renders as not_yet", () => {
    expect(decisionFromEvents([{ transition: "not_yet", note: "Add the date." }])).toEqual({
      kind: "not_yet",
      note: "Add the date.",
    });
  });

  it("a REVOKE surfaces its note as the not-yet explanation (correctness review)", () => {
    expect(
      decisionFromEvents([
        { transition: "revoke", note: "Reopening — let's redo the log." },
        { transition: "verify", note: "Stale old praise." },
      ])
    ).toEqual({ kind: "not_yet", note: "Reopening — let's redo the log." });
  });

  it("a CRITERION RETURN surfaces its note as the not-yet explanation (Unit 16; the migration writes one 'criterion_return' event per returned task exactly so this note lands on the task page)", () => {
    expect(
      decisionFromEvents([
        { transition: "criterion_return", note: "Redo the delivery with a stranger." },
        { transition: "verify", note: "Stale old praise." },
      ])
    ).toEqual({ kind: "not_yet", note: "Redo the delivery with a stranger." });
  });

  it("a phase_return note surfaces the same way (modeled for T2 — never a bare chip)", () => {
    expect(
      decisionFromEvents([{ transition: "phase_return", note: "The whole territory needs one more pass." }])
    ).toEqual({ kind: "not_yet", note: "The whole territory needs one more pass." });
  });

  it("a noteless latest decision shows NOTHING — never a stale older note", () => {
    expect(
      decisionFromEvents([
        { transition: "revoke", note: null },
        { transition: "verify", note: "Old praise." },
      ])
    ).toBeNull();
  });

  it("non-decision transitions are skipped", () => {
    expect(
      decisionFromEvents([
        { transition: "submit", note: null },
        { transition: "verify", note: "Nice." },
      ])
    ).toEqual({ kind: "verified", note: "Nice." });
  });

  it("no decisions at all → null", () => {
    expect(decisionFromEvents([])).toBeNull();
  });
});

describe("transition choreography (state → required sequence)", () => {
  it("submit from available opens first; from not_yet resumes first; else nothing", () => {
    expect(transitionsBeforeSubmit("available")).toEqual(["open"]);
    expect(transitionsBeforeSubmit("not_yet")).toEqual(["resume"]);
    expect(transitionsBeforeSubmit("in_progress")).toEqual([]);
    expect(transitionsBeforeSubmit("submitted")).toEqual([]);
    expect(transitionsBeforeSubmit("verified")).toEqual([]);
    expect(transitionsBeforeSubmit("locked")).toEqual([]);
  });

  it("capture touches the state the same way (opened / evidence added)", () => {
    expect(transitionsAfterCapture("available")).toEqual(["open"]);
    expect(transitionsAfterCapture("not_yet")).toEqual(["resume"]);
    expect(transitionsAfterCapture("in_progress")).toEqual([]);
  });
});

describe("derivePhaseViews — revoke-across-phases semantics (pinned)", () => {
  it("a later fully-verified phase STAYS complete when an earlier phase reopens", () => {
    // Earned progress is never retroactively hidden (D23 posture).
    const phase = (id: string, criteria: Parameters<typeof deriveCriterionView>[0][]) => ({
      id,
      criteria: criteria.map(deriveCriterionView),
    });
    const views = derivePhaseViews([
      phase("01", [{ id: "1.1", taskStates: ["verified", "not_yet", "verified", "verified", "verified"], review: "returned" }]),
      phase("02", [{ id: "2.1", taskStates: ["verified", "verified", "verified", "verified", "verified"], review: "cleared" }]),
    ]);
    expect(views[0]).toMatchObject({ status: "active" });
    expect(views[1]).toMatchObject({ status: "complete" });
  });
});
