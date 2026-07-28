import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import FwRoster from "@/app/fp/fw/components/FwRoster";
import { FwRosterCache } from "@/app/fp/fw/components/FwRosterCache";
import { FwOfflineRoster } from "@/app/fp/fw/components/FwOfflineRoster";
import { resolveFwActorForCohort } from "@/app/fp/lib/fw-auth";
import { loadFwCohortRoster, loadFwUnfinishedStudents } from "@/app/fp/lib/fw-loader";
import { FW_BRAND_SUFFIX } from "@/app/fp/lib/fw-nav-rules";

/** Informational stamp on the offline roster cache — a deploy changes it, but only
 *  a schema-version bump invalidates the cache (Decision 15). */
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA ?? "dev";

/**
 * /fp/fw/cohort/[cohortId] — the roster (FW Unit 4; FW-R14, gaps G21/G22).
 *
 * The gate runs HERE as well as in the layout, and not as belt-and-braces:
 * Next 16 layouts do not re-render on navigation, so a page that leaned on its
 * layout's gate would be checked once per full load and never again. It is
 * request-memoized, so the second call costs nothing on the render that mounts
 * the layout.
 *
 * `notFound()` for every refusal, never a message — distinguishing "that cohort
 * isn't yours" from "that cohort doesn't exist" enumerates cohort ids to a
 * signed-in non-guide.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Roster · Founders Weekend${FW_BRAND_SUFFIX}`,
  robots: { index: false, follow: false },
};

export default async function FwRosterPage({
  params,
}: {
  params: Promise<{ cohortId: string }>;
}) {
  const { cohortId } = await params;
  const { verdict } = await resolveFwActorForCohort(cohortId);
  if (!verdict.ok) notFound();

  const db = supabaseAdmin();
  // The unfinished probe rides alongside the roster read (todo 001): a
  // quick-create dismissed mid-submit leaves a half-created student only the
  // server can still see, and the banner FwRoster renders from this list is
  // their recovery path. A failed probe degrades to "no banner" rather than
  // taking the roster down — the roster is the shift's primary surface, the
  // banner a recovery affordance layered on it (the loader logs the failure).
  const [roster, unfinished] = await Promise.all([
    loadFwCohortRoster(db, cohortId),
    loadFwUnfinishedStudents(db, cohortId),
  ]);

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-6">
      {!roster.ok ? (
        // A read failure is NOT an empty roster. "Nobody is on this weekend's
        // roster yet" would send a guide hunting an import problem that does not
        // exist, at 8:55am, while a queue forms. Instead, fall back to the offline
        // roster cache (Decision 15): a client component reads the ≤90 names this
        // device last loaded so the guide can still NAVIGATE — and only shows the
        // plain "couldn't load" message when there is no usable cache (Unit 9).
        <FwOfflineRoster cohortId={cohortId} />
      ) : (
        <>
          <FwRoster
            cohortId={cohortId}
            students={roster.students}
            unfinished={unfinished.ok ? unfinished.students : []}
          />
          {/* Seed the offline roster cache (Decision 15) from this render — so an
              outage mid-loop still lets the guide navigate the roster they last saw,
              and a walk-in created on another device appears here after the next
              online refresh re-seeds it. */}
          <FwRosterCache
            cohortId={cohortId}
            buildId={BUILD_ID}
            students={roster.students.map((s) => ({
              studentId: s.studentId,
              firstName: s.firstName,
              lastName: s.lastName,
              band: s.band,
            }))}
          />
        </>
      )}
    </main>
  );
}
