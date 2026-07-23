import { describe, expect, it } from "vitest";
import {
  MAX_SEEN_IDS_PER_CALL,
  MOMENT_DISPLAY_MS,
  MOMENT_GAP_MS,
  NOT_YET_COPY,
  buildFeed,
  eventWhenMs,
  meterLine,
  planReplay,
  type FeedEventRow,
  type ProgramResolvers,
} from "../celebration-tier1-rules";
import { NOTIFICATION_EVENT_KINDS } from "../notify/notify-rules";

/**
 * The Tier 1 celebration / notification-surface decision layer (T1 Unit 16).
 *
 * The plan's six scenarios are the spec; everything else here pins the
 * fail-closed posture (unknown kinds, malformed params, unresolvable
 * subjects) and the ordering/supersede/replay rules the components must not
 * re-derive. The store is `path_notification_events` (Unit 12): kind + params
 * + occurred_at (the SOURCE moment) + superseded_at (one-way) + seen_at (the
 * replay cursor). Register (Trail/HQ) resolves at READ time — nothing
 * rendered is ever stored.
 */

/* ────────────────────────────────────────────────────────── fixtures */

const resolvers: ProgramResolvers = {
  taskTitle: (taskId) =>
    (
      ({
        "1.1.1": "Pick the product and the one-liner",
        "1.1.5": "Deliver and say it back",
        "1.2.1": "Set the offer and the price",
        "1.2.4": "Ask until one yes",
      }) as Record<string, string>
    )[taskId] ?? null,
  criterionTitle: (criterionId) =>
    (
      ({
        "1.1": "Pick something real to sell",
        "1.2": "Make a real sale",
      }) as Record<string, string>
    )[criterionId] ?? null,
};

let seq = 0;
function row(overrides: Partial<FeedEventRow>): FeedEventRow {
  seq += 1;
  return {
    id: `evt-${seq}`,
    kind: "verified",
    taskId: "1.2.4",
    scopeId: null,
    params: { taskId: "1.2.4", note: null },
    occurredAt: null,
    supersededAt: null,
    seenAt: null,
    createdAt: "2026-07-20T10:00:00.000Z",
    ...overrides,
  };
}

/* ─────────────────────────────────────────── the moment's clock */

describe("eventWhenMs", () => {
  it("prefers occurred_at (the source moment) over created_at", () => {
    const r = row({ occurredAt: "2026-07-01T08:00:00.000Z", createdAt: "2026-07-20T10:00:00.000Z" });
    expect(eventWhenMs(r)).toBe(Date.parse("2026-07-01T08:00:00.000Z"));
  });

  it("falls back to created_at for pre-occurred_at rows (the live fixture shape)", () => {
    const r = row({ occurredAt: null, createdAt: "2026-07-20T10:00:00.000Z" });
    expect(eventWhenMs(r)).toBe(Date.parse("2026-07-20T10:00:00.000Z"));
  });
});

/* ─────────────────────────────── scenario 1: the verifier's comment */

describe("the verifier's comment (scenario 1)", () => {
  it("a verification with a comment carries the adult's words", () => {
    const items = buildFeed({
      rows: [row({ params: { taskId: "1.2.4", note: "You knocked, you smiled, you asked. That's a real sale." } })],
      resolvers,
      skin: "trail",
    });
    expect(items).toHaveLength(1);
    expect(items[0].note).toBe("You knocked, you smiled, you asked. That's a real sale.");
    expect(items[0].tone).toBe("celebrate");
    expect(items[0].headline).toBe("Ask until one yes");
  });

  it("a verification without a comment renders cleanly — null note, never blank copy", () => {
    const items = buildFeed({ rows: [row({ params: { taskId: "1.2.4" } })], resolvers, skin: "trail" });
    expect(items[0].note).toBeNull();
    expect(items[0].eyebrow.length).toBeGreaterThan(0);
    expect(items[0].headline.length).toBeGreaterThan(0);
  });

  it("a malformed params payload (non-object) degrades to a null note, not a throw", () => {
    const items = buildFeed({ rows: [row({ params: "garbage" })], resolvers, skin: "hq" });
    expect(items[0].note).toBeNull();
    expect(items[0].headline.length).toBeGreaterThan(0);
  });

  it("a non-string note in params degrades to null, never renders an object", () => {
    const items = buildFeed({ rows: [row({ params: { note: { evil: true } } })], resolvers, skin: "hq" });
    expect(items[0].note).toBeNull();
  });
});

