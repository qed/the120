import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  bandForGrade,
  buildInitialProgressRows,
  buildTaskSnapshots,
  criterionIdOf,
  firstNameFromChildJoin,
  gradeFromChildJoin,
  interpretEcho,
  interpretReturnEcho,
  isTaskTransition,
  narrowTaskState,
  resultForEcho,
  TASK_TRANSITION_TARGETS,
  TASK_TRANSITIONS,
  transitionTarget,
  type ProgressEcho,
} from "../progress-core";
import { TASK_STATES, TRANSITIONS } from "../transition-table";

/* ---------------------------------------------- the hardcoded target map */

describe("TASK_TRANSITION_TARGETS — the hardcoded target the RPC's SQL CASE mirrors", () => {
  it("covers exactly the eight task-scope transitions (criterion/phase return are Unit 12)", () => {
    expect([...TASK_TRANSITIONS].sort()).toEqual(
      ["open", "not_yet", "resume", "revoke", "submit", "unlock", "verify", "withdraw"].sort()
    );
  });

  it("each target equals the `to` of the matching task-scope row in the Unit 7 table (single source of truth)", () => {
    // The RPC never accepts a caller-supplied target; it maps the transition NAME
    // to this literal. Pin every target against the engine's own table so the two
    // can never silently drift.
    for (const t of TASK_TRANSITIONS) {
      const row = TRANSITIONS.find((r) => r.name === t && r.scope === "task");
      expect(row, `task-scope row for "${t}"`).toBeDefined();
      expect(TASK_TRANSITION_TARGETS[t]).toBe(row!.to);
    }
  });

  it("each target equals the matching `when '<t>' then '<to>'` arm of the RPC's SQL CASE (closes the third-encoding drift)", () => {
    // The migration's SQL CASE is the third, hand-typed encoding of transition→to.
    // Parse it out of the migration and pin it against the TS map so a drift on
    // EITHER side fails a test, not just a manual production run.
    const sql = readFileSync(
      path.resolve(process.cwd(), "supabase/migrations/20260722120000_path_progress.sql"),
      "utf8"
    );
    const arms = [...sql.matchAll(/when\s+'(\w+)'\s+then\s+'([a-z_]+)'/g)];
    const sqlMap = Object.fromEntries(arms.map((m) => [m[1], m[2]]));
    // Every TS transition has an SQL arm with the identical target…
    for (const t of TASK_TRANSITIONS) {
      expect(sqlMap[t], `SQL CASE arm for "${t}"`).toBe(TASK_TRANSITION_TARGETS[t]);
    }
    // …and the SQL has no extra arms the TS map doesn't know about.
    expect(Object.keys(sqlMap).sort()).toEqual([...TASK_TRANSITIONS].sort());
  });

  it("the Unit 12 revoke-lock migration's re-created RPC carries the IDENTICAL CASE (fourth encoding pinned)", () => {
    // 20260723130000 re-creates move_path_task to add the revoke-branch
    // advisory lock; its copy of the transition CASE must never drift from
    // the TS map either.
    const sql = readFileSync(
      path.resolve(process.cwd(), "supabase/migrations/20260723130000_path_revoke_review_lock.sql"),
      "utf8"
    );
    const arms = [...sql.matchAll(/when\s+'(\w+)'\s+then\s+'([a-z_]+)'/g)];
    const sqlMap = Object.fromEntries(arms.map((m) => [m[1], m[2]]));
    for (const t of TASK_TRANSITIONS) {
      expect(sqlMap[t], `SQL CASE arm for "${t}"`).toBe(TASK_TRANSITION_TARGETS[t]);
    }
    expect(Object.keys(sqlMap).sort()).toEqual([...TASK_TRANSITIONS].sort());
    // The whole point of the file: revoke's review reconcile is now serialized.
    expect(sql).toContain("pg_advisory_xact_lock");
  });

  it("transitionTarget resolves the map", () => {
    expect(transitionTarget("verify")).toBe("verified");
    expect(transitionTarget("submit")).toBe("submitted");
    expect(transitionTarget("withdraw")).toBe("in_progress");
  });

  it("isTaskTransition guards the RPC's transition param", () => {
    expect(isTaskTransition("verify")).toBe(true);
    expect(isTaskTransition("criterion_return")).toBe(false); // criterion scope — not an RPC transition
    expect(isTaskTransition("phase_return")).toBe(false);
    expect(isTaskTransition("nonsense")).toBe(false);
  });

  it("criterionIdOf takes the first two dotted segments of a task id", () => {
    expect(criterionIdOf("1.2.4")).toBe("1.2");
    expect(criterionIdOf("2.3.6")).toBe("2.3");
    expect(criterionIdOf("5.5.5")).toBe("5.5");
  });
});

