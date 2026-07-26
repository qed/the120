


import React from 'react';
import { motion } from 'framer-motion';
import { LockIcon, StampIcon, BackpackIcon } from 'lucide-react';
import { cn } from '../system/cn';
import { phaseColor, type PhaseKey, type TaskState } from '../system/phases';

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
 *   locked      → mist
 *   available   → the glowing current step
 *   submitted   → a satchel resting on the step, shimmering while inspected
 *   verified    → a wax-stamp footprint
 */
export function TrailStep({ index, state, phase, label, onClick, className }: TrailStepProps) {
  const color = phaseColor(phase);
  const isCurrent = state === 'available' || state === 'in_progress';
  const isVerified = state === 'verified';
  const isSubmitted = state === 'submitted' || state === 'not_yet';
  const isLocked = state === 'locked';

  return (
    <div className={cn('flex flex-col items-center gap-1.5', className)}>
      <motion.button
        type="button"
        onClick={onClick}
        disabled={isLocked}
        whileHover={!isLocked ? { scale: 1.08 } : undefined}
        whileTap={!isLocked ? { scale: 0.95 } : undefined}
        className={cn(
          'relative flex h-14 w-14 items-center justify-center rounded-full border-[3px] transition-colors',
          isLocked && 'cursor-not-allowed border-trail-mist bg-trail-mist/40',
          isVerified && 'border-wax bg-trail-surface',
          isSubmitted && 'border-dashed',
          isCurrent && 'bg-trail-surface'
        )}
        style={
        isCurrent ?
        { borderColor: color, boxShadow: `0 0 0 6px ${color}22, 0 0 24px ${color}55` } :
        isSubmitted ?
        { borderColor: color } :
        undefined
        }
        aria-label={label ?? `Step ${index}`}>
        
        {isLocked && <LockIcon className="h-5 w-5 text-trail-ink/30" />}
        {isCurrent &&
        <motion.span
          className="h-4 w-4 rounded-full"
          style={{ backgroundColor: color }}
          animate={{ scale: [1, 1.25, 1] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }} />

        }
        {isSubmitted &&
        <BackpackIcon
          className="h-6 w-6 animate-shimmer"
          style={{ color }}
          strokeWidth={2} />

        }
        {isVerified &&
        <StampIcon className="animate-stamp h-6 w-6 text-wax" strokeWidth={2.25} />
        }
      </motion.button>
      <span
        className={cn(
          'max-w-[5rem] text-center text-[11px] font-medium leading-tight',
          isLocked ? 'text-trail-ink/40' : 'text-trail-ink-soft'
        )}>
        
        {label ?? `Step ${index}`}
      </span>
    </div>);

}