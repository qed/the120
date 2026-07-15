"use client";

/**
 * Send-offer-email button + confirm dialog (plan 2026-07-15-001 Unit 6).
 *
 * State derivation rule (adversarial finding): everything renders from
 * `item.*` props on every render — NEVER `useState(item.offerSentAt)` (the
 * `notes` useState in DossierDetail is the local anti-pattern; it goes stale
 * across router.refresh()). The one exception is `lastSentAt`, a deliberate
 * optimistic overlay used ONLY while props haven't yet delivered a stamp, so
 * the button can't flash back to sendable during the refresh window.
 *
 * The confirm dialog previews the EXACT template the server sends (same
 * `offerEmailTemplate`, escaped output shown as text — no
 * dangerouslySetInnerHTML). The preview is advisory: the action re-renders
 * from server truth at send time.
 *
 * Disabled states follow the settled a11y mechanism: aria-disabled +
 * focusable + aria-describedby pointing at a visible reason line — never a
 * natively disabled button with a hover-only title (the old Print button's
 * forbidden pattern). The sent badge prints (dossier history); the button
 * and dialog are no-print.
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DossierItem } from "@/app/crm/lib/queries";
import { sendOfferEmail } from "@/app/crm/lib/actions/reviews";
import {
  offerButtonState,
  offerEmailTemplate,
  type OfferButtonState,
} from "@/app/crm/lib/offer-rules";
import { fmtDay } from "@/app/crm/lib/dates";
import { useToast } from "@/app/crm/components/Toast";
import { BTN_PRIMARY, BTN_SECONDARY } from "@/app/crm/components/pipeline/atoms";
import { useFocusTrap } from "@/app/crm/components/useFocusTrap";

const DISABLED_REASON: Record<
  Exclude<OfferButtonState, "sendable" | "resendable">,
  string
> = {
  not_offered: "Not offered yet — move the candidate to Offered first.",
  deposit_paid: "Deposit already paid — nothing left to ask for.",
  no_contact: "No parent contact info on file.",
};

export default function OfferEmailButton({
  item,
  disabled,
  onSendingChange,
}: {
  item: DossierItem;
  /** e.g. while a status move is in flight — the two header actions never race. */
  disabled?: boolean;
  onSendingChange?: (sending: boolean) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  /** Optimistic overlay — only consulted while props carry no stamp. */
  const [lastSentAt, setLastSentAt] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const sentAt = item.offerSentAt ?? lastSentAt;
  const state = offerButtonState({
    reviewStatus: item.reviewStatus,
    deposits: item.deposits,
    effectiveParentEmail: item.effectiveParentEmail,
    offerSentAt: sentAt,
  });
  const isResend = state === "resendable";
  const childFirstName = item.name.split(" ")[0] ?? item.name;
  const template = offerEmailTemplate({
    childFirstName,
    parentName: item.parentName,
  });

  const close = () => {
    if (sending) return;
    setOpen(false);
    setDialogError(null);
  };
  useFocusTrap(panelRef, open, close);

  const send = async () => {
    setSending(true);
    onSendingChange?.(true);
    setDialogError(null);
    const result = await sendOfferEmail({
      childId: item.childId,
      // The CAS token: the stamp THIS staff member saw, verbatim from props.
      resendOf: isResend ? (item.offerSentAt ?? undefined) : undefined,
    });
    setSending(false);
    onSendingChange?.(false);

    switch (result.status) {
      case "sent":
        setLastSentAt(result.sentAt ?? null);
        setOpen(false);
        toast("success", `Offer email sent to ${item.parentName}`);
        router.refresh();
        break;
      case "already_sent":
        setLastSentAt(result.sentAt ?? null);
        setOpen(false);
        toast("info", "Offer already sent — refreshed");
        router.refresh();
        break;
      case "gate_closed":
        setOpen(false);
        toast("error", result.error ?? "No longer sendable — refreshed");
        router.refresh();
        break;
      case "not_found":
        setOpen(false);
        toast("error", "Candidate not found — refreshed");
        router.refresh();
        break;
      case "send_failed":
        // Dialog stays open with the form intact; button returns to sendable.
        setDialogError(result.error ?? "The email service rejected the send.");
        if (result.warning) toast("error", result.warning);
        break;
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      {state === "sendable" || state === "resendable" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-disabled={disabled || undefined}
          className={`${isResend ? BTN_SECONDARY : BTN_PRIMARY} no-print ${
            disabled ? "pointer-events-none opacity-50" : ""
          }`}
        >
          {isResend ? `Offer sent · ${fmtDay(sentAt!)}` : "Send offer email"}
        </button>
      ) : (
        <>
          <button
            type="button"
            aria-disabled="true"
            aria-describedby={`offer-reason-${item.childId}`}
            onClick={() => undefined}
            className={`${BTN_SECONDARY} no-print cursor-not-allowed opacity-50`}
          >
            Send offer email
          </button>
          <span
            id={`offer-reason-${item.childId}`}
            className="no-print max-w-[220px] text-right font-mono text-[9px] uppercase tracking-[0.06em] text-crm-faint"
          >
            {DISABLED_REASON[state]}
          </span>
          {sentAt && (
            /* R9 badge survival: the sent record outlives every gate-closed
               state — and it PRINTS (dossier history). */
            <span className="font-mono text-[9px] uppercase tracking-[0.06em] text-crm-muted">
              Offer sent · {fmtDay(sentAt)}
            </span>
          )}
        </>
      )}

      {open && (
        <div
          className="no-print fixed inset-0 z-50 flex items-center justify-center bg-crm-ink/40 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={isResend ? "Resend offer email" : "Send offer email"}
            className="flex max-h-[85vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-[14px] border border-crm-line bg-white p-5 shadow-[0_20px_60px_rgba(19,20,22,0.25)]"
          >
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-crm-red">
              {isResend ? "Resend offer email" : "Send offer email"}
            </span>

            <div className="space-y-2 rounded-[12px] border border-crm-line bg-crm-card px-4 py-3.5">
              <p className="font-mono text-[10.5px] tracking-[0.04em] text-crm-ink">
                <span className="text-crm-muted">TO&nbsp;&nbsp;</span>
                {item.parentName} ({item.effectiveParentEmail})
              </p>
              <p className="font-mono text-[10.5px] tracking-[0.04em] text-crm-ink">
                <span className="text-crm-muted">SUBJECT&nbsp;&nbsp;</span>
                {template.subject}
              </p>
              {isResend && sentAt && (
                <p className="font-mono text-[10.5px] tracking-[0.04em] text-crm-amber">
                  Already sent {fmtDay(sentAt)} — this sends it again.
                </p>
              )}
            </div>

            {/* Rendered preview — the exact template the send uses. */}
            <div className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-[12px] border border-crm-line2 bg-white px-4 py-3 text-[13px] leading-relaxed text-crm-ink">
              {template.text}
            </div>
            <p className="font-mono text-[9px] uppercase tracking-[0.06em] text-crm-faint">
              Sent from admissions@the120.school · BCC admissions@ ·
              identification footer appended
            </p>

            {dialogError && (
              <div className="rounded-[10px] border border-crm-red/30 bg-crm-red/5 px-3 py-2 text-[12.5px] text-crm-red">
                {dialogError}
              </div>
            )}

            <div className="flex items-center gap-2 border-t border-crm-line pt-4">
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
                onClick={send}
                disabled={sending}
                className={`${BTN_PRIMARY} ml-auto`}
              >
                {sending ? "Sending…" : isResend ? "Resend now" : "Send now"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
