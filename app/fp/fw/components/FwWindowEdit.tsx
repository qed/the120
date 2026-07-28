"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/app/fp/components/system/Button";
import {
  remintBoardTokenForWindowAction,
  updateCohortWindowAction,
} from "@/app/fp/lib/actions/fw-ops";
import { FW_EVENT_TIME_ZONES, fwEventLocalParts } from "@/app/fp/lib/fw-ops-rules";

/**
 * The weekend-window editor (ops redesign Unit 4; R14/R14a) — start, end, and
 * the host city's clock become correctable after creation, from the weekend's
 * own ops page.
 *
 * ── Field vocabulary is FwCohortCreate's, prefilled
 *
 * Same date + time inputs, same closed timezone `<select>` over
 * `FW_EVENT_TIME_ZONES` — an edit form that speaks a different dialect from
 * the create form is two forms to mistrust. Prefill comes through
 * `fwEventLocalParts`, the tested inverse of the conversion the save runs, so
 * an untouched form round-trips to the same instants.
 *
 * ── The board link deliberately does NOT follow the edit
 *
 * A live token keeps the `expires_at` stored at mint (`fw-board-rules.ts`'s
 * documented decision). After a successful save, when this page knows a live
 * token exists, the section says exactly that and offers the one-click
 * verdict-first revoke + re-mint — which names the token this page was
 * looking at (`expectedTokenId` CAS), so a concurrent re-mint refuses with
 * `stale_view` instead of killing somebody else's fresh link.
 *
 * ── The re-minted URL has the mint panel's shown-once contract
 *
 * Only a hash is stored, so the URL below exists in this component's state
 * and nowhere else. It renders unconditionally once set — never inside a
 * branch a later refusal or refresh could switch off (the FwBoardToken
 * lesson: an unmounted subtree takes an unrecoverable URL with it).
 *
 * try/catch/FINALLY on every awaited action (docs/solutions/ui-bugs/
 * server-action-rejection-no-try-finally-freezes-capture-modal-2026-07-20.md).
 */

const inputCls =
  "h-12 w-full rounded-xl border border-hq-border bg-hq-canvas px-3 font-path-body text-base text-hq-ink outline-none transition-colors placeholder:text-hq-ink-muted focus:border-hq-border-strong focus:ring-2 focus:ring-hq-ink/10";
const labelCls =
  "mb-1.5 block font-path-mono text-[11px] uppercase tracking-[0.12em] text-hq-ink-muted";

