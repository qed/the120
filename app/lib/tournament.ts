/**
 * GPF-4 — The Summer Tournament state machine (the "turn-on" switch).
 *
 * Single source of truth for tournament phase + all state-dependent copy.
 * Every public surface (homepage Gauntlet section, /gauntlet parent banner,
 * in-game "Enter the Tournament" CTA + modal, rules page, standings email,
 * founding leaderboard) reads its phase and copy from here — so turning the
 * tournament on is ONE switch, never a copy-hunt.
 *
 * Server-safe (NOT "use client", NOT "server-only"): server components import
 * it and pass the resolved, fully-serializable `TournamentState` down into the
 * client game tree as a prop. Never import this from a client component — read
 * the prop instead.
 *
 * Phase resolution, in priority order:
 *   1. TOURNAMENT_KILL=1  → "off" (B4 kill switch — hide every tournament
 *      surface with no redeploy; plain "Play free" remains).
 *   2. TOURNAMENT_STATE=tease|live|after  → manual override (testing/ops).
 *   3. Date-derived default (needs no env): tease < Aug 3 ≤ live ≤ Aug 23 <
 *      after. Evaluated per-request on the server, so the tournament auto-flips
 *      to Live on Aug 3 and to After on Aug 24 with zero action.
 *
 * These are plain server env vars (not NEXT_PUBLIC_*, which inline at build
 * time and need a redeploy). The date default means no env is required at all.
 */

export type TournamentPhase = "off" | "tease" | "live" | "after";

/** Prize bands — brief §9 "Confirmed details (1): 3–6 / 7–8 / 9–12". Stored on
 *  each tournament entry as `prize_band`, independent of the game's g34/g56/g78
 *  practice bands. The rules page is the single source of truth (Guardrail #6). */
export const PRIZE_BANDS = [
  { id: "b36", short: "3–6", label: "Grades 3–6" },
  { id: "b78", short: "7–8", label: "Grades 7–8" },
  { id: "b912", short: "9–12", label: "Grades 9–12" },
] as const;

export type PrizeBandId = (typeof PRIZE_BANDS)[number]["id"];
export type PrizeBand = { id: PrizeBandId; short: string; label: string };

/** Per-band prize ladder (gauntlet-roadmap Decisions #1). */
export const PRIZES = [
  { place: "1st", amount: "$50" },
  { place: "2nd", amount: "$25" },
  { place: "3rd", amount: "$10" },
] as const;

export interface WeeklyTheme {
  week: number;
  label: string; // "Week 2: Magmar's Fraction Forge"
  startLabel: string; // "Aug 10"
  endLabel: string; // "Aug 16"
}

/** Tournament window as UTC instants (Toronto is EDT = UTC−4 in August). */
const WINDOW = {
  year: 2026,
  // Midnight EDT Aug 3, 2026
  startMs: Date.UTC(2026, 7, 3, 4, 0, 0),
  // Midnight EDT Aug 24, 2026 (tournament runs through end of Aug 23)
  afterMs: Date.UTC(2026, 7, 24, 4, 0, 0),
  windowLabel: "Aug 3–23",
  startLabel: "Aug 3",
  endLabel: "Aug 23",
} as const;

/** Weekly boss themes (GPF-9/D2). Content stubs — Ethan re-cuts by tester
 *  feedback; boss names from the brief §4.2 (Clank/Gloop/Magmar/Vex). */
export const WEEKLY_THEMES: WeeklyTheme[] = [
  { week: 1, label: "Week 1: Clank's Multiplication Melee", startLabel: "Aug 3", endLabel: "Aug 9" },
  { week: 2, label: "Week 2: Magmar's Fraction Forge", startLabel: "Aug 10", endLabel: "Aug 16" },
  { week: 3, label: "Week 3: Vex's Final Reckoning", startLabel: "Aug 17", endLabel: "Aug 23" },
];

const THEME_BOUNDS_MS = [
  Date.UTC(2026, 7, 3, 4), // W1 start
  Date.UTC(2026, 7, 10, 4), // W2 start
  Date.UTC(2026, 7, 17, 4), // W3 start
  Date.UTC(2026, 7, 24, 4), // end
];