/* --------------------------------------------- the three-way echo interpretation */

function echo(over: Partial<ProgressEcho> = {}): ProgressEcho {
  return { wrote: false, state: "submitted", verifiedBy: null, decidedAt: null, ...over };
}

describe("interpretEcho — CAS echo, three ways (mirrors effectiveReviewStatus / stale-status-echo)", () => {
  it("our CAS wrote the row → applied", () => {
    const out = interpretEcho(
      { from: "submitted", to: "verified" },
      echo({ wrote: true, state: "verified", verifiedBy: "mum", decidedAt: "2026-07-22T19:42:00.000Z" })
    );
    expect(out.kind).toBe("applied");
    if (out.kind === "applied") expect(out.state).toBe("verified");
  });

  it("two concurrent verifies: the loser did NOT write but the DB reached the same target → superseded, with the winner", () => {
    const out = interpretEcho(
      { from: "submitted", to: "verified" },
      echo({ wrote: false, state: "verified", verifiedBy: "mum", decidedAt: "2026-07-22T19:42:00.000Z" })
    );
    expect(out.kind).toBe("superseded");
    if (out.kind === "superseded") {
      expect(out.winner.verifiedBy).toBe("mum");
      expect(out.winner.decidedAt).toBe("2026-07-22T19:42:00.000Z");
    }
  });

  it("verify vs not_yet race: the loser's target was NOT reached (DB went elsewhere) → diverged, adopt the DB value", () => {
    // Parent A verified (won); parent B intended not_yet and lost — the task is
    // `verified`, neither B's `to` (not_yet) nor B's `from` (submitted).
    const out = interpretEcho(
      { from: "submitted", to: "not_yet" },
      echo({ wrote: false, state: "verified", verifiedBy: "dad", decidedAt: "2026-07-22T19:41:00.000Z" })
    );
    expect(out.kind).toBe("diverged");
    if (out.kind === "diverged") expect(out.winner.state).toBe("verified");
  });

  it("nothing moved it (still at our from-state) → retryable, not a failure", () => {
    // "An errored response is not proof the write failed — re-read once before
    // reporting failure." A row still at `from` means the write did not land.
    const out = interpretEcho(
      { from: "submitted", to: "verified" },
      echo({ wrote: false, state: "submitted" })
    );
    expect(out.kind).toBe("retryable");
  });

  it("an idempotent replay (already at target, we didn't write) is superseded, never a phantom second write", () => {
    // The offline queue may replay a submit whose response was lost; the row is
    // already `submitted` and our CAS wrote nothing → superseded (adopt), not a
    // duplicate.
    const out = interpretEcho(
      { from: "in_progress", to: "submitted" },
      echo({ wrote: false, state: "submitted" })
    );
    expect(out.kind).toBe("superseded");
  });
});

/* ---------------------------------------- fail-closed DB-state narrowing */

describe("narrowTaskState — narrow an untyped DB state string, fail closed", () => {
  it("accepts every legal state", () => {
    for (const s of TASK_STATES) expect(narrowTaskState(s)).toBe(s);
  });

  it("rejects anything outside the union (null, unknown, wrong type) → null, never a coerced default", () => {
    expect(narrowTaskState("member")).toBeNull(); // a CRM status, not a Path state
    expect(narrowTaskState("VERIFIED")).toBeNull();
    expect(narrowTaskState("")).toBeNull();
    expect(narrowTaskState(null)).toBeNull();
    expect(narrowTaskState(undefined)).toBeNull();
    expect(narrowTaskState(3)).toBeNull();
  });
});