export default function FwWindowEdit({
  cohortId,
  startsAt,
  endsAt,
  timeZone,
  liveTokenId,
}: {
  cohortId: string;
  /** The stored instants, as the page loaded them. */
  startsAt: string | null;
  endsAt: string | null;
  /** The stored zone (may be null for pre-column cohorts — the prefill then
   *  reads the instants in UTC, which `fwEventLocalParts` labels honestly). */
  timeZone: string | null;
  /** The LIVE board token's id when one exists, else null — what the re-mint
   *  CAS names. The page derives it from the same load it renders the board
   *  panel from, so the two can never disagree. */
  liveTokenId: string | null;
}) {
  const router = useRouter();
  const startParts = fwEventLocalParts(startsAt, timeZone);
  const endParts = fwEventLocalParts(endsAt, timeZone);
  const [startDate, setStartDate] = useState(startParts?.date ?? "");
  const [startTime, setStartTime] = useState(startParts?.time ?? "09:00");
  const [endDate, setEndDate] = useState(endParts?.date ?? "");
  const [endTime, setEndTime] = useState(endParts?.time ?? "17:00");
  const [tz, setTz] = useState(timeZone ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [reminting, setReminting] = useState(false);
  const [remintError, setRemintError] = useState<string | null>(null);
  const [reminted, setReminted] = useState<{ url: string; expiresAt: string } | null>(null);

  const canSubmit =
    startDate.length > 0 &&
    startTime.length > 0 &&
    endDate.length > 0 &&
    endTime.length > 0 &&
    tz.length > 0 &&
    !busy;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await updateCohortWindowAction({
        cohortId,
        startDate,
        startTime,
        endDate,
        endTime,
        timeZone: tz,
      });
      if (res.success) {
        setSaved(true);
        router.refresh();
        return; // finally still clears busy
      }
      setError(res.error);
    } catch {
      setError("That didn't go through. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleRemint = async () => {
    if (reminting || !liveTokenId) return;
    setReminting(true);
    setRemintError(null);
    try {
      const res = await remintBoardTokenForWindowAction({
        cohortId,
        expectedTokenId: liveTokenId,
      });
      if (res.success) {
        setReminted({
          url: `${window.location.origin}/fp/fw/board/${res.token}`,
          expiresAt: res.expiresAt,
        });
        router.refresh();
        return;
      }
      setRemintError(res.error);
    } catch {
      setRemintError("That didn't go through. Try again.");
    } finally {
      setReminting(false);
    }
  };

  return (
    <div className="mt-3">
      <form
        onSubmit={handleSave}
        className="rounded-xl border border-hq-border bg-hq-surface p-4 shadow-hq"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block" htmlFor="fw-window-start-date">
            <span className={labelCls}>Starts</span>
            <input
              id="fw-window-start-date"
              type="date"
              className={inputCls}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
            />
          </label>
          <label className="block" htmlFor="fw-window-start-time">
            <span className={labelCls}>at</span>
            <input
              id="fw-window-start-time"
              type="time"
              className={inputCls}
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              required
            />
          </label>
          <label className="block" htmlFor="fw-window-end-date">
            <span className={labelCls}>Ends</span>
            <input
              id="fw-window-end-date"
              type="date"
              className={inputCls}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              required
            />
          </label>
          <label className="block" htmlFor="fw-window-end-time">
            <span className={labelCls}>at</span>
            <input
              id="fw-window-end-time"
              type="time"
              className={inputCls}
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              required
            />
          </label>
        </div>

        <label className="mt-4 block" htmlFor="fw-window-tz">
          <span className={labelCls}>The host city&apos;s clock</span>
          <select
            id="fw-window-tz"
            className={inputCls}
            value={tz}
            onChange={(e) => setTz(e.target.value)}
            required
          >
            {/* A cohort with no recorded zone prefills empty — the same
                no-default rule as creation: the dates mean nothing without it. */}
            <option value="">Pick one…</option>
            {FW_EVENT_TIME_ZONES.map((z) => (
              <option key={z.id} value={z.id}>
                {z.label}
              </option>
            ))}
          </select>
        </label>

        {error && (
          <p
            role="alert"
            className="mt-3 rounded-lg border border-not-yet/40 bg-not-yet/10 p-3 font-path-body text-sm leading-5 text-hq-ink"
          >
            {error}
          </p>
        )}
        {saved && (
          <p
            role="status"
            className="mt-3 rounded-lg border border-verified/40 bg-verified/10 p-3 font-path-body text-sm leading-5 text-hq-ink"
          >
            Window saved.
          </p>
        )}

        <div className="mt-4">
          <Button type="submit" skin="hq" size="lg" disabled={!canSubmit}>
            {busy ? "Saving…" : "Save window"}
          </Button>
        </div>
      </form>

      {/* The shown-once URL — rendered UNCONDITIONALLY once set, before any
          branch a refusal could switch off. This is the only copy of it. */}
      {reminted && (
        <div className="mt-4 rounded-lg border border-hq-border-strong bg-hq-canvas p-3">
          <p className="font-path-mono text-[11px] uppercase tracking-[0.12em] text-hq-ink-muted">
            Copy this now — it is shown once
          </p>
          <p className="mt-1.5 break-all font-path-mono text-sm leading-6 text-hq-ink">
            {reminted.url}
          </p>
          <p className="mt-2 font-path-body text-xs leading-5 text-hq-ink-soft">
            Expires {reminted.expiresAt}. Only a hash of this link is stored, so it cannot be
            shown again. The previous board link is dead — anyone projecting it needs this one.
          </p>
        </div>
      )}

      {saved && liveTokenId && !reminted && (
        <div className="mt-4 rounded-xl border border-not-yet/40 bg-not-yet/10 p-4">
          <p className="font-path-body text-sm leading-6 text-hq-ink">
            The live board link keeps the expiry it was issued for — it does not follow this
            edit. Re-mint it if the board should run to the corrected end time. The current
            link dies the moment the new one is minted.
          </p>
          {remintError && (
            <p
              role="alert"
              className="mt-3 rounded-lg border border-not-yet/40 bg-not-yet/10 p-3 font-path-body text-sm leading-5 text-hq-ink"
            >
              {remintError}
            </p>
          )}
          <div className="mt-3">
            <Button
              type="button"
              skin="hq"
              variant="secondary"
              size="lg"
              onClick={handleRemint}
              disabled={reminting}
            >
              {reminting ? "Re-minting…" : "Revoke + re-mint for the corrected window"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
