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
 * Every straggler named in the original note (DashboardApp, nurture copy, the
 * welcome template) now reads the label below; the offer email already did.
 */
export const DEPOSIT_REFUND_DEADLINE_LABEL = "September 30, 2026";

/**
 * The same deadline, machine-readable (F7). The date stays PRESENTATIONAL this
 * build — nothing compares against it yet — but it lands here so the unit that
 * eventually enforces it (checkout closing, or the October-customer copy the
 * plan's Design Gaps flags) does not have to introduce a second literal and
 * pick which one is authoritative.
 *
 * End of day in Toronto, where the deadline is offered: 2026-09-30 is inside
 * EDT (UTC-4), so the offset is written explicitly rather than left to the
 * server's zone — a bare `new Date("2026-09-30")` is UTC midnight, which is
 * September 29 in Toronto and would expire the refund a day early.
 *
 * The label is NOT derived from this at runtime (formatting would depend on the
 * host's ICU build); `app/lib/__tests__/site-deadline.test.ts` asserts the two
 * agree instead, so a change to either without the other goes red.
 */
export const DEPOSIT_REFUND_DEADLINE = new Date("2026-09-30T23:59:59.999-04:00");

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
  // The Gauntlet nav pillar (GPF-1) is PULLED until launch (Peter 2026-07-18:
  // strangers were meeting a v1 game as their first impression). Restore the
  // entry when GAUNTLET_OPEN=1 flips /gauntlet from Coming Soon to the game.
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

/**
 * The five phase colour tokens (`app/globals.css`), one per group door.
 * Mapping is by door position and is authoritative — unified brief §3.3, D9,
 * confirmed by Peter: Athletes coral, Founders blue, Givers purple, Makers
 * green, Scholars gold.
 *
 * These are the CSS custom-property NAMES exactly as `globals.css` declares
 * them, not Tailwind class names, and deliberately so. Tailwind v4's scanner
 * cannot see `` `text-${g.phaseToken}` `` — a class assembled from this field
 * would compile to nothing and fail silently in production while looking
 * correct in source. U4/U5 map these to COMPLETE literal class strings; they
 * must never interpolate the token into a class.
 *
 * The brief spells them `--tp-phase-*`; that prefix does not exist in this
 * repo. Pinned against `globals.css` by `app/lib/__tests__/site-groups.test.ts`.
 */
export const PHASE_TOKENS = [
  "--color-phase-sell",
  "--color-phase-build",
  "--color-phase-validate",
  "--color-phase-grow",
  "--color-phase-scale",
] as const;

export type PhaseToken = (typeof PHASE_TOKENS)[number];

/**
 * The five group slugs as a closed union. `DOOR_CLASSES` is keyed on it, so a
 * sixth group — or a renamed slug — is a COMPILE error rather than a card
 * that silently falls back to red, a colour this app already uses for errors
 * and the waitlist state. The runtime test that used to be the only backstop
 * now guards a property the compiler already enforces.
 */
export const GROUP_SLUGS = [
  "athletes",
  "founders",
  "makers",
  "scholars",
  "givers",
] as const;

export type GroupSlug = (typeof GROUP_SLUGS)[number];

/**
 * The door colours as COMPLETE LITERAL Tailwind class strings (R14, R15, R17).
 *
 * Literals, not `` `text-${slug}` `` — Tailwind v4's scanner reads source text,
 * so an interpolated class compiles to nothing and fails silently in
 * production while looking correct in the editor. Every string here must be
 * greppable in this file exactly as it ships.
 *
 * `label` uses the text-safe `-ink` variant because all five raw tokens fail
 * WCAG AA as small text on paper (R16, measured — see globals.css). `accent`
 * keeps the raw token for chips and underlines, where contrast rules do not
 * bind. `app/lib/__tests__/door-colors.test.ts` recomputes the ratios.
 *
 * R17: these five are the ONLY Path-register colours permitted on the
 * marketing site — the card footer line and the pre-selected door, nowhere
 * else.
 */
export const DOOR_CLASSES: Record<GroupSlug, { label: string; accent: string }> = {
  athletes: { label: "text-phase-sell-ink", accent: "text-phase-sell" },
  founders: { label: "text-phase-build-ink", accent: "text-phase-build" },
  givers: { label: "text-phase-validate-ink", accent: "text-phase-validate" },
  makers: { label: "text-phase-grow-ink", accent: "text-phase-grow" },
  scholars: { label: "text-phase-scale-ink", accent: "text-phase-scale" },
};

/** The home cards' footer line (R14) — one spelling, five colours. */
export const GROUP_CARD_CTA = "EXPLORE YOUR GROUP →";

