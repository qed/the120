/**
 * Funnel entry attribution (funnel U4; R10, R11, R13, R18).
 *
 * `app/2026-27/cta-source.ts` proved the marker pattern on one page. This is
 * that pattern promoted to `app/lib/` for every entry surface — and, unlike
 * the original, given a READ-BACK path, because answering the ads question is
 * the point of the exercise. `SRC_MARKER = "src=2026-27"` has been applied at
 * two call sites since launch and read back exactly nowhere.
 *
 * PURE. No next/, no supabase. `/start` parses the param (U6), `families.entry_source`
 * stores it once and immutably (column landed in U1), U16 segments on it.
 *
 * NOTE the split of concerns with `app/2026-27/cta-source.ts`: only
 * `SRC_MARKER` and `attributedBookingUrl` moved out. That file keeps its
 * page-local vocabulary (`Audience`, `ctaLabels`, `seatsDisplay`,
 * `WAITLIST_LABEL`) because it has **17 importers**, fourteen of them for the
 * `Audience` type alone. Deleting it is a seventeen-file breakage; the plan
 * says extract, not delete.
 */

/**
 * The closed set of entry surfaces (R11). Derived type, so a marker that
 * exists nowhere in this array is a COMPILE error at the call site rather
 * than a runtime string that quietly segments into a bucket nobody reads.
 *
 * `2026-27` keeps its historical spelling: rows already carry it, and
 * renaming a marker orphans the data it was collected under.
 */
export const CTA_SOURCES = [
  "home",
  "lp-athletes",
  "lp-founders",
  "lp-makers",
  "lp-scholars",
  "lp-givers",
  "fp-generic",
  "2026-27",
  "tuition",
  "faq",
  "parents",
  "scholars-legacy",
] as const;

export type CtaSource = (typeof CTA_SOURCES)[number];

export const isCtaSource = (x: unknown): x is CtaSource =>
  typeof x === "string" && (CTA_SOURCES as readonly string[]).includes(x);

/** The query key. One spelling, exported, so no surface hand-writes "src". */
export const CTA_SOURCE_PARAM = "src";

/** The group-hint key the landing pages emit (R36's hint; `/start` reads it). */
export const CTA_GROUP_PARAM = "g";

/**
 * Every funnel CTA reads exactly this (R13). "Start Building" survives only as
 * the internal name of the `/start` stage, never as a label.
 */
export const FUNNEL_CTA_LABEL = "Start Here →";

/** The five group landings' markers, by slug — the one mapping, so a surface
 *  cannot invent `lp-athlete` and have it silently become a new bucket. */
export const groupCtaSource = (slug: string): CtaSource => {
  const marker = `lp-${slug}`;
  return isCtaSource(marker) ? marker : "home";
};

/**
 * The funnel entry href for a surface. Relative by construction — this is an
 * internal route, and building it with `URL` would demand an origin the
 * caller does not have at render time.
 *
 * Idempotent, and it never emits a second `src`: a surface that composes this
 * twice (a wrapper plus a call site) produces one marker, not two, because a
 * duplicated param is a bucket that double-counts.
 */
export function funnelEntryHref(
  source: CtaSource,
  opts: { group?: string } = {}
): string {
  const params = new URLSearchParams({ [CTA_SOURCE_PARAM]: source });
  if (opts.group) params.set(CTA_GROUP_PARAM, opts.group);
  return `/start?${params.toString()}`;
}

/**
 * READ-BACK (R11's actual point): parse a marker off an incoming request's
 * params. Fail-closed to `null` — an unknown or absent marker is "unattributed",
 * never coerced to `home`, because a wrong attribution is worse than a missing
 * one when the whole exercise is deciding where to spend ad money.
 *
 * Accepts the shapes Next hands a route: a `URLSearchParams`, or the plain
 * object a Server Component receives (where a repeated param arrives as an
 * array — take the first, don't stringify the array into `"a,b"`).
 */
export function readCtaSource(
  params: URLSearchParams | Record<string, string | string[] | undefined> | null | undefined
): CtaSource | null {
  if (!params) return null;
  const raw =
    params instanceof URLSearchParams
      ? params.get(CTA_SOURCE_PARAM)
      : params[CTA_SOURCE_PARAM];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return isCtaSource(value) ? value : null;
}

/* ───────────────────────── booking attribution (R18) ───────────────────────── */

/**
 * Moved here from `app/2026-27/cta-source.ts` (its two call sites now import
 * from this module).
 *
 * R18 removes "Book a call" from the logged-out marketing site, but the
 * booking URL and this helper SURVIVE: the call is offered after C1, as a
 * quiet link on the parent dashboard and inside nurture emails. Deleting them
 * would mean rebuilding them for those surfaces.
 */
export const SRC_MARKER = "src=2026-27";

/**
 * Append the conversion-source marker to an http(s) booking URL.
 * - Non-http targets (the `mailto:` fallback) are returned unchanged.
 * - `&` when the URL already carries a query, `?` otherwise.
 * - Idempotent: a URL already carrying the marker is returned unchanged.
 */
export function attributedBookingUrl(url: string): string {
  if (!/^https?:\/\//i.test(url)) return url;
  if (url.includes(SRC_MARKER)) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}${SRC_MARKER}`;
}