/* ─────────────────────────── scenario 2: offline events fire in order */

describe("replay order (scenario 2)", () => {
  it("three events queued while offline fire oldest-first on next open", () => {
    const rows = [
      row({ id: "c", taskId: "1.2.1", params: { taskId: "1.2.1" }, createdAt: "2026-07-20T12:00:00.000Z" }),
      row({ id: "a", taskId: "1.1.1", params: { taskId: "1.1.1" }, createdAt: "2026-07-20T10:00:00.000Z" }),
      row({ id: "b", taskId: "1.1.5", params: { taskId: "1.1.5" }, createdAt: "2026-07-20T11:00:00.000Z" }),
    ];
    const plan = planReplay({ rows, resolvers, skin: "trail", verifiedCount: 6, totalTasks: 125 });
    expect(plan.moments.map((m) => m.eventId)).toEqual(["a", "b", "c"]);
  });

  it("orders by the SOURCE moment, not the heal-time insert — a backfilled row sorts by occurred_at", () => {
    const rows = [
      // Backfilled: inserted last, but the moment happened first.
      row({ id: "backfilled", occurredAt: "2026-07-20T09:00:00.000Z", createdAt: "2026-07-21T00:00:00.000Z" }),
      row({ id: "live", occurredAt: null, createdAt: "2026-07-20T10:00:00.000Z" }),
    ];
    const plan = planReplay({ rows, resolvers, skin: "hq", verifiedCount: 2, totalTasks: 125 });
    expect(plan.moments.map((m) => m.eventId)).toEqual(["backfilled", "live"]);
  });

  it("ties on the moment break deterministically (created_at, then id) — the drill fixture's shared timestamps", () => {
    const rows = [
      row({ id: "z", createdAt: "2026-07-20T10:00:00.000Z" }),
      row({ id: "a", createdAt: "2026-07-20T10:00:00.000Z" }),
    ];
    const plan = planReplay({ rows, resolvers, skin: "hq", verifiedCount: 2, totalTasks: 125 });
    expect(plan.moments.map((m) => m.eventId)).toEqual(["a", "z"]);
  });

  it("already-seen events never replay — seen_at is the cursor", () => {
    const rows = [
      row({ id: "seen", seenAt: "2026-07-20T10:05:00.000Z" }),
      row({ id: "unseen" }),
    ];
    const plan = planReplay({ rows, resolvers, skin: "trail", verifiedCount: 1, totalTasks: 125 });
    expect(plan.moments.map((m) => m.eventId)).toEqual(["unseen"]);
    expect(plan.stampWithoutPlaying).not.toContain("seen");
  });
});

/* ─────────────── scenario 3: the register resolves at read time */

describe("read-time register (scenario 3)", () => {
  const stored = row({ params: { taskId: "1.2.4", note: "Great work." } });

  it("the same stored event renders Trail copy under Trail and HQ copy under HQ", () => {
    const trail = buildFeed({ rows: [stored], resolvers, skin: "trail" })[0];
    const hq = buildFeed({ rows: [stored], resolvers, skin: "hq" })[0];
    expect(trail.eyebrow).not.toBe(hq.eyebrow);
    expect(trail.eyebrow).toContain("Stamped");
    expect(hq.eyebrow).toContain("verified");
    // The adult's words are register-independent — stored once, shown verbatim.
    expect(trail.note).toBe("Great work.");
    expect(hq.note).toBe("Great work.");
  });

  it("a not_yet stored while the student was on Trail renders the HQ register when read in HQ", () => {
    const notYet = row({ kind: "not_yet", params: { taskId: "1.2.4", note: "Add the why-sentence." } });
    const hq = buildFeed({ rows: [notYet], resolvers, skin: "hq" })[0];
    expect(hq.eyebrow.toLowerCase()).toContain("not yet");
    expect(hq.eyebrow).not.toContain("okay"); // the Trail warmth line is Trail-only
    expect(hq.tone).toBe("amber");
  });
});

