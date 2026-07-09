import type { Metadata } from "next";
import Image from "next/image";
import Nav from "@/app/components/Nav";
import ProductPillars from "@/app/components/ProductPillars";
import TimeBackSimulator from "@/app/components/TimeBackSimulator";
import KeyDates from "@/app/components/KeyDates";
import Promises from "@/app/components/Promises";
import Testimonials from "@/app/components/Testimonials";
import GtTuition from "@/app/components/GtTuition";
import Faq from "@/app/components/Faq";
import CtaBand from "@/app/components/CtaBand";
import Footer from "@/app/components/Footer";

export const metadata: Metadata = {
  title: "GT Toronto — The Scholars of The 120",
  description:
    "School reimagined for gifted kids who love to learn. Accelerated academics on the GT platform: mastery with no ceiling, run as GT Toronto.",
};

const gtLinks = [
  { label: "The program", href: "/gt#program" },
  { label: "TimeBack", href: "/gt#subject" },
  { label: "Key dates", href: "/gt#dates" },
  { label: "Tuition", href: "/tuition" },
  { label: "FAQ", href: "/faq" },
];

/** The Scholars' sub-site (handoff GT - Home), keeping our interactive pieces. */
export default function GtHome() {
  return (
    <>
      <Nav gt links={gtLinks} />
      <main className="flex-1">
        {/* GT hero */}
        <section className="relative -mt-[92px] flex min-h-[700px] flex-col justify-end overflow-hidden">
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
          <div className="px-6 pb-10 pt-44 sm:px-11">
            <span className="font-mono text-xs tracking-[0.1em] text-blush">
              GROUP 04 · GIFTED & TALENTED · RUN AS GT TORONTO
            </span>
            <h1 className="display mt-4 max-w-[860px] text-4xl text-white sm:text-5xl lg:text-[64px]">
              <span className="accent-blush">School reimagined.</span> For gifted kids who love
              to learn
            </h1>
            <div className="my-[22px] h-px max-w-[820px] bg-white/45" />
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end sm:gap-8">
              <span className="max-w-[680px] text-[17px] leading-relaxed text-white sm:text-lg">
                The Scholars of the 120: accelerated academics on the GT platform, mastery with
                no ceiling, and a weekly 1:1 with a PhD-level Academic Advisor.
              </span>
              <span className="whitespace-nowrap font-mono text-[11px] tracking-[0.08em] text-white/85">
                1400+ SAT BY 8TH GRADE · 3X VELOCITY
              </span>
            </div>
          </div>
        </section>

        <div id="program" className="scroll-mt-24">
          <ProductPillars />
        </div>
        <TimeBackSimulator />
        <div id="dates" className="scroll-mt-24">
          <KeyDates />
        </div>
        <Promises />
        <Testimonials />
        <GtTuition />
        <Faq />
        <CtaBand />
      </main>
      <Footer />
    </>
  );
}
