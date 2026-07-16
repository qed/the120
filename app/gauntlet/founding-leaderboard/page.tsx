import type { Metadata } from "next";
import Nav from "@/app/components/Nav";
import Footer from "@/app/components/Footer";
import CtaBand from "@/app/components/CtaBand";
import Cta from "@/app/components/Cta";
import FoundingBoard from "../components/FoundingBoard";
import { resolveTournamentState } from "@/app/lib/tournament";

export const metadata: Metadata = {
  title: "Founding Leaderboard — The Gauntlet — The 120",
  description:
    "The permanent record of The Gauntlet's Summer Tournament — winners by handle, across three grade bands.",
};

// Per-request so the "after close" framing tracks the live phase (GPF-4/8).
export const dynamic = "force-dynamic";

/**
 * GPF-11 — permanent Founding Leaderboard. A durable asset every future season
 * points at ("names go up once"). Renders the live public board; the at-close
 * snapshot (D5) freezes it into the record.
 */
export default function FoundingLeaderboardPage() {
  const t = resolveTournamentState();
  const isAfter = t.phase === "after";

  return (
    <>
      <Nav />
      <main className="flex-1">
        <div className="mx-auto flex w-full max-w-[860px] flex-col gap-4 px-6 pb-8 pt-[84px] sm:px-8">
          <span className="font-mono text-xs tracking-[0.1em] text-red">THE GAUNTLET · FOUNDING LEADERBOARD</span>
          <h1 className="display text-4xl sm:text-[52px] sm:leading-[1.06]">
            The names that <span className="accent">go up once.</span>
          </h1>
          <p className="max-w-[680px] text-[15px] leading-relaxed text-ink-soft">
            {isAfter
              ? "The first Summer Tournament is in the books. Here's the permanent record — top raiders by handle, across the three grade bands."
              : "The Summer Tournament's permanent record. When the tournament runs, the top raiders in each band earn a named spot here — for good."}
          </p>
        </div>

        <div className="mx-auto w-full max-w-[860px] px-6 pb-16 sm:px-8">
          <FoundingBoard />
          <div className="mt-8 flex flex-wrap gap-3">
            <Cta href="/gauntlet" variant="primary" className="px-[26px] py-[15px]">
              Play free
            </Cta>
            <Cta href="/gauntlet/rules" variant="ghost" className="px-[26px] py-[15px]">
              Tournament rules &rarr;
            </Cta>
          </div>
        </div>

        <CtaBand />
      </main>
      <Footer />
    </>
  );
}
