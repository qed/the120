import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import FwCohortPicker from "@/app/fp/fw/components/FwCohortPicker";
import { grantedCohortIds, requireFwSession } from "@/app/fp/lib/fw-auth";
import { listFwCohortsForActor, loadStaffRowActive } from "@/app/fp/lib/fw-guide-core";
import {
  fwPickerHeadline,
  fwPickerRedirectsToSingleCohort,
  fwPickerZeroState,
} from "@/app/fp/lib/fw-nav-rules";

/**
 * /fp/fw — the cohort switcher (FW Unit 4, Decision 3).
 *
 * Three shapes, and each of them is a decision rather than a rendering choice:
 *
 *   0 cohorts  → copy that names the right remedy FOR THE ROLE (R13). A signed-in
 *                student or parent lands here too, and sees an empty list rather
 *                than a 500 or somebody else's roster.
 *   1 cohort   → REDIRECT straight into it, FOR A GUIDE (R14). "Hidden for
 *                single-cohort sessions" means exactly this: a guide who works one
 *                weekend never sees a switcher, because there is nothing for them
 *                to get wrong. Staff are exempt — their one means "one exists so
 *                far", not "one is yours".
 *   2+ cohorts → an explicit pick with NO DEFAULT. That is the wrong-stamp
 *                prevention working, and it is the whole reason this page still
 *                exists after the redirect above.
 *
 * A granted guide sees only the cohorts their grants name; a staff session sees
 * every `kind='fw'` cohort with no grant row anywhere — the FW-D3 bridge,
 * rendered.
 *
 * EVERY ROLE BRANCH BELOW IS A CALL INTO `fw-nav-rules.ts`, never an inline
 * conditional. There is no jsdom here, so a decision written in this file is a
 * decision no test can reach — and the previous unit's headline finding was two such
 * decisions where flipping either left the whole suite green.
 *
 * R12 (staff on `/fp/fw` get a link to `/staff`) is carried by the persistent staff
 * bar in `layout.tsx`, which evaluates staff-ness CLIENT-side. This page deliberately
 * does not render a second one: a server-rendered hub link would be a staff-only
 * affordance sitting in HTML the service worker caches into `path-sw-fw-shell-v1`.
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

  // Decision 3 for guides, R14's exemption for staff. The redirect is what makes
  // "no switcher for a single-cohort session" true for every entry point, including
  // a bookmark and a fresh sign-in.
  if (fwPickerRedirectsToSingleCohort({ isStaff, cohortCount: listed.cohorts.length })) {
    redirect(`/fp/fw/cohort/${listed.cohorts[0].id}`);
  }

  const zero = fwPickerZeroState(isStaff);

  return (
    <main className="mx-auto w-full max-w-lg px-5 py-10">
      <h1 className="font-path-display text-2xl font-semibold tracking-tight text-hq-ink">
        {fwPickerHeadline(isStaff)}
      </h1>

      {listed.cohorts.length === 0 ? (
        <>
          <p className="mt-3 font-path-body text-sm leading-6 text-hq-ink-soft">{zero.body}</p>
          {zero.createHref !== null && (
            <Link
              href={zero.createHref}
              className="mt-4 inline-flex min-h-[44px] items-center rounded-xl border border-hq-border px-4 font-path-body text-sm font-semibold text-hq-ink hover:bg-hq-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hq-ink"
            >
              {zero.createLabel}
            </Link>
          )}
        </>
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
