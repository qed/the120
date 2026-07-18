import Link from "next/link";
import JoinButton from "@/app/components/JoinButton";

/**
 * The Gauntlet's public face while the game is hidden (per Peter 2026-07-18:
 * strangers were landing on a v1 app as their first impression of The 120).
 * A stranger who explores Gauntlet marketing info gets a teaser + waitlist
 * (a free account IS the waitlist — the D1 lead-capture path) and a clear
 * road back to the homepage. The game itself: /gauntlet/beta (unlinked,
 * noindex, for Discord testers) until GAUNTLET_OPEN=1 flips this page off.
 */
export default function ComingSoon() {
  return (
    <div
      className="flex min-h-dvh flex-col bg-[#0a0f1a] font-display text-white"
      style={{
        background:
          "linear-gradient(rgba(6,9,16,0.88), rgba(6,9,16,0.96)), url(/raiders/keyart.jpg) center / cover no-repeat, #0a0f1a",
      }}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-8">
        <Link
          href="/"
          className="font-mono text-[11px] tracking-[0.08em] text-white/50 transition-colors hover:text-white"
        >
          ← THE 120
        </Link>

        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-amber-300">Coming soon</p>
          <h1 className="mt-4 text-5xl font-bold tracking-tight sm:text-6xl">
            <span className="bg-gradient-to-r from-indigo-400 to-blue-500 bg-clip-text text-transparent">THE</span>{" "}
            <span className="bg-gradient-to-r from-red-500 to-orange-500 bg-clip-text text-transparent">GAUNTLET</span>
          </h1>
          <p className="mt-4 max-w-lg text-lg text-white/75">
            Fast math, disguised as a boss battle. One pathway from arithmetic to calculus —
            master every fact, climb the road, take on the Summer Tournament.
          </p>
          <p className="mt-2 font-mono text-sm text-white/50">
            Grades 3–12 · free for everyone · built by The 120
          </p>

          <div className="mt-8 flex flex-col items-center gap-3">
            <JoinButton>Join the waitlist — free account</JoinButton>
            <p className="max-w-sm font-mono text-[11px] leading-relaxed text-white/40">
              Account holders get first access when the Gauntlet opens, and a spot in the
              Summer Tournament — prizes in every grade band.
            </p>
          </div>

          <Link
            href="/"
            className="mt-10 rounded-xl border border-white/20 px-6 py-3 font-mono text-xs uppercase tracking-[0.1em] text-white/70 transition-colors hover:border-white/50 hover:text-white"
          >
            Explore The 120 →
          </Link>
        </div>

        <p className="pt-8 text-center font-mono text-[10px] uppercase tracking-[0.12em] text-white/35">
          FastMath training · part of membership in The 120
        </p>
      </div>
    </div>
  );
}
