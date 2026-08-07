"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/app/fp/fw/components/system/Icon";
import { applyFwCheckIn } from "@/app/lib/fp/actions/fw-checkin";
import type { FwCheckInActionResult } from "@/app/lib/fp/fw-checkin-core";
import { FW_ACTION_TIMEOUT_MS, withFwTimeout } from "@/app/lib/fp/fw-call";
import { enqueueFwCheckIns, enqueueFwFlip } from "@/app/lib/fp/fw-sync-client";
import {
  fwFlipLeg1Verdict,
  fwPendingMarker,
  projectFwPendingState,
  type FwFlipLeg,
  type FwQueueEntry,
} from "@/app/lib/fp/fw-sync-rules";
import {
  decideFwAction,
  fwActionTarget,
  fwStudentResultLine,
  isFirstDollarTask,
  type FwAction,
  type FwClientIdLedger,
  type FwStudentResult,
} from "@/app/lib/fp/fw-rules";
import type { TaskState } from "@/app/lib/fp/transition-table";

/**
 * The inline decision control (ops-guide redesign Unit 9; R20, R22, R22a, R22b,
 * R23) — `FwTaskView`'s engine contract in a smaller body, mounted at every task
 * row's trailing edge through `FwTaskTree`'s `renderDecision` seam.
 *
 * ── Every control is derived from `decideFwAction`, never re-derived ──────────
 * Same rule as the view it replaces: "is this already decided, and may this
 * action touch it?" has ONE answer in this system, and the buttons are a map
 * over the action set with the shared predicate deciding each one's presence
 * and enabled-ness. The single deliberate extension: a `not_yet` tap that the
 * table refuses with `undo_first` is not a dead button any more — it is THE
 * COMPOSED FLIP (one tap → undo, then not_yet), because the refusal's own
 * recovery ("undo it first") is exactly what the tap now performs.
 *
 * ── The flip (Key Decision, flow gap 5) ───────────────────────────────────────
 * Two ordinary actions, client-sequenced; never a new op kind and never an
 * online CAS. Both per-leg client ids are minted (or re-held) from the shared
 * page ledger BEFORE the online attempt. Online: awaited leg 1, then leg 2
 * gated on `fwFlipLeg1Verdict` (`applied`/`already_done`/`replayed`/
 * `not_a_decision` release it — a replayed undo is leg-SUCCESS). On
 * `unavailable`/timeout/throw at any point, BOTH legs backstop-enqueue through
 * `enqueueFwFlip`, each with its own held id, and the drain's ordered replay is
 * the conditionality. Offline: both legs enqueue unconditionally. Legs never
 * share an `actionId`.
 *
 * ── Honest optimistic state (R22a; the plan's state diagram) ──────────────────
 * idle / in-flight (busy-guarded) / recorded (AUTHORITATIVE echo only — the
 * state the RPC returned from under its row lock, never a local guess) /
 * queued-offline (visibly distinct clock chip) / failed (inline Retry, reusing
 * the same held client id) / refused (revert to the echoed state + the salvaged
 * per-refusal copy line). A pending sequence that LEADS with an undo renders
 * the server state unchanged plus the `pending_flip` marker —
 * `projectFwPendingState`'s documented conservatism, kept.
 *
 * ── What is deliberately GONE (origin Key Decisions) ──────────────────────────
 * The First Dollar confirm (the checkmark is instant like everything else; the
 * celebration still fires exactly once, gated server-side on `applied`), the
 * batch picker and its shared-action-id grouping (each tap its own actionId),
 * the "— Recorded" line, and "Next student". The undo-on-first-dollar BANNER
 * RETRACTION survives: responses for the first-dollar task are folded into the
 * page surface by the parent (`foldFwSurfaceOutcome`), so an undo takes a
 * still-displayed bell banner down — the fired moment itself cannot be recalled,
 * and is not what the fold touches.
 */

const ACTION_LABEL: Record<FwAction, string> = {
  checkmark: "Checkmark",
  not_yet: "Not yet",
  undo: "Undo",
};

