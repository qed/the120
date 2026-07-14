import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import Wordmark from "@/app/components/Wordmark";
import Cta from "@/app/components/Cta";
import JoinButton from "@/app/components/JoinButton";
import ProductPillars from "@/app/components/ProductPillars";
import PaceSimulator from "@/app/components/PaceSimulator";
import KeyDates from "@/app/components/KeyDates";
import Promises from "@/app/components/Promises";
import ScholarsTuition from "@/app/components/ScholarsTuition";
import Faq from "@/app/components/Faq";
import CtaBand from "@/app/components/CtaBand";
import { BOOKING_URL } from "@/app/lib/site";
import { getSeatsRemaining } from "@/app/lib/seats";

export const metadata: Metadata = {
  title: "The Scholars — The 120",
  description:
    "For gifted kids who love to learn. Accelerated, mastery-based academics with no ceiling.",
};

/**
 * /scholars — the Scholars' full program page, in the same minimal chrome as
 * the other four group pages (top bar over the hero, thin footer row, no
 * site-wide Nav/Footer). Section order per the approved rebuild:
 * hero → pillars → CTA row → simulator → key dates → promises → tuition →
 * FAQ → CTA band → footer row.
 */
export default async function ScholarsPage() {
  const seatsRemaining = await getSeatsRemaining();

  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex-1">
        {/* Hero — gradient and top bar scoped to this section */}
        <section className="relative flex min-h-[700px] flex-col justify-end overflow-hidden">
          <Image
            src="/reference/hero-science.webp"
            alt=""
            fill
            priority
            quality={95}
            sizes="100vw"
            className="-z-20 object-cover object-[72%_32%]"
          />
          <div
            className="absolute inset-0 -z-10"
            style={{
              background:
                "linear-gradient(rgba(19,20,22,0.18) 0%, rgba(19,20,22,0) 30%, rgba(19,20,22,0.02) 55%, rgba(19,20,22,0.78) 100%)",
            }}
          />

          {/* Top bar (sibling group-page chrome, in-flow over the hero) */}
          <div className="absolute inset-x-0 top-0 flex items-center justify-between px-6 pt-7 sm:px-11">
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

          <div className="px-6 pb-10 pt-44 sm:px-11">
            <span className="font-mono text-xs tracking-[0.1em] text-blush">
              GROUP 04 · GIFTED &amp; TALENTED
            </span>
            <h1 className="display mt-4 max-w-[860px] text-4xl text-white sm:text-5xl lg:text-[64px]">
              <span className="accent-blush">School reimagined.</span> For gifted kids who love
              to learn
            </h1>
            <div className="my-[22px] h-px max-w-[820px] bg-white/45" />
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end sm:gap-8">
              <span className="max-w-[680px] text-[17px] leading-relaxed text-white sm:text-lg">
                The Scholars of the 120: accelerated, mastery-based academics with no ceiling,
                and a bi-weekly 30 min 1:1 with an expert Academic Advisor.
              </span>
              <span className="whitespace-nowrap font-mono text-[11px] tracking-[0.08em] text-white/85">
                MASTERY WITH NO CEILING · FOUNDING COHORT FALL 2026
              </span>
            </div>
            <p className="mt-4 font-mono text-[11px] tracking-[0.1em] text-white/60">
              ADMISSION BY APPLICATION AND ACADEMIC REVIEW
            </p>
          </div>
        </section>

        <div id="program" className="scroll-mt-24">
          <ProductPillars />
        </div>

        {/* CTA row — closes the pillars section (the old stats-box slot) */}
        <section className="border-b border-line bg-paper">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-center gap-4 px-6 pb-20">
            <JoinButton className="px-[30px] py-4 text-sm">Join the 120</JoinButton>
            <Cta href={BOOKING_URL} variant="ghost" className="px-7 py-[14.5px] text-sm">
              Book a call
            </Cta>
          </div>
        </section>

        <PaceSimulator />
        <div id="dates" className="scroll-mt-24">
          <KeyDates />
        </div>
        <Promises />
        <ScholarsTuition seatsRemaining={seatsRemaining} />
        <Faq />
        <CtaBand />
      </main>

      {/* Footer row (sibling group-page chrome) */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-blue px-6 py-5 sm:px-11">
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
