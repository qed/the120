import { describe, expect, it } from "vitest";
import PROGRAM from "@/app/path/content/generated/program-2026-27";
import {
  LOG_TEMPLATES,
  columnsForBand,
  logTemplateFor,
} from "@/app/path/content/log-templates";
import {
  SAFETY_COPY,
  SAFETY_FLAGS,
  STANDING_SAFETY_RULES,
  flaggedTaskIds,
  safetyFlagsFor,
} from "@/app/path/content/safety-flags";
import {
  EVIDENCE_SPECS,
  evidenceSpecFor,
} from "@/app/path/content/evidence-spec";
import { BANDS } from "@/app/path/content/types";

/**
 * The sidecars are hand-authored, so the risk is not a parse bug — it is an
 * entry that drifts from the content package. A sidecar keyed to a task that
 * does not exist is dead weight that renders nothing; the reverse (a task with
 * no entry) is a supported state and must NOT be treated as an error.
 */

const TASK_IDS = new Set(
  PROGRAM.phases.flatMap((p) => p.criteria.flatMap((c) => c.tasks.map((t) => t.id)))
);
const phase01TaskIds = PROGRAM.phases[0].criteria.flatMap((c) =>
  c.tasks.map((t) => t.id)
);

describe("every sidecar entry addresses a real task", () => {
  it.each(LOG_TEMPLATES.map((t) => t.taskId))("log template %s", (id) => {
    expect(TASK_IDS.has(id)).toBe(true);
  });

  it.each(flaggedTaskIds())("safety flags %s", (id) => {
    expect(TASK_IDS.has(id)).toBe(true);
  });

  it.each(EVIDENCE_SPECS.map((s) => s.taskId))("evidence spec %s", (id) => {
    expect(TASK_IDS.has(id)).toBe(true);
  });
});

describe("log templates", () => {
  it("covers the trackers the curriculum names", () => {
    const ids = LOG_TEMPLATES.map((t) => t.taskId);
    // The four the plan calls out by name, plus the three the source defines
    // with the same explicitness.
    expect(ids).toEqual(
      expect.arrayContaining(["1.3.1", "1.5.2", "4.1.1", "4.2.1"])
    );
  });

  it("keeps column keys unique within a template", () => {
    for (const t of LOG_TEMPLATES) {
      const keys = columnsForBand(t, "g9_12").map((c) => c.key);
      expect(new Set(keys).size, t.taskId).toBe(keys.length);
    }
  });

  it("carries the 25-attempt tracker's fixed row count and 9–12 follow-up column", () => {
    const tracker = logTemplateFor("1.5.2")!;
    expect(tracker.fixedRows).toBe(25);
    expect(columnsForBand(tracker, "g3_5").map((c) => c.key)).not.toContain(
      "follow_up"
    );
    expect(columnsForBand(tracker, "g9_12").map((c) => c.key)).toContain(
      "follow_up"
    );
  });

  it("carries the P&L's 9–12 cumulative profit row", () => {
    const pl = logTemplateFor("4.2.1")!;
    expect(columnsForBand(pl, "g6_8").map((c) => c.key)).not.toContain(
      "cumulative_profit"
    );
    expect(columnsForBand(pl, "g9_12").map((c) => c.key)).toContain(
      "cumulative_profit"
    );
  });

  it("gives the sales ledger a new/repeat choice — 4.1's bar depends on it", () => {
    // "10 sales or 3 repeat customers" cannot be computed without this column.
    const ledger = logTemplateFor("4.1.1")!;
    const col = ledger.columns.find((c) => c.key === "new_or_repeat")!;
    expect(col.type).toBe("choice");
    expect(col.options).toEqual(["new", "repeat"]);
  });

  it("records the source sentence for every template", () => {
    // Hand-authored content must be checkable without re-reading the brief.
    for (const t of LOG_TEMPLATES) {
      expect(t.source.length, t.taskId).toBeGreaterThan(20);
      expect(t.source, t.taskId).toContain(t.taskId);
    }
  });

  it("returns undefined for a task that creates no log", () => {
    expect(logTemplateFor("1.1.1")).toBeUndefined();
  });

  it("throws when a band column collides with a base column key", () => {
    // The guard the current data never triggers — proven here so deleting it
    // would fail a test, not pass silently.
    const colliding = {
      taskId: "x.y.z",
      name: "collision",
      columns: [{ key: "date", label: "Date", type: "date" as const }],
      bandColumns: {
        g9_12: [{ key: "date", label: "Also date", type: "date" as const }],
      },
      source: "synthetic fixture for the collision guard",
    };
    expect(() => columnsForBand(colliding, "g9_12")).toThrow(/collides/);
  });
});

