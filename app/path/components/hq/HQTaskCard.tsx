"use client";

import { motion } from "motion/react";
import { RadioIcon } from "lucide-react";
import { cn } from "../system/cn";
import { StatusChip } from "../system/StatusChip";
import { Button } from "../system/Button";
import { phaseColor } from "../system/phases";
import type { PhaseKey } from "@/app/path/content/types";
import type { TaskState } from "@/app/path/lib/transition-table";

export interface TaskCardData {
  id: string;
  title: string;
  body: string;
  doneWhen: string;
  bandVariant?: string;
  state: TaskState;
  phase: PhaseKey;
  liveMoment?: boolean;
  reviewNote?: string;
  verifierComment?: string;
}

interface HQTaskCardProps {
  task: TaskCardData;
  /** the prominent "Now" card gets emphasis */
  now?: boolean;
  onOpen?: () => void;
  className?: string;
}

/**
 * HQTaskCard — the founder's task spec sheet. Task body, the Done-when line
 * highlighted, band variant, and a quiet status chip. Plain, confident, no
 * cheerleading.
 */
export function HQTaskCard({ task, now = false, onOpen, className }: HQTaskCardProps) {
  const color = phaseColor(task.phase);

  return (
    <motion.article
      layout
      className={cn(
        "group relative rounded-xl border bg-hq-canvas p-5 shadow-hq transition-shadow",
        now ? "border-hq-border-strong shadow-hq-lg" : "border-hq-border",
        className,
      )}
    >
      {now && (
        <span
          className="absolute -left-px top-5 h-8 w-1 rounded-r-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
      )}
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-path-mono text-xs text-hq-ink-muted">{task.id}</span>
            {task.liveMoment && (
              <span className="inline-flex items-center gap-1 rounded-full bg-hq-ink px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                <RadioIcon className="h-3 w-3" aria-hidden /> Live moment
              </span>
            )}
          </div>
          <h3 className="mt-1 text-base font-semibold text-hq-ink">{task.title}</h3>
        </div>
        <StatusChip state={task.state} />
      </header>

      <p className="mt-2 text-sm leading-relaxed text-hq-ink-soft">{task.body}</p>

      <div
        className="mt-3 rounded-lg border-l-2 bg-hq-surface px-3 py-2"
        style={{ borderColor: color }}
      >
        <span className="text-[11px] font-semibold uppercase tracking-wide text-hq-ink-muted">
          Done when
        </span>
        <p className="text-sm text-hq-ink">{task.doneWhen}</p>
      </div>

      {task.bandVariant && (
        <p className="mt-2 text-xs text-hq-ink-muted">
          <span className="font-medium text-hq-ink-soft">Band variant:</span> {task.bandVariant}
        </p>
      )}

      {task.state === "not_yet" && task.reviewNote && (
        <div className="mt-3 rounded-lg bg-not-yet/8 px-3 py-2 text-sm text-hq-ink-soft">
          <span className="font-medium text-not-yet">Not yet.</span> {task.reviewNote}
        </div>
      )}

      {task.state === "verified" && task.verifierComment && (
        <div className="mt-3 rounded-lg bg-verified/8 px-3 py-2 text-sm italic text-hq-ink-soft">
          &ldquo;{task.verifierComment}&rdquo;
        </div>
      )}

      {onOpen && task.state !== "locked" && (
        <div className="mt-4">
          <Button skin="hq" variant={now ? "primary" : "secondary"} size="sm" onClick={onOpen}>
            {task.state === "not_yet"
              ? "Resubmit"
              : task.state === "verified"
                ? "View evidence"
                : "Open task"}
          </Button>
        </div>
      )}
    </motion.article>
  );
}
