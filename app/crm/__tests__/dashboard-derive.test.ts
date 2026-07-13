/**
 * GTM dashboard aggregation tests (plan Unit 6). Fixtures pin the funnel
 * math to plan Decision 2's provisions: cumulative counts at Toronto week
 * boundaries, refund netting, calls from immutable per-stamp history events
 * (net of clears, pre-sprint excluded), snapshot coalescing, and the delta /
 * week-tick rules. The sprint sits in EDT (UTC−4): W1 runs
 * 2026-07-13T04:00Z → 2026-07-20T04:00Z; W8 ends 2026-09-05T04:00Z.
 */

import { describe, expect, it } from "vitest";
import {
  applyActionToggle,
  applyCounterBump,
  asNonFunnelTargets,
  asWeekActions,
  computeFunnelActuals,
  computeSeatsByGroup,
  computeSourceTally,
  computeThisWeekStats,
  coolingOff,
  followUpsDue,
  funnelDelta,
  stampEffectiveMs,
  warmingUp,
  weekTick,
  type BriefingFamily,
  type FunnelActuals,
  type GtmFamilyInput,
  type GtmStampEventInput,
  type GtmTargetsRow,
  type GtmTruth,
} from "@/app/crm/lib/gtm";

/* ------------------------------------------------------------- fixtures */

let seq = 0;
const nextId = () => `id-${++seq}`;

function family(overrides: Partial<GtmFamilyInput> = {}): GtmFamilyInput {
  return {
    id: nextId(),
    created_at: "2026-07-14T12:00:00Z", // W1
    consent_given: true,
    consent_revoked_at: null,
    parent_id: null,
    signup_at: null,
    dossier_submitted_at: null,
    ...overrides,
  };
}

function stamp(
  familyId: string,
  kind: "call_booked" | "call_held",
  effectiveIso: string,
  rowCreatedIso = effectiveIso
): GtmStampEventInput {
  return {
    family_id: familyId,
    to_stage: kind,
    note: `stamp · ${effectiveIso}`,
    created_at: rowCreatedIso,
  };
}

function clear(
  familyId: string,
  kind: "call_booked" | "call_held",
  createdIso: string
): GtmStampEventInput {
  return {
    family_id: familyId,
    to_stage: kind,
    note: "stamp-cleared",
    created_at: createdIso,
  };
}

const emptyTruth = (over: Partial<GtmTruth> = {}): GtmTruth => ({
  families: [],
  children: [],
  deposits: [],
  stampEvents: [],
  ...over,
});

const targetsRow = (over: Partial<GtmTargetsRow> = {}): GtmTargetsRow => ({
  week: 1,
  interested: 20,
  accounts: 11,
  dossiers_submitted: 8,
  calls_booked: 10,
  calls_held: 8,
  deposits: 0,
  ...over,
});

const zeroActuals = (over: Partial<FunnelActuals> = {}): FunnelActuals => ({
  interested: 0,
  accounts: 0,
  dossiers_submitted: 0,
  calls_booked: 0,
  calls_held: 0,
  deposits: 0,
  ...over,
});

/* -------------------------------------------------- interested (consent) */

describe("computeFunnelActuals · interested", () => {
  it("counts consented families cumulatively from their week onward", () => {
    const truth = emptyTruth({
      families: [
        family({ created_at: "2026-07-14T12:00:00Z" }), // W1
        family({ created_at: "2026-07-29T12:00:00Z" }), // W3
      ],
    });
    expect(computeFunnelActuals(1, truth).interested).toBe(1);
    expect(computeFunnelActuals(2, truth).interested).toBe(1);
    expect(computeFunnelActuals(3, truth).interested).toBe(2);
    expect(computeFunnelActuals(8, truth).interested).toBe(2);
  });

  it("excludes non-consented families from interested only", () => {
    const truth = emptyTruth({
      families: [
        family({
          consent_given: false,
          parent_id: "p1",
          signup_at: "2026-07-14T12:00:00Z",
        }),
      ],
      deposits: [
        {
          status: "paid",
          created_at: "2026-07-15T12:00:00Z",
          refunded_at: null,
        },
      ],
    });
    const w1 = computeFunnelActuals(1, truth);
    expect(w1.interested).toBe(0); // consented only (brief footnote)
    expect(w1.accounts).toBe(1); // other rows count everyone
    expect(w1.deposits).toBe(1);
  });

  it("Sunday 23:59 Toronto counts in that week; Monday 00:01 in the next", () => {
    const truth = emptyTruth({
      families: [
        family({ created_at: "2026-07-20T03:59:00Z" }), // Sun Jul 19 23:59 EDT
        family({ created_at: "2026-07-20T04:01:00Z" }), // Mon Jul 20 00:01 EDT
      ],
    });
    expect(computeFunnelActuals(1, truth).interested).toBe(1);
    expect(computeFunnelActuals(2, truth).interested).toBe(2);
  });

  it("consent revocation nets out of weeks ending after the revoke", () => {
    const truth = emptyTruth({
      families: [
        family({
          created_at: "2026-07-14T12:00:00Z",
          consent_revoked_at: "2026-08-12T12:00:00Z", // W5
        }),
      ],
    });
    expect(computeFunnelActuals(4, truth).interested).toBe(1);
    expect(computeFunnelActuals(5, truth).interested).toBe(0);
    expect(computeFunnelActuals(8, truth).interested).toBe(0);
  });
});

