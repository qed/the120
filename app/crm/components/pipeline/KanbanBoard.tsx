"use client";

/**
 * Kanban view (plan Unit 8; brief §7 / §5.2 — alphahub's kanban-board ported
 * minus geography and minus the multi-user concurrency token; two named
 * users resolve conflicts last-write-wins). Six columns: INTERESTED ·
 * ACCOUNT · DOSSIER (started/submitted sub-badges) · CALL (booked/held
 * sub-badges, the ONLY drop targets) · DEPOSIT PAID · MEMBER. Native HTML5
 * DnD: a drop on a CALL sub-zone calls `stampCall` (today), moves the card
 * optimistically (only when the stamp actually changes the derived stage —
 * `stampMovesCard`), snaps back on failure, and toasts exactly what was
 * recorded. Drops on derived columns reject with the explanatory toast.
 * LOST/WAITLIST have no columns — drawer-only overrides, table-filter views.
 */

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { PipelineFamily } from "@/app/crm/lib/queries";
import { stampCall } from "@/app/crm/lib/actions/families";
import { useToast } from "@/app/crm/components/Toast";
import {
  dropSuccessMessage,
  dropVerdict,
  kanbanColumnOf,
  stampMovesCard,
  KANBAN_COLUMNS,
} from "@/app/crm/lib/kanban-rules";
import {
  MANUAL_STAMP_STAGES,
  STAGE_LABELS,
  type ManualStampStage,
  type Stage,
} from "@/app/crm/lib/constants";
import { HeatPips, LastTouch } from "./atoms";

const MIME_ID = "text/family-id";

/* ------------------------------------------------------------------ card */

