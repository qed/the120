import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/app/fp/components/system/Icon";
import { signOutFwGuide } from "@/app/fp/lib/actions/fw-guide";
import { resolveFwStaffGate } from "@/app/fp/lib/fw-auth";

/**
 * The staff ops shell (FW Unit 5) — chrome for the surfaces guides never see.
 *
 * Deliberately NOT nested under `cohort/[cohortId]/layout.tsx`. That shell is
 * the GUIDE's working header (weekend name, switcher, sign out) and is scoped to
 * one cohort; ops spans cohorts, and half of it (creating a weekend) has no
 * cohort at all. Nesting would force a cohort into the URL of a page that does
 * not have one.
 *
 * THE GATE HERE IS THE COHORT-FREE ONE. `resolveFwStaffGate` asks the bridge's
 * two questions — admin claim AND a live, active staff row — without needing a
 * cohort to resolve against, which is exactly right for a subtree whose entry
 * point is "list every weekend". Per-cohort ops pages gate AGAIN on
 * `isFwStaffActor` for their own cohort, and every action re-gates server-side:
 * this layout is not load-bearing for authorization, because Next 16 layouts do
 * not re-render on navigation.
 *
 * `notFound()` rather than a message, matching the cohort layout: telling a
 * signed-in guide "this is staff-only" confirms the surface exists and is worth
 * probing. To a guide, /fp/fw/ops simply is not a page.
 */
export default async function FwOpsLayout({ children }: { children: ReactNode }) {
  const gate = await resolveFwStaffGate();
  if (!gate.ok) notFound();

  return (
    <>
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-hq-border bg-hq-canvas/95 px-5 py-3 backdrop-blur">
        <div className="min-w-0">
          <p className="font-path-mono text-[11px] uppercase tracking-[0.14em] text-hq-ink-muted">
            Founders Weekend · Staff ops
          </p>
          <Link
            href="/fp/fw/ops"
            className="truncate font-path-display text-base font-semibold text-hq-ink"
          >
            Weekends
          </Link>
        </div>

        <div className="flex shrink-0 items-center gap-4">
          <Link
            href="/fp/fw"
            className="inline-flex min-h-[44px] items-center gap-1.5 font-path-body text-sm text-hq-ink-soft hover:text-hq-ink"
          >
            <Icon name="arrow-right" size={16} />
            Guide view
          </Link>
          <form action={signOutFwGuide}>
            <button
              type="submit"
              className="min-h-[44px] font-path-body text-sm text-hq-ink-soft underline underline-offset-2 hover:text-hq-ink"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      {children}
    </>
  );
}