/* -------------------------------------------- accounts/dossier snapshots */

describe("computeFunnelActuals · snapshot coalescing", () => {
  it("counts a deleted account via its signup_at snapshot (Decision 2c)", () => {
    const truth = emptyTruth({
      families: [
        family({ parent_id: null, signup_at: "2026-07-15T12:00:00Z" }),
      ],
    });
    expect(computeFunnelActuals(1, truth).accounts).toBe(1);
  });

  it("falls back to created_at for a linked family missing its snapshot", () => {
    const truth = emptyTruth({
      families: [
        family({
          parent_id: "p1",
          signup_at: null,
          created_at: "2026-07-22T12:00:00Z", // W2
        }),
      ],
    });
    expect(computeFunnelActuals(1, truth).accounts).toBe(0);
    expect(computeFunnelActuals(2, truth).accounts).toBe(1);
  });

  it("a plain lead never counts as an account", () => {
    const truth = emptyTruth({ families: [family()] });
    expect(computeFunnelActuals(8, truth).accounts).toBe(0);
  });

  it("counts dossiers from the snapshot even when children are gone", () => {
    const truth = emptyTruth({
      families: [
        family({ dossier_submitted_at: "2026-07-16T12:00:00Z" }),
      ],
    });
    expect(computeFunnelActuals(1, truth).dossiers_submitted).toBe(1);
  });

  it("coalesces live children.submitted_at when the snapshot is missing", () => {
    const truth = emptyTruth({
      families: [family({ parent_id: "p1" })],
      children: [
        {
          parent_id: "p1",
          status: "submitted",
          submitted_at: "2026-07-23T12:00:00Z", // W2
        },
        // Another parent's child must not leak into this family's count.
        {
          parent_id: "p-other",
          status: "submitted",
          submitted_at: "2026-07-14T12:00:00Z",
        },
      ],
    });
    expect(computeFunnelActuals(1, truth).dossiers_submitted).toBe(0);
    expect(computeFunnelActuals(2, truth).dossiers_submitted).toBe(1);
  });
});

/* ----------------------------------------------------- deposits netting */

describe("computeFunnelActuals · refund netting (Decision 2a)", () => {
  it("paid W2 / refunded W5 counts in W2–W4, not W5+", () => {
    const truth = emptyTruth({
      deposits: [
        {
          status: "refunded", // webhook flips status AND stamps refunded_at
          created_at: "2026-07-22T12:00:00Z", // W2
          refunded_at: "2026-08-12T12:00:00Z", // W5
        },
      ],
    });
    expect(computeFunnelActuals(1, truth).deposits).toBe(0);
    expect(computeFunnelActuals(2, truth).deposits).toBe(1);
    expect(computeFunnelActuals(4, truth).deposits).toBe(1);
    expect(computeFunnelActuals(5, truth).deposits).toBe(0);
    expect(computeFunnelActuals(8, truth).deposits).toBe(0);
  });

  it("a live paid deposit counts from its week onward", () => {
    const truth = emptyTruth({
      deposits: [
        { status: "paid", created_at: "2026-07-29T12:00:00Z", refunded_at: null },
      ],
    });
    expect(computeFunnelActuals(2, truth).deposits).toBe(0);
    expect(computeFunnelActuals(3, truth).deposits).toBe(1);
  });

  it("never-paid rows don't count", () => {
    const truth = emptyTruth({
      deposits: [
        { status: "pending", created_at: "2026-07-14T12:00:00Z", refunded_at: null },
      ],
    });
    expect(computeFunnelActuals(8, truth).deposits).toBe(0);
  });
});

