"use client";

/**
 * Trail · Territory Map (T1 Unit 14) — the illustrated journey, ported from
 * handoff surface 03. Parchment; the active territory expands with a warm
 * gradient header and a schematic world motif (the brief's commissioned art
 * replaces it later — placeholder is explicit, R18–R20), five landmark pips,
 * and the current-landmark row with Enter. Later territories render as misted,
 * locked rows; a finished territory renders its honest completed state (the
 * SEAL ceremony is T2 — no fake wax here).
 *
 * First-run (0/125, nothing touched): territory revealed rather than fully
 * locked — the FirstRunHero invites the first act, and the first step glows.
 */

import Link from "next/link";
import { cn } from "@/app/path/components/system/cn";
import { Icon } from "@/app/path/components/system/Icon";
import { ProgressMeter } from "@/app/path/components/system/ProgressMeter";
import { phaseByKey, phaseColor, phaseColorAlpha } from "@/app/path/components/system/phases";
import { FirstRunHero, NoOpenTasks } from "@/app/path/components/EmptyStates";
import type { JourneyPhaseCard, NowCardData } from "./journey-view-types";

function LandmarkPip({
  n,
  status,
  isNow,
  color,
  href,
}: {
  n: number;
  status: "done" | "open" | "locked";
  isNow: boolean;
  color: string;
  href: string | null;
}) {
  const body = (
    <span
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-full border-2 font-path-mono text-[12px] font-semibold",
        status === "locked" && "border-trail-mist bg-trail-canvas text-trail-ink-soft/60",
        status === "done" && "border-wax bg-trail-surface text-wax",
        status === "open" && "bg-trail-surface"
      )}
      style={
        status === "open"
          ? {
              borderColor: color,
              color,
              boxShadow: isNow ? `0 0 0 5px ${phaseColorAlpha("SELL", 0.0)}, 0 0 0 4px ${color}22, 0 0 16px ${color}55` : undefined,
            }
          : undefined
      }
      aria-hidden
    >
      {status === "done" ? <Icon name="stamp" size={15} /> : n}
    </span>
  );
  if (!href) return body;
  return (
    <Link href={href} aria-label={`Landmark ${n}`}>
      {body}
    </Link>
  );
}

