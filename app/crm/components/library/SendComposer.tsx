"use client";

/**
 * Send composer (plan Unit 7; brief §9): family picker → CASL gate →
 * prefilled, editable subject/body → confirm step showing the recipient
 * email + consent source (flow gap 28) → Resend send. The gate verdict here
 * is the SAME `sendGate` the server action enforces — the UI is convenience,
 * the action is law. Gate states:
 * - no consent / revoked → hard-blocked (§11 voice); mark-as-sent-elsewhere
 *   is blocked too (CASL covers texts — flow gap 15)
 * - consented, no email → only "mark as sent elsewhere" offered (flow gap 13)
 * - consented + email → compose → confirm → send; failure keeps the form.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ComposerFamily, LibraryItem } from "@/app/crm/lib/queries";
import { composePrefill, sendGate } from "@/app/crm/lib/library-rules";
import {
  markSentElsewhere,
  sendFromLibrary,
} from "@/app/crm/lib/actions/library";
import { useToast } from "@/app/crm/components/Toast";
import { useFocusTrap } from "@/app/crm/components/useFocusTrap";
import { fmtDay } from "@/app/crm/lib/dates";
import { BTN_PRIMARY, BTN_SECONDARY } from "@/app/crm/components/pipeline/atoms";

const INPUT =
  "w-full rounded-[12px] border border-crm-line2 bg-white px-3 py-2 text-[13.5px] text-crm-ink placeholder:text-crm-faint focus:border-crm-blue focus:outline-none disabled:opacity-50";

const LABEL =
  "mb-1 block font-mono text-[9.5px] uppercase tracking-[0.1em] text-crm-muted";

function ConsentTag({ family }: { family: ComposerFamily }) {
  if (family.consentGiven && !family.consentRevokedAt) {
    return (
      <span className="font-mono text-[9px] uppercase tracking-[0.06em] text-crm-green">
        ✓ CASL
      </span>
    );
  }
  return (
    <span className="font-mono text-[9px] uppercase tracking-[0.06em] text-crm-amber">
      {family.consentRevokedAt ? "REVOKED" : "NO CASL"}
    </span>
  );
}

export default function SendComposer({
  item,
  families,
  initialFamilyId,
  onClose,
}: {
  item: LibraryItem;
  families: ComposerFamily[];
  initialFamilyId?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const panelRef = useRef<HTMLDivElement>(null);

  const initial = useMemo(
    () =>
      initialFamilyId
        ? (families.find((f) => f.id === initialFamilyId) ?? null)
        : null,
    [families, initialFamilyId]
  );

  const [selectedId, setSelectedId] = useState<string | null>(
    initial?.id ?? null
  );
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState(
    initial ? composePrefill(item, initial).subject : item.title
  );
  const [body, setBody] = useState(
    initial ? composePrefill(item, initial).body : item.body
  );
  const [elsewhereNote, setElsewhereNote] = useState("");
  const [step, setStep] = useState<"compose" | "confirm">("compose");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => families.find((f) => f.id === selectedId) ?? null,
    [families, selectedId]
  );

  // The same pure gate the server action enforces (library-rules).
  const verdict = selected
    ? sendGate(
        {
          email: selected.email,
          consent_given: selected.consentGiven,
          consent_revoked_at: selected.consentRevokedAt,
        },
        "email"
      )
    : null;

  const close = useCallback(() => {
    if (!sending) onClose();
  }, [onClose, sending]);

  useFocusTrap(panelRef, true, close);

  const pickFamily = (family: ComposerFamily) => {
    setSelectedId(family.id);
    setQuery("");
    setError(null);
    setStep("compose");
    const prefill = composePrefill(item, family);
    setSubject(prefill.subject);
    setBody(prefill.body);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return families;
    return families.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        (f.email ?? "").toLowerCase().includes(q)
    );
  }, [families, query]);

  const handleSend = async () => {
    if (!selected) return;
    setSending(true);
    setError(null);
    const result = await sendFromLibrary({
      familyId: selected.id,
      itemId: item.id,
      subject,
      body,
    });
    setSending(false);
    if (result.success) {
      toast("success", `Sent · ${selected.name}`);
      if (result.warning) toast("info", result.warning);
      onClose();
      router.refresh();
    } else {
      // Failure keeps the form for retry (Decision 10 logged nothing).
      setError(result.error ?? "The send failed — nothing was logged.");
    }
  };

  const handleMarkElsewhere = async () => {
    if (!selected) return;
    setSending(true);
    setError(null);
    const result = await markSentElsewhere({
      familyId: selected.id,
      itemId: item.id,
      ...(elsewhereNote.trim() ? { note: elsewhereNote } : {}),
    });
    setSending(false);
    if (result.success) {
      toast("success", `Marked as sent elsewhere · ${selected.name}`);
      onClose();
      router.refresh();
    } else {
      setError(result.error ?? "Failed to log the send.");
    }
  };

  const consentLine = selected
    ? [
        selected.consentSource ? `via ${selected.consentSource}` : null,
        selected.consentAt ? fmtDay(selected.consentAt) : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Send from library"
    >
      <div
        className="absolute inset-0 bg-crm-ink/40"
        onClick={close}
        aria-hidden
      />

      <div
        ref={panelRef}
        className="relative flex max-h-[90vh] w-full max-w-[620px] flex-col overflow-y-auto rounded-[12px] bg-white shadow-[0_4px_18px_rgba(19,20,22,0.14)]"
      >
        <div className="flex items-start justify-between border-b border-crm-line px-6 py-5">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-crm-red">
              Send from library
            </p>
            <h2 className="mt-1 truncate font-serif text-[20px] font-normal text-crm-ink">
              {item.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close composer"
            className="cursor-pointer text-[20px] leading-none text-crm-faint hover:text-crm-ink"
          >
            ×
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          {/* ------------------------------------------------ family picker */}
          <div>
            <label htmlFor="composer-to" className={LABEL}>
              To
            </label>
            {selected ? (
              <div className="flex flex-wrap items-center gap-2.5 rounded-[12px] border border-crm-line2 bg-crm-card px-3 py-2">
                <span className="text-[13.5px] font-semibold text-crm-ink">
                  {selected.name}
                </span>
                <span className="font-mono text-[10.5px] text-crm-muted">
                  {selected.email ?? "no email on file"}
                </span>
                <ConsentTag family={selected} />
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(null);
                    setStep("compose");
                    setError(null);
                  }}
                  disabled={sending}
                  className="ml-auto cursor-pointer font-mono text-[10px] uppercase tracking-[0.08em] text-crm-blue hover:underline disabled:opacity-50"
                >
                  Change
                </button>
              </div>
            ) : (
              <div>
                <input
                  id="composer-to"
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search families…"
                  className={INPUT}
                  autoComplete="off"
                />
                <ul className="mt-1.5 max-h-48 overflow-y-auto rounded-[12px] border border-crm-line2">
                  {filtered.length === 0 && (
                    <li className="px-3 py-2.5 text-[12.5px] text-crm-muted">
                      No families match.
                    </li>
                  )}
                  {filtered.map((f) => (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => pickFamily(f)}
                        className="flex w-full cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-left hover:bg-crm-card"
                      >
                        <span className="text-[13px] text-crm-ink">
                          {f.name}
                        </span>
                        <span className="font-mono text-[10px] text-crm-faint">
                          {f.email ?? "no email"}
                        </span>
                        <span className="ml-auto">
                          <ConsentTag family={f} />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {error && (
            <div className="rounded-[10px] border border-crm-red/30 bg-crm-red/5 px-3 py-2 text-[12.5px] text-crm-red">
              {error}
            </div>
          )}

          {/* ------------------------------------------------- gate states */}
          {selected && verdict === "no-consent" && (
            /* Hard-blocked (§11 voice): email AND mark-as-sent are gated. */
            <div className="rounded-[12px] border border-crm-line bg-crm-card px-5 py-8 text-center">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-crm-amber">
                {selected.consentRevokedAt ? "Consent revoked" : "No CASL"}
              </p>
              <p className="mt-3 font-serif text-[17px] italic text-crm-ink">
                {selected.consentRevokedAt
                  ? "CASL consent was revoked — this family can't be contacted."
                  : "No CASL consent on file — this family can't be emailed."}
              </p>
              <p className="mt-2 text-[12.5px] text-crm-muted">
                That includes texts and WhatsApp — CASL covers them, so
                &ldquo;mark as sent elsewhere&rdquo; is blocked too. Record
                consent first (with its source), then send.
              </p>
            </div>
          )}

          {selected && verdict === "no-email" && (
            /* Consented lead with no address: only the elsewhere path. */
            <div className="space-y-3 rounded-[12px] border border-crm-line bg-crm-card px-4 py-4">
              <p className="text-[12.5px] text-crm-muted">
                No email on file — this family can only be marked as sent
                elsewhere (text/WhatsApp). Consent covers it.
              </p>
              <div>
                <label htmlFor="composer-note" className={LABEL}>
                  Note (optional)
                </label>
                <input
                  id="composer-note"
                  type="text"
                  maxLength={500}
                  value={elsewhereNote}
                  onChange={(e) => setElsewhereNote(e.target.value)}
                  placeholder="Texted the tuition math…"
                  className={INPUT}
                  disabled={sending}
                />
              </div>
              <button
                type="button"
                onClick={handleMarkElsewhere}
                disabled={sending}
                className={BTN_PRIMARY}
              >
                {sending ? "Logging…" : "Mark as sent elsewhere"}
              </button>
            </div>
          )}

          {selected && verdict === "ok" && step === "compose" && (
            <>
              <div>
                <label htmlFor="composer-subject" className={LABEL}>
                  Subject
                </label>
                <input
                  id="composer-subject"
                  type="text"
                  maxLength={200}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className={INPUT}
                  disabled={sending}
                />
              </div>
              <div>
                <label htmlFor="composer-body" className={LABEL}>
                  Message
                </label>
                <textarea
                  id="composer-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={9}
                  maxLength={10_000}
                  className={`${INPUT} resize-y leading-relaxed`}
                  disabled={sending}
                />
                <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.06em] text-crm-faint">
                  Sent from admissions@the120.school · BCC admissions@ · CASL
                  footer appended automatically
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-crm-line pt-4">
                <button
                  type="button"
                  onClick={close}
                  className={BTN_SECONDARY}
                  disabled={sending}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleMarkElsewhere}
                  disabled={sending}
                  className={BTN_SECONDARY}
                  title="Sent it by text/WhatsApp instead — logs without emailing"
                >
                  Mark as sent elsewhere
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setStep("confirm");
                  }}
                  disabled={
                    sending || !subject.trim() || !body.trim()
                  }
                  className={`${BTN_PRIMARY} ml-auto`}
                >
                  Review &amp; send
                </button>
              </div>
            </>
          )}

          {selected && verdict === "ok" && step === "confirm" && (
            /* Confirm step (flow gap 28): recipient + consent source. */
            <>
              <div className="space-y-2 rounded-[12px] border border-crm-line bg-crm-card px-4 py-3.5">
                <p className="font-mono text-[10.5px] tracking-[0.04em] text-crm-ink">
                  <span className="text-crm-muted">TO&nbsp;&nbsp;</span>
                  {selected.email}
                </p>
                <p className="font-mono text-[10.5px] tracking-[0.04em] text-crm-ink">
                  <span className="text-crm-muted">CONSENT&nbsp;&nbsp;</span>
                  {consentLine || "on file"}
                </p>
                <p className="font-mono text-[10.5px] tracking-[0.04em] text-crm-ink">
                  <span className="text-crm-muted">SUBJECT&nbsp;&nbsp;</span>
                  {subject}
                </p>
              </div>
              <div className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-[12px] border border-crm-line2 bg-white px-4 py-3 text-[13px] leading-relaxed text-crm-ink">
                {body}
              </div>

              <div className="flex items-center gap-2 border-t border-crm-line pt-4">
                <button
                  type="button"
                  onClick={() => setStep("compose")}
                  className={BTN_SECONDARY}
                  disabled={sending}
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={sending}
                  className={`${BTN_PRIMARY} ml-auto`}
                >
                  {sending ? "Sending…" : "Send now"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
