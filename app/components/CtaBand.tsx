import Image from "next/image";
import Cta from "./Cta";
import JoinButton from "./JoinButton";
import { SEATS_REMAINING, SEATS_TOTAL } from "@/app/lib/site";

export default function CtaBand() {
  return (
    <section id="join" className="scroll-mt-24 overflow-hidden bg-red text-white">
      <div className="mx-auto grid w-full max-w-6xl items-end gap-8 px-6 pt-20 lg:grid-cols-[1.1fr_0.9fr] lg:pt-24">
        <div className="pb-20 lg:pb-24">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-white/70">
            Claim your child&rsquo;s seat — Fall 2026
          </p>
          <h2 className="mt-4 max-w-2xl font-display text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            Come join the network. Come join the 120.
          </h2>
          <p className="mt-4 max-w-xl text-white/85">
            Create an account, build your child&rsquo;s dossier, and submit it for review. An
            assessment invitation follows.
          </p>

          <div className="mt-8 flex flex-wrap gap-4">
            <JoinButton variant="secondary" className="h-14 px-8 text-sm">
              Join the 120
            </JoinButton>
            <Cta
              href="#call"
              className="h-14 border border-white/40 bg-transparent px-8 text-sm text-white hover:bg-white/10"
            >
              Book a call
            </Cta>
          </div>

          <p className="mt-6 font-mono text-xs uppercase tracking-[0.14em] text-white/80">
            <span className="font-bold text-white">{SEATS_REMAINING}</span> of {SEATS_TOTAL} seats
            remain
          </p>
        </div>

        {/* Robotics cutout — stands at the bottom edge of the band */}
        <div className="relative mx-auto h-64 w-full max-w-xs sm:h-80 lg:h-[26rem]">
          <Image
            src="/reference/project-robotics.webp"
            alt="A member smiling while holding the robot she built."
            fill
            sizes="(max-width: 1152px) 20rem, 24rem"
            className="object-contain object-bottom drop-shadow-[0_20px_40px_rgba(42,18,21,0.45)]"
          />
        </div>
      </div>
    </section>
  );
}
