"use client";

/**
 * Header status mover (plan 2026-07-15-001 Unit 4): the read-only ReviewPill
 * wrapped in a menu button — one element shows the stage AND changes it.
 * Single-purpose by design (scope note): this is the dossier stage menu, not
 * a generalized menu primitive.
 *
 * A11y (settled in the plan, not deferred): role="menu" with menuitemradio +
 * aria-checked for the current stage, roving tabindex + Arrow/Home/End keys
 * per the ARIA menu pattern (NOT useFocusTrap's Tab-trap — that's for modal
 * dialogs), Escape closes and returns focus to the trigger, click-outside
 * closes. The pill itself still prints; the ▾ affordance and the open panel
 * are print-suppressed.
 */

import { useEffect, useRef, useState } from "react";
import { REVIEW_STATUS_LABELS, type ReviewStatus } from "@/app/crm/lib/constants";
import { ReviewPill } from "./QueueList";

/** The five stages staff can move a candidate to (drafts never show here). */
const MOVE_STAGES: ReviewStatus[] = [
  "submitted",
  "in_review",
  "invited",
  "offered",
  "member",
];

export default function StatusMenu({
  status,
  disabled,
  onSelect,
}: {
  status: ReviewStatus;
  disabled?: boolean;
  onSelect: (stage: ReviewStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [focusIdx, setFocusIdx] = useState(0);

  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  // Click-outside closes (mousedown so a click that opens something else
  // doesn't leave a stale panel behind).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Focus follows the roving tabindex whenever the menu is open; the home
  // index is set in the trigger's click handler, not here (no setState in
  // effects — react-hooks/set-state-in-effect).
  useEffect(() => {
    if (open) itemRefs.current[focusIdx]?.focus();
  }, [open, focusIdx]);

  const openMenu = () => {
    setFocusIdx(Math.max(0, MOVE_STAGES.indexOf(status)));
    setOpen(true);
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const last = MOVE_STAGES.length - 1;
    let next: number | null = null;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "ArrowDown") next = focusIdx >= last ? 0 : focusIdx + 1;
    if (e.key === "ArrowUp") next = focusIdx <= 0 ? last : focusIdx - 1;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = last;
    if (next !== null) {
      e.preventDefault();
      setFocusIdx(next);
      itemRefs.current[next]?.focus();
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Candidate stage: ${REVIEW_STATUS_LABELS[status]}. Move candidate`}
        onClick={() => (open ? close(false) : openMenu())}
        className="flex items-center gap-1.5 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-crm-blue disabled:opacity-50"
      >
        <ReviewPill status={status} />
        <span aria-hidden className="no-print text-[9px] text-crm-faint">
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Move candidate"
          onKeyDown={onMenuKeyDown}
          className="no-print absolute right-0 top-full z-10 mt-1.5 w-56 rounded-[12px] border border-crm-line bg-white py-1 shadow-[0_10px_30px_rgba(19,20,22,0.12)]"
        >
          {MOVE_STAGES.map((stage, i) => {
            const current = stage === status;
            return (
              <button
                key={stage}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={current}
                tabIndex={i === focusIdx ? 0 : -1}
                onClick={() => {
                  close();
                  if (!current) onSelect(stage);
                }}
                className={`flex w-full items-center justify-between px-3.5 py-2 text-left text-[13px] leading-snug hover:bg-crm-card focus-visible:bg-crm-card focus-visible:outline-none ${
                  current ? "text-crm-ink" : "text-crm-muted"
                }`}
              >
                {REVIEW_STATUS_LABELS[stage]}
                {current && (
                  <span aria-hidden className="font-mono text-[10px] text-crm-red">
                    ●
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
