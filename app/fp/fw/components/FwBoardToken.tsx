"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/app/fp/components/system/Button";
import { mintBoardTokenAction, revokeBoardTokenAction } from "@/app/fp/lib/actions/fw-ops";
import type { FwOpsBoardToken } from "@/app/fp/lib/fw-ops-core";

/**
 * The projected board's door (FW Unit 5; FW-R25, Decision 4).
 *
 * ── The raw token is shown ONCE, and everything here is built around that
 *
 * Only the SHA-256 reaches the database, so there is no "show it again" — the
 * URL below exists in this component's state and nowhere else. Three
 * consequences, each of which was a live-review finding:
 *
 *   1. **This component is rendered UNCONDITIONALLY by its page**, even when the
 *      token read failed (`status === null`). It used to be nested inside the
 *      `token.ok` branch, which meant a transient read failure on the
 *      `router.refresh()` fired right after a successful mint swapped the whole
 *      subtree for an error paragraph — unmounting this component and taking
 *      the uncopied, unrecoverable token with it. On the connectivity this
 *      surface is built for, that is not a corner case.
 *   2. **`isLive` trusts local knowledge too.** A `router.refresh()` that never
 *      lands leaves the `status` prop stale; if we had just minted, we KNOW a
 *      live token exists, and the Revoke control has to stay reachable.
 *   3. **One state machine, not several booleans.** Two independent confirm
 *      flags let a cancelled mint-confirm resurrect a revoke-confirm the staffer
 *      had already navigated away from — the destructive prompt appearing
 *      unbidden right after an unrelated action.
 *
 * ── A re-mint is destructive, and the warning is pre-emptive
 *
 * Decision 4: one active token per cohort, enforced by a partial unique index —
 * so minting a new one REVOKES the live one. Mid-event that is a projector going
 * black until somebody types the new URL, which is one of the plan's three
 * guide-briefing lines. The button says what it will do while the board is live,
 * and asks for a confirm.
 *
 * try/catch/FINALLY on every transition (docs/solutions/ui-bugs/
 * server-action-rejection-no-try-finally-freezes-capture-modal-2026-07-20.md).
 */

/** One state, so entering any of these necessarily leaves the others. */
type Mode = "idle" | "confirm-mint" | "confirm-revoke" | "minting" | "revoking";

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

const UNREADABLE_COPY = {
  label: "Couldn't be read",
  cls: "border-not-yet/40 bg-not-yet/10",
  detail:
    "We couldn't read this weekend's board link just now. Reload before minting — minting on top of a link that is actually live would take the projector down.",
};

export default function FwBoardToken({
  cohortId,
  status,
}: {
  cohortId: string;
  /** null when the read FAILED — deliberately not collapsed into
   *  `never_minted`, which is the answer that invites a destructive mint. */
  status: FwOpsBoardToken | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("idle");
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<{ url: string; expiresAt: string } | null>(null);

  const copy = status === null ? UNREADABLE_COPY : STATUS_COPY[status.status];
  // Local knowledge counts: a mint we just completed means a live token exists
  // whether or not the refresh that would have told us so ever landed.
  const isLive = minted !== null || status?.status === "live";
  const busy = mode === "minting" || mode === "revoking";

  const doMint = async () => {
    setMode("minting");
    setError(null);
    try {
      const res = await mintBoardTokenAction({ cohortId });
      if (res.success) {
        setMinted({
          url: `${window.location.origin}/fp/fw/board/${res.token}`,
          expiresAt: res.expiresAt,
        });
        router.refresh();
        return; // finally still returns to idle
      }
      setError(res.error);
    } catch {
      setError("That didn't go through. Try again.");
    } finally {
      setMode("idle");
    }
  };

  const doRevoke = async () => {
    setMode("revoking");
    setError(null);
    try {
      // Names the token THIS PANEL IS SHOWING. If a re-mint landed in between,
      // the CAS refuses rather than killing whatever happens to be live now.
      const res = await revokeBoardTokenAction({
        cohortId,
        expectedTokenId: status?.tokenId,
      });
      if (res.success) {
        // The link this panel is showing is now dead — clearing it is the
        // honest thing, and it stops staff copying a URL that will 404.
        setMinted(null);
        router.refresh();
        return;
      }
      setError(res.error);
    } catch {
      setError("That didn't go through. Try again.");
    } finally {
      setMode("idle");
    }
  };

  return (
    <div className={`mt-3 rounded-xl border p-4 ${copy.cls}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="font-path-display text-base font-semibold text-hq-ink">{copy.label}</p>
        {status?.expiresAt && (
          <p className="font-path-mono text-[11px] uppercase tracking-[0.1em] text-hq-ink-muted">
            {status.status === "live" ? "Expires" : "Expired"} {status.expiresAt}
          </p>
        )}
      </div>
      <p
        className="mt-1 font-path-body text-sm leading-5 text-hq-ink-soft"
        role={status === null ? "alert" : undefined}
      >
        {copy.detail}
      </p>

      {/* Rendered before anything that could fail, and never inside a branch
          that a failed read can switch off. This is the only copy of the URL. */}
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
            Expires {minted.expiresAt}. Only a hash of this link is stored, so it cannot be shown
            again. If it is lost, minting a replacement is the only fix — and that kills this one.
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

      {mode === "confirm-mint" && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-not-yet/40 bg-not-yet/10 p-3 font-path-body text-sm leading-5 text-hq-ink"
        >
          The board link in use right now will stop working the moment this is minted. If a
          projector is showing the board, it goes blank until someone enters the new URL.
        </p>
      )}
      {mode === "confirm-revoke" && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-not-yet/40 bg-not-yet/10 p-3 font-path-body text-sm leading-5 text-hq-ink"
        >
          This takes the board down with no replacement. Anyone projecting it will see nothing
          until a new link is minted and entered.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {mode === "confirm-mint" ? (
          <>
            <Button type="button" skin="hq" size="lg" onClick={doMint} disabled={busy}>
              Yes — replace the live link
            </Button>
            <Button
              type="button"
              skin="hq"
              variant="secondary"
              size="lg"
              onClick={() => setMode("idle")}
              disabled={busy}
            >
              Cancel
            </Button>
          </>
        ) : mode === "confirm-revoke" ? (
          <>
            <Button
              type="button"
              skin="hq"
              variant="secondary"
              size="lg"
              onClick={doRevoke}
              disabled={busy}
            >
              Yes — take the board down
            </Button>
            <Button
              type="button"
              skin="hq"
              variant="secondary"
              size="lg"
              onClick={() => setMode("idle")}
              disabled={busy}
            >
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              skin="hq"
              size="lg"
              // A live board is the ONLY case that needs the confirm; the other
              // states have nothing to break. An UNREADABLE status is treated as
              // live for this purpose — refusing to mint blind is the safe way
              // round, since minting over a live link blanks a projector.
              onClick={isLive || status === null ? () => setMode("confirm-mint") : doMint}
              disabled={busy}
            >
              {mode === "minting"
                ? "Minting…"
                : isLive || status === null
                  ? "Replace board link"
                  : "Mint board link"}
            </Button>

            {isLive && (
              <Button
                type="button"
                skin="hq"
                variant="secondary"
                size="lg"
                onClick={() => setMode("confirm-revoke")}
                disabled={busy}
              >
                {mode === "revoking" ? "Revoking…" : "Revoke"}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