/* -------------------------------------------------- calls from history */

describe("computeFunnelActuals · calls from per-stamp events (Decision 2b)", () => {
  it("counts DISTINCT families, per kind", () => {
    const truth = emptyTruth({
      stampEvents: [
        stamp("fam-a", "call_booked", "2026-07-15T12:00:00Z"),
        stamp("fam-a", "call_booked", "2026-07-16T12:00:00Z"), // overwrite
        stamp("fam-b", "call_booked", "2026-07-16T12:00:00Z"),
        stamp("fam-a", "call_held", "2026-07-17T12:00:00Z"),
      ],
    });
    const w1 = computeFunnelActuals(1, truth);
    expect(w1.calls_booked).toBe(2);
    expect(w1.calls_held).toBe(1);
  });

  it("a clear removes the family; a later re-stamp restores it", () => {
    const truth = emptyTruth({
      stampEvents: [
        stamp("fam-a", "call_booked", "2026-07-15T12:00:00Z"), // W1
        clear("fam-a", "call_booked", "2026-07-28T12:00:00Z"), // W3
        stamp("fam-a", "call_booked", "2026-08-05T12:00:00Z"), // W4
      ],
    });
    expect(computeFunnelActuals(1, emptyTruth({ stampEvents: truth.stampEvents.slice(0, 1) })).calls_booked).toBe(1);
    expect(computeFunnelActuals(2, truth).calls_booked).toBe(1);
    expect(computeFunnelActuals(3, truth).calls_booked).toBe(0);
    expect(computeFunnelActuals(4, truth).calls_booked).toBe(1);
  });

  it("uses the effective time from the note, not the row's created_at", () => {
    // Backdated stamp: recorded in W3 for a call that happened in W1.
    const truth = emptyTruth({
      stampEvents: [
        stamp(
          "fam-a",
          "call_held",
          "2026-07-15T12:00:00Z",
          "2026-07-29T12:00:00Z"
        ),
      ],
    });
    expect(computeFunnelActuals(1, truth).calls_held).toBe(1);
  });

  it("falls back to the row's created_at when the note doesn't parse", () => {
    const truth = emptyTruth({
      stampEvents: [
        {
          family_id: "fam-a",
          to_stage: "call_booked",
          note: "stamp · not-a-date",
          created_at: "2026-07-22T12:00:00Z", // W2
        },
      ],
    });
    expect(computeFunnelActuals(1, truth).calls_booked).toBe(0);
    expect(computeFunnelActuals(2, truth).calls_booked).toBe(1);
  });

  it("excludes events timestamped before Jul 13 (pre-sprint)", () => {
    const truth = emptyTruth({
      stampEvents: [
        stamp("fam-a", "call_booked", "2026-07-10T12:00:00Z"),
      ],
    });
    expect(computeFunnelActuals(8, truth).calls_booked).toBe(0);
  });

  it("boundary: a Sunday 23:59 Toronto stamp counts in that week", () => {
    const truth = emptyTruth({
      stampEvents: [
        stamp("fam-a", "call_booked", "2026-07-20T03:59:00Z"), // Sun 23:59 EDT
        stamp("fam-b", "call_booked", "2026-07-20T04:01:00Z"), // Mon 00:01 EDT
      ],
    });
    expect(computeFunnelActuals(1, truth).calls_booked).toBe(1);
    expect(computeFunnelActuals(2, truth).calls_booked).toBe(2);
  });
});

describe("stampEffectiveMs", () => {
  it("parses the ISO from a stamp note", () => {
    expect(
      stampEffectiveMs("stamp · 2026-07-15T12:00:00Z", "2026-07-29T00:00:00Z")
    ).toBe(Date.parse("2026-07-15T12:00:00Z"));
  });
  it("falls back to created_at for non-stamp or malformed notes", () => {
    const fallback = Date.parse("2026-07-29T00:00:00Z");
    expect(stampEffectiveMs(null, "2026-07-29T00:00:00Z")).toBe(fallback);
    expect(stampEffectiveMs("stamp · junk", "2026-07-29T00:00:00Z")).toBe(fallback);
  });
});

/* ------------------------------------------------------------ delta rule */

