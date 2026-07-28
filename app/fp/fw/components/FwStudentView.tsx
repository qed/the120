"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/app/fp/components/system/Icon";
import FwPhaseNav from "./FwPhaseNav";
import FwQuickCreate from "./FwQuickCreate";
import FwReadingRule from "./FwReadingRule";
import FwStudentSidebar from "./FwStudentSidebar";
import FwTaskTree from "./FwTaskTree";
import { FwOfflineRoster } from "./FwOfflineRoster";
import type { FwTaskDetail } from "./FwTaskDetailModal";
import type { PhaseKey } from "@/app/fp/content/types";
import type { FwRosterEntry } from "@/app/fp/lib/fw-loader";
import {
  fwPhaseSlug,
  FW_BAND_LABEL,
  type FwResume,
  type FwTreePhase,
} from "@/app/fp/lib/fw-nav-rules";
import type { Band } from "@/app/fp/content/types";

/**
 * The student view (ops-guide redesign Unit 8; R19, R20-structure, R21, R23) —
 * the two-pane frame of Unit 7's cohort page, mounted on the STUDENT page:
 * student sidebar (Unit 7's, unchanged), then the phase nav (the second left
 * nav), then the selected phase's steps accordion.
 *
 * PHASE SELECTION IS URL STATE, updated natively. The server seeds
 * `initialPhaseKey` from `?phase=` (resolved by `fwSelectedPhaseKey` against
 * the pinned program), and a tap calls `history.replaceState` to keep the URL
 * current WITHOUT a server round trip — every phase's steps and detail are
 * already in this page's payload, so switching must not cost a navigation
 * (which would fail outright mid-outage, on the surface built for the outage).
 * The URL still carries the position, so a reload, a SW-cached shell, and the
 * retired task route's `?phase=` redirect all land on the right phase. This is
 * the Unit 8 "URL param, not client-only state" decision — implemented as
 * URL-seeded state + replaceState rather than router navigation, for exactly
 * the offline reason above.
 *
 * THE SIDEBAR IS lg+ ONLY ON THIS PAGE, deliberately. On the cohort page the
 * sidebar IS the narrow-width body (Unit 7's decision); here the body is one
 * student's phases and steps, and stacking ninety names above them would push
 * the R23 loop's working surface below the fold. Below lg the guide moves
 * between students through the Roster link (one tap back to the list — the
 * same budget the pre-redesign "Next student" flow spent), and the phase nav
 * collapses to a horizontal strip so switching phases stays one tap at 375px.
 *
 * QUICK-CREATE keeps its home (R23): the sidebar's + swaps the content pane
 * for `FwQuickCreate`, exactly as `FwCohortView` does. No finish-setup seeding
 * here — the recovery banner lives on the cohort page and arrives via
 * `?finish=` there.
 */
export default function FwStudentView({
  cohortId,
  student,
  roster,
  phases,
  details,
  initialPhaseKey,
  resume,
}: {
  cohortId: string;
  student: { studentId: string; firstName: string; lastName: string; band: Band };
  /** The cohort roster for the sidebar — `null` when the roster read failed,
   *  which degrades to the cached-name fallback (`FwOfflineRoster`), never a
   *  fake "nobody is enrolled" empty state. */
  roster: readonly FwRosterEntry[] | null;
  /** `buildFwTaskTree` over the student's PINNED program. */
  phases: readonly FwTreePhase[];
  /** Task id → detail, from the static content bundle (see FwTaskDetailModal). */
  details: Readonly<Record<string, FwTaskDetail>>;
  /** Server-resolved from `?phase=` via `fwSelectedPhaseKey`. */
  initialPhaseKey: PhaseKey | null;
  resume: FwResume;
}) {
  const [phaseKey, setPhaseKey] = useState<PhaseKey | null>(initialPhaseKey);
  const [creating, setCreating] = useState(false);

  const selectPhase = (key: PhaseKey) => {
    setPhaseKey(key);
    // Native history update — no navigation, no fetch (see docblock).
    const url = new URL(window.location.href);
    url.searchParams.set("phase", fwPhaseSlug(key));
    window.history.replaceState(null, "", url);
  };

  const activePhase = phases.find((p) => p.key === phaseKey) ?? phases[0] ?? null;

  return (
    <div className="lg:flex lg:items-start lg:gap-6">
      <div className="hidden lg:block">
        {roster !== null ? (
          <FwStudentSidebar
            cohortId={cohortId}
            students={roster}
            creating={creating}
            onToggleCreate={() => setCreating((v) => !v)}
          />
        ) : (
          <div className="min-w-0 lg:w-[236px] lg:shrink-0">
            <FwOfflineRoster cohortId={cohortId} />
          </div>
        )}
      </div>

      <section aria-label="Student view" className="min-w-0 flex-1">
        {creating ? (
          <FwQuickCreate key="new" cohortId={cohortId} onCancel={() => setCreating(false)} />
        ) : (
          <>
            <Link
              href={`/fp/fw/cohort/${cohortId}`}
              className="inline-flex min-h-[44px] items-center gap-1.5 font-path-body text-sm text-hq-ink-soft hover:text-hq-ink lg:hidden"
            >
              <Icon name="chevron-left" size={16} />
              Roster
            </Link>

            <h1 className="font-path-display text-2xl font-semibold tracking-tight text-hq-ink lg:mt-0">
              {student.firstName} {student.lastName}
            </h1>
            <p className="mt-1 font-path-mono text-[11px] uppercase tracking-[0.12em] text-hq-ink-muted">
              {FW_BAND_LABEL[student.band]}
              {resume.furthestTaskId &&
                ` · ${resume.verified} checked · up to ${resume.furthestTaskId}`}
            </p>

            <div className="mt-4">
              <FwReadingRule />
            </div>

            <div className="mt-4 lg:flex lg:items-start lg:gap-5">
              <FwPhaseNav phases={phases} activeKey={activePhase?.key ?? null} onSelect={selectPhase} />
              <div className="mt-3 min-w-0 flex-1 lg:mt-0">
                {activePhase ? (
                  <FwTaskTree
                    phase={activePhase}
                    details={details}
                    // UNIT 9 SEAM: pass renderDecision here — this component owns
                    // the page-level client-id ledger and pending-queue
                    // subscription when they land (one per student page).
                  />
                ) : (
                  <p className="rounded-xl border border-hq-border bg-hq-surface p-5 font-path-body text-sm leading-6 text-hq-ink-soft shadow-hq">
                    This student&apos;s program has no phases to show. Tell The 120 staff.
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