/* ------------------------------------------------- band derived from grade */

describe("bandForGrade — grade → band (Unit 5: band is derived, never stored)", () => {
  it("maps the three bands at their boundaries", () => {
    expect(bandForGrade(3)).toBe("g3_5");
    expect(bandForGrade(5)).toBe("g3_5");
    expect(bandForGrade(6)).toBe("g6_8");
    expect(bandForGrade(8)).toBe("g6_8");
    expect(bandForGrade(9)).toBe("g9_12");
    expect(bandForGrade(12)).toBe("g9_12");
  });

  it("returns null for a grade outside 3–12 or a null grade (Unit 15 owns the provisioning refusal)", () => {
    expect(bandForGrade(2)).toBeNull();
    expect(bandForGrade(13)).toBeNull();
    expect(bandForGrade(null)).toBeNull();
  });
});

describe("gradeFromChildJoin — normalise the Supabase one-to-one embed (array OR object)", () => {
  it("reads the grade from either shape", () => {
    expect(gradeFromChildJoin({ grade: 5 })).toBe(5);
    expect(gradeFromChildJoin([{ grade: 8 }])).toBe(8);
  });
  it("returns null for a null/absent/empty/non-numeric join", () => {
    expect(gradeFromChildJoin(null)).toBeNull();
    expect(gradeFromChildJoin([])).toBeNull();
    expect(gradeFromChildJoin({ grade: null })).toBeNull();
    expect(gradeFromChildJoin({ grade: "9" })).toBeNull();
    expect(gradeFromChildJoin(undefined)).toBeNull();
  });
});

describe("buildTaskSnapshots — pinned tasks joined with progress rows, fail closed", () => {
  const content = [
    { id: "1.1.1", seq: 1 },
    { id: "1.1.2", seq: 2 },
    { id: "1.1.3", seq: 3 },
  ];

  it("a task with a row reads its narrowed state; a task with no row reads `locked`", () => {
    const snaps = buildTaskSnapshots(
      content,
      [
        { task_id: "1.1.1", state: "verified", verified_by: "mum", review_opened_at: "t", snapshot_band: "g6_8" },
        { task_id: "1.1.2", state: "submitted" },
      ],
      "sX"
    );
    expect(snaps.map((s) => s.state)).toEqual(["verified", "submitted", "locked"]);
    expect(snaps[0].verifiedBy).toBe("mum");
    expect(snaps[0].snapshotBand).toBe("g6_8");
    expect(snaps[2].verifiedBy).toBeNull(); // no row → defaults
  });

  it("a row whose state is out-of-union THROWS (never a silent `locked` default)", () => {
    expect(() =>
      buildTaskSnapshots(content, [{ task_id: "1.1.1", state: "member" }], "sX")
    ).toThrow(/corrupt progress state/);
  });
});

