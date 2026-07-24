import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { Icon } from "@/app/fp/components/system/Icon";
import FwImport from "@/app/fp/fw/components/FwImport";
import { isFwStaffActor } from "@/app/fp/lib/fw-access-rules";
import { resolveFwActorForCohort } from "@/app/fp/lib/fw-auth";
import { loadFwOpsCohort } from "@/app/fp/lib/fw-ops-core";

/**
 * /fp/fw/ops/cohort/[cohortId]/import — bulk roster import (FW Unit 7).
 *
 * THE GATE IS `isFwStaffActor`, re-checked HERE and not inherited from the ops
 * layout (Next 16 layouts do not re-render on navigation), exactly like the
 * cohort ops page. A granted GUIDE resolves `via: "grant"`, fails the check, and
 * gets a 404 — telling them the page exists is telling them it is worth probing.
 *
 * `maxDuration = 60`: the import provisions in CLIENT-driven chunks, and this is
 * the ceiling one chunk's ~8 mints (~16 service-role round trips each) runs
 * inside. The client re-sends the next chunk; a chunk that times out is
 * idempotent, so it is safe to re-send. Measured against the CLI import timing
 * recorded in the Unit 7 checkbox.
 *
 * force-dynamic: service-role reads per request, and the env-less build must never
 * try to prerender it.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "Founders Weekend — import roster",
  robots: { index: false, follow: false },
};

export default async function FwOpsImportPage({
  params,
}: {
  params: Promise<{ cohortId: string }>;
}) {
  const { cohortId } = await params;
  const { verdict } = await resolveFwActorForCohort(cohortId);
  if (!isFwStaffActor(verdict)) notFound();

  const cohort = await loadFwOpsCohort(supabaseAdmin(), cohortId);

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-8">
      <Link
        href={`/fp/fw/ops/cohort/${cohortId}`}
        className="inline-flex min-h-[44px] items-center gap-1.5 font-path-body text-sm text-hq-ink-soft hover:text-hq-ink"
      >
        <Icon name="arrow-right" size={16} />
        Back to this weekend
      </Link>

      <p className="mt-3 font-path-mono text-[11px] uppercase tracking-[0.14em] text-hq-ink-muted">
        Import roster
      </p>
      <h1 className="font-path-display text-2xl font-semibold tracking-tight text-hq-ink">
        {cohort?.slug ?? "This weekend"}
      </h1>
      <p className="mt-1.5 font-path-body text-sm leading-6 text-hq-ink-soft">
        Provision a weekend&apos;s students from a CSV — accounts, rosters, and a fresh task list
        each. A returning student is linked to their existing record, never duplicated. Run it as
        many times as you like: students already on the roster are skipped.
      </p>

      <div className="mt-6">
        <FwImport cohortId={cohortId} />
      </div>
    </main>
  );
}
