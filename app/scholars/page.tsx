import type { Metadata } from "next";
import Link from "next/link";
import Wordmark from "@/app/components/Wordmark";
import Cta from "@/app/components/Cta";
import JoinButton from "@/app/components/JoinButton";
import { BOOKING_URL, groupBySlug } from "@/app/lib/site";

export const metadata: Metadata = {
  title: "The Scholars — The 120",
  description:
    "For gifted kids who love to learn. Accelerated academics on the GT platform with mastery and no ceiling, run as GT Toronto.",
};

/**
 * /scholars — the Scholars' group page in the same layout as the other four
 * (T11): The 120 chrome, group content, and a deep link to /gt for the full
 * GT Toronto program. /gt keeps all current program detail.
 */
export default function ScholarsPage() {
  const group = groupBySlug("scholars")!;

  return (
    <div className="relative flex min-h-screen flex-col bg-blue">
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(rgba(19,20,22,0.18) 0%, rgba(19,20,22,0) 30%, rgba(19,20,22,0.02) 55%, rgba(19,20,22,0.78) 100%)",
        }}
      />

      {/* Top bar */}
      <div className="relative z-10 flex items-center justify-between px-6 pt-7 sm:px-11">
        <Link
          href="/"
          className="font-mono text-[11px] tracking-[0.08em] text-white/85 transition-colors hover:text-white"
        >
          ← THE 120
        </Link>
        <Link href="/" aria-label="The 120 home">
          <Wordmark tone="light" />
        </Link>
      </div>

      <div className="flex-1" />

      {/* Bottom-anchored content */}
      <div className="relative z-10 flex max-w-[760px] flex-col gap-5 px-6 pb-8 sm:px-11">
        <span className="font-mono text-xs tracking-[0.1em] text-blush">{group.kicker}</span>
        <h1 className="display text-5xl text-white sm:text-[72px] sm:leading-[1.02]">
          The <span className="accent-blush">{group.accent}</span>
        </h1>
        <p className="max-w-[620px] text-[17px] leading-[1.65] text-white/85 sm:text-[19px]">
          {group.body}
        </p>
        <div className="mt-2 flex flex-wrap gap-3.5">
          <Cta href={BOOKING_URL} variant="white" className="px-7 py-4 text-sm">
            Book a call
          </Cta>
          <JoinButton className="px-7 py-4 text-sm">Join the 120</JoinButton>
          <Cta href="/gt" variant="ghostLight" className="px-7 py-4 text-sm">
            The full GT program →
          </Cta>
        </div>
        <span className="font-mono text-[11px] tracking-[0.06em] text-white/60">
          RUN AS GT TORONTO · ASSESSMENT-GATED · MASTERY WITH NO CEILING
        </span>
      </div>

      {/* Footer row */}
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-t border-white/25 px-6 py-5 sm:px-11">
        <span className="text-[13px] text-white/75">
          All five groups enrolling now ·{" "}
          <Link href="/#groups" className="text-white underline underline-offset-2 hover:text-blush">
            See the groups
          </Link>
        </span>
        <span className="font-mono text-[11px] tracking-[0.08em] text-white/60">
          FOUNDING COHORT · FALL 2026 · TORONTO
        </span>
      </div>
    </div>
  );
}