/**
 * The five groups (handoff Home + group pages).
 *
 * Extended in U1 with the landing-page fields (R5) — headline line 1, subhead,
 * hero asset, phase colour token — rather than a parallel content module, so
 * `/groups/[slug]`, `/first-profit` and the home cards keep one source.
 *
 * NOTE Scholars' `href` is deliberately still `/scholars`. R5 moves it to
 * `/groups/scholars`, but that move belongs to U5, in the same change that
 * admits scholars to `generateStaticParams` and drops the `notFound()`.
 * `app/components/GroupsBand.tsx` renders `href` directly, so moving it here
 * would point a live home-page card at a 404 for the length of Phase 1.
 */
export type Group = {
  slug: GroupSlug;
  name: string;
  accent: string; // italic display word
  category: string;
  kicker: string;
  blurb: string;
  body: string;
  href: string;
  /** R14 retired the per-group CTA string: the card footer is one shared
   *  constant (GROUP_CARD_CTA) in five colours, and the old copy carried the
   *  "BOOK OR JOIN" wording R18 removes from the logged-out site. */
  /** Landing headline line 1 (Georgia). Line 2 is constant across all six. */
  headline: string;
  /** Landing subhead. Its final sentence is constant across all six. */
  subhead: string;
  /** Hero image slot. The art is an external content dependency (U5 ships the
   *  slot; the photography does not exist yet). */
  hero: string;
  phaseToken: PhaseToken;
};

/**
 * The constant tail every group's subhead ends on (unified brief §3.2), and the
 * constant second line of every landing headline. Exported so the six landing
 * pages assert identity rather than duplicating the sentence six times.
 */
export const LANDING_SUBHEAD_TAIL =
  "In 10 minutes, your kid designs their business and you see where this can go.";
export const LANDING_HEADLINE_LINE_2 = "We'll show you how right now.";

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
    headline: "Your athlete will build a real brand this year.",
    subhead: `NIL branding, a training clinic for younger kids, team merch people actually buy. ${LANDING_SUBHEAD_TAIL}`,
    hero: "/landing/heroes/athletes.jpg",
    phaseToken: "--color-phase-sell",
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
    headline: "Your kid will start a real company this year.",
    subhead: `A typical startup: a product, first customers, real revenue. ${LANDING_SUBHEAD_TAIL}`,
    hero: "/landing/heroes/founders.jpg",
    phaseToken: "--color-phase-build",
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
    headline: "Your kid will sell real work to real people this year.",
    subhead: `Shows and exhibits, prints and commissions, an audience that pays. ${LANDING_SUBHEAD_TAIL}`,
    hero: "/landing/heroes/makers.jpg",
    phaseToken: "--color-phase-grow",
  },
  {
    slug: "scholars",
    name: "The Scholars",
    accent: "Scholars",
    category: "GIFTED & TALENTED",
    kicker: "GROUP 04 · GIFTED & TALENTED · ENROLLING NOW",
    blurb: "Accelerated academics. Mastery with no ceiling.",
    body: "For gifted kids who love to learn. Accelerated, mastery-based academics with no ceiling.",
    // Still /scholars, NOT /groups/scholars — R5 moves it in U5, with the route
    // that will serve it. See the note on `Group`.
    href: "/scholars",
    headline: "Your kid's ideas will earn real money this year.",
    subhead: `Thought leadership: teaching, writing, tutoring, a paid workshop of their own. ${LANDING_SUBHEAD_TAIL}`,
    hero: "/landing/heroes/scholars.jpg",
    phaseToken: "--color-phase-scale",
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
    headline: "Your kid will run a real service venture this year.",
    subhead: `A service venture that changes a corner of the city, funded and run by them. ${LANDING_SUBHEAD_TAIL}`,
    hero: "/landing/heroes/givers.jpg",
    phaseToken: "--color-phase-validate",
  },
];

/**
 * The neutral, ad-only sixth landing page (`/first-profit`) — same content
 * shape as a group, but not a group: it carries no `?g=` hint and never
 * appears on the home cards. U5 builds the route; the copy lives here so all
 * six landings read from one module (R5).
 */
export const FIRST_PROFIT_LANDING = {
  headline: "Your kid will build a real business this year.",
  subhead: `Whatever they are into — sport, a company, art, ideas, service — it becomes something real people pay for. ${LANDING_SUBHEAD_TAIL}`,
  hero: "/landing/heroes/first-profit.jpg",
} as const;

export const groupBySlug = (slug: string) => groups.find((g) => g.slug === slug);

/** Quarterly Toronto intensives. */
export const intensives = [
  { label: "Fall Intensive", date: "Nov 7 – 8, 2026" },
  { label: "Winter Intensive", date: "Jan 30 – 31, 2027" },
  { label: "Spring Intensive", date: "Apr 3 – 4, 2027" },
  { label: "Summer Intensive", date: "Jun 12 – 13, 2027" },
] as const;
