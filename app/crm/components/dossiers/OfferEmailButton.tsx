"use client";

/**
 * Send-offer-email button + confirm dialog (plan 2026-07-15-001 Unit 6).
 *
 * State derivation rule (review finding): everything renders from `item.*`
 * props on every render — NEVER `useState(item.offerSentAt)` (the `notes`
 * useState in DossierDetail is the local anti-pattern; it goes stale across
 * router.refresh()). The optimistic sent-stamp overlay is OWNED BY THE
 * PARENT (DossierDetail) and passed down as `sentAtOverlay`, because the
 * parent's demote warning needs the same overlay — a local copy here left
 * the parent reading stale props during the refresh window (review P1).
 * `sentAt` (props ?? overlay) drives BOTH the resendable state AND the CAS
 * token, so the two can never disagree (review: a props-only token silently
 * dropped a legitimate resend in the overlay window).
 *
 * The confirm dialog previews the EXACT template the server sends (same
 * `offerEmailTemplate`, fed by the same raw `first_name` column — never a
 * split of the display name), escaped output shown as text — no
 * dangerouslySetInnerHTML. The preview is advisory: the action re-renders
 * from server truth at send time.
 *
 * Disabled semantics, two distinct kinds (review finding — keyboard
 * activation bypasses CSS pointer-events):
 * - gate-derived states: aria-disabled + focusable + visible reason
 *   (aria-describedby), with a hard no-op handler;
 * - the parent-driven `disabled` (status move in flight): the handler AND
 *   the in-dialog send button both guard on it — the two header actions
 *   never race, for mouse and keyboard alike.
 * The sent badge prints in EVERY state that has a stamp (dossier history);
 * the button and dialog are no-print.
 */

import { useCallback, useRef, useState } from "react";
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

const PRINT_BADGE =
  "font-mono text-[9px] uppercase tracking-[0.06em] text-crm-muted";

export default function OfferEmailButton({
  item,
  disabled,
  sentAtOverlay,
  onSentAtChange,
  onSendingChange,
}: {
  item: DossierItem;
  /** e.g. while a status move is in flight — the two header actions never race. */
  disabled?: boolean;
  /** Parent-owned optimistic stamp, bridging the refresh window after a send. */
  sentAtOverlay: string | null;
  onSentAtChange: (sentAt: string | null) => void;
  onSendingChange?: (sending: boolean) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  /** Mirrors `sending` for the memoized close guard (stable identity keeps
   *  useFocusTrap from tearing down/rebuilding on every render). */
  const sendingRef = useRef(false);

  const sentAt = item.offerSentAt ?? sentAtOverlay;
  const state = offerButtonState({
    reviewStatus: item.reviewStatus,
    deposits: item.deposits,
    effectiveParentEmail: item.effectiveParentEmail,
    offerSentAt: sentAt,
  });
  const isResend = state === "resendable";
  const template = offerEmailTemplate({
    childFirstName: item.childFirstName,
    parentName: item.parentName,
  });

  // Memoized so useFocusTrap doesn't tear down/rebuild on every render
  // (review finding: an inert rebuild while "Sending…" disables everything).
  const close = useCallback(() => {
    if (sendingRef.current) return;
    setOpen(false);
    setDialogError(null);
  }, []);
  useFocusTrap(panelRef, open, close);

  const send = async () => {
    setSending(true);
    sendingRef.current = true;
    onSendingChange?.(true);
    setDialogError(null);
    try {
      const result = await sendOfferEmail({
        childId: item.childId,
        // The CAS token: the SAME merged value that made this a resend —
        // never raw props, which lag during the refresh window.
        resendOf: isResend ? (sentAt ?? undefined) : undefined,
      });

      switch (result.status) {
        case "sent":
          onSentAtChange(result.sentAt ?? null);
          setOpen(false);
          toast("success", `Offer email sent to ${item.parentName}`);
          router.refresh();
          break;
        case "already_sent":
          onSentAtChange(result.sentAt ?? null);
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
          // Dialog stays open with the form intact; button stays sendable.
          setDialogError(result.error ?? "The email service rejected the send.");
          if (result.warning) toast("error", result.warning);
          break;
      }
    } catch {
      // A thrown rejection must never strand the dialog in "Sending…"
      // (review finding: the close() guard would lock both header actions).
      setDialogError("Something went wrong — the send may not have completed. Refresh and check before retrying.");
    } finally {
      setSending(false);
      sendingRef.current = false;
      onSendingChange?.(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      {state === "sendable" || state === "resendable" ? (
        <>
          <button
            type="button"
            onClick={() => {
              if (!disabled) setOpen(true);
            }}
            aria-disabled={disabled || undefined}
            className={`${isResend ? BTN_SECONDARY : BTN_PRIMARY} no-print ${
              disabled ? "pointer-events-none opacity-50" : ""
            }`}
          >
            {isResend && sentAt ? `Offer sent · ${fmtDay(sentAt)}` : "Send offer email"}
          </button>
          {sentAt && (
            /* Print-only mirror of the sent record — the button itself is
               no-print, and R9 says the record must appear on paper too. */
            <span className={`hidden print:inline ${PRINT_BADGE}`}>
              Offer sent · {fmtDay(sentAt)}
            </span>
          )}
        </>
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
            <span className={PRINT_BADGE}>Offer sent · {fmtDay(sentAt)}</span>
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

            {/* Rendered preview — the exact template the send uses. Focusable
                (tabIndex) both for keyboard scrolling and so the focus trap
                always has one target while Sending… disables the buttons. */}
            <div
              tabIndex={0}
              className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-[12px] border border-crm-line2 bg-white px-4 py-3 text-[13px] leading-relaxed text-crm-ink focus-visible:outline-2 focus-visible:outline-crm-blue"
            >
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
                disabled={sending || disabled}
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
