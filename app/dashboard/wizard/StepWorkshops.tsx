"use client";

import { useState } from "react";
import { WORKSHOPS } from "../data";
import {
  GRADE_BANDS,
  TRACK_FILTERS,
  filterWorkshops,
  type GradeBandId,
  type TrackFilter,
} from "../wizard-rules";
import { StepSection, focusRing, type StepProps } from "./shared";

/**
 * Unit 6 — the GT-style workshops explore (Scholars only, R10–R13).
 * Two combinable single-select filter axes (Track × Grade band, range-overlap
 * matching) over a flat tap-to-select card grid with audition badges.
 */
export default function StepWorkshops({ child, set, n }: StepProps) {
  const [track, setTrack] = useState<TrackFilter>("all");
  const [band, setBand] = useState<GradeBandId>("all");

  const matches = filterWorkshops(WORKSHOPS, track, band);

  const toggleWorkshop = (id: string) =>
    set({
      workshopIds: child.workshopIds.includes(id)
        ? child.workshopIds.filter((x) => x !== id)
        : [...child.workshopIds, id],
    });

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
            Selected: {child.workshopIds.length}
          </span>
        </>
      }
    >
      {/* Filter chips: two single-select segmented controls, combinable */}
      <div className="space-y-2">
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
        <div role="radiogroup" aria-label="Filter by grade" className="flex flex-wrap gap-2">
          {GRADE_BANDS.map((b) => (
            <button
              key={b.id}
              type="button"
              role="radio"
              aria-checked={band === b.id}
              onClick={() => setBand(b.id)}
              className={chip(band === b.id)}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      {matches.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-line-strong bg-paper-2 p-6 text-center">
          <p className="text-sm text-ink-soft">No workshops match these filters.</p>
          <button
            type="button"
            onClick={() => {
              setTrack("all");
              setBand("all");
            }}
            className={`mt-3 inline-flex h-9 items-center justify-center rounded-full border border-line-strong px-4 font-mono text-xs uppercase tracking-[0.1em] text-ink hover:border-ink ${focusRing}`}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {matches.map((w) => {
            const on = child.workshopIds.includes(w.id);
            return (
              <button
                key={w.id}
                type="button"
                onClick={() => toggleWorkshop(w.id)}
                aria-pressed={on}
                className={`rounded-xl border p-4 text-left transition-colors ${focusRing} ${
                  on ? "border-red bg-red/5" : "border-line-strong bg-white hover:border-ink"
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
                  {w.track} · Grades {w.grades} · {w.length}
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
      )}
    </StepSection>
  );
}
