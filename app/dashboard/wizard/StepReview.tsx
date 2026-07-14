"use client";

import { childName, type Child } from "../data";
import { stepForChecklistLabel, type WizardStepId } from "../wizard-rules";
import { StepSection, focusRing } from "./shared";

/**
 * Unit 3 — Review & Submit. Full checklist with incomplete items
 * deep-linking to their owning step; Submit runs the same explicit-save
 * state machine as Next (rendered locked only on a confirmed {ok: true}).
 */
export default function StepReview({
  child,
  items,
  pct,
  locked,
  n,
  submitState,
  submitError,
  onJump,
  onPreview,
  onSubmit,
  onRemove,
}: {
  child: Child;
  items: { label: string; done: boolean }[];
  pct: number;
  locked: boolean;
  n: string;
  submitState: "idle" | "saving" | "error";
  submitError: string | null;
  onJump: (step: WizardStepId) => void;
  onPreview: () => void;
  onSubmit: () => void;
  onRemove: () => void;
}) {
  const canSubmit = pct === 100 && !locked && submitState !== "saving";

  return (
    <StepSection
      n={n}
      title="Review & submit"
      hint={
        locked
          ? "This dossier is with the review team."
          : "Everything below must be checked off before the dossier can go in."
      }
    >
      <ul className="grid gap-2 sm:grid-cols-2">
        {items.map((i) => (
          <li key={i.label} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden
              className={`flex h-4 w-4 flex-none items-center justify-center rounded-full text-[0.6rem] ${
                i.done ? "bg-red text-white" : "border border-line-strong text-transparent"
              }`}
            >
              ✓
            </span>
            {i.done ? (
              <span className="text-muted line-through">{i.label}</span>
            ) : (
              <button
                type="button"
                onClick={() => onJump(stepForChecklistLabel(i.label))}
                className={`rounded text-left text-ink-soft underline decoration-line-strong underline-offset-2 hover:text-red hover:decoration-red ${focusRing}`}
              >
                {i.label} →
              </button>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onPreview}
          className={`inline-flex h-12 items-center justify-center rounded-full border border-line-strong px-6 font-mono text-xs uppercase tracking-[0.12em] text-ink hover:border-ink ${focusRing}`}
        >
          Preview dossier
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          className={`inline-flex h-12 items-center justify-center rounded-full bg-red px-6 font-mono text-xs uppercase tracking-[0.12em] text-white hover:bg-red-dark disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`}
        >
          {locked ? "Submitted" : submitState === "saving" ? "Submitting…" : "Submit for review"}
        </button>
        {submitState === "error" && submitError && (
          <p role="alert" className="w-full text-sm text-red">
            {submitError} — your dossier is safe; press Submit to retry.
          </p>
        )}
        {pct !== 100 && !locked && (
          <p className="w-full font-mono text-[0.7rem] text-muted">
            Complete the dossier (100%) to submit for review.
          </p>
        )}
      </div>

      <div className="mt-8 border-t border-line pt-4">
        <button
          type="button"
          onClick={() => {
            if (confirm(`Remove ${childName(child)}'s dossier? This cannot be undone.`)) onRemove();
          }}
          className={`rounded font-mono text-[0.7rem] uppercase tracking-[0.1em] text-muted hover:text-red ${focusRing}`}
        >
          Remove this child
        </button>
      </div>
    </StepSection>
  );
}