describe("safety flags", () => {
  it("covers every Phase 01 task that puts a child in front of a stranger", () => {
    // Phase 01 is the door-to-door phase and the plan's stated floor. These are
    // the tasks where a missing Safety note has real-world consequence.
    for (const id of ["1.2.4", "1.2.5", "1.5.3", "1.5.4"]) {
      expect(safetyFlagsFor(id), id).toContain("parent_present");
    }
  });

  it("flags the explicit approval gate at 2.3.2", () => {
    // "Parent reviews and approves before anything is sent" — the source's
    // clearest statement of the gate.
    expect(safetyFlagsFor("2.3.2")).toContain("approval_gate");
  });

  it("flags publishing rules wherever content goes public", () => {
    for (const id of ["2.1.5", "3.5.1", "3.5.2", "3.5.3"]) {
      expect(safetyFlagsFor(id), id).toContain("publishing_rules");
    }
  });

  it("returns an empty list for desk-bound tasks — absence is correct", () => {
    expect(safetyFlagsFor("1.1.1")).toEqual([]);
    expect(safetyFlagsFor("1.4.4")).toEqual([]);
  });

  it("flags EVERY task in a live-outreach criterion, not a subset", () => {
    // 1.3 (hear three no's) and 1.5 (25 attempts) are wall-to-wall real-world
    // solicitation once they start. A per-task subset let 1.3.4 and 1.5.5 slip
    // through — the closing tasks, which read like arithmetic but are ten more
    // doorsteps. Every task from the first ask onward carries a flag.
    const liveOutreach = [
      "1.3.2",
      "1.3.3",
      "1.3.4",
      "1.5.3",
      "1.5.4",
      "1.5.5",
    ];
    for (const id of liveOutreach) {
      expect(safetyFlagsFor(id), id).toContain("parent_present");
    }
  });

  it("has display copy for every flag it can emit", () => {
    const used = new Set(Object.values(SAFETY_FLAGS).flat());
    for (const flag of used) {
      expect(SAFETY_COPY[flag], flag).toBeTruthy();
    }
  });

  it("carries the standing rules that apply regardless of task", () => {
    expect(STANDING_SAFETY_RULES.length).toBeGreaterThanOrEqual(4);
    expect(STANDING_SAFETY_RULES.join(" ")).toContain("physically present");
  });
});

describe("evidence specs", () => {
  it("covers Phase 01 except where the task files no artifact", () => {
    const covered = new Set(EVIDENCE_SPECS.map((s) => s.taskId));
    const uncovered = phase01TaskIds.filter((id) => !covered.has(id));
    // 1.2.3 is the dress rehearsal — its Done-when is a parent-witnessed
    // condition ("run start to finish … without stopping") with nothing to
    // file. Absence here is deliberate, not a gap.
    expect(uncovered).toEqual(["1.2.3"]);
  });

  it("falls back rather than inventing a spec", () => {
    expect(evidenceSpecFor("1.2.3")).toBeUndefined();
    // Unit 14 renders the Done-when line as the standard in this case.
    const task = PROGRAM.phases[0].criteria[1].tasks[2];
    expect(task.id).toBe("1.2.3");
    expect(task.doneWhen).toContain("without stopping");
  });

  it("requires at least one evidence kind and a positive count", () => {
    for (const s of EVIDENCE_SPECS) {
      expect(s.required.length, s.taskId).toBeGreaterThan(0);
      expect(s.minCount, s.taskId).toBeGreaterThan(0);
    }
  });

  it("asks for a video where the Done-when line demands one", () => {
    // 1.1.3: "a video of three consecutive clean, note-free runs".
    expect(evidenceSpecFor("1.1.3")!.required).toContain("video");
  });

  it("asks for two items on 1.2.5 — the record AND the photo", () => {
    const spec = evidenceSpecFor("1.2.5")!;
    expect(spec.minCount).toBe(2);
    expect(spec.required).toEqual(expect.arrayContaining(["photo", "log_table"]));
  });

  it("pairs a log_table requirement with a template where one exists", () => {
    for (const s of EVIDENCE_SPECS) {
      if (!s.required.includes("log_table")) continue;
      // Not every log_table task builds its own template — 1.3.2 fills the one
      // 1.3.1 created — so only assert the template exists somewhere upstream.
      const criterionId = s.taskId.split(".").slice(0, 2).join(".");
      const templatesInCriterion = LOG_TEMPLATES.filter((t) =>
        t.taskId.startsWith(`${criterionId}.`)
      );
      expect(templatesInCriterion.length, s.taskId).toBeGreaterThan(0);
    }
  });
});

describe("band coverage of sidecars", () => {
  it("resolves log columns for every band without throwing", () => {
    for (const t of LOG_TEMPLATES) {
      for (const b of BANDS) {
        expect(columnsForBand(t, b).length, `${t.taskId}/${b}`).toBeGreaterThan(0);
      }
    }
  });
});
