"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/app/fp/fw/components/system/Icon";
import FwInlineDecision from "./FwInlineDecision";
import FwPhaseNav from "./FwPhaseNav";
import FwQuickCreate from "./FwQuickCreate";
import FwReadingRule from "./FwReadingRule";
import FwStudentSidebar from "./FwStudentSidebar";
import FwTaskTree from "./FwTaskTree";
import { FwOfflineRoster } from "./FwOfflineRoster";
import type { FwTaskDetail } from "./FwTaskDetailModal";
import type { PhaseKey } from "@/app/lib/fp/content/types";
import type { FwRosterEntry } from "@/app/lib/fp/fw-loader";
import {
  fwPhaseSlug,
  FW_BAND_LABEL,
  type FwResume,
  type FwTreePhase,
} from "@/app/lib/fp/fw-nav-rules";
import {
  createFwClientIdLedger,
  foldFwSurfaceOutcome,
  EMPTY_FW_SURFACE,
  type FwClientIdLedger,
  type FwStudentResult,
  type FwSurfaceOutcome,
} from "@/app/lib/fp/fw-rules";
import { readPendingFwOpsForStudent, subscribeFwQueue } from "@/app/lib/fp/fw-sync-client";
import type { FwQueueEntry } from "@/app/lib/fp/fw-sync-rules";
import type { Band } from "@/app/lib/fp/content/types";

/** Stable empty list so an untouched row's `pendingOps` prop is referentially
 *  constant across re-renders. */
const NO_PENDING_OPS: readonly FwQueueEntry[] = [];

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
 *
 * ── UNIT 9: this component owns the capture seams, one of each per page ──────
 *   - the CLIENT-ID LEDGER (`createFwClientIdLedger`) — shared by every inline
 *     decision row, so an unsettled exactly-once key survives accordion
 *     collapse/re-expand remounts (the ledger's whole point);
 *   - the PENDING-QUEUE SUBSCRIPTION — ONE `readPendingFwOpsForStudent` scan,
 *     refreshed on every `subscribeFwQueue` notify, grouped per task and handed
 *     to each row. When a drain empties this student's pending set, the page
 *     `router.refresh()`es once so the tree's server states catch up with what
 *     the drain landed (the row must flip without user action);
 *   - the FIRST-DOLLAR SURFACE (`foldFwSurfaceOutcome`) — the standing bell
 *     banner, and the undo retraction that takes it down. Only first-dollar-task
 *     responses are folded: on a single-student page any other task's fold would
 *     wrongly retract the banner (the fold's submitted-minus rule is per
 *     student, and every tap here is the same student).
 */
export default function FwStudentView({
  cohortId,
  student,
  actorUserId,
  roster,
  phases,
  details,
  initialPhaseKey,
  resume,
}: {
  cohortId: string;
  /** The signed-in guide — the offline queue's capturing actor, and the scope of
   *  the pending-ops read. Server-known (the page's gate), never inferred. */
  actorUserId: string;
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
  const router = useRouter();
  const [phaseKey, setPhaseKey] = useState<PhaseKey | null>(initialPhaseKey);
  const [creating, setCreating] = useState(false);

  // ONE ledger per student page (Unit 9), created once — `useRef`'s argument is
  // evaluated every render, so the factory is called behind the null check.
  const ledgerRef = useRef<FwClientIdLedger | null>(null);
  if (ledgerRef.current === null) {
    ledgerRef.current = createFwClientIdLedger(() => crypto.randomUUID());
  }
  const ledger = ledgerRef.current;

  // This guide's own pending queue for this student, grouped per task — one scan
  // per page, re-read on every queue mutation.
  const [pendingByTask, setPendingByTask] = useState<ReadonlyMap<string, FwQueueEntry[]>>(
    () => new Map()
  );
  const hadPending = useRef(false);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void readPendingFwOpsForStudent({ cohortId, studentId: student.studentId, actorUserId }).then(
        (byTask) => {
          if (cancelled) return;
          // The drain just emptied this student's pending set: pull the
          // authoritative tree states so the rows show what actually landed
          // (settled OR tombstoned — either way the queue is no longer the
          // truth, the server is).
          if (hadPending.current && byTask.size === 0) router.refresh();
          hadPending.current = byTask.size > 0;
          setPendingByTask(byTask);
        }
      );
    };
    refresh();
    const unsubscribe = subscribeFwQueue(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [cohortId, student.studentId, actorUserId, router]);

  // The first-dollar surface: the standing bell banner + its undo retraction.
  const [surface, setSurface] = useState<FwSurfaceOutcome>(EMPTY_FW_SURFACE);
  const onFirstDollarFold = useCallback(
    (
      next: { outcomes: readonly FwStudentResult[]; firstDollar: readonly string[] },
      submittedStudentIds: readonly string[]
    ) => {
      setSurface((prev) =>
        foldFwSurfaceOutcome(prev, { outcomes: next.outcomes, firstDollar: next.firstDollar }, submittedStudentIds)
      );
    },
    []
  );

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

            {/* The standing First Dollar banner (Unit 9). No confirm anywhere any
                more — but an undo of the first-dollar checkmark still takes a
                still-displayed banner down (`foldFwSurfaceOutcome`'s
                submitted-minus rule). The fired celebratory moment on the board
                cannot be recalled; this banner is what can. */}
            {surface.firstDollar.length > 0 && (
              <p className="mt-4 rounded-xl border border-verified/50 bg-verified/10 p-4 font-path-display text-lg font-semibold text-hq-ink">
                First dollar — {student.firstName}. Ring the bell.
              </p>
            )}

            <div className="mt-4 lg:flex lg:items-start lg:gap-5">
              <FwPhaseNav phases={phases} activeKey={activePhase?.key ?? null} onSelect={selectPhase} />
              <div className="mt-3 min-w-0 flex-1 lg:mt-0">
                {activePhase ? (
                  <FwTaskTree
                    phase={activePhase}
                    details={details}
                    // UNIT 9: the inline decision controls, one per task row —
                    // sharing this page's ledger and pending-queue subscription.
                    renderDecision={(task) => (
                      <FwInlineDecision
                        cohortId={cohortId}
                        taskId={task.id}
                        taskTitle={task.title}
                        studentId={student.studentId}
                        studentFirstName={student.firstName}
                        actorUserId={actorUserId}
                        serverState={task.state}
                        pendingOps={pendingByTask.get(task.id) ?? NO_PENDING_OPS}
                        ledger={ledger}
                        onFirstDollarFold={onFirstDollarFold}
                      />
                    )}
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
