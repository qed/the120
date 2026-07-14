"use client";

/**
 * Dossier queue — left pane (plan Unit 5; brief §6 / Admin.dc.html):
 * Georgia 28px title, mono "N OF N DOSSIERS" count, mono filter chips
 * (ALL + the five review stages), rows with name / grade·school meta /
 * date / status pill. Selection is URL state (`?child={id}`) so the server
 * component can log the drill-down read-audit; the stage filter is local.
 */

import { useState } from "react";
import Link from "next/link";
import {
  REVIEW_STATUS_LABELS,
  type ReviewStatus,
} from "@/app/crm/lib/constants";
import { queueCounts, reviewPillColors } from "@/app/crm/lib/reviews-rules";
import { fmtDay } from "@/app/crm/lib/dates";
import type { DossierItem } from "@/app/crm/lib/queries";
import { Chip } from "@/app/crm/components/pipeline/atoms";

/** The queue's five filterable stages — drafts never reach the queue. */
const QUEUE_STAGES: ReviewStatus[] = [
  "submitted",
  "in_review",
  "invited",
  "offered",
  "member",
];

/**
 * Review-status pill (Admin.dc.html pill logic via `reviewPillColors`):
 * early = bone/ink, mid = blue/white, MEMBER = red/white. Shared with the
 * detail pane header.
 */
export function ReviewPill({ status }: { status: ReviewStatus }) {
  const colors = reviewPillColors(status);
  return (
    <span
      className="inline-block whitespace-nowrap rounded-full px-2.5 py-[5px] font-mono text-[9px] uppercase tracking-[0.06em]"
      style={{ backgroundColor: colors.bg, color: colors.text }}
    >
      {REVIEW_STATUS_LABELS[status]}
    </span>
  );
}

export default function QueueList({
  items,
  selectedId,
}: {
  items: DossierItem[];
  selectedId: string | null;
}) {
  const [filter, setFilter] = useState<ReviewStatus | null>(null);

  const visible = filter
    ? items.filter((i) => i.reviewStatus === filter)
    : items;
  // R14: badge = everyone still gated from the deposit (pre-`offered`);
  // per-chip counts break the total down by stage.
  const { needsReview, byStage } = queueCounts(items);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="font-serif text-[28px] font-normal tracking-[-0.01em] text-crm-ink">
          Dossier queue
        </h1>
        <span className="flex items-baseline gap-2.5">
          {needsReview > 0 && (
            <span className="whitespace-nowrap rounded-full bg-crm-red px-2.5 py-[3px] font-mono text-[10px] uppercase tracking-[0.06em] text-white">
              Needs review · {needsReview}
            </span>
          )}
          <span className="whitespace-nowrap font-mono text-[10.5px] uppercase text-crm-faint">
            {visible.length} of {items.length}{" "}
            {items.length === 1 ? "dossier" : "dossiers"}
          </span>
        </span>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by review stage">
        <Chip active={filter === null} onClick={() => setFilter(null)}>
          All
        </Chip>
        {QUEUE_STAGES.map((stage) => (
          <Chip
            key={stage}
            active={filter === stage}
            onClick={() => setFilter(filter === stage ? null : stage)}
          >
            {REVIEW_STATUS_LABELS[stage]}
            {byStage[stage] > 0 ? ` · ${byStage[stage]}` : ""}
          </Chip>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {visible.length === 0 ? (
          <p className="px-1 py-6 font-mono text-[10.5px] uppercase tracking-[0.08em] text-crm-faint">
            No dossiers in this stage.
          </p>
        ) : (
          visible.map((item) => {
            const selected = item.childId === selectedId;
            return (
              <Link
                key={item.childId}
                href={`/crm/dossiers?child=${item.childId}`}
                scroll={false}
                aria-current={selected ? "true" : undefined}
                className={`flex items-center gap-3 rounded-[12px] border px-4 py-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-crm-blue ${
                  selected
                    ? "border-crm-blue bg-white shadow-[0_2px_10px_rgba(3,0,237,0.10)]"
                    : "border-crm-line bg-crm-card hover:border-crm-line2"
                }`}
              >
                <span className="flex min-w-0 flex-col gap-0.5 text-left">
                  <span className="truncate text-[15.5px] font-semibold text-crm-ink">
                    {item.name}
                  </span>
                  <span className="truncate text-[12.5px] text-crm-faint">
                    {item.grade != null ? `Grade ${item.grade}` : "Grade —"}
                    {item.school ? ` · ${item.school}` : ""}
                  </span>
                </span>
                <span className="ml-auto flex flex-none items-center gap-2.5">
                  <span className="whitespace-nowrap font-mono text-[10px] text-crm-faint">
                    {fmtDay(item.submittedAt ?? item.createdAt)}
                  </span>
                  <ReviewPill status={item.reviewStatus} />
                </span>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
