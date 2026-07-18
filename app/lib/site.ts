/**
 * Single source of truth for The 120's public facts.
 * Direction (confirmed): five groups, one network — per the design handoff.
 * Scarcity stays truthful: seat numbers live in one place.
 */

export const SEATS_TOTAL = 120;
// Hand-maintained, truthful count (7 committed founding families as of 2026-07-09).
// Update as commitments land; becomes a live Supabase deposit count in S4.
export const SEATS_REMAINING = 113;
export const SEATS_FILLED = SEATS_TOTAL - SEATS_REMAINING;
export const seatsLabel = (remaining: number = SEATS_REMAINING) =>
  `${remaining} OF ${SEATS_TOTAL} SEATS REMAIN`;

/** Two price points, one network (handoff Tuition). */
export const TUITION_MEMBERSHIP_CAD = 3000;
export const TUITION_FULL_CORE_CAD = 15000;

/** Canonical absolute origin for links in outbound email. */
export const SITE_URL = "https://the120.school";

/**
 * Seat-deposit refund deadline — single source of truth for copy.
 * (Adopting sites: offer email. Known hardcoded stragglers that could adopt
 * it: welcome route, nurture copy, DashboardApp ×2, crm engine nudge.)
 */
export const DEPOSIT_REFUND_DEADLINE_LABEL = "September 30, 2026";

/**
 * Booking target for every "Book a call" CTA (T1/T2).
 * Set NEXT_PUBLIC_BOOKING_URL in Vercel (Cal.com/Calendly) to activate the real
 * scheduler — no code change needed. Email fallback until then, so no dead clicks.
 */
export const BOOKING_URL =
  process.env.NEXT_PUBLIC_BOOKING_URL || "mailto:admissions@the120.school";

// Streamlined 2026-07-13: the landing page reads top-to-bottom (groups, how
// it works, parents proof all live there); the Gauntlet moved to the
// signed-in dashboard. Footer keeps the full sitemap.
export const nav = [
  // The 2026-27 founding-year program page leads the nav (recruitment front door).
  { label: "2026–27", href: "/2026-27" },
  // GPF-1: The Gauntlet is a permanent nav pillar (noun, not "Play the
  // Gauntlet" — the verb lives in the CTAs). The wordmark covers "The 120".
  { label: "The Gauntlet", href: "/gauntlet" },
  { label: "Tuition", href: "/tuition" },
  { label: "FAQ", href: "/faq" },
] as const;

/**
 * Exact-match active-link test for the shared `nav`. Returns true only when the
 * current pathname equals the link's href — so `/2026-27` never activates on
 * `/2026-27x` or a sibling route. Null pathname (pre-hydration) is never active.
 */
export function isActiveNav(pathname: string | null, href: string): boolean {
  return pathname === href;
}

/** The five groups (handoff Home + group pages). Scholars route to their own program page. */
export type Group = {
  slug: string;
  name: string;
  accent: string; // italic display word
  category: string;
  kicker: string;
  blurb: string;
  body: string;
  href: string;
  cta: string;
};

export const groups: Group[] = [
  {
    slug: "athletes",
    name: "The Athletes",
    accent: "Athletes",
    category: "ATHLETES",
    kicker: "GROUP 01 · ATHLETES · ENROLLING NOW",
    blurb: "Train seriously, compete seriously, and think like a pro.",
    body: "For kids who train seriously and want more than practice. A year-long athletic project: a season record, a training system, a documented climb. Mentored by people who have competed, and demoed to the whole network at the Toronto intensives.",
    href: "/groups/athletes",
    cta: "ENROLLING NOW · BOOK OR JOIN →",
  },
  {
    slug: "founders",
    name: "The Founders",
    accent: "Founders",
    category: "ENTREPRENEURS",
    kicker: "GROUP 02 · ENTREPRENEURS · ENROLLING NOW",
    blurb: "Start something real. Customers, revenue, lessons learned.",
    body: "For kids who want to start something real. A year-long venture: customers, revenue, lessons learned. Mentored by people who have built companies, and pitched to the whole network at the Toronto intensives.",
    href: "/groups/founders",
    cta: "ENROLLING NOW · BOOK OR JOIN →",
  },
  {
    slug: "makers",
    name: "The Makers",
    accent: "Makers",
    category: "CREATIVE",
    kicker: "GROUP 03 · CREATIVE · ENROLLING NOW",
    blurb: "Art, film, music, invention. A real body of work, shipped.",
    body: "For kids who need to make things. A year-long body of work: a film, an album, an invention, a portfolio. Mentored by working artists and builders, and shown to the whole network at the Toronto intensives.",
    href: "/groups/makers",
    cta: "ENROLLING NOW · BOOK OR JOIN →",
  },
  {
    slug: "scholars",
    name: "The Scholars",
    accent: "Scholars",
    category: "GIFTED & TALENTED",
    kicker: "GROUP 04 · GIFTED & TALENTED · ENROLLING NOW",
    blurb: "Accelerated academics. Mastery with no ceiling.",
    body: "For gifted kids who love to learn. Accelerated, mastery-based academics with no ceiling.",
    href: "/scholars",
    cta: "ENROLLING NOW · BOOK OR JOIN →",
  },
  {
    slug: "givers",
    name: "The Givers",
    accent: "Givers",
    category: "SERVICE",
    kicker: "GROUP 05 · SERVICE · ENROLLING NOW",
    blurb: "Lead real service. Projects that change a corner of the city.",
    body: "For kids who lead with service. A year-long service program that changes a corner of the city: planned, run, and measured by them. Mentored by people who have done it, and presented to the whole network at the Toronto intensives.",
    href: "/groups/givers",
    cta: "ENROLLING NOW · BOOK OR JOIN →",
  },
];

export const groupBySlug = (slug: string) => groups.find((g) => g.slug === slug);

/** Quarterly Toronto intensives. */
export const intensives = [
  { label: "Fall Intensive", date: "Nov 7 – 8, 2026" },
  { label: "Winter Intensive", date: "Jan 30 – 31, 2027" },
  { label: "Spring Intensive", date: "Apr 3 – 4, 2027" },
  { label: "Summer Intensive", date: "Jun 12 – 13, 2027" },
] as const;
