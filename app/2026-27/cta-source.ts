// Pure helpers for the /2026-27 conversion surface (red CTA band + mid-page
// prompt). Kept as a plain, side-effect-free module so the logic is unit-tested
// in `node` (repo canon: pure `.test.ts`, no DOM harness) while the widgets
// stay thin. No "use server" — every export is an ordinary function/const.

import { COPY } from "./data";
import { seatsLabel } from "@/app/lib/site";

/** The page's two voices. Mirrors the keys of the COPY dictionary. */
export type Audience = "parents" | "kids";

/**
 * `SRC_MARKER` and `attributedBookingUrl` MOVED to `app/lib/cta-source.ts`
 * (funnel U4, R11) — every entry surface needs them, and the funnel adds the
 * read-back path this page never had. They are re-exported here rather than
 * deleted: this file has 17 importers and the page-local vocabulary below
 * (`Audience`, `ctaLabels`, `seatsDisplay`, `WAITLIST_LABEL`) stays put.
 */
export { SRC_MARKER, attributedBookingUrl } from "@/app/lib/cta-source";

/** Shown in the red band / seat indicator once the founding cohort is full. */
export const WAITLIST_LABEL = "Founding cohort full — join the waitlist";

export interface CtaLabels {
  /** Label for the account-modal ("Join") button. */
  join: string;
  /** Label for the "Book a call" link. */
  book: string;
}

/**
 * Audience-aware CTA labels, read from the COPY dictionary so the page can
 * never disagree with the rest of the content module.
 *   parents → { join: "Join the 120", book: "Book a call" }
 *   kids    → { join: "Get my seat",  book: "Show my parents" }
 */
export function ctaLabels(audience: Audience): CtaLabels {
  return { join: COPY[audience].joinCta, book: COPY[audience].callCta };
}

/**
 * Seat-indicator text: the live "N OF 120 SEATS REMAIN" label while seats are
 * available, or the waitlist state once the cohort is full (`remaining <= 0`).
 */
export function seatsDisplay(remaining: number): string {
  return remaining <= 0 ? WAITLIST_LABEL : seatsLabel(remaining);
}
