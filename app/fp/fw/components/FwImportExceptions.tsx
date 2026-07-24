"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/app/fp/components/system/Button";
import { resolveImportExceptionAction } from "@/app/fp/lib/actions/fw-import";
import type { FwOpsImportException } from "@/app/fp/lib/fw-import-core";
import { FW_BAND_LABEL } from "@/app/fp/lib/fw-nav-rules";
import { narrowFwBand } from "@/app/fp/lib/fw-provision-rules";

/** Copy per machine reason (the migration's own comment: "the ops surface renders
 *  copy"). One reason today; the fallback keeps an unmapped future reason visible
 *  rather than blank — the `fwReplayRejectReasonCopy` pattern. */
const REASON_COPY: Record<string, string> = {
  ambiguous_match:
    "This name matches more than one existing student, or one at a different band. Look them up above, then link or add them — and close this out.",
};
function reasonCopy(reason: string): string {
  return (
    REASON_COPY[reason] ??
    "This row needs a staff decision. Look the name up above, then link or add them — and close this out."
  );
}

/**
 * Pending import exceptions (FW Unit 7; gap G7) — the roster rows the importer
 * could not resolve on its own because the name matched more than one existing
 * student, or matched one at a different band. Nothing was minted for them.
 *
 * This is the G7 pre-event gate made visible: staff look each name up in "Find a
 * returning student" above (the Unit 5b resolver), then link the returner or
 * quick-create a genuinely new student — and CLOSE the exception here (Resolved),
 * or Dismiss it if it was noise. Same one-busy-state / try-catch-FINALLY shape as
 * the replay-reject list.
 */
export default function FwImportExceptions({
  cohortId,
  exceptions,
}: {
  cohortId: string;
  exceptions: FwOpsImportException[];
}) {
  const router = useRouter();
  /** `${id}:${disposition}` of the action in flight, or null. */
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const anyBusy = busy !== null;

  const close = async (exceptionId: string, disposition: "resolved" | "dismissed") => {
    if (anyBusy) return;
    setBusy(`${exceptionId}:${disposition}`);
    setError(null);
    try {
      const res = await resolveImportExceptionAction({ cohortId, exceptionId, disposition });
      if (res.success) {
        router.refresh();
        return; // finally clears the flag
      }
      setError(res.error);
    } catch {
      setError("That didn't go through. Try again.");
    } finally {
      setBusy(null);
    }
  };

  if (exceptions.length === 0) {
    return (
      <p className="mt-3 rounded-xl border border-hq-border bg-hq-sunken p-4 font-path-body text-sm leading-6 text-hq-ink-soft">
        Nothing to resolve — the last import raised no exceptions.
      </p>
    );
  }

  return (
    <div className="mt-3">
      <ul className="space-y-3">
        {exceptions.map((exc) => {
          const band = narrowFwBand(exc.band);
          return (
            <li key={exc.id} className="rounded-xl border border-hq-border bg-hq-surface p-4 shadow-hq">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="font-path-body text-sm font-medium text-hq-ink">
                  {exc.firstName} {exc.lastName}
                </p>
                <span className="inline-flex items-center rounded-full border border-not-yet/40 bg-not-yet/10 px-2.5 py-0.5 font-path-mono text-[11px] uppercase tracking-[0.1em] text-hq-ink">
                  {band ? FW_BAND_LABEL[band] : exc.band}
                </span>
              </div>
              <p className="mt-1.5 font-path-body text-sm leading-5 text-hq-ink-soft">
                {reasonCopy(exc.reason)}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  skin="hq"
                  variant="secondary"
                  size="md"
                  onClick={() => close(exc.id, "resolved")}
                  disabled={anyBusy}
                >
                  {busy === `${exc.id}:resolved` ? "Saving…" : "Mark resolved"}
                </Button>
                <Button
                  type="button"
                  skin="hq"
                  variant="ghost"
                  size="md"
                  onClick={() => close(exc.id, "dismissed")}
                  disabled={anyBusy}
                >
                  {busy === `${exc.id}:dismissed` ? "Saving…" : "Dismiss"}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-not-yet/40 bg-not-yet/10 p-3 font-path-body text-sm leading-5 text-hq-ink"
        >
          {error}
        </p>
      )}
    </div>
  );
}
