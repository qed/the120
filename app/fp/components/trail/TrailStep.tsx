"use client";

import { motion, useReducedMotion } from "motion/react";
import { LockIcon, StampIcon, BackpackIcon } from "lucide-react";
import { cn } from "../system/cn";
import { phaseColor, phaseColorAlpha } from "../system/phases";
import type { PhaseKey } from "@/app/fp/content/types";
import type { TaskState } from "@/app/fp/lib/transition-table";

interface TrailStepProps {
  index: number;
  state: TaskState;
  phase: PhaseKey;
  label?: string;
  onClick?: () => void;
  className?: string;
}

/**
 * TrailStep — a single step on the illustrated trail.
 *   locked    → mist
 *   available → the glowing current step
 *   submitted → a satchel resting on the step, shimmering while inspected
 *   verified  → a wax-stamp footprint
 */
export function TrailStep({ index, state, phase, label, onClick, className }: TrailStepProps) {
  // motion/react does not suppress scale/opacity animations on its own; honor the
  // OS setting here the way the CSS `.animate-*` classes already do (design rule).
  const reduce = useReducedMotion();
  const color = phaseColor(phase);
  const isCurrent = state === "available" || state === "in_progress";
  const isVerified = state === "verified";
  const isSubmitted = state === "submitted" || state === "not_yet";
  const isLocked = state === "locked";

  return (
    <div className={cn("flex flex-col items-center gap-1.5", className)}>
      <motion.button
        type="button"
        onClick={onClick}
        disabled={isLocked}
        whileHover={!isLocked && !reduce ? { scale: 1.08 } : undefined}
        whileTap={!isLocked && !reduce ? { scale: 0.95 } : undefined}
        className={cn(
          "relative flex h-14 w-14 items-center justify-center rounded-full border-[3px] transition-colors",
          isLocked && "cursor-not-allowed border-trail-mist bg-trail-mist/40",
          isVerified && "border-wax bg-trail-surface",
          isSubmitted && "border-dashed",
          isCurrent && "bg-trail-surface",
        )}
        style={
          isCurrent
            ? {
                borderColor: color,
                boxShadow: `0 0 0 6px ${phaseColorAlpha(phase, 0.13)}, 0 0 24px ${phaseColorAlpha(phase, 0.33)}`,
              }
            : isSubmitted
              ? { borderColor: color }
              : undefined
        }
        aria-label={label ?? `Step ${index}`}
      >
        {isLocked && <LockIcon className="h-5 w-5 text-trail-ink/30" aria-hidden />}
        {isCurrent && (
          <motion.span
            className="h-4 w-4 rounded-full"
            style={{ backgroundColor: color }}
            animate={reduce ? { scale: 1 } : { scale: [1, 1.25, 1] }}
            transition={reduce ? undefined : { duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
        {isSubmitted && (
          <BackpackIcon className="h-6 w-6 animate-shimmer" style={{ color }} strokeWidth={2} aria-hidden />
        )}
        {isVerified && (
          <StampIcon className="animate-stamp h-6 w-6 text-wax" strokeWidth={2.25} aria-hidden />
        )}
      </motion.button>
      <span
        className={cn(
          "max-w-[5rem] text-center text-[11px] font-medium leading-tight",
          isLocked ? "text-trail-ink/40" : "text-trail-ink-soft",
        )}
      >
        {label ?? `Step ${index}`}
      </span>
    </div>
  );
}
