"use client";

import { useState } from "react";
import { signOutFwGuide } from "@/app/fp/lib/actions/fw-guide";
import {
  clearFwResidue,
  fwSignOutVerdict,
  runFwClientDrain,
} from "@/app/fp/lib/fw-sync-client";

/**
 * Block-until-drained sign-out (FW Unit 8; Decision 8 / gap G1).
 *
 * A shared guide iPad rotates operators, so its queue must never be abandoned on
 * sign-out — the deliberate DIVERGENCE from the Path queue's keep-on-sign-out
 * posture. This wraps the server `signOutFwGuide` action with the client-side
 * verdict, because the queue lives in IndexedDB (client), not the session (server):
 *
 *   - empty queue → clear BOTH stores (queue + roster cache) and sign out;
 *   - queued ONLINE → drain first, then re-check and sign out if it cleared;
 *   - queued OFFLINE → refused with a count (no drain is possible, and — the stated
 *     consequence — no new sign-in is possible either, so the device stays with its
 *     guide until reconnect).
 */
export function FwSignOutButton({ actorUserId }: { actorUserId: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const messageFor = (reason: "queued_offline" | "drain_first" | "needs_attention" | "unreadable", count: number) => {
    switch (reason) {
      case "queued_offline":
        return `${count} check-in${count === 1 ? "" : "s"} haven't sent yet. Stay signed in until you're back online — they'll send automatically.`;
      case "drain_first":
        return `${count} check-in${count === 1 ? "" : "s"} are still sending. Try again in a moment.`;
      case "needs_attention":
        return `${count} saved check-in${count === 1 ? "" : "s"} couldn't be read by this app version. Dismiss ${count === 1 ? "it" : "them"} in the banner, then sign out.`;
      case "unreadable":
        return "Couldn't check your saved check-ins just now. Try again in a moment.";
    }
  };

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      let verdict = await fwSignOutVerdict(actorUserId);
      if (!verdict.ok && verdict.reason === "drain_first") {
        // Online with queued items — drain, then re-check.
        await runFwClientDrain({ actorUserId }, { wait: true, includeStuck: true });
        verdict = await fwSignOutVerdict(actorUserId);
      }
      if (verdict.ok) {
        // The clear is ATOMIC-if-empty: if a check-in raced in after the verdict, it
        // no-ops and reports cleared:false — abort rather than sign out having lost it.
        const { cleared } = await clearFwResidue();
        if (!cleared) {
          setMessage("A check-in just came in — try signing out again in a moment.");
          return;
        }
        await signOutFwGuide(); // redirects
        return;
      }
      setMessage(messageFor(verdict.reason, verdict.queuedCount));
    } catch (e) {
      console.error("[fw/pwa] sign-out flow failed:", e);
      setMessage("Couldn't sign out just now. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void onClick()}
        disabled={busy}
        className="min-h-[44px] font-path-body text-sm text-hq-ink-soft underline underline-offset-2 hover:text-hq-ink disabled:opacity-60"
      >
        {busy ? "Checking…" : "Sign out"}
      </button>
      {message && (
        <p role="status" className="max-w-[16rem] text-right font-path-body text-xs leading-4 text-not-yet">
          {message}
        </p>
      )}
    </div>
  );
}
