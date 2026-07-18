// Pure helpers for the /2026-27 conversion surface (red CTA band + mid-page
// prompt). Kept as a plain, side-effect-free module so the logic is unit-tested
// in `node` (repo canon: pure `.test.ts`, no DOM harness) while the widgets
// stay thin. No "use server" — every export is an ordinary function/const.

import { COPY } from "./data";
import { seatsLabel } from "@/app/lib/site";

/** The page's two voices. Mirrors the keys of the COPY dictionary. */
export type Audience = "parents" | "kids";

/** Conversion-attribution marker appended to the http(s) booking URL. */
export const SRC_MARKER = "src=2026-27";

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
 * Append the 2026-27 conversion-source marker to an http(s) booking URL so
 * signups from this page are attributable at launch (no analytics layer yet).
 * - Non-http targets (the `mailto:` fallback) are returned unchanged.
 * - Uses `&` when the URL already carries a query, `?` otherwise.
 * - Idempotent: a URL that already has the marker is returned unchanged.
 */
export function attributedBookingUrl(url: string): string {
  if (!/^https?:\/\//i.test(url)) return url;
  if (url.includes(SRC_MARKER)) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}${SRC_MARKER}`;
}

/**
 * Seat-indicator text: the live "N OF 120 SEATS REMAIN" label while seats are
 * available, or the waitlist state once the cohort is full (`remaining <= 0`).
 */
export function seatsDisplay(remaining: number): string {
  return remaining <= 0 ? WAITLIST_LABEL : seatsLabel(remaining);
}
