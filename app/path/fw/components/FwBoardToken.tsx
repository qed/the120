"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/app/path/components/system/Button";
import { mintBoardTokenAction, revokeBoardTokenAction } from "@/app/path/lib/actions/fw-ops";
import type { FwOpsBoardToken } from "@/app/path/lib/fw-ops-core";

/**
 * The projected board's door (FW Unit 5; FW-R25, Decision 4).
 *
 * ── The raw token is shown ONCE, and the copy has to earn that
 *
 * Only the SHA-256 reaches the database, so there is no "show it again" — the
 * URL below exists in this component's state and nowhere else. When staff
 * navigate away it is gone and the only recovery is a re-mint, which kills the
 * link they just lost. The panel says so before they leave, not after.
 *
 * ── A re-mint is destructive, and the warning is pre-emptive
 *
 * Decision 4: one active token per cohort, enforced by a partial unique index —
 * so minting a new one REVOKES the live one. Mid-event that is a projector going
 * black until somebody types the new URL, which is one of the plan's three
 * guide-briefing lines. The button therefore says what it will do while the
 * board is live, and asks for a confirm; it does not say it afterwards, when the
 * room is already dark.
 *
 * try/catch/FINALLY on both submitting flags (docs/solutions/ui-bugs/
 * server-action-rejection-no-try-finally-freezes-capture-modal-2026-07-20.md).
 */

const STATUS_COPY: Record<
  FwOpsBoardToken["status"],
  { label: string; cls: string; detail: string }
> = {
  live: {
    label: "Live",
    cls: "border-verified/40 bg-verified/10",
    detail: "The projector URL works right now.",
  },
  never_minted: {
    label: "No link yet",
    cls: "border-hq-border bg-hq-sunken",
    detail: "Nobody has minted a board link for this weekend.",
  },
  expired: {
    label: "Expired",
    cls: "border-hq-border bg-hq-sunken",
    detail:
      "The link stopped working six hours after the weekend's end time. Mint a new one only if the dates are right.",
  },
  revoked: {
    label: "Revoked",
    cls: "border-not-yet/40 bg-not-yet/10",
    detail: "Someone killed this link deliberately. Mint a new one to bring the board back.",
  },
};

export default function FwBoardToken({
  cohortId,
  status,
}: {
  cohortId: string;
  status: FwOpsBoardToken;
}) {
  const router = useRouter();
  const [minting, setMinting] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<{ url: string; expiresAt: string } | null>(null);
  const [confirmingMint, setConfirmingMint] = useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);

  const copy = STATUS_COPY[status.status];
  const isLive = status.status === "live";
  const busy = minting || revoking;

  const doMint = async () => {
    setMinting(true);
    setError(null);
    setConfirmingMint(false);
    try {
      const res = await mintBoardTokenAction({ cohortId });
      if (res.success) {
        setMinted({
          url: `${window.location.origin}/path/fw/board/${res.token}`,
          expiresAt: res.expiresAt,
        });
        router.refresh();
        return; // finally still clears the flag
      }
      setError(res.error);
    } catch {
      setError("That didn't go through. Try again.");
    } finally {
      setMinting(false);
    }
  };

  const doRevoke = async () => {
    setRevoking(true);
    setError(null);
    setConfirmingRevoke(false);
    try {
      const res = await revokeBoardTokenAction({ cohortId });
      if (res.success) {
        setMinted(null);
        router.refresh();
        return;
      }
      setError(res.error);
    } catch {
      setError("That didn't go through. Try again.");
    } finally {
      setRevoking(false);
    }
  };

  return (
    <div className={`mt-3 rounded-xl border p-4 ${copy.cls}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="font-path-display text-base font-semibold text-hq-ink">{copy.label}</p>
        {status.expiresAt && (
          <p className="font-path-mono text-[11px] uppercase tracking-[0.1em] text-hq-ink-muted">
            {isLive ? "Expires" : "Expired"} {status.expiresAt}
          </p>
        )}
      </div>
      <p className="mt-1 font-path-body text-sm leading-5 text-hq-ink-soft">{copy.detail}</p>

      {minted && (
        <div className="mt-4 rounded-lg border border-hq-border-strong bg-hq-canvas p-3">
          <p className="font-path-mono text-[11px] uppercase tracking-[0.12em] text-hq-ink-muted">
            Copy this now — it is shown once
          </p>
          {/* Selectable, wrapping, monospaced: this gets read aloud across a
              room and typed into a browser on a laptop nobody has touched yet. */}
          <p className="mt-1.5 break-all font-path-mono text-sm leading-6 text-hq-ink">
            {minted.url}
          </p>
          <p className="mt-2 font-path-body text-xs leading-5 text-hq-ink-soft">
            Only a hash of this link is stored, so it cannot be shown again. If it is lost,
            minting a replacement is the only fix — and that kills this one.
          </p>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-not-yet/40 bg-not-yet/10 p-3 font-path-body text-sm leading-5 text-hq-ink"
        >
          {error}
        </p>
      )}

      {confirmingMint && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-not-yet/40 bg-not-yet/10 p-3 font-path-body text-sm leading-5 text-hq-ink"
        >
          The board link in use right now will stop working the moment this is minted. If a
          projector is showing the board, it goes blank until someone enters the new URL.
        </p>
      )}
      {confirmingRevoke && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-not-yet/40 bg-not-yet/10 p-3 font-path-body text-sm leading-5 text-hq-ink"
        >
          This takes the board down with no replacement. Anyone projecting it will see nothing
          until a new link is minted and entered.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {confirmingMint ? (
          <>
            <Button type="button" skin="hq" size="lg" onClick={doMint} disabled={busy}>
              {minting ? "Minting…" : "Yes — replace the live link"}
            </Button>
            <Button
              type="button"
              skin="hq"
              variant="secondary"
              size="lg"
              onClick={() => setConfirmingMint(false)}
              disabled={busy}
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button
            type="button"
            skin="hq"
            size="lg"
            // A live board is the ONLY case that needs the confirm; the other
            // three states have nothing to break.
            onClick={isLive ? () => setConfirmingMint(true) : doMint}
            disabled={busy}
          >
            {minting ? "Minting…" : isLive ? "Replace board link" : "Mint board link"}
          </Button>
        )}

        {isLive &&
          !confirmingMint &&
          (confirmingRevoke ? (
            <>
              <Button
                type="button"
                skin="hq"
                variant="secondary"
                size="lg"
                onClick={doRevoke}
                disabled={busy}
              >
                {revoking ? "Revoking…" : "Yes — take the board down"}
              </Button>
              <Button
                type="button"
                skin="hq"
                variant="secondary"
                size="lg"
                onClick={() => setConfirmingRevoke(false)}
                disabled={busy}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              type="button"
              skin="hq"
              variant="secondary"
              size="lg"
              onClick={() => setConfirmingRevoke(true)}
              disabled={busy}
            >
              Revoke
            </Button>
          ))}
      </div>
    </div>
  );
}
