import Link from "next/link";
import Footer from "@/app/components/Footer";
import StartCta from "@/app/components/StartCta";
import Wordmark from "@/app/components/Wordmark";
import { seatsDisplay, LANDING_HEADLINE_LINE_2 } from "@/app/lib/site";
import type { CtaSource } from "@/app/lib/cta-source";

/**
 * The landing template, once (funnel U5; R19–R26). Six instances: five group
 * pages and `/first-profit`. Roughly 90% shared — ONLY the hero image,
 * headline line 1, subhead, and the CTA's attribution vary, all supplied as
 * props from `app/lib/site.ts` so no instance can grow its own copy.
 *
 * R20's skeleton in order: floating white nav card, full-bleed hero with
 * gradient and the text lightbox carrying the LIVE seats line (R23), proof
 * strip, the "What is The 120" paragraph, red CTA band, real footer.
 *
 * R26: one exit, forward. The retiring brochure chrome ("← THE 120", "see
 * the groups", Book a call, the Join modal) does not exist here.
 *
 * Decision 4, enforced by shape: this is a pure props-in component with no
 * `searchParams` anywhere in the tree — the pages EMIT `?g=`/`?src=` on
 * their CTAs and never read them, because a Server Component read would opt
 * the whole route into dynamic rendering and cost six indexable pages their
 * static generation.
 */

/**
 * R21: the network paragraph, byte-identical across all six — it is where
 * the NETWORK is sold and must not become group-flavoured. One exported
 * constant, asserted by identity in the tests, because `environment: "node"`
 * has no renderer to compare output through.
 */
export const WHAT_IS_THE_120 =
  "The 120 is a selective network of 120 kids across five groups — Athletes, " +
  "Founders, Makers, Scholars, and Givers. Every member builds something real " +
  "over the year, with mentors who have done it and a cohort doing it beside " +
  "them: 3–5 hours a week, alongside any school, with four in-person " +
  "intensives in Toronto.";

/**
 * The proof strip (R20; U10 fidelity, escalation E1, Peter's 2026-07-29 ruling:
 * restore the handoff copy, no documented supersession found). The strip
 * headline plus three white cards, byte for byte from the prototype's
 * `proofBeats` (straight apostrophes per shipped-spec-copy precedent).
 */
export const PROOF_STRIP_HEADLINE = "No simulations. No pretend points.";

export const PROOF_POINTS = [
  {
    title: "Real customers",
    body: "Strangers say yes at booths, doorsteps and games. Not classmates, not cousins.",
  },
  {
    title: "Real money",
    body: "Cash in hand, logged sale by sale. Cost, price and profit your kid can explain.",
  },
  {
    title: "Verified by real adults",
    body: "Every step checked against a written bar. It's never self-marked, never automated.",
  },
] as const;

/**
 * The lightbox's mono cohort line (U10 fidelity, drift 9 — README screen 1),
 * byte for byte from the prototype's hero card.
 */
export const FOUNDING_COHORT_LINE = "FOUNDING COHORT · FALL 2026 · TORONTO";

export type LandingContent = {
  headline: string;
  subhead: string;
  /**
   * The hero asset path. NOT YET RENDERED — the photography is an external
   * content dependency and the slot ships blue. This prop exists so the day
   * the art lands, the wiring is `<Image src={content.hero}>` in the hero
   * section and nothing else changes. If you are dropping the six JPGs in:
   * that render wiring must land in the same change, or the files sit in
   * /public doing nothing (review note, kept honest here).
   */
  hero: string;
  source: CtaSource;
  /** The `?g=` hint (R24). `/first-profit` sets none (fp-generic). */
  group?: string;
};

