import { describe, expect, it } from "vitest";
import { pillState } from "../pill-state";
import { workshopDates } from "../data";

describe("pillState — schedule pill classification", () => {
  it("classifies the Sep 19 kickoff as 'kickoff'", () => {
    const sep19 = workshopDates.find((d) => d.label === "SEP 19");
    expect(sep19?.kickoff).toBe(true);
    expect(pillState(sep19!)).toBe("kickoff");
  });

  it("classifies a ★-marked Demo Day as 'demo-day'", () => {
    const demoDay = workshopDates.find((d) => d.mark === "★");
    expect(demoDay?.label).toBe("NOV 7");
    expect(pillState(demoDay!)).toBe("demo-day");
  });

  it("classifies the SPECIAL/TBD session as 'tbd'", () => {
    const special = workshopDates.find((d) => d.tbd);
    expect(special?.label).toBe("SPECIAL");
    expect(pillState(special!)).toBe("tbd");
  });

  it("classifies an ordinary workshop as 'normal'", () => {
    const plain = workshopDates.find((d) => d.label === "OCT 3");
    expect(pillState(plain!)).toBe("normal");
  });
});
