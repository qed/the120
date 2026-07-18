// Pure helper for the /2026-27 schedule strip (§05 · The Schedule). Maps a
// `workshopDates` entry to its pill state so the Schedule section stays a thin,
// data-driven `.map()` and the classification is unit-tested in `node` (repo
// canon: pure `.test.ts`, no DOM harness). No "use server" — plain module.

import type { WorkshopDate } from "./data";

/** The visual state of a single workshop-date pill in the schedule strip. */
export type PillState = "kickoff" | "demo-day" | "tbd" | "normal";

/**
 * Classify a workshop-date entry into its pill state (precedence order):
 *   kickoff  → the Sep 19 launch Saturday (red fill / white + a KICKOFF tag)
 *   demo-day → a "★" Demo Day workshop (darker line-strong fill, ★ marker)
 *   tbd      → the one to-be-scheduled SPECIAL session (dashed border, muted)
 *   normal   → an ordinary in-person workshop (bone fill + hairline border)
 */
export function pillState(entry: WorkshopDate): PillState {
  if (entry.kickoff) return "kickoff";
  if (entry.mark === "★") return "demo-day";
  if (entry.tbd) return "tbd";
  return "normal";
}
