import { cn } from "./cn";
import { PHASES, phaseColor } from "./phases";
import type { PhaseKey } from "@/app/path/content/types";

interface ProgressMeterProps {
  /** verified tasks out of `total` */
  value: number;
  total?: number;
  /** how many tasks belong to each phase, for the segmented fill */
  perPhase?: Record<PhaseKey, number>;
  label?: string;
  className?: string;
}

// Design-system fallback only — 25 per phase sums to the 125-task credential.
// Surfaces pass the real per-phase breakdown (2026-27 is 25/26/24/25/25) from
// the content manifest.
const DEFAULT_PER_PHASE: Record<PhaseKey, number> = {
  SELL: 25,
  BUILD: 25,
  VALIDATE: 25,
  GROW: 25,
  SCALE: 25,
};

/**
 * ProgressMeter — the "n / 125 verified" bar. The credential, identical across
 * ages. Fills phase-by-phase in each phase's accent color so progress reads at a
 * glance.
 */
export function ProgressMeter({
  value,
  total = 125,
  perPhase = DEFAULT_PER_PHASE,
  label = "verified",
  className,
}: ProgressMeterProps) {
  // Fill phase-by-phase: each segment shows the verified tasks that land inside
  // it. Computed functionally (prefix sums) rather than with a mutable running
  // total, which the render-immutability rule rightly forbids.
  const segments = PHASES.map((p, i) => {
    const count = perPhase[p.key];
    const before = PHASES.slice(0, i).reduce((sum, q) => sum + perPhase[q.key], 0);
    const filled = Math.max(0, Math.min(count, value - before));
    const pct = count > 0 ? (filled / count) * 100 : 0;
    return { key: p.key, pct };
  });

  return (
    <div className={cn("w-full", className)}>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="font-path-mono text-sm tabular-nums text-hq-ink">
          <span className="font-semibold">{value}</span>
          <span className="text-hq-ink-muted"> / {total}</span>
        </span>
        <span className="text-xs uppercase tracking-wide text-hq-ink-muted">{label}</span>
      </div>
      <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-hq-sunken">
        {segments.map((s) => (
          <div key={s.key} className="relative h-full flex-1 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700 ease-out"
              style={{ width: `${s.pct}%`, backgroundColor: phaseColor(s.key) }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
