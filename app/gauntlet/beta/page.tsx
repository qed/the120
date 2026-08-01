import type { Metadata } from "next";
import GauntletGame from "../GauntletGame";
import { PATHWAY } from "../game/pathway";
import { parseChallenge } from "../game/challenge";
import { resolveTournamentState } from "@/app/lib/tournament";

export const dynamic = "force-dynamic";

/**
 * Dynamic unfurls for challenge links (?c=…): a shared challenge previews as
 * "⚔️ RIVAL-X challenges you" in iMessage/Discord instead of a generic beta
 * title — the kid→kid loop's first impression. Payload validated the same
 * way the client validates it; anything malformed falls back to the plain
 * beta metadata. Always noindex.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}): Promise<Metadata> {
  const base: Metadata = {
    title: "The Gauntlet (beta) — The 120",
    description: "Fast math, disguised as a boss battle. One pathway from arithmetic to calculus.",
    robots: { index: false, follow: false },
    openGraph: { images: ["/raiders/keyart.jpg"] },
  };
  try {
    const { c } = await searchParams;
    if (!c) return base;
    const challenge = parseChallenge(c, PATHWAY.map((skill) => skill.id), 5, 120);
    if (!challenge) return base;
    const skill = PATHWAY.find((candidate) => candidate.id === challenge.skillId);
    if (!skill) return base;
    const title = `⚔️ ${challenge.handle || "A rival"} challenges you — The Gauntlet`;
    const description = `Beat ${skill.label} boss L${challenge.level} in under ${challenge.time}s on the same question deck. Free to play — The 120.`;
    return {
      ...base,
      title,
      description,
      openGraph: { title, description, images: ["/raiders/keyart.jpg"] },
    };
  } catch {
    return base;
  }
}

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
