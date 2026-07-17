"use client";

/**
 * Drawer header (brief §7): Georgia 28px name, kids string · area, derived
 * stage pill with derivation tooltip, heat pips (display-only in P1),
 * last-touch chip, and the action row — LOG CALL BOOKED / HELD with a
 * backdate popover + clear, MARK LOST / WAITLIST or REOPEN, and a small
 * overflow menu carrying REVOKE CONSENT behind a confirm.
 */

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { FamilyDetail } from "@/app/crm/lib/queries";
import {
  clearStamp,
  logWarmConvo,
  markReferralAsked,
  reopenFamily,
  revokeConsent,
  setOverride,
  stampCall,
  type ActionResult,
} from "@/app/crm/lib/actions/families";
import { useToast } from "@/app/crm/components/Toast";
import { fmtDay } from "@/app/crm/lib/dates";
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  ConsentBadge,
  HeatPips,
  LastTouch,
  StagePill,
} from "./atoms";

type StampKind = "booked" | "held";

function todayStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function DrawerHeader({
  detail,
  onClose,
}: {
  detail: FamilyDetail;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [openStamp, setOpenStamp] = useState<StampKind | null>(null);
  const [stampDate, setStampDate] = useState(todayStr());
  const [menuOpen, setMenuOpen] = useState(false);
  const [warmOpen, setWarmOpen] = useState(false);
  const [warmNote, setWarmNote] = useState("");

  const run = useCallback(
    async (fn: () => Promise<ActionResult>, successMessage: string) => {
      setBusy(true);
      const result = await fn();
      setBusy(false);
      if (result.success) {
        toast("success", successMessage);
        router.refresh();
      } else {
        toast("error", result.error ?? "Something went wrong.");
      }
      return result.success;
    },
    [router, toast]
  );

  const subline = [
    detail.kidsLabel ||
      (detail.kidsCount > 0 ? `${detail.kidsCount} kids` : ""),
    detail.area ?? "",
  ]
    .filter(Boolean)
    .join(" · ");

  const handleStamp = async (kind: StampKind) => {
    const isToday = stampDate === todayStr();
    // Backdates land mid-day local so the calendar day survives UTC round-trips.
    const at = isToday
      ? undefined
      : new Date(`${stampDate}T12:00:00`).toISOString();
    const ok = await run(
      () => stampCall({ familyId: detail.id, kind, at }),
      `Call ${kind} · ${fmtDay(at ?? new Date().toISOString())} recorded`
    );
    if (ok) setOpenStamp(null);
  };

  const handleClearStamp = async (kind: StampKind) => {
    const ok = await run(
      () => clearStamp({ familyId: detail.id, kind }),
      `Call ${kind} stamp cleared`
    );
    if (ok) setOpenStamp(null);
  };

  // R5 — in-drawer warm-convo capture: one action tags the signal, applies
  // the heat floor, adds the (optional) note, and bumps last-touch.
  const handleWarmConvo = async () => {
    const note = warmNote.trim();
    const ok = await run(
      () =>
        logWarmConvo({ familyId: detail.id, ...(note ? { note } : {}) }),
      "Warm convo logged"
    );
    if (ok) {
      setWarmNote("");
      setWarmOpen(false);
    }
  };

  const handleRevoke = async () => {
    setMenuOpen(false);
    const sure = window.confirm(
      `Revoke CASL consent for ${detail.name}? All sends will be blocked. This is compliance-critical and hard to reverse.`
    );
    if (!sure) return;
    await run(() => revokeConsent({ familyId: detail.id }), "Consent revoked");
  };

  const stampButton = (kind: StampKind, existing: string | null) => (
    <div className="relative">
      <button
        type="button"
        className={BTN_SECONDARY}
        disabled={busy}
        onClick={() => {
          setStampDate(todayStr());
          setOpenStamp(openStamp === kind ? null : kind);
        }}
      >
        Log call {kind}
        {existing && (
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-crm-green" />
        )}
      </button>
      {openStamp === kind && (
        <div className="absolute left-0 top-full z-10 mt-1.5 w-64 rounded-[12px] border border-crm-line2 bg-white p-3.5 shadow-[0_4px_18px_rgba(19,20,22,0.14)]">
          {existing && (
            <p className="mb-2 font-mono text-[9.5px] uppercase tracking-[0.08em] text-crm-muted">
              Currently {fmtDay(existing)} — stamping again overwrites (latest
              wins)
            </p>
          )}
          <label
            htmlFor={`stamp-date-${kind}`}
            className="mb-1 block font-mono text-[9.5px] uppercase tracking-[0.1em] text-crm-muted"
          >
            Date
          </label>
          <input
            id={`stamp-date-${kind}`}
            type="date"
            min="2026-07-13"
            max={todayStr()}
            value={stampDate}
            onChange={(e) => setStampDate(e.target.value)}
            className="w-full rounded-[12px] border border-crm-line2 bg-white px-3 py-2 text-[13px] focus:border-crm-blue focus:outline-none"
          />
          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              className={BTN_PRIMARY}
              disabled={busy}
              onClick={() => handleStamp(kind)}
            >
              Stamp
            </button>
            {existing && (
              <button
                type="button"
                className={BTN_SECONDARY}
                disabled={busy}
                onClick={() => handleClearStamp(kind)}
              >
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpenStamp(null)}
              className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.08em] text-crm-muted hover:text-crm-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-3 border-b border-crm-line p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="truncate font-serif text-[28px] font-normal leading-tight tracking-[-0.01em] text-crm-ink">
            {detail.name || "Unnamed family"}
          </h2>
          {subline && (
            <p className="mt-0.5 text-[12.5px] text-crm-muted">{subline}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close drawer"
          className="cursor-pointer rounded-full p-1 text-[20px] leading-none text-crm-faint hover:text-crm-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-crm-blue"
        >
          ×
        </button>
      </div>

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-2.5">
        <StagePill stage={detail.stage} title={detail.stageDetail} />
        {detail.overrideSuperseded && (
          <span
            title="A LOST/WAITLIST override is set but voided by higher truth — it clears automatically on the next staff action."
            className="rounded-full bg-crm-blush px-2 py-[3px] font-mono text-[9px] tracking-[0.08em] text-crm-ink"
          >
            OVERRIDE SUPERSEDED
          </span>
        )}
        <HeatPips score={detail.heat} />
        <span className="rounded-full border border-crm-line2 px-2 py-[3px]">
          <LastTouch lastTouchAt={detail.lastTouchAt} />
        </span>
        <ConsentBadge
          consented={detail.consented}
          revoked={Boolean(detail.consentRevokedAt)}
        />
      </div>

      {/* Action row */}
      <div className="flex flex-wrap items-center gap-2">
        {stampButton("booked", detail.callBookedAt)}
        {stampButton("held", detail.callHeldAt)}

        {/* Unit 7: routes to the library with this family pre-selected in
            the composer (?family= param). */}
        <button
          type="button"
          className={BTN_SECONDARY}
          disabled={busy}
          onClick={() => router.push(`/crm/library?family=${detail.id}`)}
        >
          Send from library
        </button>

        {/* R5: log a warm conversation on this family — a small note popover
            (mirrors the call-stamp backdate popover above). */}
        <div className="relative">
          <button
            type="button"
            className={BTN_SECONDARY}
            disabled={busy}
            onClick={() => setWarmOpen((v) => !v)}
          >
            Log warm convo
          </button>
          {warmOpen && (
            <div className="absolute left-0 top-full z-10 mt-1.5 w-72 rounded-[12px] border border-crm-line2 bg-white p-3.5 shadow-[0_4px_18px_rgba(19,20,22,0.14)]">
              <label
                htmlFor="warm-convo-note"
                className="mb-1 block font-mono text-[9.5px] uppercase tracking-[0.1em] text-crm-muted"
              >
                Note (optional)
              </label>
              <textarea
                id="warm-convo-note"
                rows={3}
                maxLength={4000}
                placeholder="What did you talk about?"
                value={warmNote}
                onChange={(e) => setWarmNote(e.target.value)}
                className="w-full resize-y rounded-[12px] border border-crm-line2 bg-white px-3 py-2 text-[13px] focus:border-crm-blue focus:outline-none"
              />
              <p className="mt-2 text-[11px] text-crm-muted">
                Tags “warm convo held” and sets heat to at least warm.
              </p>
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  type="button"
                  className={BTN_PRIMARY}
                  disabled={busy}
                  onClick={handleWarmConvo}
                >
                  Log
                </button>
                <button
                  type="button"
                  onClick={() => setWarmOpen(false)}
                  className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.08em] text-crm-muted hover:text-crm-ink"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {detail.overrideSet ? (
          <button
            type="button"
            className={BTN_SECONDARY}
            disabled={busy}
            onClick={() =>
              run(() => reopenFamily({ familyId: detail.id }), "Reopened")
            }
          >
            Reopen
          </button>
        ) : (
          <>
            <button
              type="button"
              className={BTN_SECONDARY}
              disabled={busy}
              onClick={() =>
                run(
                  () => setOverride({ familyId: detail.id, kind: "lost" }),
                  "Marked lost"
                )
              }
            >
              Mark lost
            </button>
            <button
              type="button"
              className={BTN_SECONDARY}
              disabled={busy}
              onClick={() =>
                run(
                  () => setOverride({ familyId: detail.id, kind: "waitlist" }),
                  "Marked waitlist"
                )
              }
            >
              Mark waitlist
            </button>
          </>
        )}

        {/* R1: referral ask — only for the stages co-pilot Rule 2 targets.
            Shows a persistent "asked" state once the flag is set (by staff here
            or the robot's T+10 nurture send). */}
        {(detail.stage === "member" || detail.stage === "deposit_paid") &&
          (detail.depositAskedReferral ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-crm-line2 px-2.5 py-[5px] font-mono text-[10px] uppercase tracking-[0.08em] text-crm-muted">
              <span aria-hidden className="text-crm-green">
                ✓
              </span>
              Referral asked
            </span>
          ) : (
            <button
              type="button"
              className={BTN_SECONDARY}
              disabled={busy}
              onClick={() =>
                run(
                  () => markReferralAsked({ familyId: detail.id }),
                  "Referral ask recorded"
                )
              }
            >
              Mark referral asked
            </button>
          ))}

        {/* Overflow menu */}
        <div className="relative ml-auto">
          <button
            type="button"
            aria-label="More actions"
            aria-expanded={menuOpen}
            className={BTN_SECONDARY}
            onClick={() => setMenuOpen((v) => !v)}
          >
            ···
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full z-10 mt-1.5 w-56 rounded-[12px] border border-crm-line2 bg-white py-1 shadow-[0_4px_18px_rgba(19,20,22,0.14)]">
              {detail.consented ? (
                <button
                  type="button"
                  onClick={handleRevoke}
                  disabled={busy}
                  className="block w-full cursor-pointer px-3.5 py-2 text-left font-mono text-[10px] uppercase tracking-[0.08em] text-crm-red hover:bg-crm-card"
                >
                  Revoke consent
                </button>
              ) : (
                <span className="block px-3.5 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-crm-faint">
                  {detail.consentRevokedAt
                    ? "Consent revoked"
                    : "No consent on file"}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