describe("funnelDelta", () => {
  it("is null-safe against a missing target row", () => {
    expect(funnelDelta(5, null)).toBeNull();
    expect(funnelDelta(5, undefined)).toBeNull();
  });

  it("green on/over target, amber under, red below 70%", () => {
    expect(funnelDelta(10, 10)).toEqual({ diff: 0, tone: "green" });
    expect(funnelDelta(12, 10)).toEqual({ diff: 2, tone: "green" });
    expect(funnelDelta(9, 10)).toEqual({ diff: -1, tone: "amber" });
    expect(funnelDelta(7, 10)).toEqual({ diff: -3, tone: "amber" }); // exactly 70%
    expect(funnelDelta(6, 10)).toEqual({ diff: -4, tone: "red" }); // 30% under
  });

  it("a zero target is always green", () => {
    expect(funnelDelta(0, 0)).toEqual({ diff: 0, tone: "green" });
  });
});

/* -------------------------------------------------------------- weekTick */

describe("weekTick", () => {
  const onPlan = zeroActuals({
    interested: 20,
    accounts: 11,
    dossiers_submitted: 8,
    calls_booked: 10,
    calls_held: 8,
  });

  it("future / current position against currentWeek", () => {
    expect(weekTick(5, 3, zeroActuals(), null)).toBe("future");
    expect(weekTick(3, 3, zeroActuals(), null)).toBe("current");
  });

  it("past week with no targets row can't be missed", () => {
    expect(weekTick(1, 3, zeroActuals(), null)).toBe("done");
  });

  it("past week on plan → done; any red stage → missed", () => {
    expect(weekTick(1, 3, onPlan, targetsRow())).toBe("done");
    const missedCalls = { ...onPlan, calls_booked: 6 }; // 6 < 70% of 10
    expect(weekTick(1, 3, missedCalls, targetsRow())).toBe("missed");
  });

  it("amber (under but ≥70%) still counts as done", () => {
    const amber = { ...onPlan, calls_booked: 7 };
    expect(weekTick(1, 3, amber, targetsRow())).toBe("done");
  });

  it("post-sprint position (currentWeek 9) marks every week past", () => {
    expect(weekTick(8, 9, onPlan, null)).toBe("done");
  });
});

/* ---------------------------------------------------- week-card helpers */

describe("applyActionToggle / applyCounterBump", () => {
  const actions = [
    { id: "w1-a1", text: "Do it", done: false, done_by: null, done_at: null },
    {
      id: "w1-asset",
      text: "Ship it",
      done: true,
      done_by: "staff-1",
      done_at: "2026-07-14T12:00:00Z",
      kind: "asset" as const,
    },
  ];

  it("checking stamps done_by/done_at; unchecking clears both", () => {
    const checked = applyActionToggle(actions, "w1-a1", "staff-2", "2026-07-15T00:00:00Z");
    expect(checked?.done).toBe(true);
    expect(checked?.actions[0]).toMatchObject({
      done: true,
      done_by: "staff-2",
      done_at: "2026-07-15T00:00:00Z",
    });

    const unchecked = applyActionToggle(actions, "w1-asset", "staff-2", "2026-07-15T00:00:00Z");
    expect(unchecked?.actions[1]).toMatchObject({
      done: false,
      done_by: null,
      done_at: null,
      kind: "asset",
    });
  });

  it("returns null for an unknown action id", () => {
    expect(applyActionToggle(actions, "nope", "s", "t")).toBeNull();
  });

  it("bumps manual counters, floored at zero", () => {
    const targets = [
      { key: "warm-convos", label: "WARM CONVOS", target: 25, manual: true, count: 0 },
      { key: "calls_booked", label: "CALLS BOOKED", target: 10, manual: false, count: 0 },
    ];
    expect(applyCounterBump(targets, "warm-convos", 1)?.count).toBe(1);
    expect(applyCounterBump(targets, "warm-convos", -1)?.count).toBe(0); // floor
    expect(applyCounterBump(targets, "calls_booked", 1)).toBeNull(); // computed
    expect(applyCounterBump(targets, "missing", 1)).toBeNull();
  });

  it("jsonb parsers reject malformed rows instead of crashing", () => {
    expect(asWeekActions("junk")).toEqual([]);
    expect(asWeekActions([{ id: "x" }])).toEqual([]);
    expect(asNonFunnelTargets(null)).toEqual([]);
    expect(
      asNonFunnelTargets([
        { key: "k", label: "L", target: 5, manual: true, count: 2 },
        { bad: true },
      ])
    ).toHaveLength(1);
  });
});

/* -------------------------------------------------------------- briefing */

