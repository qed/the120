"use client";

import JoinButton from "@/app/components/JoinButton";
import Cta from "@/app/components/Cta";
import { BOOKING_URL } from "@/app/lib/site";
import { attributedBookingUrl, ctaLabels, type Audience } from "./cta-source";

/**
 * Compact mid-page conversion prompt, placed after The Path (§08) — the intent
 * peak — so a convinced parent can convert without scrolling the whole page to
 * the red band (the global Nav has Join but no "Book a call", and hides Join
 * behind the hamburger under `sm`). Audience-driven labels, no pricing.
 */
export default function MidPageCta({ audience }: { audience: Audience }) {
  const { join, book } = ctaLabels(audience);
  const bookingHref = attributedBookingUrl(BOOKING_URL);

  return (
    <section className="bg-white px-6 py-14 sm:px-11">
      <div className="mx-auto flex w-full max-w-[1240px] flex-col items-center gap-4 rounded-[18px] border border-line bg-paper px-8 py-10 text-center">
        <h2 className="display text-2xl text-ink sm:text-[28px]">
          Convinced? <span className="accent">Claim a seat.</span>
        </h2>
        <p className="max-w-[560px] text-[15px] leading-relaxed text-ink-soft">
          The founding cohort is 120 kids, and they&rsquo;re going. Start an account, or book a call
          and we&rsquo;ll walk your family through the year.
        </p>
        <div className="mt-1 flex flex-wrap items-center justify-center gap-3.5">
          <JoinButton className="px-7 py-4 text-sm">{join}</JoinButton>
          <Cta href={bookingHref} variant="ghost" className="px-7 py-4 text-sm">
            {book}
          </Cta>
        </div>
      </div>
    </section>
  );
}
