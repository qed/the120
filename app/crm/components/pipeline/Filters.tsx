"use client";

/**
 * Pipeline filter chips (brief §7/§11): stage pills · source pills ·
 * "Needs attention" toggle, all mono chips with cross-filtered counts.
 * Zero-count chips hide (except when active) to keep the row scannable.
 */

import {
  SOURCES,
  SOURCE_LABELS,
  STAGES,
  STAGE_LABELS,
  type Stage,
} from "@/app/crm/lib/constants";

function Chip({
  active,
  onClick,
  children,
  pressed,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed ?? active}
      className={`cursor-pointer whitespace-nowrap rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.06em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-crm-blue ${
        active
          ? "border border-transparent bg-crm-blue text-white"
          : "border border-crm-line2 bg-crm-card text-crm-muted hover:text-crm-ink"
      }`}
    >
      {children}
    </button>
  );
}

export default function Filters({
  allCount,
  stageCounts,
  sourceCounts,
  attentionCount,
  stageFilter,
  sourceFilter,
  attentionOnly,
  onStage,
  onSource,
  onAttention,
}: {
  allCount: number;
  stageCounts: Partial<Record<Stage, number>>;
  sourceCounts: Record<string, number>;
  attentionCount: number;
  stageFilter: Stage | null;
  sourceFilter: string | null;
  attentionOnly: boolean;
  onStage: (stage: Stage | null) => void;
  onSource: (source: string | null) => void;
  onAttention: (value: boolean) => void;
}) {
  const visibleStages = STAGES.filter(
    (s) => (stageCounts[s] ?? 0) > 0 || stageFilter === s
  );
  const visibleSources = SOURCES.filter(
    (s) => (sourceCounts[s] ?? 0) > 0 || sourceFilter === s
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Chip active={!stageFilter} onClick={() => onStage(null)}>
        All · {allCount}
      </Chip>
      {visibleStages.map((stage) => (
        <Chip
          key={stage}
          active={stageFilter === stage}
          onClick={() => onStage(stageFilter === stage ? null : stage)}
        >
          {STAGE_LABELS[stage]} · {stageCounts[stage] ?? 0}
        </Chip>
      ))}

      {visibleSources.length > 0 && (
        <span aria-hidden className="mx-1 h-4 w-px bg-crm-line2" />
      )}
      {visibleSources.map((source) => (
        <Chip
          key={source}
          active={sourceFilter === source}
          onClick={() => onSource(sourceFilter === source ? null : source)}
        >
          {SOURCE_LABELS[source]} · {sourceCounts[source] ?? 0}
        </Chip>
      ))}

      <span aria-hidden className="mx-1 h-4 w-px bg-crm-line2" />
      <Chip active={attentionOnly} onClick={() => onAttention(!attentionOnly)}>
        Needs attention · {attentionCount}
      </Chip>
    </div>
  );
}
