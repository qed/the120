import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import FwCohortCreate from "@/app/fp/fw/components/FwCohortCreate";
import FwWindowLabel from "@/app/fp/fw/components/FwWindowLabel";
import { resolveFwStaffGate } from "@/app/fp/lib/fw-auth";
import { listFwOpsCohorts, type FwBoardTokenStatus } from "@/app/fp/lib/fw-ops-core";

/**
 * /fp/fw/ops — every Founders Weekend, and the form that makes a new one
 * (FW Unit 5; FW-R23, Decision 4).
 *
 * The page's own gate runs BEFORE anything is read. The layout gates too, but
 * Next 16 layouts do not re-render on navigation, so a page that leaned on the
 * layout alone would be gated only on the render that happened to mount it.
 *
 * Force-dynamic: it reads the service-role client per request, and the env-less
 * build must never try to prerender it.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Founders Weekend — staff ops",
  robots: { index: false, follow: false },
};

const TOKEN_CHIP: Record<FwBoardTokenStatus, { label: string; cls: string }> = {
  live: {
    label: "Board live",
    cls: "border-verified/40 bg-verified/10 text-hq-ink",
  },
  never_minted: {
    label: "No board link",
    cls: "border-hq-border bg-hq-sunken text-hq-ink-soft",
  },
  expired: {
    label: "Board expired",
    cls: "border-hq-border bg-hq-sunken text-hq-ink-soft",
  },
  revoked: {
    label: "Board revoked",
    cls: "border-not-yet/40 bg-not-yet/10 text-hq-ink",
  },
};

/**
 * The clock read lives in a plain helper so the component body stays pure —
 * the `react-hooks/purity` rule, and the same shape the invite pages use
 * (`verdictForRow`). Token status is a function of "now", and a render that
 * calls `Date.now()` inline is a render whose output changes on a re-render
 * nobody asked for.
 */
async function loadOpsCohorts() {
  return listFwOpsCohorts(supabaseAdmin(), { now: Date.now() });
}

export default async function FwOpsPage() {
  const gate = await resolveFwStaffGate();
  if (!gate.ok) notFound();

  const listed = await loadOpsCohorts();

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-8">
      <h1 className="font-path-display text-2xl font-semibold tracking-tight text-hq-ink">
        Weekends
      </h1>

      {!listed.ok ? (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-not-yet/40 bg-not-yet/10 p-4 font-path-body text-sm leading-6 text-hq-ink"
        >
          We couldn&apos;t load the weekends just now. Reload the page — nothing here has
          changed.
        </p>
      ) : (
        <>
          <p className="mt-2 font-path-body text-sm leading-6 text-hq-ink-soft">
            {listed.cohorts.length === 0
              ? "No Founders Weekend cohorts yet. Create the first one below."
              : "Open a weekend to manage its guides and its board link."}
          </p>

          {listed.cohorts.length > 0 && (
            <ul className="mt-5 space-y-3">
              {listed.cohorts.map((cohort) => {
                const chip = TOKEN_CHIP[cohort.boardTokenStatus];
                return (
                  <li key={cohort.id}>
                    <Link
                      href={`/fp/fw/ops/cohort/${cohort.id}`}
                      className="block rounded-xl border border-hq-border bg-hq-surface p-4 shadow-hq transition-colors hover:border-hq-border-strong"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <p className="font-path-display text-base font-semibold text-hq-ink">
                          {cohort.slug}
                        </p>
                        <span
                          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-path-mono text-[11px] uppercase tracking-[0.1em] ${chip.cls}`}
                        >
                          {chip.label}
                        </span>
                      </div>
                      <p className="mt-1.5 font-path-body text-sm leading-5 text-hq-ink-soft">
                        <FwWindowLabel
                          startsAt={cohort.startsAt}
                          endsAt={cohort.endsAt}
                          timeZone={cohort.timeZone}
                        />
                      </p>
                      <p className="mt-1 font-path-mono text-[11px] uppercase tracking-[0.1em] text-hq-ink-muted">
                        {cohort.studentCount} student{cohort.studentCount === 1 ? "" : "s"} ·{" "}
                        {cohort.guideCount} guide{cohort.guideCount === 1 ? "" : "s"}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      <section className="mt-10">
        <h2 className="font-path-display text-lg font-semibold tracking-tight text-hq-ink">
          New weekend
        </h2>
        <p className="mt-1.5 mb-4 font-path-body text-sm leading-6 text-hq-ink-soft">
          The end date and time set when the projected board&apos;s link expires — six hours
          after the weekend ends. Enter them in the host city&apos;s own clock.
        </p>
        <FwCohortCreate />
      </section>
    </main>
  );
}