function KanbanCard({
  family,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  family: PipelineFamily;
  onDragStart: (e: React.DragEvent, family: PipelineFamily) => void;
  onDragEnd: () => void;
  onClick: (id: string) => void;
}) {
  const meta = [
    family.kidsCount > 0
      ? family.kidsCount === 1
        ? "1 kid"
        : `${family.kidsCount} kids`
      : null,
    family.area,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      draggable
      role="button"
      tabIndex={0}
      onDragStart={(e) => onDragStart(e, family)}
      onDragEnd={onDragEnd}
      onClick={() => onClick(family.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onClick(family.id);
      }}
      className="cursor-grab rounded-[10px] border border-crm-line2 bg-white p-2.5 transition-shadow hover:shadow-[0_2px_10px_rgba(3,0,237,0.10)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-crm-blue active:cursor-grabbing"
    >
      <p className="truncate text-[12.5px] font-semibold text-crm-ink">
        {family.name || "Unnamed family"}
      </p>
      {meta && <p className="mt-0.5 truncate text-[10.5px] text-crm-muted">{meta}</p>}
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <HeatPips score={family.heat} />
        <LastTouch lastTouchAt={family.lastTouchAt} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ empty state */

/** R32 — empty kanban column: dashed outline + stage name. */
function EmptyColumn({ label }: { label: string }) {
  return (
    <div className="flex min-h-[110px] items-center justify-center rounded-[10px] border-2 border-dashed border-crm-line2">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-crm-faint">
        {label}
      </span>
    </div>
  );
}

/* ----------------------------------------------------------------- board */

export default function KanbanBoard({
  families,
}: {
  families: PipelineFamily[];
}) {
  const router = useRouter();
  const { toast } = useToast();

  // Optimistic stage overrides (id → stage) while a stamp round-trips.
  const [optimistic, setOptimistic] = useState<Map<string, Stage>>(new Map());
  const [dragging, setDragging] = useState<PipelineFamily | null>(null);

  const effectiveStage = useCallback(
    (f: PipelineFamily): Stage => optimistic.get(f.id) ?? f.stage,
    [optimistic]
  );

  // Group into stages (lost/waitlist never render — kanbanColumnOf is null),
  // each list sorted freshest-touch first (fallback: creation recency).
  const byStage = useMemo(() => {
    const grouped = new Map<Stage, PipelineFamily[]>();
    for (const f of families) {
      const stage = effectiveStage(f);
      if (kanbanColumnOf(stage) === null) continue;
      const list = grouped.get(stage);
      if (list) list.push(f);
      else grouped.set(stage, [f]);
    }
    for (const list of grouped.values()) {
      list.sort((a, b) => {
        const ta = new Date(a.lastTouchAt ?? a.createdAt).getTime();
        const tb = new Date(b.lastTouchAt ?? b.createdAt).getTime();
        return tb - ta;
      });
    }
    return grouped;
  }, [families, effectiveStage]);

  const stageList = useCallback(
    (stage: Stage): PipelineFamily[] => byStage.get(stage) ?? [],
    [byStage]
  );

  const openDrawer = useCallback(
    (id: string) => router.push(`/crm/pipeline?family=${id}`, { scroll: false }),
    [router]
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent, family: PipelineFamily) => {
      e.dataTransfer.setData(MIME_ID, family.id);
      e.dataTransfer.effectAllowed = "move";
      setDragging(family);
    },
    []
  );

  const handleDragEnd = useCallback(() => setDragging(null), []);

  const handleDrop = useCallback(
    async (e: React.DragEvent, target: Stage) => {
      e.preventDefault();
      const id = e.dataTransfer.getData(MIME_ID) || dragging?.id;
      setDragging(null);
      if (!id) return;
      const family = families.find((f) => f.id === id);
      if (!family) return;

      const verdict = dropVerdict(effectiveStage(family), target);
      if (!verdict.ok) {
        if (verdict.reason === "derived") toast("error", verdict.message);
        return; // "same" is a silent no-op
      }

      const stampTarget = target as ManualStampStage;
      const moves = stampMovesCard(effectiveStage(family), stampTarget);
      if (moves) {
        setOptimistic((prev) => new Map(prev).set(id, target));
      }

      const result = await stampCall({ familyId: id, kind: verdict.kind });

      if (!result.success) {
        // Snap back.
        if (moves) {
          setOptimistic((prev) => {
            const next = new Map(prev);
            next.delete(id);
            return next;
          });
        }
        toast("error", result.error ?? "Failed to record the call.");
        return;
      }

      // Clear the optimistic override so the refreshed server derivation
      // takes over (alphahub's exact sequence) — a stale pin would otherwise
      // mask a later stamp-clear from the drawer.
      if (moves) {
        setOptimistic((prev) => {
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
      }
      toast(
        "success",
        dropSuccessMessage(verdict.kind, family.name || "Unnamed family")
      );
      router.refresh();
    },
    [dragging, families, effectiveStage, router, toast]
  );

  // Only the CALL sub-zones ever validate (MANUAL_STAMP_STAGES); a zone is
  // also invalid while the dragged card already sits in it.
  const isValidZone = useCallback(
    (target: ManualStampStage): boolean =>
      dragging !== null && dropVerdict(effectiveStage(dragging), target).ok,
    [dragging, effectiveStage]
  );

  /* ---------------------------------------------------------- rendering */

  const rejectZoneProps = (stages: readonly string[]) => ({
    // preventDefault marks the zone droppable so the rejection toast can
    // fire on drop — the "why not" is part of the design (brief §5.2).
    onDragOver: (e: React.DragEvent) => {
      if (dragging) e.preventDefault();
    },
    onDrop: (e: React.DragEvent) => handleDrop(e, stages[0] as Stage),
  });

  return (
    <div className="overflow-x-auto pb-2" data-testid="kanban-board">
      <div className="grid min-w-[1080px] grid-cols-6 gap-2.5">
        {KANBAN_COLUMNS.map((column) => {
          const columnFamilies = column.stages.flatMap((s) =>
            stageList(s as Stage)
          );

          /* CALL column — two stacked sub-drop-zones (the only drop targets) */
          if (column.id === "call") {
            return (
              <div
                key={column.id}
                className="flex min-h-[240px] flex-col rounded-[12px] border border-crm-line bg-crm-card"
              >
                <ColumnHeader
                  label={column.label}
                  count={columnFamilies.length}
                  badges={MANUAL_STAMP_STAGES.map((s) => ({
                    label: s === "call_booked" ? "BOOKED" : "HELD",
                    count: stageList(s).length,
                  }))}
                />
                <div className="flex flex-1 flex-col gap-2 p-2">
                  {MANUAL_STAMP_STAGES.map((stage) => (
                    <CallDropZone
                      key={stage}
                      stage={stage}
                      families={stageList(stage)}
                      validDrop={isValidZone(stage)}
                      onDrop={handleDrop}
                      onDragStart={handleDragStart}
                      onDragEnd={handleDragEnd}
                      onCardClick={openDrawer}
                    />
                  ))}
                </div>
              </div>
            );
          }

          /* Derived columns — render cards, reject drops with the toast */
          return (
            <div
              key={column.id}
              className="flex min-h-[240px] flex-col rounded-[12px] border border-crm-line bg-crm-card"
              {...rejectZoneProps(column.stages)}
            >
              <ColumnHeader
                label={column.label}
                count={columnFamilies.length}
                badges={
                  column.id === "dossier"
                    ? [
                        {
                          label: "STARTED",
                          count: stageList("dossier_started").length,
                        },
                        {
                          label: "SUBMITTED",
                          count: stageList("dossier_submitted").length,
                        },
                      ]
                    : []
                }
              />
              <div className="flex-1 space-y-2 p-2">
                {columnFamilies.length === 0 ? (
                  <EmptyColumn label={column.label} />
                ) : (
                  columnFamilies.map((f) => (
                    <KanbanCard
                      key={f.id}
                      family={f}
                      onDragStart={handleDragStart}
                      onDragEnd={handleDragEnd}
                      onClick={openDrawer}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- helpers */

function ColumnHeader({
  label,
  count,
  badges,
}: {
  label: string;
  count: number;
  badges: { label: string; count: number }[];
}) {
  return (
    <div className="border-b border-crm-line px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-crm-ink">
          {label}
        </span>
        <span className="font-mono text-[9.5px] text-crm-muted">{count}</span>
      </div>
      {badges.length > 0 && (
        <div className="mt-1 flex gap-1">
          {badges.map((b) => (
            <span
              key={b.label}
              className="rounded-full bg-crm-bg px-1.5 py-[2px] font-mono text-[8.5px] tracking-[0.06em] text-crm-muted"
            >
              {b.label} {b.count}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function CallDropZone({
  stage,
  families,
  validDrop,
  onDrop,
  onDragStart,
  onDragEnd,
  onCardClick,
}: {
  stage: ManualStampStage;
  families: PipelineFamily[];
  validDrop: boolean;
  onDrop: (e: React.DragEvent, target: Stage) => void;
  onDragStart: (e: React.DragEvent, family: PipelineFamily) => void;
  onDragEnd: () => void;
  onCardClick: (id: string) => void;
}) {
  const [over, setOver] = useState(false);

  // Highlight while a drag is live and this sub-zone is a legal target;
  // strengthen on hover (brief: drop zones highlight during drag when valid).
  const highlight = validDrop
    ? over
      ? "border-crm-blue bg-white ring-2 ring-crm-blue"
      : "border-crm-blue border-dashed"
    : "border-crm-line2";

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        onDrop(e, stage);
      }}
      className={`flex flex-1 flex-col rounded-[10px] border transition-colors ${highlight}`}
      data-testid={`kanban-drop-${stage}`}
    >
      <p className="px-2 pt-1.5 font-mono text-[8.5px] uppercase tracking-[0.1em] text-crm-muted">
        {STAGE_LABELS[stage]}
      </p>
      <div className="flex-1 space-y-2 p-2">
        {families.length === 0 ? (
          <EmptyColumn label={STAGE_LABELS[stage]} />
        ) : (
          families.map((f) => (
            <KanbanCard
              key={f.id}
              family={f}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onClick={onCardClick}
            />
          ))
        )}
      </div>
    </div>
  );
}
