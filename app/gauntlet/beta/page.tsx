import type { Metadata } from "next";
import GauntletGame from "../GauntletGame";
import { PATHWAY } from "../game/pathway";
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
    const d = JSON.parse(Buffer.from(c, "base64").toString("utf8")) as {
      s?: unknown;
      l?: unknown;
      t?: unknown;
      h?: unknown;
    };
    const skill = PATHWAY.find((sk) => sk.id === d.s);
    const level = Math.floor(Number(d.l));
    const t = Math.floor(Number(d.t));
    if (!skill || level < 1 || level > 5 || !(t > 0)) return base;
    const h =
      typeof d.h === "string" ? d.h.replace(/[^A-Z0-9-]/gi, "").toUpperCase().slice(0, 12) : "";
    const title = `⚔️ ${h || "A rival"} challenges you — The Gauntlet`;
    const description = `Beat ${skill.label} boss L${level} in under ${t}s. Free to play — The 120.`;
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
