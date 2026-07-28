"use client";

/**
 * Per-row overflow menu for the ops weekend list (ops redesign Unit 2; R5–R7,
 * R9): a ⋯ trigger opening Archive (active weekends) or Restore (archived ones),
 * so retiring a weekend no longer requires opening its page first.
 *
 * PLACEMENT CONTRACT with the list page: this component is the LAST child of a
 * `relative` card `<li>`. The trigger is absolutely positioned into the card's
 * top-right corner (the row's Link reserves that corner with padding); the
 * confirm panel and any failure copy render in normal flow, which — because this
 * component follows the Link in the DOM — expands BELOW the row instead of
 * floating over it.
 *
 * A11y is StatusMenu's model (`app/crm/components/dossiers/StatusMenu.tsx`, the
 * a11y-complete precedent): role="menu"/"menuitem", roving tabindex with
 * Arrow/Home/End, Escape closes and returns focus to the trigger, outside
 * mousedown closes. Items are ACTIONS, so `menuitem`, not the stage menu's
 * `menuitemradio`.
 *
 * ARCHIVE confirms by typed slug in an inline panel (FwArchiveControl's visual
 * canon) and SENDS the typed value: `confirmSlug` is re-verified in the core
 * against the stored slug — the disabled-until-match button here is UX
 * convenience, the server check is the boundary. RESTORE acts directly: its
 * consequence is visibility, not destruction.
 *
 * Neither action ever `redirect()`s (both return typed results), so the catch
 * has no `isNextRedirect` guard to order — there is no digest to swallow. Busy
 * state is a REF + state pair (the StaffBar double-tap lesson), and the flag
 * clears in `finally` per docs/solutions/ui-bugs/server-action-rejection-no-
 * try-finally-freezes-capture-modal-2026-07-20.md.
 *
 * UNIT 3 SEAM: Delete joins `items` for rows the untouched classifier clears,
 * reusing this same typed-slug confirm panel with its own copy + action.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/app/fp/components/system/Icon";
import { archiveCohortAction, unarchiveCohortAction } from "@/app/fp/lib/actions/fw-ops";
import { fwArchiveConfirmMatches } from "@/app/fp/lib/fw-ops-rules";

export default function FwOpsRowMenu({
  cohortId,
  slug,
  archived,
}: {
  cohortId: string;
  slug: string;
  archived: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRef = useRef<HTMLButtonElement | null>(null);
  const confirmInputRef = useRef<HTMLInputElement | null>(null);

  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  // Click-outside closes the MENU only (mousedown, StatusMenu's reasoning: a
  // click that opens something else must not leave a stale panel). The confirm
  // panel deliberately does NOT outside-close — typing a slug is slow, and an
  // accidental tap wiping the field would teach staff to distrust the panel.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Focus moves into the menu on open (the ARIA menu pattern's home position;
  // no setState in effects — focus only).
  useEffect(() => {
    if (open) itemRef.current?.focus();
  }, [open]);

  // The confirm panel opens → the slug field takes focus (the next required act).
  useEffect(() => {
    if (confirming) confirmInputRef.current?.focus();
  }, [confirming]);

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
      setConfirming(false);
      setTyped("");
      router.refresh();
    } catch (e) {
      console.error("[fw/ops-row-menu] action failed:", e);
      setMessage("Something went wrong — please try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  // ONE item per state today (Archive for active weekends, Restore for archived
  // ones), so the roving tabindex degenerates honestly: the single item holds
  // tabIndex 0 and Arrow/Home/End keep focus on it (wrap-around over a set of
  // one). UNIT 3 GROWS THIS: Delete joins as a second item for untouched rows,
  // and the arrows start moving between two refs.
  const onPick = archived
    ? () => {
        close();
        void run(() => unarchiveCohortAction({ cohortId }));
      }
    : () => {
        // Focus moves to the panel's input (the effect above), not back to
        // the trigger — the menu handed off to the confirm.
        close(false);
        setMessage(null);
        setConfirming(true);
      };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      itemRef.current?.focus();
    }
  };

  const confirmed = fwArchiveConfirmMatches(typed, slug);

  return (
    <div ref={rootRef}>
      <div className="absolute right-2 top-2.5 z-10">
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Actions for ${slug}`}
          onClick={() => (open ? close(false) : setOpen(true))}
          className="flex h-11 w-11 items-center justify-center rounded-full text-hq-ink-soft transition-colors hover:bg-hq-sunken hover:text-hq-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hq-ink"
        >
          <Icon name="ellipsis" size={18} />
        </button>

        {open && (
          <div
            role="menu"
            aria-label={`Actions for ${slug}`}
            onKeyDown={onMenuKeyDown}
            className="absolute right-0 top-full z-20 mt-1.5 w-44 rounded-xl border border-hq-border bg-hq-surface py-1 shadow-hq"
          >
            <button
              ref={itemRef}
              type="button"
              role="menuitem"
              tabIndex={0}
              disabled={busy}
              onClick={onPick}
              className="block min-h-[44px] w-full px-3.5 py-2 text-left font-path-body text-sm text-hq-ink hover:bg-hq-sunken focus-visible:bg-hq-sunken focus-visible:outline-none disabled:opacity-50"
            >
              {archived ? "Restore" : "Archive…"}
            </button>
          </div>
        )}
      </div>

      {confirming && !archived && (
        <div className="mx-4 mb-4 rounded-xl border border-not-yet/40 bg-not-yet/10 p-3">
          <label
            className="block font-path-body text-sm leading-6 text-hq-ink-soft"
            htmlFor={`fw-ops-archive-confirm-${cohortId}`}
          >
            Archiving hides this weekend from the list and turns off its projector board for
            good. Type <span className="font-path-mono text-hq-ink">{slug}</span> to confirm.
          </label>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              id={`fw-ops-archive-confirm-${cohortId}`}
              ref={confirmInputRef}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-hq-border bg-hq-canvas px-3 font-path-mono text-sm text-hq-ink"
            />
            <button
              type="button"
              disabled={busy || !confirmed}
              onClick={() => run(() => archiveCohortAction({ cohortId, confirmSlug: typed }))}
              className="inline-flex min-h-[44px] items-center rounded-xl border border-not-yet/60 px-4 font-path-body text-sm font-semibold text-hq-ink hover:bg-not-yet/10 disabled:opacity-50"
            >
              {busy ? "Archiving…" : "Archive"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                setTyped("");
                setMessage(null);
                triggerRef.current?.focus();
              }}
              className="inline-flex min-h-[44px] items-center rounded-xl border border-hq-border px-4 font-path-body text-sm text-hq-ink-soft hover:text-hq-ink disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
          {message && (
            <p role="alert" className="mt-2 font-path-body text-sm text-not-yet">
              {message}
            </p>
          )}
        </div>
      )}

      {/* Restore has no panel to host its failure copy, so a refusal renders in
          the same below-the-row slot the archive panel uses. */}
      {!confirming && message && (
        <p role="alert" className="mx-4 mb-4 font-path-body text-sm text-not-yet">
          {message}
        </p>
      )}
    </div>
  );
}
