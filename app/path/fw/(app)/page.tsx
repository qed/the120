import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import FwCohortPicker from "@/app/path/fw/components/FwCohortPicker";
import { grantedCohortIds, requireFwSession } from "@/app/path/lib/fw-auth";
import { listFwCohortsForActor, loadStaffRowActive } from "@/app/path/lib/fw-guide-core";

/**
 * /path/fw — the cohort switcher (FW Unit 4, Decision 3).
 *
 * Three shapes, and each of them is a decision rather than a rendering choice:
 *
 *   0 cohorts  → copy that sends the caller to staff. A signed-in student or
 *                parent lands here too, and sees an empty list rather than a 500
 *                or somebody else's roster.
 *   1 cohort   → REDIRECT straight into it. "Hidden for single-cohort sessions"
 *                means exactly this: a guide who works one weekend never sees a
 *                switcher, because there is nothing for them to get wrong.
 *   2+ cohorts → an explicit pick with NO DEFAULT. That is the wrong-stamp
 *                prevention working, and it is the whole reason this page still
 *                exists after the redirect above.
 *
 * A granted guide sees only the cohorts their grants name; a staff session sees
 * every `kind='fw'` cohort with no grant row anywhere — the FW-D3 bridge,
 * rendered.
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

  // A read failure is NOT "you hold no grants" — saying so would send a
  // legitimately-provisioned guide to find staff at the start of an
  // event-morning shift over something a refresh fixes.
  if (!listed.ok) {
    return (
      <main className="mx-auto w-full max-w-lg px-5 py-10">
        <h1 className="font-path-display text-2xl font-semibold tracking-tight text-hq-ink">
          Your weekends
        </h1>
        <p
          role="alert"
          className="mt-4 rounded-xl border border-not-yet/40 bg-not-yet/10 p-4 font-path-body text-sm leading-6 text-hq-ink"
        >
          We couldn&apos;t load your weekends just now. Reload the page — if it keeps happening,
          tell The 120 staff.
        </p>
      </main>
    );
  }

  // Decision 3: one cohort means no switcher at all. The redirect is what makes
  // that true for every entry point, including a bookmark and a fresh sign-in.
  if (listed.cohorts.length === 1) redirect(`/path/fw/cohort/${listed.cohorts[0].id}`);

  return (
    <main className="mx-auto w-full max-w-lg px-5 py-10">
      <h1 className="font-path-display text-2xl font-semibold tracking-tight text-hq-ink">
        {isStaff ? "Weekends you can run" : "Your weekends"}
      </h1>

      {listed.cohorts.length === 0 ? (
        <p className="mt-3 font-path-body text-sm leading-6 text-hq-ink-soft">
          You&apos;re signed in, but you aren&apos;t a guide on any Founders Weekend cohort yet.
          Ask The 120 staff to add you.
        </p>
      ) : (
        <>
          <p className="mt-2 font-path-body text-sm leading-6 text-hq-ink-soft">
            Pick the weekend you&apos;re working. Everything you tap today is recorded against it.
          </p>
          <FwCohortPicker cohorts={listed.cohorts} />
        </>
      )}
    </main>
  );
}
