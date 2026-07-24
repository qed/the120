import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import FwBoardToken from "@/app/path/fw/components/FwBoardToken";
import FwGuideRoster from "@/app/path/fw/components/FwGuideRoster";
import FwMatchResolver from "@/app/path/fw/components/FwMatchResolver";
import FwReplayRejects from "@/app/path/fw/components/FwReplayRejects";
import FwStudentRoster from "@/app/path/fw/components/FwStudentRoster";
import FwWindowLabel from "@/app/path/fw/components/FwWindowLabel";
import { isFwStaffActor } from "@/app/path/lib/fw-access-rules";
import { resolveFwActorForCohort } from "@/app/path/lib/fw-auth";
import {
  listFwCohortGuides,
  listFwOpsStudents,
  listFwReplayRejects,
  loadFwOpsBoardToken,
  loadFwOpsCohort,
} from "@/app/path/lib/fw-ops-core";

/**
 * /path/fw/ops/cohort/[cohortId] — one weekend's ops (FW Unit 5).
 *
 * Two surfaces, both of which Boston cannot run without: the projected board's
 * token, and the guide roster with provisioning, re-issue, and grant revoke.
 *
 * THE GATE IS `isFwStaffActor`, the one predicate for "may this session see
 * ops" — never a hand-rolled `via === "bridge"` comparison, and never inherited
 * from the layout (Next 16 layouts do not re-render on navigation). A guide with
 * a grant on this cohort resolves `via: "grant"`, fails this check, and gets a
 * 404: not a refusal message, because telling them the page exists is telling
 * them it is worth probing.
 *
 * Force-dynamic: service-role reads per request, and the env-less build must
 * never try to prerender it.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Founders Weekend — weekend ops",
  robots: { index: false, follow: false },
};

/**
 * Everything this page renders, in one place — and the CLOCK READ lives here
 * rather than in the component body (`react-hooks/purity`, and the shape the
 * invite pages already use). Both the board-token status and every guide's
 * credential state are functions of "now".
 *
 * The three reads are independent of each other, all keyed on the cohort id
 * already in hand, so they run concurrently rather than serializing three round
 * trips onto a page staff open while a room is waiting.
 */
async function loadOpsCohortPage(cohortId: string) {
  const db = supabaseAdmin();
  const now = Date.now();
  const [cohort, token, guides, students, rejects] = await Promise.all([
    loadFwOpsCohort(db, cohortId),
    loadFwOpsBoardToken(db, { cohortId, now }),
    listFwCohortGuides(db, { cohortId, now }),
    listFwOpsStudents(db, { cohortId }),
    listFwReplayRejects(db, { cohortId }),
  ]);
  return { cohort, token, guides, students, rejects };
}

