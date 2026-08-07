"use client";

import { useCallback, useState, type ReactNode } from "react";
import { Icon } from "@/app/fp/fw/components/system/Icon";
import { StatusChip } from "@/app/fp/fw/components/system/StatusChip";
import FwTaskDetailModal, { type FwTaskDetail } from "./FwTaskDetailModal";
import type { FwTreeCriterion, FwTreePhase, FwTreeTask } from "@/app/lib/fp/fw-nav-rules";

/**
 * The steps accordion (FW Unit 4, reshaped by ops-guide redesign Unit 8;
 * FW-R14, R20-structure, R21, FW-D5) — ONE phase's criteria and tasks, with
 * task detail inline behind an (i) modal.
 *
 * WHAT CHANGED IN UNIT 8: this used to render all five phases as a top-level
 * accordion whose task rows LINKED to the per-task page. The phase level moved
 * to `FwPhaseNav` (URL-selected), and the task page is retired — its route now
 * redirects back to the student view — so a task row is a ROW, not a link:
 * title, state chip, an (i) button revealing the detail the task page used to
 * show, and the seam where Unit 9's inline decision controls land.
 *
 * NOTHING IS GATED, still (FW-D5): the tree renders exactly what
 * `buildFwTaskTree` returns for the selected phase — every task, curriculum
 * order, no `available` tier, no predecessor rule.
 *
 * OFFLINE BY CONSTRUCTION, still: criteria expand accordion-style with no
 * network between taps, and the (i) modal's content arrived with the page
 * (static bundle, pinned program version) — nothing here fetches.
 *
 * ── THE UNIT 9 SEAM (read before wiring FwInlineDecision) ──────────────────
 * `renderDecision` is the placeholder slot: Unit 9 mounts `FwInlineDecision`
 * by passing `renderDecision={(task) => <FwInlineDecision … />}` from the
 * student view (which owns the shared client-id ledger and pending-queue
 * subscription — ONE per student page, per the plan). The slot renders at the
 * task row's TRAILING edge, after the (i) button. Until Unit 9 lands, rows
 * simply have no decision controls — deliberate: Units 8 and 9 deploy in the
 * same release (the plan's sequencing note), so this state is never shipped
 * alone.
 */

/** Untouched rows (`locked`) get the quiet dashed mark, NOT a StatusChip: FW's
 *  `locked` means "no guide has decided this yet", and a "Locked" pill would
 *  claim a gate FW-D5 forbids. Every other state reads in the StatusChip
 *  vocabulary the rest of the product uses. */
function TaskStateMark({ task }: { task: FwTreeTask }) {
  if (task.state === "locked") {
    return <Icon name="circle-dashed" size={18} className="shrink-0 text-hq-ink-muted" />;
  }
  return <StatusChip state={task.state} className="shrink-0" />;
}

function Counts({ verified, notYet, total }: { verified: number; notYet: number; total: number }) {
  return (
    <span className="shrink-0 font-path-mono text-[11px] uppercase tracking-[0.1em] text-hq-ink-muted">
      {verified}/{total}
      {notYet > 0 && <span className="text-not-yet"> · {notYet} not yet</span>}
    </span>
  );
}

function CriterionRow({
  criterion,
  details,
  onOpenDetail,
  renderDecision,
}: {
  criterion: FwTreeCriterion;
  details: Readonly<Record<string, FwTaskDetail>>;
  onOpenDetail: (task: FwTreeTask) => void;
  renderDecision?: (task: FwTreeTask) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-t border-hq-border first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-[56px] w-full items-center justify-between gap-3 px-4 py-3 text-left active:bg-hq-sunken"
      >
        <span className="min-w-0">
          <span className="font-path-mono text-[11px] uppercase tracking-[0.1em] text-hq-ink-muted">
            {criterion.id}
          </span>
          <span className="block font-path-body text-sm leading-5 text-hq-ink">
            {criterion.passCriterion}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <Counts {...criterion} />
          <Icon
            name={open ? "chevron-left" : "chevron-right"}
            size={18}
            className="text-hq-ink-muted"
          />
        </span>
      </button>

      {open && (
        <ul className="bg-hq-canvas">
          {criterion.tasks.map((task) => (
            <li
              key={task.id}
              className="flex min-h-[56px] items-center gap-3 border-t border-hq-border px-4 py-3"
            >
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-path-mono text-[11px] uppercase tracking-[0.1em] text-hq-ink-muted">
                    {task.id}
                  </span>
                  <TaskStateMark task={task} />
                  {task.completesCriterion && (
                    <Icon
                      name="stamp"
                      size={16}
                      title="Closes this criterion"
                      className="shrink-0 text-hq-ink-muted"
                    />
                  )}
                </span>
                <span className="block font-path-body text-sm leading-5 text-hq-ink">
                  {task.title}
                </span>
              </span>

              {/* The (i): task detail inline, no navigation (R21). Only offered
                  when the bundle actually carries detail for this id — a state
                  key outside the pinned program has no row here anyway. */}
              {details[task.id] && (
                <button
                  type="button"
                  onClick={() => onOpenDetail(task)}
                  aria-label={`About ${task.id} — ${task.title}`}
                  aria-haspopup="dialog"
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-hq-ink-muted hover:bg-hq-sunken hover:text-hq-ink active:bg-hq-sunken"
                >
                  <Icon name="info" size={20} />
                </button>
              )}

              {/* ── UNIT 9 SEAM: FwInlineDecision mounts here (see docblock). ── */}
              {renderDecision?.(task)}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export default function FwTaskTree({
  phase,
  details,
  renderDecision,
}: {
  /** The URL-selected phase (see FwPhaseNav) — one at a time; the phase level
   *  is no longer an accordion tier. */
  phase: FwTreePhase;
  /** Task id → detail, built server-side from the STATIC CONTENT BUNDLE against
   *  the student's pinned program — the (i) modal's offline-capable source. */
  details: Readonly<Record<string, FwTaskDetail>>;
  /** UNIT 9's slot — the inline decision controls per task row. Absent in Unit 8
   *  (they ship together; see the module docblock). */
  renderDecision?: (task: FwTreeTask) => ReactNode;
}) {
  const [detailTask, setDetailTask] = useState<FwTreeTask | null>(null);
  const openDetail = detailTask ? details[detailTask.id] : undefined;
  // Stable across re-renders — belt-and-braces with the focus trap's own
  // ref-held escape handler, so a queue-driven parent re-render can never
  // re-fire the modal's trap through a fresh closure identity.
  const closeDetail = useCallback(() => setDetailTask(null), []);

  return (
    <section className="overflow-hidden rounded-xl border border-hq-border bg-hq-surface shadow-hq">
      <div className="flex min-h-[64px] w-full items-center justify-between gap-3 px-4 py-3">
        <span className="min-w-0">
          <span className="font-path-mono text-[11px] uppercase tracking-[0.14em] text-hq-ink-muted">
            {phase.num} · {phase.key}
          </span>
          <span className="block truncate font-path-display text-base font-semibold text-hq-ink">
            {phase.subtitle}
          </span>
        </span>
        <Counts {...phase} />
      </div>

      <ul className="border-t border-hq-border">
        {phase.criteria.map((criterion) => (
          <CriterionRow
            key={criterion.id}
            criterion={criterion}
            details={details}
            onOpenDetail={setDetailTask}
            renderDecision={renderDecision}
          />
        ))}
      </ul>

      {detailTask && openDetail && (
        <FwTaskDetailModal
          taskId={detailTask.id}
          title={detailTask.title}
          detail={openDetail}
          onClose={closeDetail}
        />
      )}
    </section>
  );
}
