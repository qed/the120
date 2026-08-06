"use client";

/**
 * Archive / unarchive, from the ops cohort page (Unit 9; R19, R26).
 *
 * DELIBERATELY THIN (environment: "node", no jsdom): every decision is a pure
 * function in `fw-ops-rules.ts` — the confirm-match rule, the banner copy, the
 * affordance table that says when this renders which mode. This file wires state
 * to those answers.
 *
 * The ARCHIVE side confirms by typed slug, same gate as anonymize: it darkens a
 * public URL and hides the weekend from the default list, and both are a click's
 * worth of accident without the gate. The typed slug is SENT with the action
 * (`confirmSlug`) and re-verified in the core against the stored slug (ops
 * redesign Unit 2) — the disabled-until-match button below is UX convenience;
 * the server check is the boundary. The UNARCHIVE side is one button — its
 * consequence is visibility, not destruction, and the board deliberately stays
 * dark until an explicit re-mint (the server's contract; the copy says so).
 *
 * Busy state is a REF + state pair (the StaffBar's double-tap lesson): two taps in
 * one frame both read `busy === false` from state alone.
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { archiveCohortAction, unarchiveCohortAction } from "@/app/lib/fp/actions/fw-ops";
import { fwArchiveConfirmMatches } from "@/app/lib/fp/fw-ops-rules";

export default function FwArchiveControl({
  cohortId,
  slug,
  archived,
}: {
  cohortId: string;
  slug: string;
  archived: boolean;
}) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);

  const run = async (action: () => Promise<{ success: boolean; error?: string }>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const res = await action();
      if (!res.success) {
        setMessage(res.error ?? "Something went wrong — please try again.");
        return;
      }
      router.refresh();
    } catch (e) {
      console.error("[fw/archive-control] action failed:", e);
      setMessage("Something went wrong — please try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  if (archived) {
    return (
      <div className="mt-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => unarchiveCohortAction({ cohortId }))}
          className="inline-flex min-h-[44px] items-center rounded-xl border border-hq-border px-4 font-path-body text-sm font-semibold text-hq-ink hover:bg-hq-surface disabled:opacity-50"
        >
          {busy ? "Restoring…" : "Unarchive this weekend"}
        </button>
        <p className="mt-2 font-path-body text-xs leading-5 text-hq-ink-muted">
          Restoring makes it visible again. The projector board stays off until you mint a new
          URL — the old one is gone for good.
        </p>
        {message && (
          <p role="alert" className="mt-2 font-path-body text-sm text-not-yet">
            {message}
          </p>
        )}
      </div>
    );
  }

  const confirmed = fwArchiveConfirmMatches(typed, slug);
  return (
    <div className="mt-3">
      <label className="block font-path-body text-sm text-hq-ink-soft" htmlFor="fw-archive-confirm">
        Archiving hides this weekend from the list and turns off its projector board for good.
        Type <span className="font-path-mono text-hq-ink">{slug}</span> to confirm.
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          id="fw-archive-confirm"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          className="min-h-[44px] rounded-xl border border-hq-border bg-hq-canvas px-3 font-path-mono text-sm text-hq-ink"
        />
        <button
          type="button"
          disabled={busy || !confirmed}
          onClick={() => run(() => archiveCohortAction({ cohortId, confirmSlug: typed }))}
          className="inline-flex min-h-[44px] items-center rounded-xl border border-not-yet/60 px-4 font-path-body text-sm font-semibold text-hq-ink hover:bg-not-yet/10 disabled:opacity-50"
        >
          {busy ? "Archiving…" : "Archive this weekend"}
        </button>
      </div>
      {message && (
        <p role="alert" className="mt-2 font-path-body text-sm text-not-yet">
          {message}
        </p>
      )}
    </div>
  );
}
