"use client";

/**
 * HQ · Dashboard (T1 Unit 14) — the founder dashboard, ported from handoff
 * surface 07: the n/125 credential meter, the ONE prominent Now card, and the
 * five-phase progress ledger. Criterion chips under the active phase are the
 * T1 navigation into parallel criteria (criteria run in parallel within a
 * phase — the Now card alone must not be the only door).
 *
 * First-run (0/125): the FirstRunHero replaces the Now card's mid-program
 * framing — never mid-program components with empty props.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/app/path/components/system/cn";
import { HQTaskCard } from "@/app/path/components/hq/HQTaskCard";
import { PhaseRow } from "@/app/path/components/hq/PhaseRow";
import { ProgressMeter } from "@/app/path/components/system/ProgressMeter";
import { phaseColor } from "@/app/path/components/system/phases";
import { FirstRunHero, JourneyNotReady, NoOpenTasks } from "@/app/path/components/EmptyStates";
import type { JourneyPhaseCard, NowCardData } from "@/app/path/lib/journey-view-types";
import type { JourneyPresentation } from "@/app/path/lib/now-card-rules";

export function HQDashboard({
  firstName,
  gradeLabel,
  verifiedTotal,
  totalTasks,
  presentation,
  now,
  phases,
}: {
  firstName: string;
  gradeLabel: string | null;
  verifiedTotal: number;
  totalTasks: number;
  presentation: JourneyPresentation;
  now: NowCardData | null;
  phases: JourneyPhaseCard[];
}) {
  const router = useRouter();
  const firstCriterion = phases[0]?.criteria[0];

  return (
    <div className="pb-8">
      {/* scene header (prototype: name · grade, HQ pill lives in the shell) */}
      <div className="mb-4 mt-2">
        <div className="font-path-display text-base font-semibold leading-none text-hq-ink">
          {firstName || "Your HQ"}
        </div>
        {gradeLabel && <div className="mt-1 font-path-body text-[10.5px] text-hq-ink-muted">{gradeLabel}</div>}
      </div>

      <div className="mb-4 rounded-xl border border-hq-border bg-hq-canvas px-4 py-3 shadow-hq">
        <ProgressMeter value={verifiedTotal} total={totalTasks} label="verified" />
      </div>

      {presentation === "not_ready" && <JourneyNotReady skin="hq" firstName={firstName} />}
      {presentation === "first_run" && firstCriterion && (
        <FirstRunHero
          skin="hq"
          firstName={firstName}
          firstCriterionId={firstCriterion.id}
          firstCriterionTitle={firstCriterion.title}
        />
      )}

      {now ? (
        <>
          <div
            className="mb-2.5 mt-1 font-path-mono text-[11px] font-bold uppercase tracking-[0.09em]"
            style={{ color: phaseColor(now.phaseKey) }}
          >
            Now{now.pinned ? " · pinned" : ""}
          </div>
          <HQTaskCard
            task={{
              id: now.taskId,
              title: now.title,
              body: now.body,
              doneWhen: now.doneWhen,
              bandVariant: now.variant ?? undefined,
              state: now.state,
              phase: now.phaseKey,
              liveMoment: now.liveMoment,
            }}
            now
            onOpen={() => router.push(`/path/task/${now.taskId}`)}
          />
        </>
      ) : (
        presentation === "mid_program" && <NoOpenTasks skin="hq" />
      )}

      <div className="mb-2.5 mt-6 font-path-body text-[12.5px] font-semibold text-hq-ink">Your Path</div>
      <div className="flex flex-col gap-2.5">
        {phases.map((phase) => (
          <div key={phase.num}>
            <PhaseRow
              phase={phase.key}
              criteriaCleared={phase.criteriaComplete}
              tasksVerified={phase.tasksVerified}
              tasksTotal={phase.tasksTotal}
              status={phase.status === "complete" ? "active" : phase.status}
            />
            {phase.status === "active" && (
              <div className="mt-1.5 flex flex-wrap gap-1.5 px-1">
                {phase.criteria.map((c) => {
                  const open = c.status !== "locked";
                  const chip = (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-path-mono text-[11px]",
                        open
                          ? "border-hq-border bg-hq-canvas text-hq-ink hover:border-hq-border-strong"
                          : "border-hq-border bg-hq-sunken text-hq-ink-muted"
                      )}
                    >
                      {c.id}
                      <span className="font-path-body text-[10px] text-hq-ink-muted">
                        {c.verifiedCount}/{c.taskTotal}
                      </span>
                    </span>
                  );
                  return open ? (
                    <Link key={c.id} href={`/path/criterion/${c.id}`} aria-label={`Criterion ${c.id} · ${c.title}`}>
                      {chip}
                    </Link>
                  ) : (
                    <span key={c.id}>{chip}</span>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