/* ────────────── scenario 4: superseded renders past-tense, no re-celebration */

describe("superseded events (scenario 4)", () => {
  const verifiedThenReopened: FeedEventRow[] = [
    row({
      id: "old-verify",
      taskId: "1.1.5",
      params: { taskId: "1.1.5", note: "Five for five!" },
      occurredAt: "2026-07-18T10:00:00.000Z",
      supersededAt: "2026-07-19T09:00:00.000Z",
    }),
    row({
      id: "the-return",
      kind: "criterion_returned",
      taskId: null,
      scopeId: "1.1",
      params: { criterionId: "1.1", attempt: 1, note: "One more pass on the delivery." },
      occurredAt: "2026-07-19T09:00:00.000Z",
    }),
  ];

  it("renders past-tense with the correction inline — history intact, no deletion", () => {
    const items = buildFeed({ rows: verifiedThenReopened, resolvers, skin: "hq" });
    const past = items.find((i) => i.eventId === "old-verify");
    expect(past).toBeDefined();
    expect(past!.tone).toBe("past");
    expect(past!.correction).toBeTruthy();
    expect(past!.correction!.toLowerCase()).toContain("another pass");
    // The original moment is still told — the adult's words survive.
    expect(past!.note).toBe("Five for five!");
  });

  it("never re-celebrates: a superseded unseen event is stamped without playing", () => {
    const plan = planReplay({ rows: verifiedThenReopened, resolvers, skin: "trail", verifiedCount: 4, totalTasks: 125 });
    expect(plan.moments.map((m) => m.eventId)).toEqual(["the-return"]);
    expect(plan.stampWithoutPlaying).toContain("old-verify");
  });

  it("a superseded review_underway pairs with its criterion_returned correction by scope", () => {
    const rows: FeedEventRow[] = [
      row({
        id: "opened",
        kind: "review_underway",
        taskId: null,
        scopeId: "1.1",
        params: { criterionId: "1.1", attempt: 1 },
        occurredAt: "2026-07-18T12:00:00.000Z",
        supersededAt: "2026-07-19T09:00:00.000Z",
      }),
      row({
        id: "returned",
        kind: "criterion_returned",
        taskId: null,
        scopeId: "1.1",
        params: { criterionId: "1.1", attempt: 1, note: "Redo the stranger delivery." },
        occurredAt: "2026-07-19T09:00:00.000Z",
      }),
    ];
    const items = buildFeed({ rows, resolvers, skin: "trail" });
    const past = items.find((i) => i.eventId === "opened");
    expect(past!.tone).toBe("past");
    expect(past!.correction).toBeTruthy();
  });

  it("a superseded verified pairs with a reopened correction on the same task", () => {
    const rows: FeedEventRow[] = [
      row({
        id: "v",
        taskId: "1.2.1",
        params: { taskId: "1.2.1" },
        occurredAt: "2026-07-18T10:00:00.000Z",
        supersededAt: "2026-07-18T11:00:00.000Z",
      }),
      row({
        id: "r",
        kind: "reopened",
        taskId: "1.2.1",
        params: { taskId: "1.2.1", note: "Let's look again." },
        occurredAt: "2026-07-18T11:00:00.000Z",
      }),
    ];
    const past = buildFeed({ rows, resolvers, skin: "hq" }).find((i) => i.eventId === "v");
    expect(past!.tone).toBe("past");
    expect(past!.correction!.toLowerCase()).toContain("reopened");
  });

  it("a superseded event whose reversal is outside the loaded window still gets a correction (falls back to superseded_at)", () => {
    const rows = [
      row({
        id: "lonely",
        taskId: "1.1.5",
        params: { taskId: "1.1.5" },
        occurredAt: "2026-07-18T10:00:00.000Z",
        supersededAt: "2026-07-19T09:00:00.000Z",
      }),
    ];
    const past = buildFeed({ rows, resolvers, skin: "trail" })[0];
    expect(past.tone).toBe("past");
    // The generic fallback sentence, never blank — pinned by content so a
    // broken skin ternary or date interpolation can't pass as "truthy".
    expect(past.correction).toMatch(/took another look/i);
  });

  it("with several return cycles of one criterion, the correction pairs by superseded_at PROXIMITY — never a different cycle's note (adversarial pass)", () => {
    // verify(1.2.4)@T2 was superseded by attempt-2's ceremony @T5 — but
    // attempt-1's ceremony @T3 (which returned a DIFFERENT task) also matches
    // by criterion prefix and is earlier-≥. Proximity to superseded_at (T5)
    // must pick attempt 2.
    const rows: FeedEventRow[] = [
      row({
        id: "v-124",
        taskId: "1.2.4",
        params: { taskId: "1.2.4" },
        occurredAt: "2026-07-10T10:00:00.000Z", // T2
        supersededAt: "2026-07-14T10:00:00.000Z", // flagged by attempt 2 (T5)
      }),
      row({
        id: "ceremony-1",
        kind: "criterion_returned",
        taskId: null,
        scopeId: "1.2",
        params: { criterionId: "1.2", attempt: 1, note: "Redo 1.2.1 only." },
        occurredAt: "2026-07-11T10:00:00.000Z", // T3 — the WRONG pairing
      }),
      row({
        id: "ceremony-2",
        kind: "criterion_returned",
        taskId: null,
        scopeId: "1.2",
        params: { criterionId: "1.2", attempt: 2, note: "Now 1.2.4 needs a pass." },
        occurredAt: "2026-07-14T10:00:00.000Z", // T5 — the RIGHT pairing
      }),
    ];
    const past = buildFeed({ rows, resolvers, skin: "hq" }).find((i) => i.eventId === "v-124");
    expect(past!.tone).toBe("past");
    // The correction dates off ceremony-2's moment (Tue Jul 14), not
    // ceremony-1's (Sat Jul 11).
    expect(past!.correction).toContain("on Tue");
  });
});

