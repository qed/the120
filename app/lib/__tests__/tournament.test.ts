import { describe, expect, it } from "vitest";
import { resolvePhase, resolveTournamentState, PRIZE_BANDS } from "../tournament";

// Toronto is EDT (UTC−4) in August 2026. Boundaries: Aug 3 00:00 EDT (start),
// Aug 24 00:00 EDT (after).
const d = (iso: string) => new Date(iso);

describe("resolvePhase — date derivation (no env)", () => {
  const noEnv = { state: undefined, kill: undefined };

  it("is tease before the window opens", () => {
    expect(resolvePhase(d("2026-07-16T12:00:00Z"), noEnv)).toBe("tease");
    // 11pm EDT Aug 2 = 03:00Z Aug 3, still before midnight-EDT start
    expect(resolvePhase(d("2026-08-03T03:59:00Z"), noEnv)).toBe("tease");
  });

  it("is live from Aug 3 midnight EDT through Aug 23", () => {
    expect(resolvePhase(d("2026-08-03T04:00:00Z"), noEnv)).toBe("live");
    expect(resolvePhase(d("2026-08-15T12:00:00Z"), noEnv)).toBe("live");
    // 11:59pm EDT Aug 23 = 03:59Z Aug 24, still live
    expect(resolvePhase(d("2026-08-24T03:59:00Z"), noEnv)).toBe("live");
  });

  it("is after from Aug 24 midnight EDT onward", () => {
    expect(resolvePhase(d("2026-08-24T04:00:00Z"), noEnv)).toBe("after");
    expect(resolvePhase(d("2026-12-01T12:00:00Z"), noEnv)).toBe("after");
  });
});

describe("resolvePhase — overrides", () => {
  const anyTime = d("2026-08-15T12:00:00Z"); // would be "live" by date

  it("TOURNAMENT_KILL forces off and beats the state override", () => {
    expect(resolvePhase(anyTime, { kill: "1" })).toBe("off");
    expect(resolvePhase(anyTime, { kill: "true" })).toBe("off");
    expect(resolvePhase(anyTime, { kill: "1", state: "live" })).toBe("off");
  });

  it("TOURNAMENT_STATE overrides the date default", () => {
    expect(resolvePhase(d("2026-07-16T12:00:00Z"), { state: "live" })).toBe("live");
    expect(resolvePhase(anyTime, { state: "tease" })).toBe("tease");
    expect(resolvePhase(anyTime, { state: "after" })).toBe("after");
  });

  it("ignores an unrecognized state and falls back to date", () => {
    expect(resolvePhase(anyTime, { state: "garbage" })).toBe("live");
  });
});

describe("resolveTournamentState — copy + shape", () => {
  it("tease: play-free CTA + opens-Aug-3 line, no weekly theme", () => {
    const s = resolveTournamentState(d("2026-07-16T12:00:00Z"), {});
    expect(s.phase).toBe("tease");
    expect(s.visible).toBe(true);
    expect(s.isLive).toBe(false);
    expect(s.home.line).toContain("opens Aug 3");
    expect(s.home.ctas[0].label).toBe("Play free");
    expect(s.currentTheme).toBeNull();
    expect(s.bannerLine).toContain("Aug 3");
  });

  it("live: enter-the-tournament CTA + current weekly theme", () => {
    const s = resolveTournamentState(d("2026-08-12T12:00:00Z"), {});
    expect(s.phase).toBe("live");
    expect(s.isLive).toBe(true);
    expect(s.home.ctas[0].label).toBe("Enter the Tournament");
    expect(s.currentTheme?.week).toBe(2);
    expect(s.home.line).toContain("Magmar");
  });

  it("after: founding-leaderboard CTA", () => {
    const s = resolveTournamentState(d("2026-09-01T12:00:00Z"), {});
    expect(s.phase).toBe("after");
    expect(s.home.ctas[0].href).toBe("/gauntlet/founding-leaderboard");
    expect(s.bannerLine).toContain("in the books");
  });

  it("off: not visible, no banner, only a plain play-free CTA", () => {
    const s = resolveTournamentState(d("2026-08-12T12:00:00Z"), { kill: "1" });
    expect(s.phase).toBe("off");
    expect(s.visible).toBe(false);
    expect(s.bannerLine).toBeNull();
    expect(s.home.ctas).toHaveLength(1);
    expect(s.home.ctas[0].label).toBe("Play free");
  });

  it("always exposes the confirmed 3–6 / 7–8 / 9–12 prize bands", () => {
    const s = resolveTournamentState(d("2026-08-12T12:00:00Z"), {});
    expect(s.bands.map((b) => b.short)).toEqual(["3–6", "7–8", "9–12"]);
    expect(PRIZE_BANDS).toHaveLength(3);
  });
});