function currentTheme(nowMs: number): WeeklyTheme | null {
  for (let i = 0; i < WEEKLY_THEMES.length; i++) {
    if (nowMs >= THEME_BOUNDS_MS[i] && nowMs < THEME_BOUNDS_MS[i + 1]) {
      return WEEKLY_THEMES[i];
    }
  }
  return null;
}

export interface TournamentCta {
  label: string;
  href: string;
  primary?: boolean;
}

/** Fully serializable — safe to pass from a server component into the client
 *  game tree as a prop. No functions, no Date instances. */
export interface TournamentState {
  phase: TournamentPhase;
  isLive: boolean;
  visible: boolean; // false only when phase === "off"
  year: number;
  windowLabel: string;
  startLabel: string;
  endLabel: string;
  bands: PrizeBand[];
  prizes: { place: string; amount: string }[];
  currentTheme: WeeklyTheme | null;
  /** Homepage Gauntlet section: the state-dependent tournament line + CTAs. */
  home: { line: string; ctas: TournamentCta[] };
  /** /gauntlet parent banner: the tournament line (null when off). */
  bannerLine: string | null;
}

function normalizePhase(raw: string | undefined): TournamentPhase | null {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "off" || v === "tease" || v === "live" || v === "after" ? v : null;
}

/** Resolve the current phase. `now`/`env` are injectable for tests. */
export function resolvePhase(
  now: Date = new Date(),
  env: { state?: string; kill?: string } = {
    state: process.env.TOURNAMENT_STATE,
    kill: process.env.TOURNAMENT_KILL,
  }
): TournamentPhase {
  const kill = (env.kill ?? "").trim().toLowerCase();
  if (kill === "1" || kill === "true") return "off";

  const override = normalizePhase(env.state);
  if (override) return override;

  const ms = now.getTime();
  if (ms < WINDOW.startMs) return "tease";
  if (ms < WINDOW.afterMs) return "live";
  return "after";
}

/** Build the full, serializable tournament state for a given moment. */
export function resolveTournamentState(
  now: Date = new Date(),
  env?: { state?: string; kill?: string }
): TournamentState {
  const phase = resolvePhase(now, env);
  const bands = PRIZE_BANDS.map((b) => ({ ...b }));
  const prizes = PRIZES.map((p) => ({ ...p }));
  const theme = phase === "live" ? currentTheme(now.getTime()) : null;

  const base = {
    phase,
    isLive: phase === "live",
    visible: phase !== "off",
    year: WINDOW.year,
    windowLabel: WINDOW.windowLabel,
    startLabel: WINDOW.startLabel,
    endLabel: WINDOW.endLabel,
    bands,
    prizes,
    currentTheme: theme,
  };

  switch (phase) {
    case "off":
      return {
        ...base,
        home: {
          line: "",
          ctas: [{ label: "Play free", href: "/gauntlet", primary: true }],
        },
        bannerLine: null,
      };
    case "tease":
      return {
        ...base,
        home: {
          line: `The Summer Tournament opens ${WINDOW.startLabel}. Play now — be ready when the board goes live.`,
          ctas: [
            { label: "Play free", href: "/gauntlet", primary: true },
            { label: "Tournament rules", href: "/gauntlet/rules" },
          ],
        },
        bannerLine: `Summer Tournament opens ${WINDOW.startLabel}.`,
      };
    case "live":
      return {
        ...base,
        home: {
          line: theme
            ? `The Summer Tournament is live until ${WINDOW.endLabel} — ${theme.label}.`
            : `The Summer Tournament is live until ${WINDOW.endLabel}.`,
          ctas: [
            { label: "Enter the Tournament", href: "/gauntlet", primary: true },
            { label: "Tournament rules", href: "/gauntlet/rules" },
          ],
        },
        bannerLine: theme
          ? `Summer Tournament live until ${WINDOW.endLabel} — ${theme.label}.`
          : `The Summer Tournament is live until ${WINDOW.endLabel}.`,
      };
    case "after":
      return {
        ...base,
        home: {
          line: "The first Summer Tournament is in the books.",
          ctas: [
            { label: "See the Founding Leaderboard", href: "/gauntlet/founding-leaderboard", primary: true },
            { label: "Play free", href: "/gauntlet" },
          ],
        },
        bannerLine: "The first Summer Tournament is in the books.",
      };
  }
}
