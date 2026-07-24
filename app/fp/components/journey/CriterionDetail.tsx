"use client";

/**
 * Criterion detail (T1 Unit 14) — Trail renders the Landmark (handoff surface
 * 04: steps on parchment, the glowing current step, the locked crest panel);
 * HQ renders the criterion as a founder's sheet (task cards in sequence).
 * Wisdom cards are T2 and deliberately absent (scope boundary).
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Crest } from "@/app/fp/components/system/Crest";
import { HQTaskCard } from "@/app/fp/components/hq/HQTaskCard";
import { Icon } from "@/app/fp/components/system/Icon";
import { TrailStep } from "@/app/fp/components/trail/TrailStep";
import { phaseByKey, phaseColor, phaseColorAlpha } from "@/app/fp/components/system/phases";
import type { PhaseKey } from "@/app/fp/content/types";
import type { CriterionStatus } from "@/app/fp/lib/now-card-rules";
import type { Skin } from "@/app/fp/lib/skin-tokens";
import type { TaskState } from "@/app/fp/lib/transition-table";

export type CriterionTaskItem = {
  id: string;
  seq: number;
  title: string;
  body: string;
  doneWhen: string;
  state: TaskState;
};

export type CriterionDetailProps = {
  skin: Skin;
  criterionId: string;
  title: string;
  detail: string | null;
  status: CriterionStatus;
  phaseKey: PhaseKey;
  verifiedCount: number;
  taskTotal: number;
  tasks: CriterionTaskItem[];
  /** The step the surface treats as current (the Now task when it lives here). */
  currentTaskId: string | null;
};

export function CriterionDetail(props: CriterionDetailProps) {
  return props.skin === "trail" ? <TrailLandmark {...props} /> : <HQCriterionSheet {...props} />;
}

function TrailLandmark({
  criterionId,
  title,
  detail,
  status,
  phaseKey,
  tasks,
  currentTaskId,
}: CriterionDetailProps) {
  const router = useRouter();
  const meta = phaseByKey(phaseKey);
  const color = phaseColor(phaseKey);
  const current = tasks.find((t) => t.id === currentTaskId) ?? null;
  const allVerified = tasks.every((t) => t.state === "verified");

  return (
    <div className="pb-8">
      <Link
        href="/fp"
        className="mb-1 mt-2 flex items-center gap-1.5 py-2 font-path-body text-[12.5px] font-semibold text-trail-ink-soft"
      >
        <Icon name="chevron-left" size={16} />
        Territory map
      </Link>
      <div className="font-path-mono text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color }}>
        {meta.territory}
      </div>
      <h2 className="mb-1 mt-1 font-path-display text-2xl font-semibold text-trail-ink">
        Landmark {criterionId} · {title}
      </h2>
      {detail && (
        <p className="mb-4 font-path-body text-[13px] leading-relaxed text-trail-ink-soft">{detail}</p>
      )}

      <div className="mb-4 flex justify-between gap-1.5">
        {tasks.map((t) => (
          <TrailStep
            key={t.id}
            index={t.seq}
            state={t.id === currentTaskId && t.state === "available" ? "available" : t.state}
            phase={phaseKey}
            label={t.title}
            onClick={t.state === "locked" ? undefined : () => router.push(`/fp/task/${t.id}`)}
          />
        ))}
      </div>

      {current && (
        <div className="mb-4 rounded-[20px] border-2 border-trail-ink/15 bg-trail-surface p-4 shadow-trail">
          <div className="mb-2 flex items-center gap-2">
            <span
              className="rounded-md px-2 py-0.5 font-path-mono text-xs font-semibold text-white"
              style={{ backgroundColor: color }}
            >
              {current.id}
            </span>
            <span className="font-path-body text-[11px] font-semibold uppercase tracking-[0.05em]" style={{ color }}>
              {current.state === "submitted" ? "In for review" : "The glowing step"}
            </span>
          </div>
          <div className="mb-2 font-path-display text-xl font-semibold text-trail-ink">{current.title}</div>
          <div
            className="mb-3.5 rounded-r-[10px] border-l-[3px] px-3 py-2"
            style={{ borderColor: color, backgroundColor: phaseColorAlpha(phaseKey, 0.07) }}
          >
            <div className="mb-0.5 font-path-body text-[9.5px] font-bold uppercase tracking-[0.08em]" style={{ color }}>
              Done when
            </div>
            <p className="font-path-body text-[12.5px] leading-snug text-trail-ink">{current.doneWhen}</p>
          </div>
          <Link
            href={`/fp/task/${current.id}`}
            className="block w-full rounded-xl py-2.5 text-center font-path-body text-sm font-semibold text-white hover:brightness-105"
            style={{ backgroundColor: color }}
          >
            Open this step
          </Link>
        </div>
      )}

      <div className="flex items-center gap-3.5 rounded-[18px] border-2 border-dashed border-trail-ink/20 bg-trail-surface p-4">
        <Crest phase={phaseKey} criterion={criterionId} skin="trail" size={60} locked={status !== "cleared"} />
        <div className="flex-1">
          <div className="font-path-body text-[13px] font-semibold text-trail-ink">The {criterionId} crest</div>
          <p className="font-path-body text-[11.5px] leading-snug text-trail-ink-soft">
            {status === "cleared"
              ? "Yours. Every step stamped and the landmark reviewed."
              : status === "in_review" || (allVerified && status === "active")
                ? "Every step is in — a parent is reviewing the landmark now."
                : status === "returned"
                  ? "The review sent one step back. Fix it up and the crest is still yours."
                  : `Clear all ${tasks.length} steps and a parent reviews the landmark — then this crest is yours.`}
          </p>
        </div>
      </div>
    </div>
  );
}