/* ──────────── scenario 6: a deleted task is skipped with a note */

describe("unresolvable subjects (scenario 6)", () => {
  it("an event referencing a task not in the pinned program is skipped with a note, never rendered blank", () => {
    const items = buildFeed({
      rows: [row({ taskId: "9.9.9", params: { taskId: "9.9.9" } })],
      resolvers,
      skin: "trail",
    });
    expect(items).toHaveLength(1);
    expect(items[0].tone).toBe("skipped");
    expect(items[0].headline.length).toBeGreaterThan(0);
    expect(items[0].body).toContain("9.9.9"); // names what it skipped
  });

  it("a skipped event never plays as a celebration — stamped without playing", () => {
    const plan = planReplay({
      rows: [row({ id: "ghost", taskId: "9.9.9", params: { taskId: "9.9.9" } })],
      resolvers,
      skin: "hq",
      verifiedCount: 1,
      totalTasks: 125,
    });
    expect(plan.moments).toHaveLength(0);
    expect(plan.stampWithoutPlaying).toContain("ghost");
  });

  it("an unknown kind fails closed the same way — skipped with a note, not a throw, not blank", () => {
    const items = buildFeed({ rows: [row({ kind: "confetti_storm" })], resolvers, skin: "hq" });
    expect(items[0].tone).toBe("skipped");
    expect(items[0].headline.length).toBeGreaterThan(0);
  });

  it("a criterion event whose criterion is not in the pinned program is skipped with a note", () => {
    const items = buildFeed({
      rows: [row({ kind: "review_underway", taskId: null, scopeId: "7.7", params: { criterionId: "7.7" } })],
      resolvers,
      skin: "trail",
    });
    expect(items[0].tone).toBe("skipped");
  });

  it("a task-scope event with a null task_id falls back to params.taskId before skipping", () => {
    const items = buildFeed({
      rows: [row({ taskId: null, params: { taskId: "1.2.4" } })],
      resolvers,
      skin: "hq",
    });
    expect(items[0].tone).toBe("celebrate");
    expect(items[0].headline).toBe("Ask until one yes");
  });

  it("a criterion-scope event with a null scope_id falls back to params.criterionId before skipping (the task-scope fallback's twin)", () => {
    const items = buildFeed({
      rows: [
        row({ kind: "review_underway", taskId: null, scopeId: null, params: { criterionId: "1.1", attempt: 1 } }),
      ],
      resolvers,
      skin: "trail",
    });
    expect(items[0].tone).toBe("info");
    expect(items[0].headline).toBe("Pick something real to sell");
    expect(items[0].href).toBe("/path/criterion/1.1");
  });
});

