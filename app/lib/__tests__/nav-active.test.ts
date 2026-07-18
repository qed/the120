import { describe, expect, it } from "vitest";
import { isActiveNav } from "../site";

describe("isActiveNav — exact-match active-link test", () => {
  it("is active on an exact path match", () => {
    expect(isActiveNav("/2026-27", "/2026-27")).toBe(true);
  });

  it("is not active on a different route", () => {
    expect(isActiveNav("/tuition", "/2026-27")).toBe(false);
  });

  it("does not activate on a prefixed sibling path", () => {
    expect(isActiveNav("/2026-27x", "/2026-27")).toBe(false);
  });

  it("is never active for a null pathname (pre-hydration)", () => {
    expect(isActiveNav(null, "/2026-27")).toBe(false);
  });
});
