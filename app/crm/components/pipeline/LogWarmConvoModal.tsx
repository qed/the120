"use client";

/**
 * Log-warm-convo modal (plan 2026-07-17-002 Unit 5, R4): one-step capture of
 * a warm conversation as a create-or-match lead. Name (required) + optional
 * email + optional note. A duplicate probe on blur surfaces an email match
 * (the conversation attaches to it) or a name/phone similarity. On submit:
 * - new lead → navigate to its drawer (`?family=`), symmetric with AddFamily;
 * - matched existing → toast + open that drawer;
 * - no email + a similar family → an attach-or-create choice, not a silent
 *   duplicate.
 * Escape closes, focus trap + return (a11y baseline, mirrors AddFamilyModal).
 */

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { checkDuplicates, logWarmConvo } from "@/app/crm/lib/actions/families";
import { useToast } from "@/app/crm/components/Toast";
import { useFocusTrap } from "@/app/crm/components/useFocusTrap";
import { BTN_PRIMARY, BTN_SECONDARY } from "./atoms";

const INPUT =
  "w-full rounded-[12px] border border-crm-line2 bg-white px-3 py-2 text-[13.5px] text-crm-ink placeholder:text-crm-faint focus:border-crm-blue focus:outline-none disabled:opacity-50";

const LABEL =
  "mb-1 block font-mono text-[9.5px] uppercase tracking-[0.1em] text-crm-muted";

interface Candidate {
  id: string;
  name: string;
}