export default async function FwOpsCohortPage({
  params,
}: {
  params: Promise<{ cohortId: string }>;
}) {
  const { cohortId } = await params;
  const { verdict } = await resolveFwActorForCohort(cohortId);
  if (!isFwStaffActor(verdict)) notFound();

  const { cohort, token, guides, students, rejects } = await loadOpsCohortPage(cohortId);
  // The gate already proved this cohort is `kind='fw'` and that the caller may
  // act in it; a null here is a read failure, not an authorization answer.
  if (!cohort) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-8">
        <p
          role="alert"
          className="rounded-xl border border-not-yet/40 bg-not-yet/10 p-4 font-path-body text-sm leading-6 text-hq-ink"
        >
          We couldn&apos;t load this weekend just now. Reload the page — nothing has changed.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-8">
      <p className="font-path-mono text-[11px] uppercase tracking-[0.14em] text-hq-ink-muted">
        Weekend
      </p>
      <h1 className="font-path-display text-2xl font-semibold tracking-tight text-hq-ink">
        {cohort.slug}
      </h1>
      <p className="mt-1.5 font-path-body text-sm leading-6 text-hq-ink-soft">
        <FwWindowLabel
          startsAt={cohort.startsAt}
          endsAt={cohort.endsAt}
          timeZone={cohort.timeZone}
        />
      </p>
      <Link
        href={`/path/fw/cohort/${cohort.id}`}
        className="mt-3 inline-flex min-h-[44px] items-center font-path-body text-sm text-hq-ink-soft underline underline-offset-2 hover:text-hq-ink"
      >
        Open the guide view for this weekend
      </Link>

      <section className="mt-8">
        <h2 className="font-path-display text-lg font-semibold tracking-tight text-hq-ink">
          Projected board
        </h2>
        {/* UNCONDITIONAL, and that is a fix rather than a simplification
            (frontend-races review). This used to render the panel only on
            `token.ok`, so a transient read failure on the `router.refresh()`
            fired right after a successful mint swapped the subtree for an error
            paragraph — unmounting the component that held the just-minted,
            never-recoverable URL before staff had copied it. The component
            renders the read-failure state itself now, keeping the token safe. */}
        <FwBoardToken cohortId={cohort.id} status={token.ok ? token.token : null} />
      </section>

      <section className="mt-10">
        <h2 className="font-path-display text-lg font-semibold tracking-tight text-hq-ink">
          Guides
        </h2>
        {guides.ok ? (
          <FwGuideRoster cohortId={cohort.id} guides={guides.guides} />
        ) : (
          <p
            role="alert"
            className="mt-3 rounded-xl border border-not-yet/40 bg-not-yet/10 p-4 font-path-body text-sm leading-6 text-hq-ink"
          >
            We couldn&apos;t load this weekend&apos;s guides just now. Reload the page — this is
            not the same thing as &ldquo;no guides&rdquo;.
          </p>
        )}
      </section>

      <section className="mt-10">
        <h2 className="font-path-display text-lg font-semibold tracking-tight text-hq-ink">
          Offline replays that didn&apos;t apply
        </h2>
        <p className="mt-1.5 mb-1 font-path-body text-sm leading-6 text-hq-ink-soft">
          Check-ins captured offline that couldn&apos;t be applied at sync — a cross-guide
          correction, a session that couldn&apos;t re-authenticate, a row that had already
          moved. Resolve each once you&apos;ve handled it.
        </p>
        {rejects.ok ? (
          <FwReplayRejects cohortId={cohort.id} rejects={rejects.rejects} />
        ) : (
          <p
            role="alert"
            className="mt-3 rounded-xl border border-not-yet/40 bg-not-yet/10 p-4 font-path-body text-sm leading-6 text-hq-ink"
          >
            We couldn&apos;t load the replay rejects just now. Reload the page — this is not the
            same thing as &ldquo;none&rdquo;.
          </p>
        )}
      </section>

      <section className="mt-10">
        <h2 className="font-path-display text-lg font-semibold tracking-tight text-hq-ink">
          Find a returning student
        </h2>
        <p className="mt-1.5 mb-1 font-path-body text-sm leading-6 text-hq-ink-soft">
          A guide flagged a possible match from another weekend. Look the name up here to see
          the full picture, then link the existing student into this weekend or confirm
          they&apos;re new.
        </p>
        <FwMatchResolver cohortId={cohort.id} />
      </section>

      <section className="mt-10">
        <h2 className="font-path-display text-lg font-semibold tracking-tight text-hq-ink">
          Students
        </h2>
        <p className="mt-1.5 mb-1 font-path-body text-sm leading-6 text-hq-ink-soft">
          Removing a student anonymizes their record in place — their name is erased and their
          address is retired so it&apos;s never reused. It cannot be undone.
        </p>
        {students.ok ? (
          <FwStudentRoster cohortId={cohort.id} students={students.students} />
        ) : (
          <p
            role="alert"
            className="mt-3 rounded-xl border border-not-yet/40 bg-not-yet/10 p-4 font-path-body text-sm leading-6 text-hq-ink"
          >
            We couldn&apos;t load this weekend&apos;s students just now. Reload the page — this
            is not the same thing as &ldquo;no students&rdquo;.
          </p>
        )}
      </section>
    </main>
  );
}
