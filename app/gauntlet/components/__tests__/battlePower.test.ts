import { describe, expect, it } from "vitest";
import { comboBurstDamage, isComboBurst } from "../Battle";

describe("raid combo burst", () => {
  it("fires automatically on every fifth correct answer", () => {
    expect(isComboBurst(0)).toBe(false);
    expect(isComboBurst(4)).toBe(false);
    expect(isComboBurst(5)).toBe(true);
    expect(isComboBurst(10)).toBe(true);
  });

  it("adds a noticeable but bounded hit without pausing play", () => {
    expect(comboBurstDamage(1_000)).toBe(80);
    expect(comboBurstDamage(400)).toBe(60);
  });
});
