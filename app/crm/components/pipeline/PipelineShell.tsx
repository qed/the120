"use client";

/**
 * Pipeline client shell (plan Unit 4; alphahub `pipeline-shell` restyled):
 * holds filter state (stage / source / needs-attention with cross-filtered
 * counts), the add-family modal, and the URL-driven contact drawer. TABLE
 * view only this unit — the kanban toggle renders disabled ("P3").
 */

import { useCallback, useMemo, useState } from "react";
import type { FamilyDetail, PipelineFamily } from "@/app/crm/lib/queries";
import { needsAttention } from "@/app/crm/lib/dates";
import type { Stage } from "@/app/crm/lib/constants";
import { BTN_PRIMARY } from "./atoms";
import Filters from "./Filters";
import PipelineTable from "./PipelineTable";
import AddFamilyModal from "./AddFamilyModal";
import ContactDrawer from "./ContactDrawer";

export default function PipelineShell({
  families,
  detail,
}: {
  families: PipelineFamily[];
  detail: FamilyDetail | null;
}) {
  const [stageFilter, setStageFilter] = useState<Stage | null>(null);
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const matchesStage = useCallback(
    (f: PipelineFamily) => !stageFilter || f.stage === stageFilter,
    [stageFilter]
  );
  const matchesSource = useCallback(
    (f: PipelineFamily) => !sourceFilter || f.source === sourceFilter,
    [sourceFilter]
  );
  const matchesAttention = useCallback(
    (f: PipelineFamily) => !attentionOnly || needsAttention(f),
    [attentionOnly]
  );

  const filtered = useMemo(
    () =>
      families.filter(
        (f) => matchesStage(f) && matchesSource(f) && matchesAttention(f)
      ),
    [families, matchesStage, matchesSource, matchesAttention]
  );

  // Cross-filtered counts: each chip row counts rows matching the OTHER
  // filters, so the numbers always answer "what would I get if I clicked".
  const stageCounts = useMemo(() => {
    const counts: Partial<Record<Stage, number>> = {};
    for (const f of families) {
      if (!matchesSource(f) || !matchesAttention(f)) continue;
      counts[f.stage] = (counts[f.stage] ?? 0) + 1;
    }
    return counts;
  }, [families, matchesSource, matchesAttention]);

  const allCount = useMemo(
    () => families.filter((f) => matchesSource(f) && matchesAttention(f)).length,
    [families, matchesSource, matchesAttention]
  );

  const sourceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of families) {
      if (!matchesStage(f) || !matchesAttention(f)) continue;
      counts[f.source] = (counts[f.source] ?? 0) + 1;
    }
    return counts;
  }, [families, matchesStage, matchesAttention]);

  const attentionCount = useMemo(
    () =>
      families.filter(
        (f) => matchesStage(f) && matchesSource(f) && needsAttention(f)
      ).length,
    [families, matchesStage, matchesSource]
  );

  const hasActiveFilters = Boolean(stageFilter || sourceFilter || attentionOnly);
  const clearFilters = useCallback(() => {
    setStageFilter(null);
    setSourceFilter(null);
    setAttentionOnly(false);
  }, []);

  return (
    <div className="px-5 py-6 sm:px-7">
      {/* Header row */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-crm-muted">
            {families.length === 1 ? "1 FAMILY" : `${families.length} FAMILIES`}
          </p>
          <h1 className="mt-1 font-serif text-[28px] font-normal tracking-[-0.01em] text-crm-ink">
            Pipeline
          </h1>
        </div>

        <div className="flex items-center gap-2.5">
          {/* View toggle — kanban ships in P3 (Unit 8) */}
          <div className="flex overflow-hidden rounded-[10px] border border-crm-line2">
            <button
              type="button"
              aria-pressed="true"
              className="bg-crm-blue px-3 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-white"
            >
              Table
            </button>
            <button
              type="button"
              disabled
              aria-disabled="true"
              title="Kanban view ships in P3"
              className="cursor-not-allowed bg-crm-card px-3 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-crm-faint"
            >
              Kanban
            </button>
          </div>

          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className={BTN_PRIMARY}
          >
            Add family
          </button>
        </div>
      </div>

      {families.length === 0 ? (
        /* Pipeline-empty state (brief §11, brand voice) */
        <div className="flex flex-col items-center px-6 py-24 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-crm-red">
            Pipeline
          </p>
          <h2 className="mt-3 font-serif text-[28px] font-normal tracking-[-0.01em] text-crm-ink">
            The pipeline starts with one family.
          </h2>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className={`${BTN_PRIMARY} mt-6`}
          >
            Add family
          </button>
        </div>
      ) : (
        <>
          <div className="mt-5">
            <Filters
              allCount={allCount}
              stageCounts={stageCounts}
              sourceCounts={sourceCounts}
              attentionCount={attentionCount}
              stageFilter={stageFilter}
              sourceFilter={sourceFilter}
              attentionOnly={attentionOnly}
              onStage={setStageFilter}
              onSource={setSourceFilter}
              onAttention={setAttentionOnly}
            />
          </div>

          <div className="mt-4">
            <PipelineTable
              families={filtered}
              hasActiveFilters={hasActiveFilters}
              onClearFilters={clearFilters}
            />
          </div>
        </>
      )}

      {detail && <ContactDrawer detail={detail} />}

      <AddFamilyModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
