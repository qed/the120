"use client";

import { useState } from "react";
import { signOutFwGuide } from "@/app/fp/lib/actions/fw-guide";
import { runFwSignOut } from "@/app/fp/lib/fw-sync-client";
import { fwSignOutOutcomeCopy } from "@/app/fp/lib/fw-sync-rules";

/**
 * Block-until-drained sign-out (FW Unit 8; Decision 8 / gap G1).
 *
 * A shared guide iPad rotates operators, so its queue must never be abandoned on
 * sign-out — the deliberate DIVERGENCE from the Path queue's keep-on-sign-out
 * posture. This wraps the server `signOutFwGuide` action with the client-side
 * sequence, because the queue lives in IndexedDB (client), not the session (server).
 *
 * DELIBERATELY THIN. The sequence (evidence gate → verdict → one drain → re-verdict →
 * atomic clear), the refusal precedence and every sentence below live in
 * `fw-sync-rules.ts`: this repo's tests are node-only, so a decision written in a
 * `.tsx` is a decision CI cannot see — and the defect this replaces was exactly two
 * such decisions disagreeing. The button's whole job is to run the sequence, show
 * what it says, and only end the session on `sign_out`.
 *
 * NOTE for whoever mounts this elsewhere (the plan's staff nav bar): `needs_attention`
 * tells the guide to dismiss records "in the banner", and that banner is rendered by
 * `FwPwa` on `/fp/fw` only. Every OTHER refusal is now actionable from anywhere, but
 * that one still assumes the FW shell is on screen.
 */
export function FwSignOutButton({
  actorUserId,
  actorIsFwGuide,
}: {
  actorUserId: string;
  /** SERVER-KNOWN at the cohort layout (does this account hold a `guide` grant?).
   *  The device-evidence gate reads it instead of guessing from localStorage — see
   *  `hasFwDeviceEvidence`, B1. Staff reaching a cohort through the FW-D3 bridge hold
   *  no grant, so this is genuinely false for them. */
  actorIsFwGuide: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const outcome = await runFwSignOut({ actorUserId, actorIsFwGuide });
      if (outcome.kind === "sign_out") {
        await signOutFwGuide(); // redirects
        return;
      }
      setMessage(fwSignOutOutcomeCopy(outcome));
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