/* ───────────────────────────────────── the rest of the feed contract */

describe("buildFeed", () => {
  it("orders newest-first by the coalesced moment", () => {
    const items = buildFeed({
      rows: [
        row({ id: "old", createdAt: "2026-07-19T10:00:00.000Z" }),
        row({ id: "new", createdAt: "2026-07-20T10:00:00.000Z" }),
      ],
      resolvers,
      skin: "trail",
    });
    expect(items.map((i) => i.eventId)).toEqual(["new", "old"]);
  });

  it("marks unseen items so the surface can whisper what's new", () => {
    const items = buildFeed({
      rows: [row({ id: "a", seenAt: "2026-07-20T11:00:00.000Z" }), row({ id: "b" })],
      resolvers,
      skin: "hq",
    });
    expect(items.find((i) => i.eventId === "a")!.unseen).toBe(false);
    expect(items.find((i) => i.eventId === "b")!.unseen).toBe(true);
  });

  it("links a live task event to its task page; a criterion event to the landmark", () => {
    const items = buildFeed({
      rows: [
        row({ id: "t", taskId: "1.2.4" }),
        row({ id: "c", kind: "review_underway", taskId: null, scopeId: "1.2", params: { criterionId: "1.2" } }),
      ],
      resolvers,
      skin: "trail",
    });
    expect(items.find((i) => i.eventId === "t")!.href).toBe("/path/task/1.2.4");
    expect(items.find((i) => i.eventId === "c")!.href).toBe("/path/criterion/1.2");
  });

  it("EVERY registered kind renders non-blank copy in both registers — derived from NOTIFICATION_EVENT_KINDS, so a 7th kind added without copy fails here", () => {
    const TASK_KINDS = new Set(["verified", "not_yet", "reopened"]);
    const fixtures = NOTIFICATION_EVENT_KINDS.map((kind) =>
      TASK_KINDS.has(kind)
        ? { kind, taskId: "1.1.1", scopeId: null, params: { taskId: "1.1.1", note: "n" } }
        : { kind, taskId: null, scopeId: "1.1", params: { criterionId: "1.1", attempt: 1, note: "n" } }
    );
    for (const skin of ["trail", "hq"] as const) {
      const items = buildFeed({ rows: fixtures.map((k) => row({ ...k })), resolvers, skin });
      expect(items).toHaveLength(NOTIFICATION_EVENT_KINDS.length);
      for (const item of items) {
        expect(item.tone, `${skin} ${item.eyebrow} must not fall to skipped`).not.toBe("skipped");
        expect(item.eyebrow.length, `${skin} eyebrow`).toBeGreaterThan(0);
        expect(item.headline.length, `${skin} headline`).toBeGreaterThan(0);
      }
    }
  });

  it("the Not Yet copy is single-sourced: copyFor's body IS NOT_YET_COPY's reassurance in both registers", () => {
    for (const skin of ["trail", "hq"] as const) {
      const item = buildFeed({
        rows: [row({ kind: "not_yet", params: { taskId: "1.2.4", note: "n" } })],
        resolvers,
        skin,
      })[0];
      expect(item.body).toBe(NOT_YET_COPY[skin].reassurance);
    }
  });

  it("buildFeed and planReplay handle an empty feed — empty out, no throw (the first-time student)", () => {
    expect(buildFeed({ rows: [], resolvers, skin: "trail" })).toEqual([]);
    expect(planReplay({ rows: [], resolvers, skin: "hq", verifiedCount: 0, totalTasks: 125 })).toEqual({
      moments: [],
      stampWithoutPlaying: [],
    });
  });

  it("not_yet is amber — information, not judgement (and never the celebrate tone)", () => {
    const items = buildFeed({
      rows: [row({ kind: "not_yet", params: { taskId: "1.2.4", note: "Add the why-sentence." } })],
      resolvers,
      skin: "trail",
    });
    expect(items[0].tone).toBe("amber");
  });
});

