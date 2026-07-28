import type { Metadata } from "next";
import LandingPage from "@/app/components/landing/LandingPage";
import { getSeatsRemaining } from "@/app/lib/seats";
import { FIRST_PROFIT_LANDING } from "@/app/lib/site";

/**
 * `/first-profit` — the group-neutral sixth landing (funnel U5; R19, R24,
 * R25). The BROAD-ADS destination only: nothing internal links here (R25,
 * pinned by test), its CTA carries `src=fp-generic` and sets NO `?g=` — a
 * cold visitor has named no group, and a hint they never gave would
 * pre-select a door on someone else's behalf.
 */

export const metadata: Metadata = {
  title: "First Profit — The 120",
  description: FIRST_PROFIT_LANDING.subhead,
};

export default async function FirstProfitPage() {
  const seatsRemaining = await getSeatsRemaining();

  return (
    <LandingPage
      content={{
        headline: FIRST_PROFIT_LANDING.headline,
        subhead: FIRST_PROFIT_LANDING.subhead,
        hero: FIRST_PROFIT_LANDING.hero,
        source: "fp-generic",
        // No group: fp-generic names none (R24).
      }}
      seatsRemaining={seatsRemaining}
    />
  );
}
