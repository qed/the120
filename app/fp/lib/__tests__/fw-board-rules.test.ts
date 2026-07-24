import { describe, expect, it } from "vitest";

import {
  FW_BOARD_TICKER_LIMIT,
  FW_BOARD_TOKEN_GRACE_MS,
  FW_FIRST_DOLLAR_FRESHNESS_MS,
  fwBoardDisplayNames,
  fwBoardTokenExpiry,
  fwBoardTokenMintVerdict,
  fwBoardTokenVerdict,
  fwParseBoardTaskId,
  fwTaskPhaseWeight,
  pickFwCurrentBoardToken,
  shapeFwBoardModel,
  type FwBoardEvent,
  type FwBoardMember,
  type FwBoardProgressRow,
} from "../fw-board-rules";
import type { Band } from "@/app/fp/content/types";
import type { TaskState } from "../transition-table";

/**
 * The board token's pure decisions (FW Unit 5; Decision 4, gap G18).
 *
 * Written BEFORE any surface consumed them, per the unit's execution posture:
 * the mint/verify/expiry table is the one place a wrong value silently expires
 * a board mid-event, and it is a decision table, not an implementation detail.
 *
 * `now` is a fixed instant everywhere. A test that reads the wall clock would
 * pass every day but Saturday of an event.
 */

const NOW = Date.parse("2026-08-21T14:00:00Z");
/** Boston: Sun Aug 23, 5pm Eastern = 21:00Z. */
const BOSTON_ENDS = "2026-08-23T21:00:00.000Z";

describe("FW_BOARD_TOKEN_GRACE_MS", () => {
  it("is the six hours Decision 4 names, not a rounder number", () => {
    expect(FW_BOARD_TOKEN_GRACE_MS).toBe(6 * 60 * 60 * 1000);
  });
});

describe("fwBoardTokenExpiry", () => {
  it("is ends_at plus the grace", () => {
    expect(fwBoardTokenExpiry(BOSTON_ENDS)).toBe("2026-08-24T03:00:00.000Z");
  });

  it("crosses a calendar day and a month boundary without drift", () => {
    // Aug 31, 8pm Pacific = Sep 1 03:00Z; +6h = Sep 1 09:00Z.
    expect(fwBoardTokenExpiry("2026-09-01T03:00:00.000Z")).toBe("2026-09-01T09:00:00.000Z");
  });

  it("accepts an offset-bearing timestamp and normalizes it to UTC", () => {
    // The database hands back timestamptz; the value, not its rendering, is
    // what the grace applies to.
    expect(fwBoardTokenExpiry("2026-08-23T17:00:00-04:00")).toBe("2026-08-24T03:00:00.000Z");
  });

  it("refuses an unparseable or absent end, rather than inventing an instant", () => {
    // `new Date(NaN).toISOString()` THROWS, and a thrown expiry inside a mint
    // sequence is a half-written token. Null is the answer the caller branches
    // on.
    expect(fwBoardTokenExpiry("not a timestamp")).toBeNull();
    expect(fwBoardTokenExpiry("")).toBeNull();
    expect(fwBoardTokenExpiry(null)).toBeNull();
  });
});

