import type { Metadata } from "next";
import GauntletGame from "../GauntletGame";
import { resolveTournamentState } from "@/app/lib/tournament";

export const metadata: Metadata = {
  title: "The Gauntlet (beta) — The 120",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Tester door while the public /gauntlet shows Coming Soon (Peter 2026-07-18).
 * Unlinked and noindexed — shared only in the testers' Discord. No parent
 * banner: everyone here already knows what The 120 is. Retire this once
 * GAUNTLET_OPEN=1 makes the public page the game again.
 */
export default function GauntletBetaPage() {
  const tournament = resolveTournamentState();
  return <GauntletGame tournament={tournament} />;
}
