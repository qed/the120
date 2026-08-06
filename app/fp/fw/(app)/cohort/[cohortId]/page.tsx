import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import FwCohortView from "@/app/fp/fw/components/FwCohortView";
import { FwRosterCache } from "@/app/fp/fw/components/FwRosterCache";
import { FwOfflineRoster } from "@/app/fp/fw/components/FwOfflineRoster";
import { resolveFwActorForCohort } from "@/app/lib/fp/fw-auth";
import { loadFwCohortRoster, loadFwUnfinishedStudents } from "@/app/lib/fp/fw-loader";
import { FW_BAND_LABEL, FW_BRAND_SUFFIX } from "@/app/lib/fp/fw-nav-rules";

/** Informational stamp on the offline roster cache — a deploy changes it, but only
 *  a schema-version bump invalidates the cache (Decision 15). */
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA ?? "dev";

/**
 * /fp/fw/cohort/[cohortId] — the cohort view (FW Unit 4; ops-guide redesign
 * Unit 7: two-pane layout — FW-R14, R18, R23, gaps G21/G22).
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
 *
 * ?finish=<profileId> re-arms quick-create for a half-created student (the
 * banner's "Finish setup" is a Link carrying it — URL state, so it works with
 * a server-rendered banner and survives a reload on venue wifi). Resolved HERE
 * against the server's own unfinished list, never trusted raw: a stale or
 * fabricated id matches nothing and degrades to the plain view.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Roster · Founders Weekend${FW_BRAND_SUFFIX}`,
  robots: { index: false, follow: false },
};

export default async function FwRosterPage({
  params,
  searchParams,
}: {
  params: Promise<{ cohortId: string }>;
  searchParams: Promise<{ finish?: string | string[] }>;
}) {
  const [{ cohortId }, sp] = await Promise.all([params, searchParams]);
  const { verdict } = await resolveFwActorForCohort(cohortId);
  if (!verdict.ok) notFound();

  const db = supabaseAdmin();
  // The unfinished probe rides alongside the roster read (todo 001): a
  // quick-create dismissed mid-submit leaves a half-created student only the
  // server can still see, and the banner rendered from this list is their
  // recovery path. A failed probe degrades to "no banner" rather than taking
  // the roster down — the roster is the shift's primary surface, the banner a
  // recovery affordance layered on it (the loader logs the failure).
  const [roster, unfinished] = await Promise.all([
    loadFwCohortRoster(db, cohortId),
    loadFwUnfinishedStudents(db, cohortId),
  ]);

  const unfinishedStudents = unfinished.ok ? unfinished.students : [];
  const finishParam = typeof sp.finish === "string" ? sp.finish : null;
  const resume = finishParam
    ? (unfinishedStudents.find((u) => u.profileId === finishParam) ?? null)
    : null;

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-6">
      {!roster.ok ? (
        // A read failure is NOT an empty roster. "Nobody is on this weekend's
        // roster yet" would send a guide hunting an import problem that does not
        // exist, at 8:55am, while a queue forms. Instead, fall back to the offline
        // roster cache (Decision 15): a client component reads the ≤90 names this
        // device last loaded so the guide can still NAVIGATE — and only shows the
        // plain "couldn't load" message when there is no usable cache (Unit 9).
        // It renders in the SIDEBAR REGION of the same two-pane frame, so offline
        // navigation looks and works like online navigation.
        <div className="lg:flex lg:items-start lg:gap-6">
          <div className="min-w-0 lg:w-[236px] lg:shrink-0">
            <FwOfflineRoster cohortId={cohortId} />
          </div>
          <section aria-label="Student pane" className="mt-4 hidden min-w-0 flex-1 lg:mt-0 lg:block">
            <p className="rounded-xl border border-hq-border bg-hq-surface p-5 font-path-body text-sm leading-6 text-hq-ink-soft shadow-hq">
              Tap a cached name to open that student&apos;s check-in view.
            </p>
          </section>
        </div>
      ) : (
        <>
          {/* The unfinished-student banner (PR #86; todo 001) keeps its
              first-class home ABOVE the two-pane area — recovery must not hide
              behind a pane state. Server markup: "Finish setup" is a LINK
              carrying ?finish=, so the recovery path needs no client parent
              shared with the pane and survives a reload. */}
          {unfinishedStudents.length > 0 && (
            <div
              role="status"
              className="mb-4 rounded-xl border border-not-yet/40 bg-not-yet/10 p-4"
            >
              <p className="font-path-body text-sm leading-5 text-hq-ink">
                {unfinishedStudents.length === 1
                  ? "1 student is not finished setting up."
                  : `${unfinishedStudents.length} students are not finished setting up.`}{" "}
                Finish them so their task list works at check-in.
              </p>
              <ul className="mt-2 space-y-2">
                {unfinishedStudents.map((u) => (
                  <li key={u.profileId} className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate font-path-body text-sm font-medium text-hq-ink">
                      {u.firstName} {u.lastName}{" "}
                      <span className="font-path-mono text-[11px] uppercase tracking-[0.1em] text-hq-ink-soft">
                        {FW_BAND_LABEL[u.band]}
                      </span>
                    </span>
                    <Link
                      href={`/fp/fw/cohort/${cohortId}?finish=${encodeURIComponent(u.profileId)}`}
                      className="inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-lg border border-hq-border bg-hq-surface px-3 font-path-body text-sm font-medium text-hq-ink active:bg-hq-sunken"
                    >
                      Finish setup
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Keyed on the resolved finish target: a different "Finish setup"
              tap must REMOUNT the view (seeds are initial state), never leak a
              stale retry handle — the invariant FwQuickCreate's own key
              enforces one level down. */}
          <FwCohortView
            key={resume?.profileId ?? "fresh"}
            cohortId={cohortId}
            students={roster.students}
            resume={resume}
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
