import type { Metadata } from "next";
import Link from "next/link";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { grantedCohortIds, requireFwSession } from "@/app/path/lib/fw-auth";
import { listFwCohortsForActor, loadStaffRowActive } from "@/app/path/lib/fw-guide-core";

/**
 * /path/fw — the FW landing (FW Unit 2, STUB): which Founders Weekend cohorts
 * this session may act in.
 *
 * This is the plan's Unit 2 verification made visible. A granted guide sees only
 * the cohorts their grants name; a staff session sees every `kind='fw'` cohort
 * with no grant row anywhere — which IS the FW-D3 bridge, rendered. A signed-in
 * student or parent sees an empty list and is told to find staff, never a 500
 * and never someone else's roster.
 *
 * Unit 4 replaces this with the cohort switcher (Decision 3: hidden for
 * single-cohort sessions, explicit no-default pick for multi-cohort ones,
 * persisted per device) and the roster behind it. The list-building lives in
 * `listFwCohortsForActor` precisely so that replacement is a UI change.
 *
 * Force-dynamic: it reads the service-role client per request, and the env-less
 * build must never try to prerender it.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Founders Weekend",
  robots: { index: false, follow: false },
};

export default async function FwHomePage() {
  const session = await requireFwSession();
  const db = supabaseAdmin();
  // The bridge's second half, read fresh — never from the JWT (revocation bites
  // here). Skipped entirely without the claim, so no claim-less session can be
  // promoted by this row.
  const isStaff = session.hasAdminClaim ? await loadStaffRowActive(db, session.userId) : false;
  const listed = await listFwCohortsForActor(db, {
    grantedCohortIds: grantedCohortIds(session.grants),
    isStaff,
  });
  const cohorts = listed.ok ? listed.cohorts : [];

  return (
    <main className="mx-auto w-full max-w-md px-5 py-10">
      <h1 className="font-path-display text-2xl font-semibold tracking-tight text-hq-ink">
        {isStaff ? "Weekends you can run" : "Your weekends"}
      </h1>

      {!listed.ok ? (
        // A read failure is NOT "you hold no grants" (reliability review). Saying
        // so would send a legitimately-provisioned guide to find staff at the
        // start of an event-morning shift over something a refresh fixes.
        <p
          role="alert"
          className="mt-3 rounded-lg border border-not-yet/40 bg-not-yet/10 p-3 font-path-body text-sm leading-6 text-hq-ink"
        >
          We couldn&apos;t load your weekends just now. Reload the page — if it keeps happening, tell
          The 120 staff.
        </p>
      ) : cohorts.length === 0 ? (
        <p className="mt-3 font-path-body text-sm leading-6 text-hq-ink-soft">
          You&apos;re signed in, but you aren&apos;t a guide on any Founders Weekend cohort yet. Ask
          The 120 staff to add you.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {cohorts.map((cohort) => (
            <li key={cohort.id}>
              <Link
                href={`/path/fw/cohort/${cohort.id}`}
                className="block rounded-xl border border-hq-border bg-hq-surface px-4 py-3 font-path-body text-sm text-hq-ink shadow-hq transition-colors hover:border-hq-border-strong"
              >
                {cohort.slug}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