describe("fwBoardTokenMintVerdict", () => {
  const fwCohort = { kind: "fw", endsAt: BOSTON_ENDS };

  it("mints for an fw cohort with a live window, carrying the derived expiry", () => {
    const verdict = fwBoardTokenMintVerdict({ cohort: fwCohort, now: NOW });
    expect(verdict).toEqual({ ok: true, expiresAt: "2026-08-24T03:00:00.000Z" });
  });

  it("refuses a missing cohort", () => {
    expect(fwBoardTokenMintVerdict({ cohort: null, now: NOW })).toEqual({
      ok: false,
      reason: "cohort_not_found",
    });
  });

  it("refuses a kind='path' cohort (G18)", () => {
    // The whole point of the gate: a Path cohort's students are in the Path's
    // gated, cascaded world, and a board token is an UNAUTHENTICATED read door.
    expect(
      fwBoardTokenMintVerdict({ cohort: { kind: "path", endsAt: BOSTON_ENDS }, now: NOW })
    ).toEqual({ ok: false, reason: "cohort_not_fw" });
  });

  it("refuses any kind outside the union rather than treating it as fw", () => {
    expect(
      fwBoardTokenMintVerdict({ cohort: { kind: "FW", endsAt: BOSTON_ENDS }, now: NOW })
    ).toEqual({ ok: false, reason: "cohort_not_fw" });
    expect(
      fwBoardTokenMintVerdict({ cohort: { kind: "", endsAt: BOSTON_ENDS }, now: NOW })
    ).toEqual({ ok: false, reason: "cohort_not_fw" });
  });

  it("refuses an fw cohort with no end date — there is no expiry to derive", () => {
    expect(fwBoardTokenMintVerdict({ cohort: { kind: "fw", endsAt: null }, now: NOW })).toEqual({
      ok: false,
      reason: "no_event_window",
    });
  });

  it("refuses an unparseable end date rather than minting a token with a bad expiry", () => {
    expect(
      fwBoardTokenMintVerdict({ cohort: { kind: "fw", endsAt: "sometime saturday" }, now: NOW })
    ).toEqual({ ok: false, reason: "no_event_window" });
  });

  it("refuses to mint a token that would already be expired", () => {
    // Born-dead tokens are the confusing failure: staff copy a URL, project it,
    // and the room sees a 404 with nothing to explain it. The fix is the
    // cohort's dates, so the refusal has to name that.
    const past = { kind: "fw", endsAt: "2026-08-16T21:00:00.000Z" };
    expect(fwBoardTokenMintVerdict({ cohort: past, now: NOW })).toEqual({
      ok: false,
      reason: "window_passed",
    });
  });

  it("still mints during the grace period after ends_at", () => {
    // Sunday 5pm has passed but the board is legitimately still up — a re-mint
    // during teardown must work, which is exactly what the grace is for.
    const justEnded = { kind: "fw", endsAt: "2026-08-21T13:00:00.000Z" };
    expect(fwBoardTokenMintVerdict({ cohort: justEnded, now: NOW })).toEqual({
      ok: true,
      expiresAt: "2026-08-21T19:00:00.000Z",
    });
  });

  it("checks kind BEFORE the window, so a Path cohort never reports a date problem", () => {
    // Ordering is a security property, not taste: telling staff "that cohort
    // has no end date" invites them to add one to a Path cohort and try again.
    expect(fwBoardTokenMintVerdict({ cohort: { kind: "path", endsAt: null }, now: NOW })).toEqual({
      ok: false,
      reason: "cohort_not_fw",
    });
  });
});