function HQCriterionSheet({
  criterionId,
  title,
  detail,
  status,
  phaseKey,
  verifiedCount,
  taskTotal,
  tasks,
  currentTaskId,
}: CriterionDetailProps) {
  const router = useRouter();
  const color = phaseColor(phaseKey);

  return (
    <div className="pb-8">
      <Link
        href="/fp"
        className="mb-1.5 mt-2 flex items-center gap-1.5 py-2 font-path-body text-[12.5px] font-semibold text-hq-ink-soft"
      >
        <Icon name="chevron-left" size={16} />
        Dashboard
      </Link>
      <div className="mb-2 flex items-center gap-2">
        <span
          className="rounded-md px-2 py-0.5 font-path-mono text-[13px] font-semibold text-white"
          style={{ backgroundColor: color }}
        >
          {criterionId}
        </span>
        <span className="font-path-mono text-xs text-hq-ink-muted">
          {verifiedCount}/{taskTotal} verified
        </span>
        {status === "in_review" && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-awaiting/25 bg-awaiting/10 px-2.5 py-1 font-path-body text-xs font-medium text-awaiting">
            Review underway
          </span>
        )}
        {status === "returned" && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-not-yet/30 bg-not-yet/10 px-2.5 py-1 font-path-body text-xs font-medium text-not-yet">
            Returned — one task reopened
          </span>
        )}
      </div>
      <h2 className="font-path-display text-2xl font-semibold tracking-tight text-hq-ink">{title}</h2>
      {detail && <p className="mt-1.5 font-path-body text-[13.5px] leading-relaxed text-hq-ink-soft">{detail}</p>}

      <div className="mt-5 flex flex-col gap-3">
        {tasks.map((t) => (
          <HQTaskCard
            key={t.id}
            task={{
              id: t.id,
              title: t.title,
              body: t.body,
              doneWhen: t.doneWhen,
              state: t.state,
              phase: phaseKey,
            }}
            now={t.id === currentTaskId}
            onOpen={t.state === "locked" ? undefined : () => router.push(`/fp/task/${t.id}`)}
          />
        ))}
      </div>

      <p className="mt-5 font-path-body text-xs text-hq-ink-muted">
        {status === "cleared"
          ? "Criterion cleared — crest awarded."
          : `Clear all ${taskTotal} tasks and a parent reviews the criterion.`}
      </p>
    </div>
  );
}
