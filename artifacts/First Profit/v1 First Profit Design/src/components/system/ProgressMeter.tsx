


import React from 'react';
import { cn } from './cn';
import { PHASES, phaseColor, type PhaseKey } from './phases';

interface ProgressMeterProps {
  /** verified tasks out of 125 */
  value: number;
  total?: number;
  /** how many tasks belong to each phase, in order, for the segmented fill */
  perPhase?: Record<PhaseKey, number>;
  label?: string;
  className?: string;
}

const DEFAULT_PER_PHASE: Record<PhaseKey, number> = {
  sell: 25,
  build: 25,
  validate: 25,
  grow: 25,
  scale: 25
};

/**
 * ProgressMeter — the "n / 125 verified" bar. The credential, identical across ages.
 * Fills phase-by-phase using each phase's accent color so progress reads at a glance.
 */
export function ProgressMeter({
  value,
  total = 125,
  perPhase = DEFAULT_PER_PHASE,
  label = 'verified',
  className
}: ProgressMeterProps) {
  let remaining = value;

  return (
    <div className={cn('w-full', className)}>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="font-mono text-sm tabular-nums text-hq-ink">
          <span className="font-semibold">{value}</span>
          <span className="text-hq-ink-muted"> / {total}</span>
        </span>
        <span className="text-xs uppercase tracking-wide text-hq-ink-muted">{label}</span>
      </div>
      <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-hq-sunken">
        {PHASES.map((p) => {
          const count = perPhase[p.key];
          const filled = Math.max(0, Math.min(count, remaining));
          remaining -= count;
          const pct = filled / count * 100;
          return (
            <div key={p.key} className="relative h-full flex-1 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700 ease-out"
                style={{ width: `${pct}%`, backgroundColor: phaseColor(p.key) }} />
              
            </div>);

        })}
      </div>
    </div>);

}