export default function LandingPage({
  content,
  seatsRemaining,
}: {
  content: LandingContent;
  seatsRemaining: number;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      {/* Floating white nav card (R20): wordmark and the one forward exit. */}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-20 px-4">
        <div className="pointer-events-auto mx-auto flex w-full max-w-[1080px] items-center justify-between rounded-2xl border border-line bg-white/95 px-5 py-3 shadow-[0_10px_30px_-18px_rgba(0,0,0,0.35)] backdrop-blur">
          <Link href="/" aria-label="The 120 home">
            <Wordmark />
          </Link>
          <StartCta source={content.source} group={content.group} className="px-5 py-2.5 text-xs" />
        </div>
      </div>

      {/* Full-bleed hero (R20). The photography is an external content
          dependency — the slot ships, blue shows until the art lands, and the
          gradient guarantees the lightbox text survives either way. */}
      <section className="relative flex min-h-[92vh] flex-col justify-end bg-blue">
        {/* U10 fidelity (audit drift 9/1b): the handoff's gradient stops,
            byte for byte — .30 → .06 → .10 → .82. */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(rgba(19,20,22,0.30) 0%, rgba(19,20,22,0.06) 30%, rgba(19,20,22,0.10) 55%, rgba(19,20,22,0.82) 100%)",
          }}
        />
        <div className="relative z-10 mx-auto w-full max-w-[1080px] px-6 pb-10 pt-40 sm:px-8">
          {/* The text lightbox (drift 9, README screen 1): rgba(19,20,22,.55),
              14px radius, backdrop-blur 2px, padding 16/18 — seats line,
              headline, divider, subhead + cohort line, CTA, in the
              prototype's order. */}
          <div
            className="rounded-[14px] backdrop-blur-[2px]"
            style={{ background: "rgba(19,20,22,0.55)", padding: "16px 18px" }}
          >
            {/* The lightbox opens on the LIVE seats line (R23) — never the
                prototype's hardcoded scaffolding — through seatsDisplay, so
                zero seats reads as the waitlist state (the /2026-27
                treatment), never "0 OF 120 SEATS REMAIN". */}
            <p className="font-mono text-[11px] tracking-[0.1em] text-white/85">
              {seatsDisplay(seatsRemaining)}
            </p>
            <h1 className="display mt-3 max-w-[820px] text-4xl text-white sm:text-[64px] sm:leading-[1.04]">
              {content.headline}{" "}
              <span className="accent-blush italic">{LANDING_HEADLINE_LINE_2}</span>
            </h1>
            <div className="my-4 h-px max-w-[820px] bg-white/45" />
            <div className="flex flex-wrap items-end justify-between gap-3">
              <p className="max-w-[560px] text-[15px] leading-[1.6] text-white sm:text-[17px]">
                {content.subhead}
              </p>
              <span className="whitespace-nowrap font-mono text-[10px] tracking-[0.08em] text-white/85">
                {FOUNDING_COHORT_LINE}
              </span>
            </div>
            <div className="mt-5">
              <StartCta source={content.source} group={content.group} className="px-7 py-4 text-sm" />
            </div>
          </div>
        </div>
      </section>

      {/* Proof strip (R20/E1): the mono-red headline over three white cards,
          Georgia card titles on paper, the handoff treatment. */}
      <section className="border-b border-line">
        <div className="mx-auto w-full max-w-[1080px] px-6 py-8 sm:px-8">
          <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-red">
            {PROOF_STRIP_HEADLINE}
          </p>
          <div className="mt-3.5 grid gap-2.5 sm:grid-cols-3">
            {PROOF_POINTS.map((p) => (
              <div key={p.title} className="rounded-xl border border-line bg-white px-[15px] py-4">
                <p className="display text-[19px] leading-[1.15] text-ink">{p.title}</p>
                <p className="mt-1.5 text-[12.5px] leading-[1.5] text-ink-soft">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The "What is The 120" paragraph (R21) — the constant, verbatim. */}
      <section className="mx-auto w-full max-w-[820px] px-6 py-20 sm:px-8">
        <span className="font-mono text-xs tracking-[0.1em] text-red">WHAT IS THE 120</span>
        <p className="mt-4 text-lg leading-relaxed text-ink-soft">{WHAT_IS_THE_120}</p>
      </section>

      {/* Red CTA band (R20): one exit, forward (R26). */}
      <section className="flex flex-col items-center gap-6 bg-red px-6 py-20 text-center sm:px-11">
        {/* U10 fidelity (audit drift 6): the handoff band headline, with its
            italic accent sentence. */}
        <h2 className="display max-w-[760px] text-3xl text-white sm:text-[44px] sm:leading-[1.1]">
          The application is the first day of the business.{" "}
          <span className="italic">Start it now.</span>
        </h2>
        <StartCta source={content.source} group={content.group} variant="white" className="px-[30px] py-4 text-sm" />
      </section>

      <Footer />
    </div>
  );
}
