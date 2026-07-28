import StartCta from "./StartCta";
import type { CtaSource } from "@/app/lib/cta-source";

/** Handoff CTA band: centered serif on brand red, white JOIN + bordered BOOK pair. */
export default function CtaBand({
  source,
  headline,
  accent,
  subline = "Founding cohort · Fall 2026 · Ages 8–17 · Toronto",
}: {
  /**
   * REQUIRED, and required for a reason: this band is mounted on /faq,
   * /parents, /tuition, /scholars, the Gauntlet pages and the home page. A
   * hardcoded "home" here credited every one of those conversions to the home
   * page — and left the `faq` and `parents` markers unreachable — which is
   * precisely the number the funnel exists to measure (two reviewers caught
   * this independently).
   */
  source: CtaSource;
  headline?: string;
  accent?: string;
  subline?: string;
}) {
  return (
    <section
      id="join"
      className="flex scroll-mt-24 flex-col items-center gap-7 bg-red px-6 py-[88px] text-center sm:px-11"
    >
      <h2 className="display max-w-[800px] text-3xl text-white sm:text-[52px] sm:leading-[1.1]">
        {headline ?? "Come join the network."}{" "}
        <span className="italic">{accent ?? "Come join the 120."}</span>
      </h2>
      <span className="text-[17px] text-white/85">{subline}</span>
      <div className="flex flex-wrap items-center justify-center gap-[18px]">
        {/* R13: every CTA into the funnel reads "Start Here →" — StartCta's
            default — so the label cannot drift per surface. */}
        <StartCta source={source} variant="white" className="px-[30px] py-4 text-sm" />
        {/* R18: "Book a call" is gone from the logged-out marketing site. The
            call is offered after C1 — on the dashboard and in nurture email —
            where it converts a family who has already started rather than
            competing with the thing that starts them. */}
      </div>
    </section>
  );
}
