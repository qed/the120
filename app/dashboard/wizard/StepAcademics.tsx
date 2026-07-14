"use client";

import { useEffect, useRef } from "react";
import { ACADEMIC_PLANS, ACADEMIC_SUBJECTS, type Academic } from "../data";
import { Label, TextArea, inputCls } from "../ui";
import { StepSection, focusRing, type StepProps } from "./shared";

const EMPTY_ENTRY: Academic = { subject: "", plan: "", goal: "" };

const isListedSubject = (s: string) =>
  ACADEMIC_SUBJECTS.includes(s as (typeof ACADEMIC_SUBJECTS)[number]);

/**
 * Unit 5 — structured Academics capture (R7–R9b): per entry a subject
 * (7 pills + free-text "Other"), one of three plans, and an optional goal.
 * Max 2 entries. Legacy drafts (subjects populated, academics empty) are
 * prefilled as plan-less entries on first render (written as academics —
 * `subjects` is never written again).
 */
export default function StepAcademics({ child, set, n }: StepProps) {
  // Legacy prefill (R14 old-shape drafts) — once per mount of this step.
  // One update carries both halves: the entries move into `academics` AND the
  // legacy `subjects` column empties, so the persisted row can never re-fire
  // this prefill (deleted legacy subjects stay deleted across remounts).
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current) return;
    prefilled.current = true;
    if (child.academics.length === 0 && child.subjects.length > 0) {
      set({
        academics: child.subjects.slice(0, 2).map((s) => ({ subject: s, plan: "", goal: "" })),
        subjects: [],
      });
    }
  }, [child.academics.length, child.subjects, set]);

  // Render at least one entry block; the pad is UI-only until the user edits.
  const entries = child.academics.length > 0 ? child.academics : [EMPTY_ENTRY];

  const updateEntry = (i: number, patch: Partial<Academic>) =>
    set({ academics: entries.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const addEntry = () => set({ academics: [...entries, EMPTY_ENTRY] });
  const removeEntry = (i: number) => set({ academics: entries.filter((_, j) => j !== i) });

  return (
    <StepSection
      n={n}
      title="Academics"
      hint="We help you: Choose a subject (or 2) and a project the next year."
    >
      <div className="space-y-5">
        {entries.map((entry, i) => (
          <div key={i} className="rounded-xl border border-line bg-paper-2/60 p-4">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted">
                Subject {i + 1} of 2
              </p>
              {entries.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeEntry(i)}
                  aria-label={`Remove subject ${i + 1}`}
                  className={`rounded font-mono text-xs text-muted hover:text-red ${focusRing}`}
                >
                  ✕
                </button>
              )}
            </div>

            {/* Subject pills in two rows (R4): math/science subjects first,
                language subjects second — ACADEMIC_SUBJECTS is ordered to
                match, so the rows are plain slices. Custom "Other" below. */}
            <div className="mt-3 space-y-2">
              {[ACADEMIC_SUBJECTS.slice(0, 3), ACADEMIC_SUBJECTS.slice(3)].map((row, r) => (
                <div key={r} className="flex flex-wrap gap-2">
                  {row.map((s) => {
                    const on = entry.subject === s;
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => updateEntry(i, { subject: on ? "" : s })}
                        aria-pressed={on}
                        className={`rounded-full border px-3.5 py-1.5 font-mono text-xs uppercase tracking-[0.08em] transition-colors ${focusRing} ${
                          on
                            ? "border-red bg-red text-white"
                            : "border-line-strong text-ink-soft hover:border-ink"
                        }`}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <input
              value={isListedSubject(entry.subject) ? "" : entry.subject}
              onChange={(e) => updateEntry(i, { subject: e.target.value })}
              placeholder="Other subject…"
              aria-label={`Other subject for entry ${i + 1}`}
              className={`${inputCls} mt-3 h-10`}
            />

            {/* Plan cards — single-select within the entry */}
            <div className="mt-4">
              <Label>The plan</Label>
              <div
                role="radiogroup"
                aria-label={`Plan for subject ${i + 1}`}
                className="grid gap-2 sm:grid-cols-3"
              >
                {ACADEMIC_PLANS.map((p) => {
                  const on = entry.plan === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => updateEntry(i, { plan: p.id })}
                      className={`rounded-xl border p-3 text-left transition-colors ${focusRing} ${
                        on ? "border-red bg-red/5" : "border-line-strong bg-white hover:border-ink"
                      }`}
                    >
                      <span className="font-display text-sm font-bold text-ink">{p.label}</span>
                      <p className="mt-1 text-xs leading-5 text-ink-soft">{p.blurb}</p>
                    </button>
                  );
                })}
              </div>
              {entry.subject.trim() !== "" && entry.plan === "" && (
                <p className="mt-2 font-mono text-[0.7rem] text-red">
                  Pick a plan to round out this subject.
                </p>
              )}
            </div>

            <div className="mt-4">
              <TextArea
                label="What do you want to accomplish with this Academic Project (optional)"
                value={entry.goal}
                onChange={(v) => updateEntry(i, { goal: v })}
                placeholder="Where should this subject be a year from now?"
                rows={2}
                maxLength={1500}
              />
            </div>
          </div>
        ))}

        {entries.length < 2 && (
          <button
            type="button"
            onClick={addEntry}
            disabled={entries[0].subject.trim() === ""}
            className={`rounded-full border border-dashed border-line-strong px-4 py-2 font-mono text-xs uppercase tracking-[0.1em] text-ink-soft hover:border-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line-strong ${focusRing}`}
          >
            + Add another subject
          </button>
        )}
      </div>
    </StepSection>
  );
}