describe("fwBoardTokenVerdict", () => {
  const live = { expiresAt: "2026-08-24T03:00:00.000Z", revokedAt: null };

  it("passes a live, unrevoked, unexpired token", () => {
    expect(fwBoardTokenVerdict({ token: live, now: NOW })).toEqual({ ok: true });
  });

  it("refuses a token nobody minted", () => {
    expect(fwBoardTokenVerdict({ token: null, now: NOW })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("refuses a revoked token even while its expiry is still in the future", () => {
    expect(
      fwBoardTokenVerdict({ token: { ...live, revokedAt: "2026-08-21T13:00:00Z" }, now: NOW })
    ).toEqual({ ok: false, reason: "revoked" });
  });

  it("refuses an expired token", () => {
    expect(
      fwBoardTokenVerdict({ token: { ...live, expiresAt: "2026-08-21T13:59:59Z" }, now: NOW })
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("treats the exact expiry instant as expired, not as live", () => {
    expect(
      fwBoardTokenVerdict({ token: { ...live, expiresAt: new Date(NOW).toISOString() }, now: NOW })
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("fails CLOSED on a malformed expiry", () => {
    // `NaN > now` is false → expired. The inverse comparison would read a
    // garbage timestamp as a live board, which is the whole reason this is
    // written as `!(x > now)` rather than `x <= now`.
    expect(fwBoardTokenVerdict({ token: { ...live, expiresAt: "whenever" }, now: NOW })).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("reports revocation ahead of expiry, so ops copy names the actionable cause", () => {
    // Both true at once. "Revoked" tells staff someone did this on purpose;
    // "expired" would send them to edit the cohort's dates for nothing.
    expect(
      fwBoardTokenVerdict({
        token: { expiresAt: "2026-08-01T00:00:00Z", revokedAt: "2026-08-02T00:00:00Z" },
        now: NOW,
      })
    ).toEqual({ ok: false, reason: "revoked" });
  });
});

describe("pickFwCurrentBoardToken", () => {
  const live = { id: "live", revokedAt: null };
  const revokedEarly = { id: "early", revokedAt: "2026-08-21T10:00:00Z" };
  const revokedLate = { id: "late", revokedAt: "2026-08-22T10:00:00Z" };

  it("has no token to report when none exist", () => {
    expect(pickFwCurrentBoardToken([])).toBeNull();
  });

  it("prefers the LIVE token regardless of where it sits in the list", () => {
    // Order-independence is the property that matters: the caller hands over
    // whatever pagination returned, in whatever order the database chose.
    expect(pickFwCurrentBoardToken([revokedLate, live, revokedEarly])).toBe(live);
    expect(pickFwCurrentBoardToken([live, revokedLate])).toBe(live);
    expect(pickFwCurrentBoardToken([revokedEarly, revokedLate, live])).toBe(live);
  });

  it("falls back to the MOST RECENTLY revoked when none is live", () => {
    // So "I revoked the board" is confirmable, and so a cohort with a long
    // re-mint history reports the kill that actually matters.
    expect(pickFwCurrentBoardToken([revokedEarly, revokedLate])).toBe(revokedLate);
    expect(pickFwCurrentBoardToken([revokedLate, revokedEarly])).toBe(revokedLate);
  });

  it("is deterministic where an `order by created_at` would not be", () => {
    // The tie that motivated this function: two rows minted inside one
    // statement timestamp. The live one still wins, every time.
    const tieA = { id: "a", revokedAt: "2026-08-22T15:00:00Z" };
    const tieB = { id: "b", revokedAt: null };
    expect(pickFwCurrentBoardToken([tieA, tieB])).toBe(tieB);
    expect(pickFwCurrentBoardToken([tieB, tieA])).toBe(tieB);
  });
});

/* ═══════════════════════════════════════════════════ the board READ MODEL ══ */
/*
 * FW Unit 6. The read model is where the composition lives, and every prior FW
 * unit shipped a P1 in exactly this shape — a freshness gate × grouping ×
 * retraction × weekend-scope × no-per-student-XP fold whose halves were each
 * obvious. So these pin the whole table against seeded members/progress/events,
 * INCLUDING a replayed (stale-capture) 1.2.4 and an undo that must retract a
 * ticker line and decrement XP and the counter.
 *
 * The phase words the loader passes; index 0 = phase 1.
 */
const PHASE_NAMES = ["Sell", "Build", "Validate", "Grow", "Scale"];

/** Boston Saturday afternoon, in ms. */
const SAT = Date.parse("2026-08-22T15:00:00Z");
const MIN = 60_000;

let eventSeq = 0;
/** Build one cohort-stamped event. `atMs` defaults to a fresh live tap (capture
 *  == insert); pass `capturedAtMs` behind `atMs` to model a replayed drain. */
function ev(
  studentId: string,
  taskId: string,
  transition: "checkmark" | "not_yet" | "undo",
  opts: {
    atMs?: number;
    capturedAtMs?: number;
    actionId?: string | null;
    fromState?: TaskState;
    id?: string;
  } = {}
): FwBoardEvent {
  const to: TaskState =
    transition === "checkmark" ? "verified" : transition === "not_yet" ? "not_yet" : "locked";
  const atMs = opts.atMs ?? SAT + eventSeq * 1000;
  eventSeq += 1;
  return {
    id: opts.id ?? `e${eventSeq}`,
    studentId,
    taskId,
    transition,
    fromState: opts.fromState ?? "locked",
    toState: to,
    atMs,
    capturedAtMs: opts.capturedAtMs ?? atMs,
    actionId: opts.actionId ?? null,
  };
}

function member(
  studentId: string,
  firstName: string,
  lastName: string,
  band: Band = "g6_8",
  anonymized = false
): FwBoardMember {
  return { studentId, firstName, lastName, band, anonymized };
}

function prog(studentId: string, taskId: string, state: TaskState): FwBoardProgressRow {
  return { studentId, taskId, state };
}

const shape = (input: {
  members?: FwBoardMember[];
  progress?: FwBoardProgressRow[];
  events?: FwBoardEvent[];
  tickerLimit?: number;
}) =>
  shapeFwBoardModel({
    members: input.members ?? [],
    progress: input.progress ?? [],
    events: input.events ?? [],
    phaseNames: PHASE_NAMES,
    tickerLimit: input.tickerLimit,
  });

describe("fwParseBoardTaskId / fwTaskPhaseWeight", () => {
  it("splits a task id into phase number and criterion", () => {
    expect(fwParseBoardTaskId("1.2.4")).toEqual({ phase: 1, criterion: "1.2" });
    expect(fwParseBoardTaskId("5.5.5")).toEqual({ phase: 5, criterion: "5.5" });
  });

  it("weights by phase number — SELL=1 … SCALE=5, the durable definition", () => {
    expect(fwTaskPhaseWeight("1.1.1")).toBe(1);
    expect(fwTaskPhaseWeight("3.4.2")).toBe(3);
    expect(fwTaskPhaseWeight("5.5.5")).toBe(5);
  });

  it("fails CLOSED to weight 0 on an unparseable id, never inflating the room's number", () => {
    expect(fwParseBoardTaskId("1.2")).toBeNull();
    expect(fwParseBoardTaskId("x.y.z")).toBeNull();
    expect(fwParseBoardTaskId("0.1.1")).toBeNull(); // no phase 0
    expect(fwTaskPhaseWeight("garbage")).toBe(0);
    expect(fwTaskPhaseWeight("1.2")).toBe(0);
  });
});

describe("fwBoardDisplayNames — first name + last initial, band tiebreaker (FW-D11)", () => {
  it("renders 'Maya C.' when there is no collision", () => {
    const names = fwBoardDisplayNames([member("a", "Maya", "Chen")]);
    expect(names.get("a")).toBe("Maya C.");
  });

  it("adds the band when two students collide on first name + last initial", () => {
    // Chen and Carter both render "Maya C." — the projected board must tell them
    // apart, and the band is what a guide already uses to.
    const names = fwBoardDisplayNames([
      member("a", "Maya", "Chen", "g6_8"),
      member("b", "Maya", "Carter", "g9_12"),
    ]);
    expect(names.get("a")).toBe("Maya C. · Grades 6–8");
    expect(names.get("b")).toBe("Maya C. · Grades 9–12");
  });

  it("falls back to the full name when first + initial + band all collide", () => {
    const names = fwBoardDisplayNames([
      member("a", "Maya", "Chen", "g6_8"),
      member("b", "Maya", "Carter", "g6_8"),
    ]);
    expect(names.get("a")).toBe("Maya Chen");
    expect(names.get("b")).toBe("Maya Carter");
  });

  it("gives a truly identical pair distinct strings even when their ids share a prefix", () => {
    // Real UUIDs can share leading characters — a 4-char id slice was NOT unique
    // (testing review). A stable per-group ordinal (by studentId) always is.
    const names = fwBoardDisplayNames([
      member("aaaa2222", "Maya", "Chen", "g6_8"),
      member("aaaa1111", "Maya", "Chen", "g6_8"),
    ]);
    expect(names.get("aaaa1111")).not.toBe(names.get("aaaa2222"));
    // Ordinal is assigned by studentId order, so it is stable across polls.
    expect(names.get("aaaa1111")).toBe("Maya Chen (1)");
    expect(names.get("aaaa2222")).toBe("Maya Chen (2)");
  });
});

describe("shapeFwBoardModel — the grid (record-to-date, Decision 16)", () => {
  it("fills a cell from a LIFETIME progress row, decided states only", () => {
    const model = shape({
      members: [member("a", "Maya", "Chen")],
      progress: [
        prog("a", "1.1.1", "verified"),
        prog("a", "1.1.2", "not_yet"),
        prog("a", "1.1.3", "available"), // a Path work state — never a board cell
        prog("a", "1.1.4", "locked"),
      ],
    });
    expect(model.grid).toHaveLength(1);
    expect(model.grid[0].cells).toEqual({ "1.1.1": "verified", "1.1.2": "not_yet" });
  });

  it("orders rows by NAME, never by progress (FW-D13)", () => {
    const model = shape({
      members: [
        member("a", "Zed", "Ableton"),
        member("b", "Ada", "Zimmer"),
        member("c", "Ada", "Ableton"),
      ],
      progress: [prog("a", "1.1.1", "verified")], // the most progress, still last by name
    });
    expect(model.grid.map((r) => r.studentId)).toEqual(["c", "a", "b"]);
  });

  it("renders a returner's cells filled while the weekend numbers stay at zero", () => {
    // Decision 16: the grid is the student's record; a Hamptons returner arrives
    // in Boston with 1.2.4 already verified — but with NO Boston-stamped event,
    // Friday-morning weekend XP is 0 and the counter ignores their Boston 1.2.4.
    const model = shape({
      members: [member("ret", "Maya", "Chen")],
      progress: [prog("ret", "1.2.4", "verified"), prog("ret", "1.2.3", "verified")],
      events: [], // nothing stamped to THIS cohort yet
    });
    expect(model.grid[0].cells["1.2.4"]).toBe("verified");
    expect(model.weekendXp).toBe(0);
    expect(model.firstDollarCount).toBe(0);
    expect(model.ticker).toEqual([]);
  });
});

describe("shapeFwBoardModel — weekend XP, ticker, counter (happy path)", () => {
  it("surfaces a checkmark as a cell, a ticker line, and an XP delta", () => {
    const model = shape({
      members: [member("a", "Maya", "Chen")],
      progress: [prog("a", "1.2.1", "verified")], // the write path updated progress too
      events: [ev("a", "1.2.1", "checkmark")],
    });
    expect(model.grid[0].cells["1.2.1"]).toBe("verified");
    expect(model.weekendXp).toBe(1); // phase 1
    expect(model.rollups.checkmarks).toBe(1);
    expect(model.ticker).toHaveLength(1);
    expect(model.ticker[0]).toMatchObject({
      studentId: "a",
      displayName: "Maya C.",
      taskId: "1.2.1",
      label: "Sell 1.2",
      kind: "verified",
      firstDollar: false,
    });
  });

  it("sums XP phase-weighted across phases", () => {
    const model = shape({
      events: [
        ev("a", "1.1.1", "checkmark"), // 1
        ev("a", "2.1.1", "checkmark"), // 2
        ev("a", "5.5.5", "checkmark"), // 5
      ],
      members: [member("a", "A", "A")],
    });
    expect(model.weekendXp).toBe(8);
  });

  it("resurfaces a re-attempt not-yet in the ticker (Decision 2)", () => {
    // A fresh not-yet onto an already-not-yet row: from_state == to_state, no
    // state change, but it IS activity and must show up again in the ticker.
    const model = shape({
      members: [member("a", "Maya", "Chen")],
      events: [
        ev("a", "1.1.1", "not_yet", { atMs: SAT }),
        ev("a", "2.1.1", "checkmark", { atMs: SAT + MIN }),
        ev("a", "1.1.1", "not_yet", { atMs: SAT + 2 * MIN, fromState: "not_yet" }), // re-attempt
      ],
    });
    // The re-attempt is the most recent activity → it leads the ticker.
    expect(model.ticker[0]).toMatchObject({ taskId: "1.1.1", kind: "not_yet" });
    expect(model.rollups.notYets).toBe(1);
  });

  it("caps the ticker and shows the most recent activity first", () => {
    const events: FwBoardEvent[] = [];
    const members: FwBoardMember[] = [];
    for (let i = 0; i < FW_BOARD_TICKER_LIMIT + 5; i += 1) {
      members.push(member(`s${i}`, `N${i}`, `L${i}`));
      events.push(ev(`s${i}`, "1.1.1", "checkmark", { atMs: SAT + i * 1000 }));
    }
    const model = shape({ members, events });
    expect(model.ticker).toHaveLength(FW_BOARD_TICKER_LIMIT);
    // Newest first: the last-seeded student leads.
    expect(model.ticker[0].studentId).toBe(`s${FW_BOARD_TICKER_LIMIT + 4}`);
  });
});

describe("shapeFwBoardModel — First Dollar celebrations & counter (Decision 5, PROPOSED-2)", () => {
  it("rings ONCE for a batched 1.2.4, naming every student in the action", () => {
    const model = shape({
      members: [member("a", "Maya", "Chen"), member("b", "Sam", "Diaz"), member("c", "Ana", "Ruiz")],
      progress: [
        prog("a", "1.2.4", "verified"),
        prog("b", "1.2.4", "verified"),
        prog("c", "1.2.4", "verified"),
      ],
      events: [
        ev("a", "1.2.4", "checkmark", { actionId: "batch-1", atMs: SAT }),
        ev("b", "1.2.4", "checkmark", { actionId: "batch-1", atMs: SAT }),
        ev("c", "1.2.4", "checkmark", { actionId: "batch-1", atMs: SAT }),
      ],
    });
    expect(model.celebrations).toHaveLength(1);
    expect(model.celebrations[0].key).toBe("batch-1");
    expect(model.celebrations[0].students.map((s) => s.studentId).sort()).toEqual(["a", "b", "c"]);
    expect(model.grid.every((r) => r.cells["1.2.4"] === "verified")).toBe(true);
    expect(model.firstDollarCount).toBe(3);
  });

  it("counts a REPLAYED first dollar in XP and the counter, but rings NO bell (G5)", () => {
    // Drained from a 20-minute outage: captured_at sits far behind the insert.
    const model = shape({
      members: [member("a", "Maya", "Chen")],
      progress: [prog("a", "1.2.4", "verified")],
      events: [
        ev("a", "1.2.4", "checkmark", { atMs: SAT, capturedAtMs: SAT - 20 * MIN, actionId: "old" }),
      ],
    });
    expect(model.firstDollarCount).toBe(1); // counted
    expect(model.weekendXp).toBe(1); // counted
    expect(model.grid[0].cells["1.2.4"]).toBe("verified"); // filled
    expect(model.celebrations).toEqual([]); // but silent
  });

  it("treats the freshness boundary as inclusive (≤ 60s fresh, > 60s stale)", () => {
    const fresh = shape({
      members: [member("a", "A", "A")],
      events: [ev("a", "1.2.4", "checkmark", { atMs: SAT, capturedAtMs: SAT - FW_FIRST_DOLLAR_FRESHNESS_MS })],
    });
    const stale = shape({
      members: [member("a", "A", "A")],
      events: [ev("a", "1.2.4", "checkmark", { atMs: SAT, capturedAtMs: SAT - FW_FIRST_DOLLAR_FRESHNESS_MS - 1 })],
    });
    expect(fresh.celebrations).toHaveLength(1);
    expect(stale.celebrations).toHaveLength(0);
  });

  it("queues two fresh first-dollar actions in adjacent windows — neither dropped", () => {
    const model = shape({
      members: [member("a", "Maya", "Chen"), member("b", "Sam", "Diaz")],
      events: [
        ev("a", "1.2.4", "checkmark", { actionId: "act-1", atMs: SAT }),
        ev("b", "1.2.4", "checkmark", { actionId: "act-2", atMs: SAT + 5000 }),
      ],
    });
    expect(model.celebrations.map((c) => c.key)).toEqual(["act-1", "act-2"]); // oldest first
    expect(model.firstDollarCount).toBe(2);
  });

  it("keys a celebration by the verifying event id when it carried no action id", () => {
    // The fallback is the event's OWN id (unique per occasion, stable across
    // polls) — not a per-student key, which would suppress a genuine re-celebration
    // after undo+re-check (adversarial residual).
    const e = ev("a", "1.2.4", "checkmark", { actionId: null, atMs: SAT, id: "evt-xyz" });
    const model = shape({ members: [member("a", "Maya", "Chen")], events: [e] });
    expect(model.celebrations).toHaveLength(1);
    expect(model.celebrations[0].key).toBe("evt-xyz");
  });
});

describe("shapeFwBoardModel — retraction on undo (G17 / FW-D13)", () => {
  it("drops the ticker line and decrements XP and the counter after an undo", () => {
    const before = shape({
      members: [member("a", "Maya", "Chen")],
      progress: [prog("a", "1.2.4", "verified")],
      events: [ev("a", "1.2.4", "checkmark", { atMs: SAT, actionId: "x" })],
    });
    expect(before.firstDollarCount).toBe(1);
    expect(before.weekendXp).toBe(1);
    expect(before.ticker).toHaveLength(1);
    expect(before.celebrations).toHaveLength(1);

    // Next poll: the undo landed. Its event is the latest, so the current cell is
    // `locked` — retracted everywhere. (Progress also reverts to locked.)
    const after = shape({
      members: [member("a", "Maya", "Chen")],
      progress: [prog("a", "1.2.4", "locked")],
      events: [
        ev("a", "1.2.4", "checkmark", { atMs: SAT, actionId: "x" }),
        ev("a", "1.2.4", "undo", { atMs: SAT + MIN, fromState: "verified" }),
      ],
    });
    expect(after.firstDollarCount).toBe(0);
    expect(after.weekendXp).toBe(0);
    expect(after.ticker).toEqual([]);
    expect(after.celebrations).toEqual([]);
    expect(after.grid[0].cells["1.2.4"]).toBeUndefined();
  });

  it("re-verifies after an undo — a fresh checkmark restores XP, the cell, and the bell", () => {
    const model = shape({
      members: [member("a", "Maya", "Chen")],
      progress: [prog("a", "1.2.4", "verified")],
      events: [
        ev("a", "1.2.4", "checkmark", { atMs: SAT, actionId: "x" }),
        ev("a", "1.2.4", "undo", { atMs: SAT + MIN, fromState: "verified" }),
        ev("a", "1.2.4", "checkmark", { atMs: SAT + 2 * MIN, actionId: "y" }),
      ],
    });
    expect(model.weekendXp).toBe(1);
    expect(model.firstDollarCount).toBe(1);
    expect(model.celebrations).toHaveLength(1);
    expect(model.celebrations[0].key).toBe("y");
  });

  it("exposes NO per-student score field anywhere on the model (FW-D13, structural)", () => {
    // Mutation-resistant, and stronger than a synonym regex: it pins the EXACT key
    // set of every grid row and ticker line, so ANY added per-student field —
    // `xp`, `dollarsEarned`, `total`, anything — reddens it, not just three named
    // synonyms (testing review). Reads RUNTIME keys, so a relocation of the cohort
    // total onto a row fails it too.
    const model = shape({
      members: [member("a", "Maya", "Chen"), member("b", "Sam", "Diaz")],
      progress: [prog("a", "1.1.1", "verified"), prog("b", "2.2.2", "verified")],
      events: [ev("a", "1.1.1", "checkmark"), ev("b", "2.2.2", "checkmark")],
    });
    for (const row of model.grid) {
      expect(Object.keys(row).sort()).toEqual(["cells", "displayName", "studentId"]);
    }
    for (const line of model.ticker) {
      expect(Object.keys(line).sort()).toEqual([
        "atMs",
        "displayName",
        "firstDollar",
        "kind",
        "label",
        "studentId",
        "taskId",
      ]);
    }
    // The ONLY XP the model carries is the cohort total — never a per-student one.
    expect(typeof model.weekendXp).toBe("number");
    expect(model.grid.every((r) => !("weekendXp" in r))).toBe(true);
  });

  it("resolves a same-millisecond checkmark/undo pair by capture (tap) order, not by random id", () => {
    // adv-fw6-01: `at` is ms-truncated and `id` is a random uuid, so a drain's
    // back-to-back captured pair sharing an insert millisecond must fall to
    // `capturedAtMs` (the true tap order the queue preserves) — NOT a coin flip
    // that could stably report the wrong current state.
    const at = SAT;
    // The undo was TAPPED after the checkmark (captured later), but both were
    // INSERTED (drained) in the same millisecond, and the undo's id sorts LOWER.
    const undone = shape({
      members: [member("a", "Maya", "Chen")],
      events: [
        ev("a", "1.2.4", "checkmark", { atMs: at, capturedAtMs: at - 5 * MIN, actionId: "x", id: "zzz" }),
        ev("a", "1.2.4", "undo", { atMs: at, capturedAtMs: at - 1 * MIN, fromState: "verified", id: "aaa" }),
      ],
    });
    // Capture order wins: the undo is last → retracted everywhere.
    expect(undone.firstDollarCount).toBe(0);
    expect(undone.weekendXp).toBe(0);
    expect(undone.ticker).toEqual([]);

    // And the reverse tap order (undo tapped first, then a genuine re-check) lands
    // verified despite the same insert millisecond and an unfavourable id order.
    const reverified = shape({
      members: [member("a", "Maya", "Chen")],
      events: [
        ev("a", "1.2.4", "undo", { atMs: at, capturedAtMs: at - 5 * MIN, fromState: "verified", id: "zzz" }),
        ev("a", "1.2.4", "checkmark", { atMs: at, capturedAtMs: at - 1 * MIN, actionId: "y", id: "aaa" }),
      ],
    });
    expect(reverified.firstDollarCount).toBe(1);
    expect(reverified.weekendXp).toBe(1);
  });

  it("does NOT ring a bell for an anomalous negative capture gap (captured after insert)", () => {
    // adv-fw6 residual: a real event has captured_at ≤ at (RPC-clamped); a negative
    // gap can only come from a future direct-SQL writer, and it must fail closed to
    // stale rather than reading as an ultra-fresh live tap.
    const model = shape({
      members: [member("a", "Maya", "Chen")],
      events: [ev("a", "1.2.4", "checkmark", { atMs: SAT, capturedAtMs: SAT + 5000 })],
    });
    expect(model.firstDollarCount).toBe(1); // still counts in the aggregate
    expect(model.celebrations).toEqual([]); // but rings no bell
  });
});

describe("shapeFwBoardModel — anonymized members (Decision 10)", () => {
  it("keeps a removed student's events in the aggregates but off the grid and ticker", () => {
    // Mirrors loadFwProfiles' guide-roster filter: the retained events still count
    // (task ids are not PII), but a 'Removed student' never renders a name.
    const model = shape({
      members: [
        member("keep", "Maya", "Chen"),
        member("gone", "Removed", "student", "g9_12", true),
      ],
      progress: [prog("keep", "1.1.1", "verified"), prog("gone", "1.2.4", "verified")],
      events: [
        ev("keep", "1.1.1", "checkmark", { atMs: SAT }),
        ev("gone", "1.2.4", "checkmark", { atMs: SAT + MIN, capturedAtMs: SAT + MIN }),
      ],
    });
    // Grid + ticker: only the name-bearing student.
    expect(model.grid.map((r) => r.studentId)).toEqual(["keep"]);
    expect(model.ticker.every((l) => l.studentId === "keep")).toBe(true);
    // Aggregates: the anonymized student's 1.2.4 still counts.
    expect(model.firstDollarCount).toBe(1);
    expect(model.weekendXp).toBe(1 + 1); // keep's phase-1 + gone's phase-1
    expect(model.rollups.checkmarks).toBe(2);
    // ...but they are never NAMED in a celebration.
    expect(model.celebrations).toEqual([]);
    // rollups.students counts only the name-bearing roster.
    expect(model.rollups.students).toBe(1);
  });
});