export default function LogWarmConvoModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const panelRef = useRef<HTMLDivElement>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");

  const [emailMatch, setEmailMatch] = useState<string | null>(null);
  const [similar, setSimilar] = useState<string | null>(null);
  // No-email "did you mean?" — a similar family to attach to instead of dup.
  const [candidate, setCandidate] = useState<Candidate | null>(null);

  const reset = useCallback(() => {
    setName("");
    setEmail("");
    setNote("");
    setEmailMatch(null);
    setSimilar(null);
    setCandidate(null);
    setError(null);
  }, []);

  const close = useCallback(() => {
    if (!submitting) onClose();
  }, [onClose, submitting]);

  useFocusTrap(panelRef, open, close);

  const probeDuplicates = useCallback(async () => {
    if (!name.trim() && !email.trim()) return;
    try {
      const result = await checkDuplicates({ name, email });
      setEmailMatch(result.emailConflict?.name ?? null);
      setSimilar(result.similar?.name ?? null);
    } catch {
      // A failed probe never blocks — the server action re-checks.
    }
  }, [name, email]);

  const finish = useCallback(
    (familyId: string | undefined, matched: boolean | undefined) => {
      toast(
        "success",
        matched ? "Warm convo logged on existing family" : "Warm lead captured"
      );
      reset();
      onClose();
      if (familyId) {
        router.push(`/crm/pipeline?family=${familyId}`, { scroll: false });
      } else {
        router.refresh();
      }
    },
    [onClose, reset, router, toast]
  );

  // Core submit — `force` skips the no-email similarity probe (create anyway).
  const submit = useCallback(
    async (force: boolean) => {
      setError(null);
      setSubmitting(true);

      const payload: Record<string, unknown> = { name };
      if (email.trim()) payload.email = email.trim();
      if (note.trim()) payload.note = note;
      if (force) payload.force = true;

      // A rejected server action must never freeze the modal on "Logging…":
      // finally always clears `submitting`, catch surfaces a retryable error.
      try {
        const result = await logWarmConvo(payload);
        if (!result.success) {
          setError(result.error ?? "Failed to log the conversation.");
          return;
        }
        // No-email soft match → offer attach-or-create instead of finishing.
        if (result.candidate && !result.familyId) {
          setCandidate(result.candidate);
          return;
        }
        finish(result.familyId, result.matched);
      } catch {
        setError("Something went wrong logging the conversation. Please try again.");
      } finally {
        setSubmitting(false);
      }
    },
    [email, finish, name, note]
  );

  const attachToCandidate = useCallback(async () => {
    if (!candidate) return;
    setSubmitting(true);
    const payload: Record<string, unknown> = { familyId: candidate.id };
    if (note.trim()) payload.note = note;
    try {
      const result = await logWarmConvo(payload);
      if (!result.success) {
        setError(result.error ?? "Failed to attach the conversation.");
        return;
      }
      finish(result.familyId, true);
    } catch {
      setError("Something went wrong attaching the conversation. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [candidate, finish, note]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await submit(false);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Log a warm conversation"
    >
      <div
        className="absolute inset-0 bg-crm-ink/40"
        onClick={close}
        aria-hidden
      />

      <div
        ref={panelRef}
        className="relative max-h-[90vh] w-full max-w-[480px] overflow-y-auto rounded-[12px] bg-white shadow-[0_4px_18px_rgba(19,20,22,0.14)]"
      >
        <div className="flex items-start justify-between border-b border-crm-line px-6 py-5">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-crm-muted">
              Fast capture
            </p>
            <h2 className="mt-1 font-serif text-[22px] font-normal text-crm-ink">
              Log warm convo
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="cursor-pointer text-[20px] leading-none text-crm-faint hover:text-crm-ink"
          >
            ×
          </button>
        </div>

        {candidate ? (
          /* No-email "did you mean?" — attach to the similar family or create. */
          <div className="space-y-4 px-6 py-5">
            {error && (
              <div className="rounded-[10px] border border-crm-red/30 bg-crm-red/5 px-3 py-2 font-mono text-[10.5px] uppercase tracking-[0.06em] text-crm-red">
                {error}
              </div>
            )}
            <div className="rounded-[10px] border border-crm-amber/40 bg-crm-blush/30 px-3 py-2.5 text-[12.5px] text-crm-ink">
              A similar family already exists: <strong>{candidate.name}</strong>.
              Attach this conversation to them, or create a separate new lead.
            </div>
            <div className="flex flex-wrap justify-end gap-2.5">
              <button
                type="button"
                onClick={() => submit(true)}
                className={BTN_SECONDARY}
                disabled={submitting}
              >
                {submitting ? "Working…" : "Create new lead"}
              </button>
              <button
                type="button"
                onClick={attachToCandidate}
                className={BTN_PRIMARY}
                disabled={submitting}
              >
                {submitting ? "Working…" : `Attach to ${candidate.name}`}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
            {error && (
              <div className="rounded-[10px] border border-crm-red/30 bg-crm-red/5 px-3 py-2 font-mono text-[10.5px] uppercase tracking-[0.06em] text-crm-red">
                {error}
              </div>
            )}
            {emailMatch && (
              <div className="rounded-[10px] border border-crm-line2 bg-crm-card px-3 py-2 text-[12.5px] text-crm-muted">
                This email matches {emailMatch} — the conversation will be logged
                on their record.
              </div>
            )}
            {similar && !emailMatch && (
              <div className="rounded-[10px] border border-crm-amber/40 bg-crm-blush/30 px-3 py-2 text-[12.5px] text-crm-ink">
                Similar family exists: {similar}. You can still log this one.
              </div>
            )}

            <div>
              <label htmlFor="warm-name" className={LABEL}>
                Name *
              </label>
              <input
                id="warm-name"
                type="text"
                required
                maxLength={200}
                placeholder="Dana Osei"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={probeDuplicates}
                className={INPUT}
                disabled={submitting}
              />
            </div>

            <div>
              <label htmlFor="warm-email" className={LABEL}>
                Email
              </label>
              <input
                id="warm-email"
                type="email"
                maxLength={254}
                placeholder="Optional — matches an existing family"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setEmailMatch(null);
                }}
                onBlur={probeDuplicates}
                className={INPUT}
                disabled={submitting}
              />
            </div>

            <div>
              <label htmlFor="warm-note" className={LABEL}>
                Note
              </label>
              <textarea
                id="warm-note"
                rows={3}
                maxLength={4000}
                placeholder="What did you talk about?"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className={`${INPUT} resize-y`}
                disabled={submitting}
              />
            </div>

            <p className="text-[11.5px] text-crm-muted">
              Sets heat to at least warm and tags the family “warm convo held”.
              No CASL consent — a warm convo isn’t opt-in.
            </p>

            <div className="flex justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={close}
                className={BTN_SECONDARY}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={BTN_PRIMARY}
                disabled={submitting}
              >
                {submitting ? "Logging…" : "Log warm convo"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
