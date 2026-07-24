import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import FwBoardToken from "@/app/path/fw/components/FwBoardToken";
import FwGuideRoster from "@/app/path/fw/components/FwGuideRoster";
import FwWindowLabel from "@/app/path/fw/components/FwWindowLabel";
import { isFwStaffActor } from "@/app/path/lib/fw-access-rules";
import { resolveFwActorForCohort } from "@/app/path/lib/fw-auth";
import {
  listFwCohortGuides,
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
  const [cohort, token, guides] = await Promise.all([
    loadFwOpsCohort(db, cohortId),
    loadFwOpsBoardToken(db, { cohortId, now }),
    listFwCohortGuides(db, { cohortId, now }),
  ]);
  return { cohort, token, guides };
}

export default async function FwOpsCohortPage({
  params,
}: {
  params: Promise<{ cohortId: string }>;
}) {
  const { cohortId } = await params;
  const { verdict } = await resolveFwActorForCohort(cohortId);
  if (!isFwStaffActor(verdict)) notFound();

  const { cohort, token, guides } = await loadOpsCohortPage(cohortId);
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
        {token.ok ? (
          <FwBoardToken cohortId={cohort.id} status={token.token} />
        ) : (
          <p
            role="alert"
            className="mt-3 rounded-xl border border-not-yet/40 bg-not-yet/10 p-4 font-path-body text-sm leading-6 text-hq-ink"
          >
            We couldn&apos;t read this weekend&apos;s board link just now. Reload before minting
            — minting on top of a link that is actually live would take the projector down.
          </p>
        )}
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
    </main>
  );
}