describe("resultForEcho — EchoOutcome → client TransitionResult (the action's contract)", () => {
  const winnerEcho = (over: Partial<ProgressEcho> = {}): ProgressEcho =>
    ({ wrote: false, state: "verified", verifiedBy: "mum", decidedAt: "2026-07-22T19:42:00.000Z", ...over });

  it("applied → ok, byCaller true (our CAS wrote it)", () => {
    const r = resultForEcho({ kind: "applied", state: "verified" }, { transition: "verify", actorId: "mum" });
    expect(r).toEqual({ ok: true, state: "verified", byCaller: true });
  });

  it("superseded → ok but byCaller FALSE, with the winner (never claim the caller did it)", () => {
    const r = resultForEcho({ kind: "superseded", winner: winnerEcho() }, { transition: "verify", actorId: "dad" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.byCaller).toBe(false);
      expect(r.winner).toEqual({ state: "verified", verifiedBy: "mum", decidedAt: "2026-07-22T19:42:00.000Z" });
    }
  });

  it("superseded on a non-verified target (submit replay) nulls the stale verifiedBy/decidedAt", () => {
    const r = resultForEcho(
      { kind: "superseded", winner: winnerEcho({ state: "submitted", verifiedBy: "old", decidedAt: "old-t" }) },
      { transition: "submit", actorId: "kid" }
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.winner).toEqual({ state: "submitted", verifiedBy: null, decidedAt: null });
  });

  it("diverged → not-ok with its OWN reason (distinct from superseded); decidedAt kept for a not_yet", () => {
    const r = resultForEcho(
      { kind: "diverged", winner: winnerEcho({ state: "not_yet", verifiedBy: null, decidedAt: "d" }) },
      { transition: "verify", actorId: "mum" }
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("diverged");
      expect(r.winner).toEqual({ state: "not_yet", verifiedBy: null, decidedAt: "d" });
    }
  });

  it("retryable (non-revoke) → retry", () => {
    const r = resultForEcho(
      { kind: "retryable", echo: winnerEcho({ state: "in_progress" }) },
      { transition: "submit", actorId: "kid" }
    );
    expect(r).toEqual({ ok: false, reason: "retry" });
  });

  it("retryable revoke where the row is verified by SOMEONE ELSE → permanent not_original_verifier, not retry", () => {
    const r = resultForEcho(
      { kind: "retryable", echo: winnerEcho({ state: "verified", verifiedBy: "dad" }) },
      { transition: "revoke", actorId: "mum" } // mum is no longer the verifier
    );
    expect(r).toEqual({ ok: false, reason: "not_original_verifier" });
  });

  it("retryable revoke where the row is still verified by the actor → genuine retry", () => {
    const r = resultForEcho(
      { kind: "retryable", echo: winnerEcho({ state: "verified", verifiedBy: "mum" }) },
      { transition: "revoke", actorId: "mum" }
    );
    expect(r).toEqual({ ok: false, reason: "retry" });
  });
});

/* -------------------------------------------- initial progress materialization */

describe("buildInitialProgressRows — the Unit 14 provisioning-gap fix", () => {
  const version = "2026-27";
  const criteria = [
    { criterion_id: "1.1", phase_num: "01", seq: 1 },
    { criterion_id: "1.2", phase_num: "01", seq: 2 },
    { criterion_id: "2.1", phase_num: "02", seq: 1 },
  ];
  const tasks = [
    { task_id: "1.1.1", criterion_id: "1.1", seq: 1 },
    { task_id: "1.1.2", criterion_id: "1.1", seq: 2 },
    { task_id: "1.2.1", criterion_id: "1.2", seq: 1 },
    { task_id: "1.2.2", criterion_id: "1.2", seq: 2 },
    { task_id: "2.1.1", criterion_id: "2.1", seq: 1 },
  ];
  const firstPhaseNum = "01";

  it("marks the first task of each first-phase criterion available with the band snapshotted; everything else locked, band null", () => {
    const rows = buildInitialProgressRows({
      studentId: "s1",
      programVersionId: version,
      band: "g3_5",
      firstPhaseNum,
      criteria,
      tasks,
    });
    expect(rows).toHaveLength(5);
    const byTask = Object.fromEntries(rows.map((r) => [r.task_id, r]));
    expect(byTask["1.1.1"]).toMatchObject({ state: "available", snapshot_band: "g3_5" });
    expect(byTask["1.2.1"]).toMatchObject({ state: "available", snapshot_band: "g3_5" });
    expect(byTask["1.1.2"]).toMatchObject({ state: "locked", snapshot_band: null });
    expect(byTask["1.2.2"]).toMatchObject({ state: "locked", snapshot_band: null });
    expect(byTask["2.1.1"]).toMatchObject({ state: "locked", snapshot_band: null });
    for (const r of rows) {
      expect(r.student_id).toBe("s1");
      expect(r.program_version_id).toBe(version);
      expect(r.criterion_id).toBe(tasks.find((t) => t.task_id === r.task_id)!.criterion_id);
    }
  });

  it("refuses a null band — an unlock must never snapshot nothing (Unit 8 carry-forward)", () => {
    expect(() =>
      buildInitialProgressRows({
        studentId: "s1",
        programVersionId: version,
        band: null,
        firstPhaseNum,
        criteria,
        tasks,
      })
    ).toThrow(/band/i);
  });

  it("refuses an empty task list — materializing zero rows is a data bug, not a no-op", () => {
    expect(() =>
      buildInitialProgressRows({
        studentId: "s1",
        programVersionId: version,
        band: "g6_8",
        firstPhaseNum,
        criteria,
        tasks: [],
      })
    ).toThrow(/tasks/i);
  });

  it("a task whose criterion is missing from the criteria list throws, never silently locks", () => {
    expect(() =>
      buildInitialProgressRows({
        studentId: "s1",
        programVersionId: version,
        band: "g6_8",
        firstPhaseNum,
        criteria: criteria.filter((c) => c.criterion_id !== "1.2"),
        tasks,
      })
    ).toThrow(/1\.2/);
  });
});

