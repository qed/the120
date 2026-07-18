"use client";

import JoinButton from "@/app/components/JoinButton";
import Cta from "@/app/components/Cta";
import SeatsDot from "@/app/components/SeatsDot";
import { BOOKING_URL } from "@/app/lib/site";
import { COPY } from "./data";
import { attributedBookingUrl, ctaLabels, seatsDisplay, type Audience } from "./cta-source";

/**
 * Red CTA band (§CTA) — mirrors the shared `CtaBand` structure/classes but with
 * audience-driven Join/Book labels + a live `SeatsDot`. The shared band can't
 * relabel its buttons, so this is page-local.
 *
 * Sold-out (R10 decision): when `seatsRemaining <= 0` the seat line shows the
 * waitlist state instead of "0 … SEATS REMAIN"; Join still opens the modal.
 */
export default function RedCtaBand({
  audience,
  seatsRemaining,
}: {
  audience: Audience;
  seatsRemaining: number;
}) {
  const t = COPY[audience];
  const { join, book } = ctaLabels(audience);
  const bookingHref = attributedBookingUrl(BOOKING_URL);
  const soldOut = seatsRemaining <= 0;

  return (
    <section
      id="join"
      className="flex scroll-mt-[152px] flex-col items-center gap-6 bg-red px-6 py-[88px] text-center sm:px-11"
    >
      <h2 className="display max-w-[820px] text-3xl text-white sm:text-[52px] sm:leading-[1.1]">
        <span className="block">One year.</span>
        <span className="block">One real business.</span>
        <span className="accent-blush block">One of 120.</span>
      </h2>

      <p className="text-[17px] text-white/85">
        <span className="block">{t.ctaSub1}</span>
        <span className="block">{t.ctaSub2}</span>
      </p>

      <div className="flex flex-wrap items-center justify-center gap-[18px]">
        <JoinButton variant="white" className="px-[30px] py-4 text-sm">
          {join}
        </JoinButton>
        <Cta href={bookingHref} variant="ghostLight" className="px-7 py-[14.5px] text-sm">
          {book}
        </Cta>
      </div>

      <div className="mt-1">
        {soldOut ? (
          <span className="inline-flex items-center gap-[9px]">
            <span className="h-2 w-2 rounded-full bg-blush" />
            <span className="font-mono text-xs tracking-[0.06em] text-white/70">
              {seatsDisplay(seatsRemaining)}
            </span>
          </span>
        ) : (
          <SeatsDot tone="onDark" remaining={seatsRemaining} />
        )}
      </div>
    </section>
  );
}
