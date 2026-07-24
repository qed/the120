import { cn } from "../system/cn";
import { StatusChip } from "../system/StatusChip";
import { phaseByKey, phaseColor } from "../system/phases";
import type { PhaseKey } from "@/app/fp/content/types";

interface PhaseRowProps {
  phase: PhaseKey;
  /** verified criteria out of 5 */
  criteriaCleared: number;
  /** verified tasks in this phase, out of the total shown */
  tasksVerified: number;
  tasksTotal?: number;
  status?: "locked" | "active" | "review" | "sealed";
  sealedDate?: string;
  reviewer?: string;
  className?: string;
}

/**
 * PhaseRow — one row of the HQ progress ledger. Criteria as five segments, a task
 * tally, and the phase's status (including the formal review banner).
 */
export function PhaseRow({
  phase,
  criteriaCleared,
  tasksVerified,
  tasksTotal = 25,
  status = "active",
  sealedDate,
  reviewer,
  className,
}: PhaseRowProps) {
  const meta = phaseByKey(phase);
  const color = phaseColor(phase);
  const dim = status === "locked";

  return (
    <div
      className={cn(
        "rounded-xl border border-hq-border bg-hq-canvas p-4 shadow-hq",
        dim && "opacity-55",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-lg font-path-mono text-sm font-semibold"
            style={{ backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`, color }}
          >
            0{meta.index}
          </span>
          <div>
            <h3 className="text-sm font-semibold tracking-wide text-hq-ink">{meta.name}</h3>
            <p className="text-xs text-hq-ink-muted">{meta.tagline}</p>
          </div>
        </div>
        <div className="text-right">
          {status === "sealed" && <StatusChip state="verified" className="ml-auto" />}
          {status === "review" && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-awaiting/25 bg-awaiting/10 px-2.5 py-1 text-xs font-medium text-awaiting">
              Review in progress
            </span>
          )}
          {status === "locked" && <StatusChip state="locked" className="ml-auto" />}
          {status === "active" && (
            <span className="font-path-mono text-xs text-hq-ink-muted">
              <span className="font-semibold text-hq-ink">{tasksVerified}</span>/{tasksTotal}
            </span>
          )}
        </div>
      </div>

      {/* five criterion segments */}
      <div className="mt-3 flex gap-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-1.5 flex-1 overflow-hidden rounded-full bg-hq-sunken">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: i < criteriaCleared ? "100%" : "0%", backgroundColor: color }}
            />
          </div>
        ))}
      </div>

      {status === "review" && reviewer && (
        <p className="mt-2 font-path-mono text-[11px] text-hq-ink-muted">
          Reviewer: {reviewer} · Countersign: Guide (pending)
        </p>
      )}
      {status === "sealed" && sealedDate && (
        <p className="mt-2 font-path-mono text-[11px] text-hq-ink-muted">Sealed {sealedDate}</p>
      )}
    </div>
  );
}