describe("firstNameFromChildJoin — join-shape narrowing for the shell header", () => {
  it("normalises object and array join shapes", () => {
    expect(firstNameFromChildJoin({ first_name: "Maya" })).toBe("Maya");
    expect(firstNameFromChildJoin([{ first_name: "Dev" }])).toBe("Dev");
  });

  it("fails closed to null on malformed shapes — never an empty-string sentinel", () => {
    expect(firstNameFromChildJoin(null)).toBeNull();
    expect(firstNameFromChildJoin(undefined)).toBeNull();
    expect(firstNameFromChildJoin({})).toBeNull();
    expect(firstNameFromChildJoin({ first_name: 42 })).toBeNull();
    expect(firstNameFromChildJoin({ first_name: "" })).toBeNull();
    expect(firstNameFromChildJoin([])).toBeNull();
  });
});

/* ------------------------------------- the review-return echo (Unit 12) */

describe("interpretReturnEcho — the attempt-based criterion-return verdict", () => {
  const echo = (over: Partial<{
    decided: boolean;
    reviewState: string;
    reviewAttempt: number;
    decidedBy: string | null;
    decidedAt: string | null;
  }> = {}) => ({
    decided: false,
    reviewId: "rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr",
    reviewState: "returned",
    reviewAttempt: 1,
    decidedBy: "dad-uuid",
    decidedAt: "2026-07-23T10:00:00+00:00",
    ...over,
  });

  it("decided → applied (our decide wrote the attempt row)", () => {
    expect(interpretReturnEcho(echo({ decided: true }), 1)).toEqual({ kind: "applied" });
  });

  it("not decided, same attempt already returned → superseded with the winner's identity and time", () => {
    expect(interpretReturnEcho(echo(), 1)).toEqual({
      kind: "superseded",
      decidedBy: "dad-uuid",
      decidedAt: "2026-07-23T10:00:00+00:00",
    });
  });

  it("a NEWER attempt exists → stale (the reviewer's view predates a whole return/re-complete cycle)", () => {
    expect(interpretReturnEcho(echo({ reviewAttempt: 2, reviewState: "review_underway" }), 1)).toEqual({
      kind: "stale",
    });
  });

  it("a bogus future attempt from the client → stale, never applied", () => {
    expect(interpretReturnEcho(echo({ reviewAttempt: 1, reviewState: "review_underway" }), 5)).toEqual({
      kind: "stale",
    });
  });

  it("same attempt still review_underway (near-unreachable race residue) → retry", () => {
    expect(interpretReturnEcho(echo({ reviewState: "review_underway" }), 1)).toEqual({ kind: "retry" });
  });

  it("a cleared review (T2 outcome) → stale, never a T1 verdict", () => {
    expect(interpretReturnEcho(echo({ reviewState: "cleared" }), 1)).toEqual({ kind: "stale" });
  });

  it("no review row at all → not_found", () => {
    expect(interpretReturnEcho(null, 1)).toEqual({ kind: "not_found" });
  });
});
