import { describe, expect, it } from "vitest";

import {
  FW_BOARD_TOKEN_GRACE_MS,
  fwBoardTokenExpiry,
  fwBoardTokenMintVerdict,
  fwBoardTokenVerdict,
  pickFwCurrentBoardToken,
} from "../fw-board-rules";

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