const ACTION_ICON: Record<FwAction, "check" | "x" | "refresh"> = {
  checkmark: "check",
  not_yet: "x",
  undo: "refresh",
};

const OFFLINE_UNSUPPORTED =
  "That didn't go through, and this device can't save it offline. Keep a signal, or use paper as backup.";

type FwInlineNote = {
  kind: "queued" | "refused" | "failed";
  text: string;
};

/** What an inline Retry re-runs — the same tap, so the ledger re-issues the same
 *  held client ids (the exactly-once contract across retries). */
type FwInlineRetry = { kind: "single"; action: FwAction } | { kind: "flip" };

export default function FwInlineDecision({
  cohortId,
  taskId,
  taskTitle,
  studentId,
  studentFirstName,
  actorUserId,
  serverState,
  pendingOps,
  ledger,
  onFirstDollarFold,
}: {
  cohortId: string;
  taskId: string;
  taskTitle: string;
  studentId: string;
  studentFirstName: string;
  /** The signed-in guide — stamped on an offline capture as the capturing actor. */
  actorUserId: string;
  /** The tree's server-rendered state for this row (refreshed via router.refresh). */
  serverState: TaskState;
  /** This guide's own non-blocked queued ops for THIS task, from the page-level
   *  subscription (one queue scan per student page, never one per row). */
  pendingOps: readonly FwQueueEntry[];
  /** The ONE page-level ledger (owned by FwStudentView) — an unsettled client id
   *  survives row remounts, which is the ledger's point. */
  ledger: FwClientIdLedger;
  /** Fold a first-dollar task response into the page surface — the standing-bell
   *  banner and its undo retraction (`foldFwSurfaceOutcome` upstairs). */
  onFirstDollarFold: (
    next: { outcomes: readonly FwStudentResult[]; firstDollar: readonly string[] },
    submittedStudentIds: readonly string[]
  ) => void;
}) {
  const router = useRouter();
  /** The AUTHORITATIVE echo from the last online tap — outlives a router.refresh
   *  race, never a local guess at what the action must have done. */
  const [echo, setEcho] = useState<TaskState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<FwInlineNote | null>(null);
  const [retry, setRetry] = useState<FwInlineRetry | null>(null);
  /** Which action is in flight — the tapped icon pulses, the others just disable. */
  const [inFlight, setInFlight] = useState<FwAction | null>(null);

  // Synchronous re-entry guard: two taps in one frame must not double-submit
  // (state updates are async; a ref is not).
  const busyRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const marker = fwPendingMarker(pendingOps);
  // The state this row SHOWS: the echo if an online tap answered, else the
  // server state with this guide's own pending ops folded through the canonical
  // table. A leading-undo (pending flip) projection deliberately does not move.
  const base = echo ?? serverState;
  const shown = pendingOps.length === 0 ? base : projectFwPendingState(base, pendingOps);

  const offline = () => typeof navigator !== "undefined" && navigator.onLine === false;
  const nowIso = () => new Date().toISOString();
  const mineOf = (outcomes: readonly FwStudentResult[]) =>
    outcomes.find((o) => o.studentId === studentId);

  const begin = (action: FwAction) => {
    busyRef.current = true;
    setBusy(true);
    setInFlight(action);
    setNote(null);
    setRetry(null);
  };
  const end = () => {
    busyRef.current = false;
    if (mounted.current) {
      setBusy(false);
      setInFlight(null);
    }
  };
  const fail = (text: string, retryWith: FwInlineRetry | null) => {
    if (!mounted.current) return;
    setNote({ kind: "failed", text });
    setRetry(retryWith);
  };

  /** Fold an action-level outright failure into the first-dollar surface, so a
   *  standing banner never survives beside an error claiming the tap failed —
   *  the same parity `FwTaskView` kept via `fwResultsForFailedAction`. */
  const foldFailure = () => {
    if (!isFirstDollarTask(taskId)) return;
    onFirstDollarFold(
      {
        outcomes: [{ studentId, kind: "failed", reason: "unavailable" }],
        firstDollar: [],
      },
      [studentId]
    );
  };

  const actionRefusalCopy = (reason: "no_session" | "forbidden" | "invalid_input"): string =>
    reason === "no_session"
      ? "Your session ended. Sign in again."
      : reason === "forbidden"
        ? "You can't record check-ins for this weekend. Find The 120 staff."
        : "Something about that tap didn't look right. Try again.";

  /** The durable backstop for an online tap that couldn't reach the server —
   *  keyed by the SAME held client ids the failed call used, so the drain's
   *  replay is idempotent if the write had in fact landed. */
  const backstopSingle = async (
    action: FwAction,
    clientIds: Readonly<Record<string, string>>
  ): Promise<boolean> => {
    const enq = await enqueueFwCheckIns({
      cohortId,
      taskId,
      action,
      actorUserId,
      studentIds: [studentId],
      actionId: crypto.randomUUID(),
      capturedAt: nowIso(),
      clientIds,
    });
    if (!enq.ok) return false;
    if (mounted.current) {
      setNote({
        kind: "queued",
        text: "Couldn't reach the server — saved. It'll send when you're back online.",
      });
    }
    return true;
  };

  /* ── the single tap — FwTaskView's contract, one student ─────────────────── */

  const runSingle = async (action: FwAction) => {
    begin(action);
    try {
      if (offline()) {
        const enq = await enqueueFwCheckIns({
          cohortId,
          taskId,
          action,
          actorUserId,
          studentIds: [studentId],
          actionId: crypto.randomUUID(),
          capturedAt: nowIso(),
        });
        if (!mounted.current) return;
        if (!enq.ok) {
          fail("This device can't save check-ins offline. Keep a signal, or use paper as backup.", null);
          return;
        }
        // No optimistic echo here: the queue subscription re-renders this row
        // with the pending projection (or the pending-flip marker), which is
        // the honest rendering of "captured, not yet landed".
        setNote({ kind: "queued", text: "Saved. It'll send when you're back online." });
        return;
      }

      // Minted (or re-held) BEFORE the call, so a retry of this same tap carries
      // the same key and cannot append a phantom re-attempt event.
      const clientIds = ledger.idsFor({ taskId, action, studentIds: [studentId] });
      const raced = await withFwTimeout(
        applyFwCheckIn({ cohortId, taskId, action, studentIds: [studentId], clientIds }),
        `check-in ${action}`,
        FW_ACTION_TIMEOUT_MS
      );
      if (raced.timedOut) {
        // Neither proof it landed nor proof it did not — durably capture with
        // the same key and let the idempotent drain settle it.
        if (await backstopSingle(action, clientIds)) return;
        foldFailure();
        fail(OFFLINE_UNSUPPORTED, { kind: "single", action });
        return;
      }
      const res: FwCheckInActionResult = raced.value;

      if (!res.ok) {
        if (res.reason === "unavailable" && (await backstopSingle(action, clientIds))) return;
        foldFailure();
        fail(
          res.reason === "unavailable" ? OFFLINE_UNSUPPORTED : actionRefusalCopy(res.reason),
          res.reason === "unavailable" || res.reason === "invalid_input"
            ? { kind: "single", action }
            : null
        );
        return;
      }

      // Release the key if the server actually decided; an ambiguous outcome
      // keeps it for the retry.
      ledger.settle({ taskId, action }, res.outcomes);
      // The banner fold — including the undo retraction — before any early return.
      if (isFirstDollarTask(taskId)) onFirstDollarFold(res, [studentId]);

      const mine = mineOf(res.outcomes);
      if (mine && mine.kind === "failed" && mine.reason === "unavailable") {
        // The request succeeded but this student's write did not answer —
        // durably capture rather than leave it in ephemeral state.
        if (await backstopSingle(action, clientIds)) return;
        fail(fwStudentResultLine(mine, studentFirstName), { kind: "single", action });
        return;
      }

      if (!mounted.current) return;
      // The authoritative state, echoed from under the RPC's row lock. A refusal
      // caused by another guide's concurrent tap self-heals the stale view.
      if (mine && "state" in mine) setEcho(mine.state);
      if (mine && (mine.kind === "refused" || mine.kind === "skipped" || mine.kind === "failed")) {
        setNote({
          kind: mine.kind === "refused" ? "refused" : "failed",
          text: fwStudentResultLine(mine, studentFirstName),
        });
      }
      // Keeps the tree's chips and counts honest — the row's serverState prop
      // is what this refresh updates.
      router.refresh();
    } catch {
      // A Server Action can REJECT rather than return. Capture durably FIRST —
      // even if this row unmounted, the enqueue must still run.
      if (await backstopSingle(action, ledger.idsFor({ taskId, action, studentIds: [studentId] }))) {
        return;
      }
      if (!mounted.current) return;
      foldFailure();
      fail(OFFLINE_UNSUPPORTED, { kind: "single", action });
    } finally {
      end();
    }
  };

  /* ── the composed flip — checked → Not yet in one tap ────────────────────── */

  const runFlip = async () => {
    begin("not_yet");
    // BOTH leg ids held before anything is attempted (Key Decision): leg 2
    // must never ride leg 1's id, or the RPC's replay probe swallows it as
    // `replayed`. `fwTapKey` already keys per action, so the ledger hands the
    // two legs distinct, retry-stable ids with no key change. Derived OUTSIDE
    // the try, because the catch must reuse these exact ids: after leg 1's
    // settle() releases the undo key, a fresh idsFor there would mint a NEW
    // undo id, and the drain would reject the backstopped pair — losing the
    // not_yet.
    const undoId = ledger.idsFor({ taskId, action: "undo", studentIds: [studentId] })[studentId];
    const notYetId = ledger.idsFor({ taskId, action: "not_yet", studentIds: [studentId] })[
      studentId
    ];
    try {
      const legs = (): FwFlipLeg[] => [
        // Fresh actionIds per enqueue are fine — the exactly-once key is the
        // clientId; the actionId only groups a board celebration per action.
        { action: "undo", actionId: crypto.randomUUID(), clientId: undoId },
        { action: "not_yet", actionId: crypto.randomUUID(), clientId: notYetId },
      ];
      const backstopFlip = async (): Promise<boolean> => {
        const enq = await enqueueFwFlip({
          cohortId,
          taskId,
          studentId,
          actorUserId,
          capturedAt: nowIso(),
          legs: legs(),
        });
        if (!enq.ok) return false;
        if (mounted.current) {
          setNote({ kind: "queued", text: "Saved. It'll flip to Not yet when you're back online." });
        }
        return true;
      };

      if (offline()) {
        // Offline: enqueue both legs unconditionally; the drain's ordered
        // replay (halt-on-first-non-settle) is the conditionality.
        if (await backstopFlip()) return;
        fail("This device can't save check-ins offline. Keep a signal, or use paper as backup.", null);
        return;
      }

      // ── leg 1: the undo, awaited ─────────────────────────────────────────
      const r1 = await withFwTimeout(
        applyFwCheckIn({
          cohortId,
          taskId,
          action: "undo",
          studentIds: [studentId],
          clientIds: { [studentId]: undoId },
        }),
        "check-in flip undo",
        FW_ACTION_TIMEOUT_MS
      );
      if (r1.timedOut) {
        if (await backstopFlip()) return;
        fail(OFFLINE_UNSUPPORTED, { kind: "flip" });
        return;
      }
      const res1: FwCheckInActionResult = r1.value;
      if (!res1.ok) {
        if (res1.reason === "unavailable" && (await backstopFlip())) return;
        fail(
          res1.reason === "unavailable" ? OFFLINE_UNSUPPORTED : actionRefusalCopy(res1.reason),
          res1.reason === "unavailable" || res1.reason === "invalid_input" ? { kind: "flip" } : null
        );
        return;
      }
      ledger.settle({ taskId, action: "undo" }, res1.outcomes);
      // An undo on the first-dollar task retracts a still-standing bell banner
      // (the fold's submitted-minus rule) — the origin-accepted behavior kept.
      if (isFirstDollarTask(taskId)) onFirstDollarFold(res1, [studentId]);

      const mine1 = mineOf(res1.outcomes);
      const verdict = fwFlipLeg1Verdict(mine1);
      if (verdict === "backstop") {
        if (await backstopFlip()) return;
        fail(OFFLINE_UNSUPPORTED, { kind: "flip" });
        return;
      }
      if (verdict === "halt") {
        if (!mounted.current) return;
        if (mine1 && "state" in mine1) setEcho(mine1.state);
        setNote({
          kind: mine1?.kind === "refused" ? "refused" : "failed",
          text: mine1 ? fwStudentResultLine(mine1, studentFirstName) : OFFLINE_UNSUPPORTED,
        });
        return;
      }

      // ── leg 2: the not_yet, released by leg 1 ────────────────────────────
      const r2 = await withFwTimeout(
        applyFwCheckIn({
          cohortId,
          taskId,
          action: "not_yet",
          studentIds: [studentId],
          clientIds: { [studentId]: notYetId },
        }),
        "check-in flip not_yet",
        FW_ACTION_TIMEOUT_MS
      );
      // From here, any no-answer backstops BOTH legs: the landed undo replays
      // as `replayed`, which the drain treats as leg-success and releases the
      // not_yet — idempotent by construction.
      if (r2.timedOut) {
        if (await backstopFlip()) return;
        fail(OFFLINE_UNSUPPORTED, { kind: "flip" });
        return;
      }
      const res2: FwCheckInActionResult = r2.value;
      if (!res2.ok) {
        if (res2.reason === "unavailable" && (await backstopFlip())) return;
        fail(
          res2.reason === "unavailable" ? OFFLINE_UNSUPPORTED : actionRefusalCopy(res2.reason),
          res2.reason === "unavailable" || res2.reason === "invalid_input" ? { kind: "flip" } : null
        );
        return;
      }
      ledger.settle({ taskId, action: "not_yet" }, res2.outcomes);

      const mine2 = mineOf(res2.outcomes);
      if (mine2 && mine2.kind === "failed" && mine2.reason === "unavailable") {
        if (await backstopFlip()) return;
        fail(fwStudentResultLine(mine2, studentFirstName), { kind: "flip" });
        return;
      }
      if (!mounted.current) return;
      if (mine2 && "state" in mine2) setEcho(mine2.state);
      if (mine2 && (mine2.kind === "refused" || mine2.kind === "skipped" || mine2.kind === "failed")) {
        setNote({
          kind: mine2.kind === "refused" ? "refused" : "failed",
          text: fwStudentResultLine(mine2, studentFirstName),
        });
      }
      router.refresh();
    } catch {
      // A rejection anywhere in the sequence: both legs to the queue, each with
      // the SAME id hoisted above the try — never re-derived here, because a
      // post-settle idsFor mints a new key the drain would reject.
      const enq = await enqueueFwFlip({
        cohortId,
        taskId,
        studentId,
        actorUserId,
        capturedAt: nowIso(),
        legs: [
          { action: "undo", actionId: crypto.randomUUID(), clientId: undoId },
          { action: "not_yet", actionId: crypto.randomUUID(), clientId: notYetId },
        ],
      });
      if (enq.ok) {
        if (mounted.current) {
          setNote({ kind: "queued", text: "Saved. It'll flip to Not yet when you're back online." });
        }
        return;
      }
      if (!mounted.current) return;
      fail(OFFLINE_UNSUPPORTED, { kind: "flip" });
    } finally {
      end();
    }
  };

  const onTap = (action: FwAction) => {
    if (busyRef.current) return;
    const decision = decideFwAction({ action, from: shown });
    if (action === "not_yet" && decision.kind === "refused" && decision.reason === "undo_first") {
      void runFlip();
      return;
    }
    if (decision.kind !== "apply" && decision.kind !== "re_attempt") return;
    void runSingle(action);
  };

  const onRetry = () => {
    if (busyRef.current || retry === null) return;
    if (retry.kind === "flip") void runFlip();
    else void runSingle(retry.action);
  };

  return (
    <div className="flex shrink-0 flex-col items-end gap-1.5">
      <div
        role="group"
        aria-label={`Check-in for ${taskId} — ${taskTitle}`}
        className="flex items-center gap-1.5"
      >
        {marker !== "none" && (
          <span
            role="status"
            className="inline-flex items-center gap-1 rounded-full border border-hq-border-strong bg-hq-surface px-2 py-1 font-path-mono text-[10px] uppercase tracking-[0.1em] text-hq-ink-soft"
          >
            <Icon name="clock" size={12} className="shrink-0" />
            {/* The pending-FLIP marker: the row keeps showing the server state
                (the projection deliberately does not move for a leading undo),
                and this chip is what says a flip is queued. */}
            {marker === "pending_flip" ? "Queued — flip" : "Queued"}
          </span>
        )}
        {(["checkmark", "not_yet", "undo"] as const).map((action) => {
          const decision = decideFwAction({ action, from: shown });
          // `undo` on a row holding no decision is not a disabled button, it is
          // not a button (FwTaskView's rule, kept).
          if (action === "undo" && decision.kind !== "apply") return null;
          const isFlip =
            action === "not_yet" && decision.kind === "refused" && decision.reason === "undo_first";
          const enabled = decision.kind === "apply" || decision.kind === "re_attempt" || isFlip;
          // The button whose target the row currently SHOWS reads as the
          // current state (a checked row shows a filled checkmark).
          const current = action !== "undo" && shown === fwActionTarget(action);
          const label = isFlip
            ? `Not yet (undoes the checkmark first) — ${taskId} ${taskTitle}`
            : `${decision.kind === "re_attempt" ? "Not yet again" : ACTION_LABEL[action]} — ${taskId} ${taskTitle}`;
          return (
            <button
              key={action}
              type="button"
              aria-label={label}
              title={isFlip ? "Not yet (undoes the checkmark first)" : ACTION_LABEL[action]}
              aria-pressed={current}
              disabled={!enabled || busy}
              onClick={() => onTap(action)}
              className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-colors ${
                current
                  ? action === "checkmark"
                    ? "border-verified bg-verified/15 text-hq-ink"
                    : "border-not-yet bg-not-yet/15 text-hq-ink"
                  : "border-hq-border bg-hq-surface text-hq-ink-soft active:bg-hq-sunken"
              } ${!enabled ? "opacity-40" : ""} ${busy && inFlight === action ? "animate-pulse" : ""}`}
            >
              <Icon name={ACTION_ICON[action]} size={20} />
            </button>
          );
        })}
      </div>

      {note && (
        <p
          role={note.kind === "queued" ? "status" : "alert"}
          className={`flex max-w-[240px] items-center gap-1.5 text-right font-path-body text-xs leading-4 ${
            note.kind === "queued" ? "text-hq-ink-soft" : "text-not-yet"
          }`}
        >
          {note.kind === "queued" && <Icon name="clock" size={14} className="shrink-0" />}
          {note.kind !== "queued" && <Icon name="alert-triangle" size={14} className="shrink-0" />}
          <span>{note.text}</span>
          {retry && (
            <button
              type="button"
              disabled={busy}
              onClick={onRetry}
              className="inline-flex min-h-[44px] shrink-0 items-center rounded-lg border border-hq-border-strong bg-hq-surface px-3 font-path-body text-xs font-medium text-hq-ink active:bg-hq-sunken"
            >
              Retry
            </button>
          )}
        </p>
      )}
    </div>
  );
}
