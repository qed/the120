"use client";

import { useEffect, useRef, useState } from "react";
import {
  checklist,
  childName,
  completeness,
  statusIndex,
  statusMeta,
  workshopById,
  type Child,
} from "./data";
import { useDashboard } from "./store";
import { Meter } from "./ui";
import {
  STEP_LABELS,
  WORKSHOP_MAX,
  firstIncompleteStep,
  resolveStep,
  sanitizeWorkshopSelection,
  stepsForGroup,
  type WizardStepId,
} from "./wizard-rules";
import { focusRing } from "./wizard/shared";
import StepBasics from "./wizard/StepBasics";
import StepGroup from "./wizard/StepGroup";
import StepAcademics from "./wizard/StepAcademics";
import StepWorkshops from "./wizard/StepWorkshops";
import StepProject from "./wizard/StepProject";
import StepReview from "./wizard/StepReview";

type SaveState = "idle" | "saving" | "error";

/* ---------- progress rail ---------- */

function WizardRail({
  steps,
  activeIdx,
  allNavigable,
  onSelect,
}: {
  steps: WizardStepId[];
  activeIdx: number;
  /** Locked wizard: every step stays clickable (read-only browse). */
  allNavigable: boolean;
  onSelect: (s: WizardStepId) => void;
}) {
  return (
    <nav aria-label="Dossier steps" className="mt-6">
      {/* Full rail ≥480px */}
      <ol className="hidden flex-wrap gap-x-2 gap-y-3 min-[480px]:flex">
        {steps.map((s, i) => {
          const done = i < activeIdx;
          const active = i === activeIdx;
          // Completed (already-passed) steps are revisitable; in the locked
          // wizard everything is.
          const clickable = allNavigable ? !active : done;
          const inner = (
            <>
              <span
                aria-hidden
                className={`flex h-6 w-6 flex-none items-center justify-center rounded-full font-mono text-[0.65rem] ${
                  active ? "bg-red text-white" : done ? "bg-blue text-white" : "bg-line text-muted"
                }`}
              >
                {done ? "✓" : i + 1}
              </span>
              <span
                className={`font-mono text-[0.65rem] uppercase tracking-[0.1em] ${
                  active ? "text-ink" : "text-muted"
                }`}
              >
                {STEP_LABELS[s]}
              </span>
            </>
          );
          return (
            <li key={s} className="flex items-center gap-2">
              {clickable ? (
                <button
                  type="button"
                  onClick={() => onSelect(s)}
                  aria-current={active ? "step" : undefined}
                  className={`flex items-center gap-2 rounded-full hover:opacity-80 ${focusRing}`}
                >
                  {inner}
                </button>
              ) : (
                <span aria-current={active ? "step" : undefined} className="flex items-center gap-2">
                  {inner}
                </span>
              )}
              {i < steps.length - 1 && (
                <span aria-hidden className="text-line-strong">
                  ·
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {/* Condensed under 480px */}
      <p
        aria-current="step"
        className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-ink min-[480px]:hidden"
      >
        Step {activeIdx + 1} of {steps.length} · {STEP_LABELS[steps[activeIdx]]}
      </p>
    </nav>
  );
}

/* ---------- wizard shell ---------- */

export default function DossierEditor({
  child,
  onBack,
  onPreview,
}: {
  child: Child;
  onBack: () => void;
  onPreview: () => void;
}) {
  const { updateChild, removeChild, saveChildNow, deposits } = useDashboard();

  // Resume: land on the first incomplete step (complete draft → Review).
  const [currentId, setCurrentId] = useState<WizardStepId>(() => firstIncompleteStep(child));
  // Set when a step was reached via a Review deep-link → "Back to review".
  const [reviewOrigin, setReviewOrigin] = useState<WizardStepId | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<SaveState>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Post-submit Group/Workshops save confirmation ("… updated ✓").
  const [lockedSavedStep, setLockedSavedStep] = useState<WizardStepId | null>(null);

  // Steps re-derive whenever the group changes; if the current step vanished
  // (Workshops after switching away from Scholars) route to its successor.
  const steps = stepsForGroup(child.groupSlug);
  const step = resolveStep(currentId, child.groupSlug);
  const idx = steps.indexOf(step);
  const nextStep = steps[idx + 1];

  // Stale-continuation guard: async save handlers compare the step they
  // started on against this ref after their await — if the user navigated
  // meanwhile (Back/rail), the finishing save must not yank navigation.
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  });

  const pct = completeness(child);
  const items = checklist(child);
  // The submitted/locked state renders only once the submit save confirmed
  // {ok: true} — while the Submit write is in flight the wizard stays open.
  const locked = child.status !== "draft" && submitState !== "saving";
  const depositPaid = deposits.some((d) => d.childId === child.id && d.status === "paid");
  /** Post-submit, only Group (and with it Workshops) stays editable until a
   *  paid deposit exists (R5/R6) — the DB group-lock guard is the real gate. */
  const stepEditable = (s: WizardStepId) =>
    !locked || (!depositPaid && (s === "group" || s === "workshops"));

  const set = (patch: Partial<Child>) => updateChild(child.id, patch);

  const goTo = (s: WizardStepId, opts?: { fromReview?: boolean }) => {
    setCurrentId(s);
    setReviewOrigin(opts?.fromReview ? s : null);
    setSaveState("idle");
    setSaveError(null);
    setLockedSavedStep(null);
  };

  /** Next: idle → saving (disabled) → advance on ok / stay with a retryable
   *  inline error on failure. In the locked wizard Next is free navigation —
   *  except on the still-editable steps (Group/Workshops pre-deposit), which
   *  save-then-advance like the unlocked wizard so a quick edit-then-Next
   *  never rides on the debounce with no error surfacing. */
  const goNext = async () => {
    if (!nextStep) return;
    if (locked && !stepEditable(step)) {
      goTo(nextStep);
      return;
    }
    setSaveState("saving");
    setSaveError(null);
    const startedOn = step;
    const res = await saveChildNow(child.id);
    if (stepRef.current !== startedOn) return; // user navigated during the save
    if (res.ok) {
      goTo(nextStep);
    } else {
      setSaveState("error");
      setSaveError(res.error ?? "Could not save.");
    }
  };

  const goBackStep = () => {
    if (idx > 0) goTo(steps[idx - 1]);
  };

  /** Explicit save for the locked-but-editable steps (post-submit group
   *  change): its own confirmation, since Next's advance feedback doesn't
   *  apply in the locked wizard. A paid-deposit group change is rejected by
   *  the DB guard and surfaces here as the inline error. */
  const saveLockedStep = async () => {
    setSaveState("saving");
    setSaveError(null);
    setLockedSavedStep(null);
    const startedOn = step;
    const res = await saveChildNow(child.id);
    if (stepRef.current !== startedOn) return; // user navigated during the save
    if (res.ok) {
      setSaveState("idle");
      setLockedSavedStep(startedOn);
    } else {
      setSaveState("error");
      setSaveError(res.error ?? "Could not save.");
    }
  };

  /** Submit: same state machine as Next. Status flips locally first, but the
   *  locked state renders only on a confirmed {ok: true}; on failure the
   *  local status reverts to draft with a retryable inline error. */
  const doSubmit = async () => {
    if (pct !== 100 || locked || submitState === "saving") return;
    setSubmitState("saving");
    setSubmitError(null);
    // updateChild updates the store's ref synchronously, so the explicit save
    // below sees the submitted status immediately. Only this save carries
    // status (includeStatus) — ordinary saves never round-trip it.
    updateChild(child.id, { status: "submitted", submittedAt: new Date().toISOString() });
    const res = await saveChildNow(child.id, { includeStatus: true });
    if (res.ok) {
      setSubmitState("idle");
      // R15: best-effort admissions notification — fire-and-forget (auth via
      // session cookie, like /api/checkout). A send failure must never affect
      // the submit UX; the CRM needs-review badge is the reliable signal.
      void fetch("/api/notify-submission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ childId: child.id }),
      }).catch(() => {});
    } else {
      updateChild(child.id, { status: "draft", submittedAt: undefined });
      setSubmitState("error");
      setSubmitError(res.error ?? "Could not submit.");
    }
  };

  const n = String(idx + 1).padStart(2, "0");
  const nextDisabled =
    saveState === "saving" || (!locked && step === "group" && child.groupSlug === "");

  /** Sticky selection bar state (workshops step only, R8/R9): the editable
   *  wizard views the selection through sanitize (legacy >3 / retired ids
   *  converge on the next save); the deposit-locked browse shows raw truth. */
  const workshopsEditable = stepEditable("workshops");
  const workshopSelection = workshopsEditable
    ? sanitizeWorkshopSelection(child.workshopIds)
    : child.workshopIds;
  const savingNow = saveState === "saving" || submitState === "saving";

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <button
        onClick={onBack}
        className={`rounded font-mono text-xs uppercase tracking-[0.12em] text-muted hover:text-ink ${focusRing}`}
      >
        ← All children
      </button>

      {/* Header + meter */}
      <div className="mt-4 flex flex-col gap-4 rounded-2xl border border-line bg-paper-2 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="eyebrow">Dossier</p>
          <h2 className="mt-1 font-display text-2xl font-bold tracking-tight text-ink">
            {childName(child)}
          </h2>
          <p className="mt-1 font-mono text-xs uppercase tracking-[0.1em] text-muted">
            Status · {statusMeta(child.status).label}
          </p>
        </div>
        <Meter value={pct} className="w-full sm:w-56" />
      </div>

      {locked && (
        <p className="mt-4 rounded-xl border border-line bg-white px-4 py-3 text-sm text-ink-soft">
          {depositPaid ? (
            <>
              This dossier is locked for review and the seat deposit is in — contact{" "}
              <span className="text-ink">admissions@the120.school</span> for any changes.
            </>
          ) : statusIndex(child.status) >= statusIndex("offered") ? (
            // Accepted, deposit pending — never say "we will review" here: the
            // dashboard CTA is simultaneously asking this family to pay (R12/R13).
            <>
              Your application has been accepted — reserve your seat from your dashboard. Your
              group choice can still be changed until a deposit is paid.
            </>
          ) : (
            // R10 — exact confirmation copy for submitted / in_review / invited.
            <>
              Thank you for your interest in joining The 120. We will review your submission and
              be in touch. Feel free to contact{" "}
              <span className="text-ink">admissions@the120.school</span> for anything else. Your
              group choice can still be changed until a deposit is paid.
            </>
          )}
        </p>
      )}

      <WizardRail steps={steps} activeIdx={idx} allNavigable={locked} onSelect={(s) => goTo(s)} />

      {reviewOrigin === step && (
        <button
          onClick={() => goTo("review")}
          className={`mt-4 rounded font-mono text-xs uppercase tracking-[0.12em] text-blue hover:text-red ${focusRing}`}
        >
          ← Back to review
        </button>
      )}

      {/* Step content */}
      <div className="mt-5">
        {step === "review" ? (
          <StepReview
            child={child}
            items={items}
            pct={pct}
            locked={locked}
            depositPaid={depositPaid}
            n={n}
            submitState={submitState}
            submitError={submitError}
            onJump={(s) => goTo(s, { fromReview: true })}
            onPreview={onPreview}
            onSubmit={doSubmit}
            onRemove={() => removeChild(child.id)}
          />
        ) : (
          <fieldset
            // Frozen while an explicit save is in flight (no new edits and no
            // new debounce can start mid-save), and on non-editable locked steps.
            disabled={
              !stepEditable(step) || saveState === "saving" || submitState === "saving"
            }
            className="disabled:opacity-70"
          >
            {step === "basics" && <StepBasics child={child} set={set} n={n} />}
            {step === "group" && <StepGroup child={child} set={set} n={n} />}
            {step === "academics" && <StepAcademics child={child} set={set} n={n} />}
            {step === "workshops" && (
              <StepWorkshops child={child} set={set} n={n} editable={workshopsEditable} />
            )}
            {step === "project" && <StepProject child={child} set={set} n={n} />}
          </fieldset>
        )}
      </div>

      {/* Step navigation — on the workshops step it becomes a sticky bottom
          bar (R9): selected-workshop chips + the forward/save actions stay
          reachable without scrolling the card list. */}
      {step !== "review" && (
        <div
          className={
            step === "workshops"
              ? "sticky bottom-0 z-40 -mx-6 mt-6 border-t border-line bg-paper/90 px-6 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-md"
              : "mt-6"
          }
        >
          {step === "workshops" && (
            <div className="mb-3">
              <p className="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-muted">
                Selected · {workshopSelection.length} of {WORKSHOP_MAX}
              </p>
              {workshopSelection.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {workshopSelection.map((id) => {
                    const title = workshopById(id)?.title ?? id;
                    return (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 rounded-full border border-red/40 bg-red/5 py-1 pl-3 pr-1.5 text-xs text-ink"
                      >
                        {title}
                        {workshopsEditable && (
                          <button
                            type="button"
                            disabled={savingNow}
                            onClick={() =>
                              set({ workshopIds: workshopSelection.filter((x) => x !== id) })
                            }
                            aria-label={`Remove ${title}`}
                            className={`flex h-5 w-5 items-center justify-center rounded-full text-muted hover:bg-red/10 hover:text-red disabled:cursor-wait ${focusRing}`}
                          >
                            ×
                          </button>
                        )}
                      </span>
                    );
                  })}
                </div>
              )}
              {workshopsEditable && workshopSelection.length >= WORKSHOP_MAX && (
                <p role="status" className="mt-2 font-mono text-[0.7rem] text-muted">
                  Pick up to {WORKSHOP_MAX} — remove one to add another.
                </p>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
          {idx > 0 && (
            <button
              onClick={goBackStep}
              className={`inline-flex h-12 items-center justify-center rounded-full border border-line-strong px-6 font-mono text-xs uppercase tracking-[0.12em] text-ink hover:border-ink ${focusRing}`}
            >
              ← Back
            </button>
          )}
          <button
            onClick={goNext}
            disabled={nextDisabled}
            className={`inline-flex h-12 items-center justify-center rounded-full bg-red px-6 font-mono text-xs uppercase tracking-[0.12em] text-white hover:bg-red-dark disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`}
          >
            {saveState === "saving"
              ? "Saving…"
              : nextStep === "review"
                ? "Review →"
                : "Next →"}
          </button>
          {locked && stepEditable(step) && (
            <button
              onClick={saveLockedStep}
              disabled={saveState === "saving"}
              className={`inline-flex h-12 items-center justify-center rounded-full bg-blue px-6 font-mono text-xs uppercase tracking-[0.12em] text-white hover:bg-blue-dark disabled:cursor-wait disabled:opacity-60 ${focusRing}`}
            >
              {saveState === "saving"
                ? "Saving…"
                : step === "group"
                  ? "Save group choice"
                  : "Save workshop picks"}
            </button>
          )}
          {!locked && step === "group" && child.groupSlug === "" && (
            <p className="w-full font-mono text-[0.7rem] text-muted">
              Pick a group to continue — it shapes the rest of the dossier.
            </p>
          )}
          {lockedSavedStep === step && (
            <p className="w-full text-sm text-ink" role="status">
              {step === "group" ? "Group choice updated ✓" : "Workshop picks updated ✓"}
            </p>
          )}
          {saveState === "error" && (
            <p role="alert" className="w-full text-sm text-red">
              {saveError ?? "Could not save."} — nothing was lost; press{" "}
              {locked ? "Save" : "Next"} to retry.
            </p>
          )}
          </div>
        </div>
      )}
    </div>
  );
}