/* ─────────────────────────────────────────────── the replay's meter */

describe("meterLine and the replay's detail", () => {
  it("speaks the CURRENT truthful count — never a fabricated from→to", () => {
    expect(meterLine(9, 125, "trail")).toContain("9");
    expect(meterLine(9, 125, "trail")).toContain("125");
    expect(meterLine(9, 125, "hq")).toContain("9 / 125");
  });

  it("only the LAST verified moment in a replay carries the meter detail", () => {
    const rows = [
      row({ id: "v1", taskId: "1.1.1", params: { taskId: "1.1.1" }, createdAt: "2026-07-20T10:00:00.000Z" }),
      row({ id: "v2", taskId: "1.2.1", params: { taskId: "1.2.1" }, createdAt: "2026-07-20T11:00:00.000Z" }),
    ];
    const plan = planReplay({ rows, resolvers, skin: "hq", verifiedCount: 7, totalTasks: 125 });
    expect(plan.moments[0].detail).toBeNull();
    expect(plan.moments[1].detail).toContain("7");
  });

  it("a replay with no verified moments carries no meter anywhere", () => {
    const rows = [row({ kind: "not_yet", params: { taskId: "1.2.4", note: "n" } })];
    const plan = planReplay({ rows, resolvers, skin: "trail", verifiedCount: 3, totalTasks: 125 });
    expect(plan.moments[0].detail).toBeNull();
  });
});

/* ─────────────────────────────────────────────── the moment's timing */

describe("timing constants", () => {
  it("each moment holds the screen for two to four seconds (the brief's §5.1 window)", () => {
    expect(MOMENT_DISPLAY_MS).toBeGreaterThanOrEqual(2000);
    expect(MOMENT_DISPLAY_MS).toBeLessThanOrEqual(4000);
    expect(MOMENT_GAP_MS).toBeGreaterThan(0);
  });

  it("the seen-stamp chunk ceiling is a sane positive bound shared by action and clients", () => {
    expect(MAX_SEEN_IDS_PER_CALL).toBeGreaterThan(0);
    expect(Number.isInteger(MAX_SEEN_IDS_PER_CALL)).toBe(true);
  });
});

describe("Moment.whenIso — the host's merge-order key", () => {
  it("every planned moment carries its coalesced source moment, so late-arriving backfills can merge into a live queue in true order", () => {
    const rows = [
      row({ id: "live", occurredAt: null, createdAt: "2026-07-20T10:00:00.000Z" }),
      row({ id: "backfilled", occurredAt: "2026-07-19T08:00:00.000Z", createdAt: "2026-07-21T00:00:00.000Z" }),
    ];
    const plan = planReplay({ rows, resolvers, skin: "trail", verifiedCount: 2, totalTasks: 125 });
    const byId = Object.fromEntries(plan.moments.map((m) => [m.eventId, m.whenIso]));
    expect(byId.live).toBe("2026-07-20T10:00:00.000Z"); // created_at fallback
    expect(byId.backfilled).toBe("2026-07-19T08:00:00.000Z"); // the SOURCE moment, not heal time
  });
});
