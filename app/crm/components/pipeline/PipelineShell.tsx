"use client";

/**
 * Pipeline client shell (plan Units 4+8; alphahub `pipeline-shell` restyled):
 * holds filter state (stage / source / needs-attention with cross-filtered
 * counts), the TABLE/KANBAN view toggle (persisted in localStorage
 * 'crm-pipeline-view'; the kanban option is hidden entirely on touch-primary
 * or <900px viewports — native DnD doesn't fire on touch, and mobile stage
 * changes go through the drawer's stamp/override buttons), the add-family
 * modal, and the URL-driven contact drawer.
 */

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import type { FamilyDetail, PipelineFamily } from "@/app/crm/lib/queries";
import { needsAttention } from "@/app/crm/lib/dates";
import type { Stage } from "@/app/crm/lib/constants";
import { BTN_PRIMARY, BTN_SECONDARY } from "./atoms";
import Filters from "./Filters";
import PipelineTable from "./PipelineTable";
import KanbanBoard from "./KanbanBoard";
import AddFamilyModal from "./AddFamilyModal";
import LogWarmConvoModal from "./LogWarmConvoModal";
import ContactDrawer from "./ContactDrawer";

type PipelineView = "table" | "kanban";

const VIEW_STORAGE_KEY = "crm-pipeline-view";

/* Kanban capability — deliberately simple client-side matchMedia (no SSR
   media hints): native HTML5 DnD doesn't fire on touch, and the six-column
   board needs width, so touch-primary or <900px hides the option entirely.
   Modeled as an external store; the SSR snapshot is `false`, so the server
   renders table-only and the toggle appears after hydration on capable
   viewports. */

const KANBAN_MEDIA = ["(pointer: coarse)", "(max-width: 899px)"] as const;

function subscribeKanbanAllowed(onChange: () => void): () => void {
  const queries = KANBAN_MEDIA.map((q) => window.matchMedia(q));
  for (const q of queries) q.addEventListener("change", onChange);
  return () => {
    for (const q of queries) q.removeEventListener("change", onChange);
  };
}

const readKanbanAllowed = (): boolean =>
  KANBAN_MEDIA.every((q) => !window.matchMedia(q).matches);

/* Persisted view choice (localStorage 'crm-pipeline-view') as an external
   store too — writes go through `writeStoredView`, which notifies local
   subscribers (the `storage` event only fires in OTHER tabs). */

const viewListeners = new Set<() => void>();

const readStoredView = (): PipelineView =>
  window.localStorage.getItem(VIEW_STORAGE_KEY) === "kanban"
    ? "kanban"
    : "table";

function writeStoredView(view: PipelineView): void {
  window.localStorage.setItem(VIEW_STORAGE_KEY, view);
  for (const listener of viewListeners) listener();
}

function subscribeStoredView(onChange: () => void): () => void {
  viewListeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    viewListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

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
  const [warmModalOpen, setWarmModalOpen] = useState(false);

  // View toggle (Unit 8): everything derives — no view state to reconcile.
  // A narrowed/touch viewport forces the table WITHOUT clobbering the
  // stored choice, so kanban comes back when the window widens again.
  const kanbanAllowed = useSyncExternalStore(
    subscribeKanbanAllowed,
    readKanbanAllowed,
    () => false
  );
  const storedView = useSyncExternalStore(
    subscribeStoredView,
    readStoredView,
    () => "table" as PipelineView
  );
  const view: PipelineView =
    kanbanAllowed && storedView === "kanban" ? "kanban" : "table";

  const switchView = useCallback((next: PipelineView) => {
    writeStoredView(next);
  }, []);

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
          {/* View toggle — kanban hidden on touch/narrow viewports */}
          {kanbanAllowed && (
            <div className="flex overflow-hidden rounded-[10px] border border-crm-line2">
              {(["table", "kanban"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => switchView(v)}
                  className={
                    view === v
                      ? "bg-crm-blue px-3 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-white"
                      : "cursor-pointer bg-crm-card px-3 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-crm-muted hover:text-crm-ink"
                  }
                >
                  {v}
                </button>
              ))}
            </div>
          )}

          {/* Warm-convo fast capture (Unit 5) — SECONDARY weight; the red
              "Add family" stays the single primary CTA. */}
          <button
            type="button"
            onClick={() => setWarmModalOpen(true)}
            className={BTN_SECONDARY}
          >
            Log warm convo
          </button>

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
            {view === "kanban" && kanbanAllowed ? (
              /* Same filtered set as the table; LOST/WAITLIST never render
                 as columns (table-filter-only views — plan Unit 8). */
              <KanbanBoard families={filtered} />
            ) : (
              <PipelineTable
                families={filtered}
                hasActiveFilters={hasActiveFilters}
                onClearFilters={clearFilters}
              />
            )}
          </div>
        </>
      )}

      {detail && <ContactDrawer detail={detail} />}

      <AddFamilyModal open={modalOpen} onClose={() => setModalOpen(false)} />
      <LogWarmConvoModal
        open={warmModalOpen}
        onClose={() => setWarmModalOpen(false)}
      />
    </div>
  );
}
