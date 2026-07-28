"use client";

import { useRef } from "react";
import { Icon } from "@/app/fp/components/system/Icon";
import { useFocusTrap } from "@/app/fp/components/useFocusTrap";

/**
 * What an (i) button reveals about a task — exactly the detail the retired task
 * page rendered: body, done-when, the band-resolved line, the all-bands note.
 * All of it derived from the STATIC CONTENT BUNDLE server-side and carried in
 * the page's own payload (ops-guide redesign Unit 8, Key Decision "task detail
 * is server-rendered into the student page").
 */
export type FwTaskDetail = {
  body: string;
  doneWhen: string;
  /** The band-resolved line, when this task has one for this student's band. */
  variant: string | null;
  allBandsNote: string | null;
};

/**
 * The (i) modal (ops-guide redesign Unit 8; R21) — task detail on demand,
 * inside the student view, with no navigation and no fetch.
 *
 * PRESENTATION ONLY, and that is the offline contract: everything this modal
 * shows arrived as props with the page HTML (the static bundle, resolved
 * against the student's pinned program version server-side), so opening it
 * mid-outage works exactly like opening it online. If this component ever
 * grows a fetch, the surface built for the outage stops working in one.
 *
 * Modal canon is `AddFamilyModal` (fixed inset-0 z-50 scrim + panel,
 * role="dialog" aria-modal, focus trap, Escape closes, focus returns to the
 * opener — the trap restores `document.activeElement` on cleanup, which IS the
 * (i) button that opened it). Placement follows the First Dollar dialog's
 * precedent: bottom sheet on a phone (`items-end`), centered at `sm`+.
 */
export default function FwTaskDetailModal({
  taskId,
  title,
  detail,
  onClose,
}: {
  taskId: string;
  title: string;
  detail: FwTaskDetail;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true, onClose);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="fw-task-detail-title"
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
    >
      <div className="absolute inset-0 bg-hq-ink/40" onClick={onClose} aria-hidden />

      <div
        ref={panelRef}
        className="relative max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-hq-border bg-hq-surface p-5 shadow-hq sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-path-mono text-[11px] uppercase tracking-[0.14em] text-hq-ink-muted">
              {taskId}
            </p>
            <h2
              id="fw-task-detail-title"
              className="mt-1 font-path-display text-xl font-semibold leading-tight tracking-tight text-hq-ink"
            >
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close task detail"
            className="-m-2 inline-flex h-11 w-11 shrink-0 items-center justify-center text-hq-ink-muted hover:text-hq-ink"
          >
            <Icon name="x" size={20} />
          </button>
        </div>

        {/* The task itself — the retired task page's order kept: body, then
            done-when (FW-R15). */}
        <p className="mt-4 whitespace-pre-line font-path-body text-base leading-7 text-hq-ink-soft">
          {detail.body}
        </p>

        <div className="mt-4 rounded-xl border border-hq-border bg-hq-canvas p-4">
          <p className="font-path-mono text-[11px] uppercase tracking-[0.12em] text-hq-ink-muted">
            Done when
          </p>
          <p className="mt-1 font-path-body text-base leading-7 text-hq-ink">{detail.doneWhen}</p>
          {detail.variant && (
            <p className="mt-3 font-path-body text-sm leading-6 text-hq-ink-soft">
              <span className="font-semibold text-hq-ink">For this band:</span> {detail.variant}
            </p>
          )}
          {detail.allBandsNote && (
            <p className="mt-2 font-path-body text-sm leading-6 text-hq-ink-soft">
              <span className="font-semibold text-hq-ink">All bands:</span> {detail.allBandsNote}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
