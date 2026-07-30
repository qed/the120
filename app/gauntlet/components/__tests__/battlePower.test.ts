import { describe, expect, it } from "vitest";
import { strikePowerDamage, strikePowerMode } from "../Battle";

describe("raid strike power", () => {
  it("charges the next correct answer while the boss can survive the bonus", () => {
    expect(strikePowerDamage(1_000)).toBe(140);
    expect(strikePowerMode(500, 1_000)).toBe("charged");
  });

  it("becomes an explicit finishing blow only inside lethal range", () => {
    expect(strikePowerMode(140, 1_000)).toBe("finisher");
    expect(strikePowerMode(141, 1_000)).toBe("charged");
  });
});
