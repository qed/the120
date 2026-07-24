"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/app/path/components/system/Button";
import { resolveReplayRejectAction } from "@/app/path/lib/actions/fw-ops";
import type { FwOpsReplayReject } from "@/app/path/lib/fw-ops-core";
import { fwReplayRejectReasonCopy } from "@/app/path/lib/fw-ops-rules";

/**
 * The offline-replay reject list (FW Unit 5b; Decision 9, gap G11).
 *
 * These rows are WRITTEN by Unit 8's drain (not yet built); this is the LIST +
 * resolve surface, which the plan names first because "a reject list with no way
 * to close a row is a list nobody reads twice". Each row names the student, the
 * task, the action, and a sentence rendered from the machine reason — and offers
 * exactly one affordance: mark it resolved once staff have handled it.
 *
 * ── ONE busy state across the panel, try/catch/FINALLY on every transition
 *
 * The same shape FwGuideRoster settled on: one `busy` value naming the row in
 * flight, every control disabled while anything runs, and one shared message
 * region each handler owns on exit — so two concurrent resolves can't leave a
 * stale "resolved" notice sitting over the wrong row.
 */
export default function FwReplayRejects({
  cohortId,
  rejects,
}: {
  cohortId: string;
  rejects: FwOpsReplayReject[];
}) {
  const router = useRouter();
  /** The reject id whose resolve is running, or null. */
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const anyBusy = busy !== null;

  const handleResolve = async (rejectId: string) => {
    if (anyBusy) return;
    setBusy(rejectId);
    setError(null);
    try {
      const res = await resolveReplayRejectAction({ cohortId, rejectId });
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

  if (rejects.length === 0) {
    return (
      <p className="mt-3 rounded-xl border border-hq-border bg-hq-sunken p-4 font-path-body text-sm leading-6 text-hq-ink-soft">
        Nothing to resolve — no offline replays were rejected for this weekend.
      </p>
    );
  }

  return (
    <div className="mt-3">
      <ul className="space-y-3">
        {rejects.map((reject) => {
          const rowBusy = busy === reject.id;
          return (
            <li
              key={reject.id}
              className="rounded-xl border border-hq-border bg-hq-surface p-4 shadow-hq"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="font-path-body text-sm font-medium text-hq-ink">
                  {reject.studentName ?? `Unnamed student (${reject.studentId})`}
                </p>
                <span className="inline-flex items-center rounded-full border border-not-yet/40 bg-not-yet/10 px-2.5 py-0.5 font-path-mono text-[11px] uppercase tracking-[0.1em] text-hq-ink">
                  {reject.taskId} · {reject.action}
                </span>
              </div>
              <p className="mt-1.5 font-path-body text-sm leading-5 text-hq-ink-soft">
                {fwReplayRejectReasonCopy(reject.reason)}
              </p>
              {reject.capturedAt && (
                <p className="mt-1 font-path-mono text-[11px] uppercase tracking-[0.1em] text-hq-ink-muted">
                  Captured {reject.capturedAt}
                </p>
              )}
              <div className="mt-3">
                <Button
                  type="button"
                  skin="hq"
                  variant="secondary"
                  size="md"
                  onClick={() => handleResolve(reject.id)}
                  disabled={anyBusy}
                >
                  {rowBusy ? "Resolving…" : "Mark resolved"}
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
