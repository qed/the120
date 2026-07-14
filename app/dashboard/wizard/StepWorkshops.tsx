"use client";

import { useState } from "react";
import { WORKSHOPS } from "../data";
import {
  DEFAULT_TRACK,
  TRACK_FILTERS,
  WORKSHOP_MAX,
  filterWorkshops,
  sanitizeWorkshopSelection,
  type TrackFilter,
} from "../wizard-rules";
import { StepSection, focusRing, type StepProps } from "./shared";

/**
 * The workshops explore (Scholars only, R5–R9): one track visible at a time
 * (Sciences first, no "All tracks"), no grade machinery, and a hard cap of
 * WORKSHOP_MAX picks. At the cap, unselected cards dim with aria-disabled —
 * they stay in the tab order and announce their state — and the sticky
 * selection bar in DossierEditor carries the explanatory note, so a 4th tap
 * is never a silent no-op.
 *
 * `editable` mirrors DossierEditor's stepEditable: when true, the selection
 * renders/writes through sanitizeWorkshopSelection so legacy rows (>3 picks,
 * retired K–2 ids) converge on the next save; when false (deposit-locked
 * browse) the raw stored selection is shown untouched.
 */
export default function StepWorkshops({
  child,
  set,
  n,
  editable = true,
}: StepProps & { editable?: boolean }) {
  const [track, setTrack] = useState<TrackFilter>(DEFAULT_TRACK);

  const matches = filterWorkshops(WORKSHOPS, track);
  const selected = editable
    ? sanitizeWorkshopSelection(child.workshopIds)
    : child.workshopIds;
  const atCap = selected.length >= WORKSHOP_MAX;

  const toggleWorkshop = (id: string) => {
    if (!editable) return;
    if (selected.includes(id)) {
      set({ workshopIds: selected.filter((x) => x !== id) });
    } else if (!atCap) {
      set({ workshopIds: [...selected, id] });
    }
    // At the cap an unselected card is aria-disabled; the sticky bar's
    // persistent note explains why the tap does nothing.
  };

  const chip = (on: boolean) =>
    `rounded-full border px-3.5 py-1.5 font-mono text-xs uppercase tracking-[0.08em] transition-colors ${focusRing} ${
      on ? "border-red bg-red text-white" : "border-line-strong text-ink-soft hover:border-ink"
    }`;

  return (
    <StepSection
      n={n}
      title="Workshops of interest"
      hint={
        <>
          Express interest — this isn&rsquo;t scheduling.{" "}
          <span className="font-mono text-xs uppercase tracking-[0.08em] text-red">
            Pick up to {WORKSHOP_MAX}.
          </span>
        </>
      }
    >
      {/* One single-select track row — a track is always active (R7) */}
      <div role="radiogroup" aria-label="Filter by track" className="flex flex-wrap gap-2">
        {TRACK_FILTERS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={track === t.id}
            onClick={() => setTrack(t.id)}
            className={chip(track === t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {matches.map((w) => {
          const on = selected.includes(w.id);
          const capBlocked = editable && atCap && !on;
          return (
            <button
              key={w.id}
              type="button"
              onClick={() => toggleWorkshop(w.id)}
              aria-pressed={on}
              aria-disabled={capBlocked || undefined}
              className={`rounded-xl border p-4 text-left transition-colors ${focusRing} ${
                on
                  ? "border-red bg-red/5"
                  : capBlocked
                    ? "border-line bg-white opacity-50"
                    : "border-line-strong bg-white hover:border-ink"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-display text-sm font-bold text-ink">{w.title}</span>
                <span
                  aria-hidden
                  className={`mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full border text-[0.55rem] ${
                    on ? "border-red bg-red text-white" : "border-line-strong text-transparent"
                  }`}
                >
                  ✓
                </span>
              </div>
              <p className="mt-1 font-mono text-[0.65rem] uppercase tracking-[0.08em] text-muted">
                {w.track} · {w.length}
              </p>
              <p className="mt-2 text-xs leading-5 text-ink-soft">{w.description}</p>
              <p className="mt-2 font-mono text-[0.65rem] text-red">{w.advisor}</p>
              {w.audition && (
                <span className="mt-2 inline-block rounded-full bg-blue/10 px-2.5 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.08em] text-blue">
                  Audition required
                </span>
              )}
            </button>
          );
        })}
      </div>
    </StepSection>
  );
}
