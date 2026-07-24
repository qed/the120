"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/app/path/components/system/Icon";
import type { FwTreeCriterion, FwTreePhase } from "@/app/path/lib/fw-nav-rules";
import type { TaskState } from "@/app/path/lib/transition-table";

/**
 * The drill-down (FW Unit 4; FW-R14, FW-D5) — stage → criterion → task, over the
 * whole 125-task catalog.
 *
 * NOTHING IS GATED, and nothing here could gate it: the tree renders exactly the
 * phases, criteria, and tasks `buildFwTaskTree` returns, and that function is
 * pinned by a test asserting every task in the catalog survives it. A guide
 * reaches any task by drilling to it — there is no `available` tier and no
 * predecessor rule, because a weekend does not run in curriculum order.
 *
 * Both levels are ACCORDIONS rather than pages. Three taps to a task with no
 * network round trip between them is what keeps the loop inside a minute, and it
 * is what will still work in Unit 8's outage — a page-per-level drill-down would
 * need a navigation the service worker deliberately never caches.
 */

const STATE_MARK: Record<TaskState, { icon: "check" | "x" | "circle-dashed"; cls: string }> = {
  verified: { icon: "check", cls: "text-verified" },
  not_yet: { icon: "x", cls: "text-not-yet" },
  locked: { icon: "circle-dashed", cls: "text-hq-ink-muted" },
  // A converted student can carry Path work states. They are not FW decisions,
  // so they read as untouched here rather than borrowing a decision's mark.
  available: { icon: "circle-dashed", cls: "text-hq-ink-muted" },
  in_progress: { icon: "circle-dashed", cls: "text-hq-ink-muted" },
  submitted: { icon: "circle-dashed", cls: "text-hq-ink-muted" },
};

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
  taskHrefPrefix,
}: {
  criterion: FwTreeCriterion;
  taskHrefPrefix: string;
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
          {criterion.tasks.map((task) => {
            const mark = STATE_MARK[task.state];
            return (
              <li key={task.id}>
                <Link
                  href={`${taskHrefPrefix}/${task.id}`}
                  className="flex min-h-[56px] items-center gap-3 border-t border-hq-border px-4 py-3 active:bg-hq-sunken"
                >
                  <Icon name={mark.icon} size={20} className={`shrink-0 ${mark.cls}`} />
                  <span className="min-w-0 flex-1">
                    <span className="font-path-mono text-[11px] uppercase tracking-[0.1em] text-hq-ink-muted">
                      {task.id}
                    </span>
                    <span className="block font-path-body text-sm leading-5 text-hq-ink">
                      {task.title}
                    </span>
                  </span>
                  {task.completesCriterion && (
                    <Icon
                      name="stamp"
                      size={16}
                      title="Closes this criterion"
                      className="shrink-0 text-hq-ink-muted"
                    />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

export default function FwTaskTree({
  phases,
  taskHrefPrefix,
}: {
  phases: readonly FwTreePhase[];
  /** A STRING, not a builder function: props crossing the server/client boundary
   *  must serialize, and a `(taskId) => string` prop is the kind of thing that
   *  looks fine until it is rendered from a Server Component. */
  taskHrefPrefix: string;
}) {
  const [openPhase, setOpenPhase] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {phases.map((phase) => {
        const open = openPhase === phase.num;
        return (
          <section
            key={phase.num}
            className="overflow-hidden rounded-xl border border-hq-border bg-hq-surface shadow-hq"
          >
            <button
              type="button"
              onClick={() => setOpenPhase(open ? null : phase.num)}
              aria-expanded={open}
              className="flex min-h-[64px] w-full items-center justify-between gap-3 px-4 py-3 text-left active:bg-hq-sunken"
            >
              <span className="min-w-0">
                <span className="font-path-mono text-[11px] uppercase tracking-[0.14em] text-hq-ink-muted">
                  {phase.num} · {phase.key}
                </span>
                <span className="block truncate font-path-display text-base font-semibold text-hq-ink">
                  {phase.subtitle}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <Counts {...phase} />
                <Icon
                  name={open ? "chevron-left" : "chevron-right"}
                  size={20}
                  className="text-hq-ink-muted"
                />
              </span>
            </button>

            {open && (
              <ul className="border-t border-hq-border">
                {phase.criteria.map((criterion) => (
                  <CriterionRow
                    key={criterion.id}
                    criterion={criterion}
                    taskHrefPrefix={taskHrefPrefix}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