export function TrailTerritoryMap({
  firstName,
  gradeLabel,
  verifiedTotal,
  totalTasks,
  firstRun,
  now,
  phases,
}: {
  firstName: string;
  gradeLabel: string | null;
  verifiedTotal: number;
  totalTasks: number;
  firstRun: boolean;
  now: NowCardData | null;
  phases: JourneyPhaseCard[];
}) {
  const active = phases.find((p) => p.status === "active");
  // The landmark row points at the Now criterion when it lives in the active
  // phase, else the first not-finished criterion — there is always a "now" row
  // while the phase is active.
  const nowCriterion =
    (now && active?.criteria.find((c) => c.id === now.criterionId)) ??
    active?.criteria.find((c) => c.verifiedCount < c.taskTotal) ??
    active?.criteria[0];

  const firstCriterion = phases[0]?.criteria[0];

  return (
    <div className="pb-8">
      {/* scene header (prototype: name · grade · stamps so far) */}
      <div className="mb-4 mt-2 flex items-center justify-between">
        <div>
          <div className="font-path-display text-base font-semibold leading-none text-trail-ink">
            {firstName ? `${firstName}'s Trail` : "Your Trail"}
          </div>
          <div className="mt-1 font-path-body text-[10.5px] text-trail-ink-soft">
            {[gradeLabel, `${verifiedTotal} ${verifiedTotal === 1 ? "stamp" : "stamps"} so far`]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
      </div>

      <div className="mb-4 rounded-2xl border-2 border-trail-ink/10 bg-trail-surface px-3.5 py-3 shadow-trail">
        <ProgressMeter value={verifiedTotal} total={totalTasks} label="stamped" />
      </div>

      {firstRun && firstCriterion && (
        <FirstRunHero
          skin="trail"
          firstName={firstName}
          firstCriterionId={firstCriterion.id}
          firstCriterionTitle={firstCriterion.title}
        />
      )}

      <div className="font-path-mono text-[11px] font-bold uppercase tracking-[0.08em] text-phase-sell">
        Your journey
      </div>
      <h2 className="mb-4 mt-1 font-path-display text-[23px] font-semibold text-trail-ink">Five territories</h2>

      {phases.map((phase, i) => {
        const meta = phaseByKey(phase.key);
        const color = phaseColor(phase.key);
        const prev = i > 0 ? phaseByKey(phases[i - 1].key) : null;

        if (phase.status === "active") {
          return (
            <section
              key={phase.num}
              className="mb-4 overflow-hidden rounded-[20px] border-2 border-trail-ink/15 shadow-trail"
            >
              {/* schematic territory art — placeholder for commissioned illustration */}
              <div
                className="relative h-[76px] overflow-hidden"
                style={{ background: `linear-gradient(180deg, ${phaseColorAlpha(phase.key, 0.85)}, ${color})` }}
              >
                <svg
                  viewBox="0 0 320 76"
                  preserveAspectRatio="xMidYMax slice"
                  className="absolute inset-0 h-full w-full"
                  aria-hidden
                >
                  <circle cx="266" cy="26" r="15" fill="hsl(41 90% 70%)" />
                  <g fill="hsl(30 60% 96%)" opacity="0.92">
                    <path d="M24 76V52h30v24z" />
                    <path d="M20 52h38l-6-10H26z" />
                    <path d="M78 76V56h26v20z" />
                    <path d="M74 56h34l-5-9H79z" />
                    <path d="M128 76V50h30v26z" />
                    <path d="M124 50h38l-6-10h-26z" />
                  </g>
                  <path d="M0 66h320" stroke="rgba(0,0,0,0.18)" strokeWidth="2" />
                </svg>
              </div>
              <div className="bg-trail-surface p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-baseline gap-2">
                    <span className="font-path-mono text-[15px] font-semibold" style={{ color }}>
                      {phase.num}
                    </span>
                    <span className="font-path-display text-xl font-semibold tracking-wide text-trail-ink">
                      {meta.name}
                    </span>
                  </div>
                  <span
                    className="flex items-center gap-1.5 rounded-full px-2.5 py-1 font-path-body text-[10.5px] font-semibold text-white"
                    style={{ backgroundColor: color }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden />
                    You are here
                  </span>
                </div>
                <p className="mb-3.5 font-path-body text-[12.5px] text-trail-ink-soft">
                  {meta.territory} — {meta.tagline}
                </p>
                <div className="mb-4 flex justify-between gap-1.5">
                  {phase.criteria.map((c) => (
                    <LandmarkPip
                      key={c.id}
                      n={c.seq}
                      status={
                        c.verifiedCount === c.taskTotal ? "done" : c.status === "locked" ? "locked" : "open"
                      }
                      isNow={now?.criterionId === c.id}
                      color={color}
                      href={c.status === "locked" ? null : `/path/criterion/${c.id}`}
                    />
                  ))}
                </div>
                {nowCriterion ? (
                  <div
                    className="flex items-center gap-3 rounded-[13px] border-[1.5px] bg-trail-canvas px-3 py-2.5"
                    style={{ borderColor: phaseColorAlpha(phase.key, 0.3) }}
                  >
                    <span className="min-w-0 flex-1">
                      <span
                        className="font-path-body text-[10px] font-bold uppercase tracking-[0.06em]"
                        style={{ color }}
                      >
                        Landmark {nowCriterion.id} · now
                      </span>
                      <span className="block truncate font-path-body text-[13.5px] font-semibold text-trail-ink">
                        {nowCriterion.title} · {nowCriterion.verifiedCount} of {nowCriterion.taskTotal} steps
                      </span>
                    </span>
                    <Link
                      href={`/path/criterion/${nowCriterion.id}`}
                      className="rounded-lg px-3.5 py-2 font-path-body text-sm font-semibold text-white hover:brightness-105"
                      style={{ backgroundColor: color }}
                    >
                      Enter
                    </Link>
                  </div>
                ) : (
                  <NoOpenTasks skin="trail" />
                )}
              </div>
            </section>
          );
        }

        if (phase.status === "complete") {
          return (
            <section
              key={phase.num}
              className="mb-3 flex items-center gap-3 rounded-[18px] border-2 border-trail-ink/10 bg-trail-surface px-4 py-3.5"
            >
              <span
                className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border-2 border-wax bg-trail-canvas text-wax"
                aria-hidden
              >
                <Icon name="stamp" size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-path-mono text-xs font-semibold text-trail-ink-soft">{phase.num}</span>
                  <span className="font-path-display text-base font-semibold tracking-wide text-trail-ink">
                    {meta.name}
                  </span>
                </div>
                <div className="font-path-body text-[11.5px] text-trail-ink-soft">
                  {meta.territory} · every step stamped
                </div>
              </div>
              <span className="font-path-mono text-[11px] text-trail-ink-soft">
                {phase.tasksVerified}/{phase.tasksTotal}
              </span>
            </section>
          );
        }

        return (
          <section
            key={phase.num}
            className="mb-3 flex items-center gap-3 rounded-[18px] border-2 border-trail-ink/10 bg-trail-surface px-4 py-3.5 opacity-60"
          >
            <span
              className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border-2 border-dashed border-trail-mist bg-trail-canvas text-trail-ink-soft"
              aria-hidden
            >
              <Icon name="lock" size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="font-path-mono text-xs font-semibold text-trail-ink-soft">{phase.num}</span>
                <span className="font-path-display text-base font-semibold tracking-wide text-trail-ink">
                  {meta.name}
                </span>
              </div>
              <div className="font-path-body text-[11.5px] text-trail-ink-soft">{meta.territory}</div>
            </div>
            <span className="max-w-[80px] text-right font-path-body text-[10px] leading-tight text-trail-ink-soft">
              opens when {prev?.name ?? "the last territory"} is sealed
            </span>
          </section>
        );
      })}
    </div>
  );
}
