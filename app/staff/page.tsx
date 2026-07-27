import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/app/crm/lib/auth";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { getSeatsRemaining } from "@/app/lib/seats";
import { listFwActiveWeekends } from "@/app/fp/lib/fw-ops-core";
import { crmCardLine, fwCardLine, fwCardModel } from "@/app/staff/lib/hub-rules";

/**
 * Force-dynamic: the gate reads the session and the service-role `staff` row
 * per request, and the env-less build must never try to prerender it.
 * `/fp/fw/ops` carries the same explicit directive. `/crm` does NOT — it goes
 * dynamic implicitly, through the Dynamic APIs `requireStaff()` calls. Stated
 * because the difference is easy to misread as redundancy and delete.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Staff — The 120",
  // R5a, declared at the page as well as the layout. Next merges `metadata`
  // shallowly from the root segment DOWN, nearest wins — so an undeclared
  // page would inherit the layout's noindex, not the root layout's public
  // marketing directive. This is belt-and-braces against the layout's
  // declaration being removed, not a defence against the root.
  robots: { index: false, follow: false },
};

/**
 * The staff hub (Unit 11; R1–R4): two application cards, one live number each,
 * neither of which can hide a door.
 *
 * EVERY decision is a call into `hub-rules.ts` (pure, tested) — no jsdom reaches
 * this file. The two reads run CONCURRENTLY; the clock is read in the loader, not
 * the component body. R4's asymmetry (the FW card degrades honestly, the seats
 * number cannot admit it fell back) is documented where the numbers are shaped.
 *
 * The page gates as well as the layout, matching every other guarded surface
 * in the repo: Next 16 layouts do not re-render on soft navigation, so a page
 * leaning on its layout alone would be gated only on the render that mounted
 * it. `requireStaff()` is request-memoized, so this second call is free.
 */
async function loadHub() {
  const nowMs = Date.now();
  const [seats, weekends] = await Promise.all([
    getSeatsRemaining(),
    listFwActiveWeekends(supabaseAdmin()),
  ]);
  return { seats, fw: fwCardModel(weekends, nowMs) };
}

export default async function StaffHubPage() {
  await requireStaff();
  const { seats, fw } = await loadHub();

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
          <span className="mt-3 block font-path-mono text-[13px] text-crm-blue">
            {crmCardLine(seats)}
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
          <span className="mt-3 block font-path-mono text-[13px] text-hq-ink-soft">
            {fwCardLine(fw)}
          </span>
        </Link>
      </nav>
    </main>
  );
}
