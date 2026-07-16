import type { Metadata } from "next";
import GauntletGame from "./GauntletGame";
import ParentBanner from "./components/ParentBanner";
import { resolveTournamentState } from "@/app/lib/tournament";

export const metadata: Metadata = {
  title: "The Gauntlet — The 120",
  description:
    "FastMath training, boss-battle style: fast correct answers do damage. Multiplication to triangle congruence.",
};

// Render per-request so the tournament phase (date-derived + env-overridable)
// is read at request time, not baked at build — the "turn on without redeploy"
// guarantee (GPF-4/8).
export const dynamic = "force-dynamic";

// Tournament state is resolved per-request on the server (date-derived +
// env-overridable) and passed into the client game tree — so the whole surface
// flips with the phase and no client rebuild (GPF-4/8).
export default function GauntletPage() {
  const tournament = resolveTournamentState();
  return (
    <>
      <ParentBanner bannerLine={tournament.bannerLine} visible={tournament.visible} />
      <GauntletGame tournament={tournament} />
    </>
  );
}
