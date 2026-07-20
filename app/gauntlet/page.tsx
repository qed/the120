import type { Metadata } from "next";
import GauntletGame from "./GauntletGame";
import ComingSoon from "./ComingSoon";
import ParentBanner from "./components/ParentBanner";
import { resolveTournamentState } from "@/app/lib/tournament";

export const metadata: Metadata = {
  title: "The Gauntlet — The 120",
  description:
    "Fast math, disguised as a boss battle. One pathway from arithmetic to calculus — coming soon from The 120.",
  openGraph: { images: ["/raiders/keyart.jpg"] },
};

// Render per-request so the tournament phase (date-derived + env-overridable)
// is read at request time, not baked at build — the "turn on without redeploy"
// guarantee (GPF-4/8).
export const dynamic = "force-dynamic";

// HIDDEN until launch (Peter 2026-07-18): strangers were meeting a v1 game as
// their first impression of The 120. Public launch (Aug 3, or when it's ready,
// playable, and useful) = set GAUNTLET_OPEN=1 in Vercel + redeploy — no code
// change. Testers keep playing at /gauntlet/beta (unlinked, noindex).
export default function GauntletPage() {
  if (process.env.GAUNTLET_OPEN !== "1") return <ComingSoon />;
  const tournament = resolveTournamentState();
  return (
    <>
      <ParentBanner bannerLine={tournament.bannerLine} visible={tournament.visible} />
      <GauntletGame tournament={tournament} />
    </>
  );
}
