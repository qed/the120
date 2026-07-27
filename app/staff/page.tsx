import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/app/crm/lib/auth";

/**
 * Force-dynamic: the gate reads the session and the service-role `staff` row
 * per request, and the env-less build must never try to prerender it. Both
 * `/crm` and `/fp/fw/ops` carry the same directive for the same reason.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Staff — The 120",
  // R5a again, at the page: `metadata` does not merge up from a layout for
  // fields the page declares, and a page that shipped without this would
  // inherit the PUBLIC marketing robots directive from the root layout.
  robots: { index: false, follow: false },
};

/**
 * The staff hub — PLACEHOLDER BODY (Staff Front Door plan, Unit 2).
 *
 * Unit 11 fills this in: two application cards, each with a name, a one-line
 * description and one live number (R1–R4). What ships here is only what Unit 2
 * owes — a real, gated, noindex mount target at a real URL, with working links
 * so the route is not a dead end for whoever lands on it before Unit 11.
 *
 * The page gates as well as the layout, matching every other guarded surface
 * in the repo: Next 16 layouts do not re-render on soft navigation, so a page
 * leaning on its layout alone would be gated only on the render that mounted
 * it. `requireStaff()` is request-memoized, so this second call is free.
 */
export default async function StaffHubPage() {
  await requireStaff();

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <h1 className="font-path-display text-2xl text-hq-ink">Staff</h1>
      <p className="mt-2 text-sm text-hq-ink-soft">
        The front door to The 120&rsquo;s staff tools.
      </p>

      <nav className="mt-8 grid gap-4 sm:grid-cols-2">
        <Link
          href="/crm"
          className="block rounded-xl border border-hq-border bg-hq-surface p-5 shadow-hq transition-colors hover:border-hq-border-strong"
        >
          <span className="block font-path-display text-lg text-hq-ink">
            Admissions
          </span>
          <span className="mt-1 block text-sm text-hq-ink-soft">
            Families, dossiers, and the admissions pipeline.
          </span>
        </Link>

        <Link
          href="/fp/fw/ops"
          className="block rounded-xl border border-hq-border bg-hq-surface p-5 shadow-hq transition-colors hover:border-hq-border-strong"
        >
          <span className="block font-path-display text-lg text-hq-ink">
            Founders Weekend
          </span>
          <span className="mt-1 block text-sm text-hq-ink-soft">
            Weekend cohorts, rosters, and guide access.
          </span>
        </Link>
      </nav>
    </main>
  );
}