describe("briefing lists", () => {
  const now = new Date("2026-07-20T12:00:00Z");
  const brief = (over: Partial<BriefingFamily>): BriefingFamily => ({
    id: nextId(),
    name: "Fam",
    stage: "interested",
    heat: 3,
    lastTouchAt: null,
    createdAt: "2026-07-01T00:00:00Z",
    nextMove: "Check in.",
    ...over,
  });

  it("followUpsDue: stalest first, LOST excluded", () => {
    const fresh = brief({ id: "fresh", lastTouchAt: "2026-07-19T12:00:00Z" });
    const stale = brief({ id: "stale", lastTouchAt: "2026-07-05T12:00:00Z" });
    const lost = brief({ id: "lost", stage: "lost" });
    const result = followUpsDue([fresh, stale, lost], now);
    expect(result.map((f) => f.id)).toEqual(["stale", "fresh"]);
    expect(result[0].days).toBe(15);
  });

  it("coolingOff: heat ≥3 AND >7 days untouched only", () => {
    const cooling = brief({ id: "cooling", heat: 4, lastTouchAt: "2026-07-10T12:00:00Z" });
    const cold = brief({ id: "cold-low-heat", heat: 2, lastTouchAt: "2026-07-01T12:00:00Z" });
    const warm = brief({ id: "warm", heat: 5, lastTouchAt: "2026-07-19T12:00:00Z" });
    expect(coolingOff([cooling, cold, warm], now).map((f) => f.id)).toEqual([
      "cooling",
    ]);
  });

  it("warmingUp: only families with a recent signal toggle (empty pre-Unit 8)", () => {
    const a = brief({ id: "a" });
    const b = brief({ id: "b" });
    expect(warmingUp([a, b], new Set(["b"])).map((f) => f.id)).toEqual(["b"]);
    expect(warmingUp([a, b], new Set())).toEqual([]);
  });
});

/* --------------------------------------------------------- footer tallies */

describe("computeSourceTally", () => {
  it("tallies leads + deposits by source with the AMB-* sub-table", () => {
    const fams = [
      { id: "f1", source: "ambassador", referralCode: "amb-maya" },
      { id: "f2", source: "ambassador", referralCode: "AMB-MAYA" },
      { id: "f3", source: "gauntlet", referralCode: "" },
    ];
    const { rows, ambassadors } = computeSourceTally(fams, ["f2", "f3"]);
    expect(rows.find((r) => r.source === "ambassador")).toMatchObject({
      leads: 2,
      deposits: 1,
    });
    expect(rows.find((r) => r.source === "gauntlet")).toMatchObject({
      leads: 1,
      deposits: 1,
    });
    expect(ambassadors).toEqual([
      { code: "AMB-MAYA", leads: 2, deposits: 1 },
    ]);
  });
});

describe("computeSeatsByGroup", () => {
  it("commits via member review OR paid deposit; buckets the unassigned", () => {
    const reviews = [
      { child_id: "c1", review_status: "member", group_assignment: "scholars" },
      { child_id: "c2", review_status: "in_review", group_assignment: "makers" },
      { child_id: "c3", review_status: "submitted", group_assignment: null },
    ];
    const result = computeSeatsByGroup(reviews, new Set(["c3", "c4"]));
    const scholars = result.rows.find((r) => r.group === "scholars")!;
    const makers = result.rows.find((r) => r.group === "makers")!;
    expect(scholars).toMatchObject({ committed: 1, assigned: 1 });
    expect(makers).toMatchObject({ committed: 0, assigned: 1 });
    // c3 (paid, reviewed, no group) + c4 (paid, no review row at all)
    expect(result.unassignedCommitted).toBe(2);
    expect(result.scholarsWarning).toBe(false);
  });

  it("raises the Scholars warning past 24 assigned", () => {
    const reviews = Array.from({ length: 25 }, (_, i) => ({
      child_id: `c${i}`,
      review_status: "in_review",
      group_assignment: "scholars",
    }));
    expect(computeSeatsByGroup(reviews, new Set()).scholarsWarning).toBe(true);
  });
});

describe("computeThisWeekStats", () => {
  it("counts the four activity actions from audit rows", () => {
    const rows = [
      { action: "note-add" },
      { action: "note-add" },
      { action: "stamp-call" },
      { action: "review-move" },
      { action: "family-add" },
      { action: "gtm-edit" }, // not an activity stat
    ];
    expect(computeThisWeekStats(rows)).toEqual({
      notesAdded: 2,
      callsLogged: 1,
      dossiersReviewed: 1,
      familiesAdded: 1,
    });
  });
});
