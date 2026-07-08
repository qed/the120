/**
 * Single source of truth for The 120's public facts.
 * Brief §14.8: never display "120" scarcity claims unless seat counts are
 * truthful and maintained — so seat numbers live in one place.
 */

export const SEATS_TOTAL = 120;
export const SEATS_REMAINING = 87;
export const SEATS_FILLED = SEATS_TOTAL - SEATS_REMAINING;

export const TUITION_CAD = 15000;

export const nav = [
  { label: "The Network", href: "#network" },
  { label: "The Project", href: "#project" },
  { label: "The Subject", href: "#subject" },
  { label: "Tuition", href: "#tuition" },
  { label: "FAQ", href: "#faq" },
] as const;

/** Quarterly Toronto intensives — brief §7. */
export const intensives = [
  { label: "Fall Intensive", date: "Oct 31 – Nov 1, 2026" },
  { label: "Winter Intensive", date: "Jan 23 – 24, 2027" },
  { label: "Spring Intensive", date: "Mar 27 – 28, 2027" },
  { label: "Summer Intensive", date: "Jun 5 – 6, 2027" },
] as const;

/** GT / 2 Hour Learning network outcomes — attributed to the network, never claimed as The 120's own (brief §9, §14.4). */
export const proofStats = [
  { value: "3x", label: "learning velocity vs. traditional school" },
  { value: "1400+", label: "SAT scores by 8th grade" },
  { value: "91%", label: "outperform their national peers" },
  { value: "AP 5s", label: "earned before high school" },
] as const;
