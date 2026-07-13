import { describe, it, expect } from "vitest";
import { weekOf, weekBounds, isInSprint, SPRINT_WEEKS } from "@/app/crm/lib/week";

/**
 * Sprint window: Mon Jul 13 → Fri Sep 4, 2026, weeks anchored at Jul 13
 * in America/Toronto. Toronto is EDT (UTC−4) for the whole window, so
 * Toronto-local midnight = 04:00Z.
 */

describe("weekOf", () => {
  it("sprint start (Jul 13 00:00 Toronto) → W1", () => {
    expect(weekOf(new Date("2026-07-13T04:00:00Z")).week).toBe(1);
  });

  it("last day of W1 (Jul 19, midday Toronto) → W1", () => {
    expect(weekOf(new Date("2026-07-19T16:00:00Z")).week).toBe(1);
  });

  it("Sunday 23:30 Toronto = 03:30 UTC Monday → still W1 (Toronto rules, not UTC)", () => {
    // 2026-07-20T03:30:00Z is Mon Jul 20 in UTC but Sun Jul 19 23:30 in
    // Toronto — a naive UTC computation would report W2.
    expect(weekOf(new Date("2026-07-20T03:30:00Z")).week).toBe(1);
  });

  it("W2 begins at Jul 20 00:00 Toronto (04:00Z)", () => {
    expect(weekOf(new Date("2026-07-20T04:00:00Z")).week).toBe(2);
  });

  it("mid-sprint: Aug 12 → W5", () => {
    expect(weekOf(new Date("2026-08-12T16:00:00Z")).week).toBe(5);
  });

  it("W8 starts Aug 31 and still reports 8 on Sep 4 (partial week)", () => {
    expect(weekOf(new Date("2026-08-31T12:00:00Z")).week).toBe(8);
    expect(weekOf(new Date("2026-09-04T12:00:00Z")).week).toBe(8);
  });

  it("pre-sprint (Jul 12) clamps to W1", () => {
    expect(weekOf(new Date("2026-07-12T16:00:00Z")).week).toBe(1);
  });

  it("far pre-sprint (Jan 2026) clamps to W1", () => {
    expect(weekOf(new Date("2026-01-05T12:00:00Z")).week).toBe(1);
  });

  it("post-sprint (Sep 5) clamps to W8", () => {
    expect(weekOf(new Date("2026-09-05T16:00:00Z")).week).toBe(8);
  });

  it("far post-sprint (Dec 2026) clamps to W8", () => {
    expect(weekOf(new Date("2026-12-25T12:00:00Z")).week).toBe(8);
  });
});

describe("weekBounds", () => {
  it("W1 spans Jul 13 00:00 → Jul 20 00:00 Toronto (04:00Z instants)", () => {
    const { start, end } = weekBounds(1);
    expect(start.toISOString()).toBe("2026-07-13T04:00:00.000Z");
    expect(end.toISOString()).toBe("2026-07-20T04:00:00.000Z");
  });

  it("W2 starts where W1 ends (contiguous, no gap)", () => {
    expect(weekBounds(2).start.getTime()).toBe(weekBounds(1).end.getTime());
  });

  it("W8 is partial: Aug 31 → exclusive end after Sep 4", () => {
    const { start, end } = weekBounds(8);
    expect(start.toISOString()).toBe("2026-08-31T04:00:00.000Z");
    expect(end.toISOString()).toBe("2026-09-05T04:00:00.000Z");
    // Only 5 days (Mon Aug 31 – Fri Sep 4), not 7.
    expect((end.getTime() - start.getTime()) / 86_400_000).toBe(5);
  });

  it("weeks 2–7 are full 7-day weeks", () => {
    for (let n = 2; n <= 7; n++) {
      const { start, end } = weekBounds(n);
      expect((end.getTime() - start.getTime()) / 86_400_000).toBe(7);
    }
  });

  it("throws on out-of-range or non-integer weeks", () => {
    expect(() => weekBounds(0)).toThrow(RangeError);
    expect(() => weekBounds(9)).toThrow(RangeError);
    expect(() => weekBounds(1.5)).toThrow(RangeError);
  });

  it("SPRINT_WEEKS is 8", () => {
    expect(SPRINT_WEEKS).toBe(8);
  });
});

describe("isInSprint", () => {
  it("true at the first instant of W1", () => {
    expect(isInSprint(new Date("2026-07-13T04:00:00Z"))).toBe(true);
  });

  it("false one millisecond before the sprint (Jul 12 23:59:59.999 Toronto)", () => {
    expect(isInSprint(new Date("2026-07-13T03:59:59.999Z"))).toBe(false);
  });

  it("true late on Sep 4 Toronto (Sep 5 03:59Z)", () => {
    expect(isInSprint(new Date("2026-09-05T03:59:00Z"))).toBe(true);
  });

  it("false from Sep 5 00:00 Toronto onward (sprint ended)", () => {
    expect(isInSprint(new Date("2026-09-05T04:00:00Z"))).toBe(false);
  });

  it("weekOf clamps outside the window, isInSprint distinguishes the edges", () => {
    const after = new Date("2026-09-10T12:00:00Z");
    expect(weekOf(after).week).toBe(8);
    expect(isInSprint(after)).toBe(false);
  });
});
