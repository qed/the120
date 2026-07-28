"use client";

import type { PhaseKey } from "@/app/fp/content/types";
import { fwPhaseLabel, fwPhaseSlug } from "@/app/fp/lib/fw-nav-rules";

/**
 * The phase nav (ops-guide redesign Unit 8; R19, R23) — the SECOND left nav of
 * the student view: the five phases as single words (Sell / Build / Validate /
 * Grow / Scale), sitting beside the student sidebar on `lg`+ and collapsing to
 * a horizontal strip below it, so at 375px switching phases stays ONE tap (a
 * vertical rail there would push the steps below the fold; a drawer would cost
 * an opening tap per switch — both fail the R23 loop).
 *
 * PHASE SELECTION IS URL STATE (?phase=sell), NOT ephemeral client state — the
 * documented Unit 8 choice. Three reasons, all offline-shaped: a reload on
 * venue wifi restores the phase; a SW-cached shell replays the URL it was
 * cached under, so the restored page opens where the guide left it; and the
 * retired task route's redirect can land a guide on the RIGHT phase by writing
 * nothing but a query param. The parent owns the selected key and updates the
 * URL via `history.replaceState` — Next's App Router supports native history
 * updates without a server round trip, which matters because a router.push
 * would re-fetch the page per switch and fail entirely mid-outage. This
 * component only renders and reports taps.
 *
 * NOTHING HERE DECIDES ANYTHING: labels and slugs come from `fw-nav-rules.ts`
 * (`fwPhaseLabel` / `fwPhaseSlug`), selection resolution from
 * `fwSelectedPhaseKey` in the parent — all pure and tested.
 */
export default function FwPhaseNav({
  phases,
  activeKey,
  onSelect,
}: {
  /** From `buildFwTaskTree` — the student's PINNED program, so the nav can never
   *  offer a phase this student's curriculum does not have. */
  phases: readonly {
    key: PhaseKey;
    num: string;
    verified: number;
    notYet: number;
    total: number;
  }[];
  activeKey: PhaseKey | null;
  onSelect: (key: PhaseKey) => void;
}) {
  return (
    <nav
      aria-label="Phases"
      className="min-w-0 lg:w-[128px] lg:shrink-0"
    >
      <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:gap-1.5 lg:overflow-visible lg:pb-0">
        {phases.map((phase) => {
          const active = phase.key === activeKey;
          return (
            <li key={phase.key} className="shrink-0 lg:shrink">
              <button
                type="button"
                onClick={() => onSelect(phase.key)}
                // aria-current="true" (not "page"): selection is a query param,
                // not a distinct page — "page" would claim a navigation the URL
                // bar does not show.
                aria-current={active ? "true" : undefined}
                data-phase={fwPhaseSlug(phase.key)}
                className={
                  active
                    ? "flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg bg-hq-ink px-3 py-2 text-left font-path-body text-sm font-semibold text-white shadow-hq"
                    : "flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left font-path-body text-sm font-medium text-hq-ink transition-colors hover:bg-hq-sunken active:bg-hq-sunken"
                }
              >
                <span>{fwPhaseLabel(phase.key)}</span>
                <span
                  className={
                    active
                      ? "font-path-mono text-[10px] uppercase tracking-[0.08em] text-white/70"
                      : "font-path-mono text-[10px] uppercase tracking-[0.08em] text-hq-ink-muted"
                  }
                >
                  {phase.verified}/{phase.total}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
