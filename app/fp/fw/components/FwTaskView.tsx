"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/app/fp/components/system/Button";
import { Icon } from "@/app/fp/components/system/Icon";
import { applyFwCheckIn } from "@/app/fp/lib/actions/fw-checkin";
import type { FwCheckInActionResult } from "@/app/fp/lib/fw-checkin-core";
import { enqueueFwCheckIns, readPendingFwOpsFor } from "@/app/fp/lib/fw-sync-client";
import { projectFwPendingState } from "@/app/fp/lib/fw-sync-rules";
import {
  fwBatchStudentIds,
  searchFwRoster,
  toggleFwBatchExtra,
  type FwRosterStudent,
} from "@/app/fp/lib/fw-nav-rules";
import {
  createFwClientIdLedger,
  decideFwAction,
  foldFwSurfaceOutcome,
  fwActionTarget,
  fwResultsForFailedAction,
  fwRetryStudentIds,
  isFirstDollarTask,
  stateForFwPrimary,
  EMPTY_FW_SURFACE,
  FW_BATCH_MAX,
  type FwAction,
  type FwClientIdLedger,
  type FwStudentResult,
  type FwSurfaceOutcome,
} from "@/app/fp/lib/fw-rules";
import type { TaskState } from "@/app/fp/lib/transition-table";

/**
 * The task view (FW Unit 4; FW-R15, FW-D16, Decisions 6 and 14) — the single
 * highest-frequency interaction in the product, and the only screen where a tap
 * writes to a child's permanent record.
 *
 * ── Every control is derived from `decideFwAction`, never re-derived
 *
 * "Is this already decided, and may this action touch it?" is answered in ONE
 * place in this system, and a component that re-implemented it — even as
 * `state === "verified" ? …` — would be the fourth copy of a table the SQL,
 * the write path, and the queue reducer all share. When the two disagree the
 * guide sees an enabled button that the server refuses, which reads as a broken
 * iPad. So the buttons below are a `map` over the action set with the shared
 * predicate deciding each one's label and enabled-ness.
 *
 * ── A client id per tap, ONLINE as well as offline
 *
 * Carried forward from Unit 3 as a requirement, not a nicety. `checkmark` and
 * `undo` are idempotent by state, so an ambiguous retry is free. `not_yet` is
 * not: a repeat tap is DEFINED to append a re-attempt event (the FW-D4 struggle
 * signal), so without an exactly-once key the system cannot tell "the guide
 * tapped twice" from "the first response was lost over venue wifi" — and the
 * blocker data silently inflates. The ledger holds one key per (task, student,
 * action) across every retry of a tap and releases it the moment the server
 * gives a definite answer.
 *
 * ── The view STAYS IN PLACE after a tap (Decision 14)
 *
 * Undo-as-toggle needs the view, and auto-advance fights the whole premise of
 * mis-tap recovery. What appears instead is a prominent next-student
 * affordance — the guide leaves when they decide to, not when the screen does.
 */

const ACTION_LABEL: Record<FwAction, string> = {
  checkmark: "Checkmark",
  not_yet: "Not yet",
  undo: "Undo",
};

/**
 * The one place a per-student result becomes a line of copy.
 *
 * An EXHAUSTIVE SWITCH, not a lookup table with a `?? result.kind` fallback.
 * The earlier shape was a `Record<string, string>`, which accepts any key — so a
 * new `FwStudentResult` kind added by Units 5b/6/7/8 would have compiled
 * cleanly and rendered the raw internal enum text to a guide, which is exactly
 * the "silence in front of a guide" this function's own comment claimed was
 * impossible (maintainability + testing review). Now the compiler enforces the
 * claim: TS2366 fires the moment a kind has no arm.
 *
 * `refused` branches on its REASON. `FwRefusalReason` is two-valued and the two
 * are reached by different actions — `undo_first` only by `not_yet`,
 * `not_a_decision` only by `undo` — so the single generic line was actively
 * backwards for half of them: it told a guide who had just tapped Undo to "undo
 * it first" (correctness review). Reachable in ordinary use, because the
 * controls are enabled from the PRIMARY student's state while the action is
 * submitted for the whole batch.
 */
function resultLine(result: FwStudentResult, nameOf: (id: string) => string): string {
  const who = nameOf(result.studentId);
  switch (result.kind) {
    case "applied":
      return `${who} — recorded`;
    case "re_attempt":
      return `${who} — not yet again, recorded`;
    case "already_done":
      return `${who} — was already done, nothing changed`;
    case "replayed":
      return `${who} — already recorded from an earlier tap`;
    case "refused":
      return result.reason === "undo_first"
        ? `${who} — is already checked. Undo it first.`
        : `${who} — had nothing to undo`;
    case "skipped":
      return result.reason === "not_in_cohort"
        ? `${who} — isn't on this weekend's roster, so nothing was recorded`
        : `${who} — not applied (only ${FW_BATCH_MAX} at a time)`;
    case "failed":
      switch (result.reason) {
        case "missing_progress":
          return `${who} — their task list isn't ready. Find The 120 staff.`;
        case "cohort_invalid":
          return `${who} — isn't on this weekend's roster, so nothing was recorded`;
        case "cross_actor_undo":
          // Terminal, NOT retryable: someone else's decision now stands (only the offline
          // drain can produce this today — the online path never sends expectedVerifiedBy —
          // but the arm is exhaustive so a future online CAS can't fall through to "Tap Retry").
          return `${who} — another guide changed this, so your undo wasn't applied. Find The 120 staff.`;
        case "unavailable":
          return `${who} — didn't go through. Tap Retry.`;
      }
  }
}

export default function FwTaskView({
  cohortId,
  actorUserId,
  student,
  roster,
  taskId,
  taskTitle,
  taskBody,
  doneWhen,
  variant,
  allBandsNote,
  initialState,
  treeHref,
  rosterHref,
}: {
  cohortId: string;
  /** The signed-in guide — stamped on an offline capture as the capturing actor. */
  actorUserId: string;
  student: { studentId: string; firstName: string; lastName: string };
  /**
   * The whole cohort, for the batch picker. Roster-scoped by construction —
   * there is nobody here who is not in this weekend.
   *
   * `FwRosterStudent`, NOT the richer `FwRosterEntry`: this view names and
   * searches teammates and never reads a resume chip. Narrowing the prop is what
   * lets the page skip the paginated decided-rows scan entirely, and it makes
   * that fact structural rather than a comment (performance review).
   */
  roster: readonly FwRosterStudent[];
  taskId: string;
  taskTitle: string;
  taskBody: string;
  doneWhen: string;
  /** The band-resolved line, when this task has one for this student's band. */
  variant: string | null;
  allBandsNote: string | null;
  initialState: TaskState;
  treeHref: string;
  rosterHref: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<TaskState>(initialState);
  const [extras, setExtras] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerNote, setPickerNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Whether the current error is one a retry could clear. A session that ended
   *  or a cohort the guide may not write to will refuse identically forever. */
  const [retryable, setRetryable] = useState(false);
  /** What the surface is showing: per-student lines plus any standing first
   *  dollar. ONE piece of state folded by a tested pure function, rather than
   *  two that a partial retry could drive out of agreement. */
  const [surface, setSurface] = useState<FwSurfaceOutcome>(EMPTY_FW_SURFACE);
  const [lastAction, setLastAction] = useState<FwAction | null>(null);
  /** Exactly the students the last submission was for — never the live
   *  selection, which the picker can change while an error banner is up. */
  const [lastSubmitted, setLastSubmitted] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<{
    action: FwAction;
    studentIds: string[];
  } | null>(null);
  /** Set when a tap was CAPTURED OFFLINE rather than sent — visibly distinct from a
   *  recorded tap (a neutral note) and from a failed one (the red alert). The global
   *  queued indicator (FwPwa) carries the count; this is the per-tap acknowledgment
   *  so the guide is not left wondering whether their tap took. */
  const [queuedNote, setQueuedNote] = useState<string | null>(null);

  /**
   * Whether this view is still mounted. Every post-await write is gated on it —
   * `router.refresh()` in particular, which is NOT scoped to this component and
   * would otherwise refresh whatever page a guide navigated to after giving up
   * on a slow tap. Same pattern as the Path's `TaskSurface.tsx`.
   */
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Whether the guide has interacted (submitted/queued) since mount. Once they have,
  // the local `state` is authoritative and the async mount-reconciliation below must
  // NOT overwrite it with a value derived from the pre-tap queue snapshot.
  const interacted = useRef(false);

  // Reconcile the server-supplied initial state with this guide's OWN pending offline
  // captures (correctness review): mid-outage the page renders from a stale SW-cached
  // shell that predates the guide's queued taps, so a revisit would show the task as
  // untouched. Folding the pending ops through the canonical decision table shows the
  // true pending position — the guide sees Undo, not a conflicting fresh decision.
  useEffect(() => {
    let cancelled = false;
    void readPendingFwOpsFor({ cohortId, studentId: student.studentId, taskId, actorUserId }).then(
      (ops) => {
        if (cancelled || ops.length === 0 || !mounted.current || interacted.current) return;
        setState(projectFwPendingState(initialState, ops));
      }
    );
    return () => {
      cancelled = true;
    };
  }, [cohortId, student.studentId, taskId, actorUserId, initialState]);

  // One ledger per mounted task view, created ONCE. `useRef`'s argument is
  // evaluated on every render, so calling the factory inline allocated a fresh
  // Map per keystroke in the picker and threw it away (julik review).
  // `randomUUID` is injected rather than called inside the rules module, which
  // is imported by tests and by the offline queue and must not depend on which
  // runtime's crypto is present.
  const ledgerRef = useRef<FwClientIdLedger | null>(null);
  if (ledgerRef.current === null) {
    ledgerRef.current = createFwClientIdLedger(() => crypto.randomUUID());
  }
  const ledger = ledgerRef.current;

  const nameById = useMemo(() => {
    const m = new Map<string, string>([
      [student.studentId, `${student.firstName} ${student.lastName}`],
    ]);
    for (const r of roster) m.set(r.studentId, `${r.firstName} ${r.lastName}`);
    return m;
  }, [roster, student]);
  const nameOf = (id: string) => nameById.get(id) ?? "That student";

  const selected = fwBatchStudentIds(student.studentId, extras);
  const pickable = useMemo(
    () => searchFwRoster(roster.filter((r) => r.studentId !== student.studentId), pickerQuery),
    [roster, student.studentId, pickerQuery]
  );

  /**
   * The durable backstop for an ONLINE tap that couldn't reach the server (Unit 8
   * P0). `navigator.onLine` reports link-layer only, so an iPad associated with a
   * venue AP whose uplink is dead reads `online: true` and takes the online branch —
   * the single most common venue-wifi failure. When that branch fails (a throw, or an
   * `unavailable` result), the tap must NOT be left in ephemeral React state a "Next
   * student" tap would discard; it is captured to the queue instead, keyed by the
   * SAME client ids the failed online call used, so the drain's replay is idempotent
   * if the write had in fact partly landed. Returns false when the device cannot
   * queue at all (private mode), so the caller falls through to the visible error.
   */
  const queueBackstop = async (
    action: FwAction,
    studentIds: readonly string[],
    opts: { silent?: boolean } = {}
  ): Promise<boolean> => {
    const enq = await enqueueFwCheckIns({
      cohortId,
      taskId,
      action,
      actorUserId,
      studentIds: [...studentIds],
      actionId: crypto.randomUUID(),
      capturedAt: new Date().toISOString(),
      clientIds: ledger.idsFor({ taskId, action, studentIds }),
    });
    if (!enq.ok) return false;
    // Silent mode durably captures ambiguous PER-STUDENT outcomes inside an otherwise
    // successful batch without disturbing the surface (which already shows each
    // student's real result); the global indicator carries the queued count.
    if (!opts.silent && mounted.current) {
      setState(fwActionTarget(action));
      setExtras([]);
      setPickerNote(null);
      setQueuedNote(
        studentIds.length === 1
          ? "Couldn't reach the server — saved. It'll send when you're back online."
          : `Couldn't reach the server — saved for ${studentIds.length} students. They'll send when you're back online.`
      );
    }
    return true;
  };

  const submit = async (action: FwAction, studentIds: readonly string[]) => {
    if (busy || studentIds.length === 0) return;
    // From here the local state is user-driven; the mount reconcile must stand down.
    interacted.current = true;
    setBusy(true);
    setError(null);
    setRetryable(false);
    setQueuedNote(null);
    setLastAction(action);
    setLastSubmitted([...studentIds]);

    // OFFLINE: capture to the IndexedDB queue instead of calling the server (Unit
    // 8). The tap is not lost and does not mislead — it drains on reconnect through
    // `runFwCheckIn`, the same gate a live tap passes, with the same-actor guard and
    // the minimal-legal-sequence reduction applied. A batch shares ONE action id so
    // the board still groups its celebration on drain.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      try {
        const enq = await enqueueFwCheckIns({
          cohortId,
          taskId,
          action,
          actorUserId,
          studentIds: [...studentIds],
          actionId: crypto.randomUUID(),
          capturedAt: new Date().toISOString(),
        });
        if (!mounted.current) return;
        if (!enq.ok && enq.reason === "unsupported") {
          setError("This device can't save check-ins offline. Keep a signal, or use paper as backup.");
          setSurface((prev) =>
            foldFwSurfaceOutcome(
              prev,
              { outcomes: fwResultsForFailedAction(studentIds), firstDollar: [] },
              studentIds
            )
          );
          return;
        }
        // Optimistically reflect the tap on THIS student's control; the board and
        // the true state confirm on reconnect. The batch clears like an online tap.
        setState(fwActionTarget(action));
        setExtras([]);
        setPickerNote(null);
        setQueuedNote(
          studentIds.length === 1
            ? "Saved. It'll send when you're back online."
            : `Saved for ${studentIds.length} students. They'll send when you're back online.`
        );
      } finally {
        if (mounted.current) setBusy(false);
      }
      return;
    }

    try {
      // Minted (or re-used) BEFORE the call, so a retry of this same tap carries
      // the same keys and cannot append a phantom re-attempt event.
      const clientIds = ledger.idsFor({ taskId, action, studentIds });
      const res: FwCheckInActionResult = await applyFwCheckIn({
        cohortId,
        taskId,
        action,
        studentIds: [...studentIds],
        clientIds,
      });

      if (!res.ok) {
        // `unavailable` = the server was unreachable or a server-side read failed
        // (the associated-but-dead venue-wifi case navigator.onLine can't detect).
        // Capture the tap durably rather than leave it in ephemeral state (P0).
        if (res.reason === "unavailable" && (await queueBackstop(action, studentIds))) return;
        setRetryable(res.reason === "unavailable" || res.reason === "invalid_input");
        setError(
          res.reason === "no_session"
            ? "Your session ended. Sign in again."
            : res.reason === "forbidden"
              ? "You can't record check-ins for this weekend. Find The 120 staff."
              : res.reason === "invalid_input"
                ? "Something about that tap didn't look right. Try again."
                : "That didn't go through, and this device can't save it offline. Keep a signal, or use paper as backup."
        );
        // The action failed OUTRIGHT — no per-student outcomes came back. Report
        // every submitted student as unavailable rather than leaving the PREVIOUS
        // action's lines on screen beside the new error, where they read as
        // though they belonged to the tap that just failed (correctness review).
        if (mounted.current) {
          setSurface((prev) =>
            foldFwSurfaceOutcome(
              prev,
              { outcomes: fwResultsForFailedAction(studentIds), firstDollar: [] },
              studentIds
            )
          );
        }
        return;
      }

      // Release the keys of every student the server actually decided; the
      // ambiguous ones keep theirs for the retry.
      ledger.settle({ taskId, action }, res.outcomes);

      // Every post-await write is guarded: a guide who gave up on a slow tap and
      // navigated away has unmounted this view, and `router.refresh()` is NOT
      // scoped to it — unguarded, it would refresh whatever page they are now
      // using (julik review). The pattern is lifted from `TaskSurface.tsx`, the
      // Path's sibling task view, which already does exactly this.
      if (!mounted.current) return;

      // MERGED, not assigned. A narrowed retry's response describes only the
      // students it was asked about; assigning it wiped the settled teammates'
      // lines and — worse — the standing First Dollar banner (correctness review,
      // P1). The fold is a tested pure function precisely because this is the
      // composition layer that has produced a P1 in each of the last two units.
      setSurface((prev) => foldFwSurfaceOutcome(prev, res, studentIds));

      // The AUTHORITATIVE state, echoed from under the RPC's row lock — never a
      // local guess at what the action must have done. `undefined` means the
      // response said nothing about this student, and leaving the control where
      // it was is the truthful rendering of that.
      const mine = stateForFwPrimary(res.outcomes, student.studentId);
      if (mine !== undefined) setState(mine);

      // FW-D16: the batch is cleared after the action. A selection that survived
      // would silently ride along on the guide's next, unrelated tap. The cap
      // note goes with it — found in the live walkthrough, where "3 at a time is
      // the maximum" stayed on screen beside an empty picker and read as a
      // refusal of the tap that had just succeeded.
      setExtras([]);
      setPickerNote(null);
      // Keeps the tree's counts and the roster's resume chips honest when the
      // guide navigates back.
      router.refresh();

      // Durably capture any PER-STUDENT ambiguous outcome (a batch where the request
      // succeeded but one student's write timed out) so a "Next student" tap can't
      // discard it with the in-memory ledger (adversarial re-review P1). Idempotent by
      // the same client ids still held for those students.
      const unsettled = fwRetryStudentIds(res.outcomes);
      if (unsettled.length > 0) void queueBackstop(action, unsettled, { silent: true });
    } catch {
      // A Server Action can REJECT rather than return — on venue wifi that is
      // the likely shape (docs/solutions/ui-bugs/server-action-rejection-no-try-
      // finally-freezes-capture-modal-2026-07-20.md). Capture the tap durably
      // FIRST — even if the guide already navigated away (unmounting this view),
      // the enqueue must still run, because a navigate-away-before-throw is exactly
      // the loss this backstop exists to prevent (queueBackstop guards only its OWN
      // setState on mounted, so calling it while unmounted is safe). The mount check
      // gates only the visible error UI below.
      if (await queueBackstop(action, studentIds)) return;
      if (!mounted.current) return;
      setRetryable(true);
      setError("That didn't go through, and this device can't save it offline. Keep a signal, or use paper as backup.");
      setSurface((prev) =>
        foldFwSurfaceOutcome(
          prev,
          { outcomes: fwResultsForFailedAction(studentIds), firstDollar: [] },
          studentIds
        )
      );
    } finally {
      // EVERY exit path. A stuck flag is a dead iPad in front of a queue.
      if (mounted.current) setBusy(false);
    }
  };

  /**
   * THE ONLY WAY A CHECK-IN IS SUBMITTED. Every entry point — the three action
   * buttons, the action-level Retry, the per-student Retry — comes through here.
   *
   * Decision 6's confirm is enforced HERE rather than in the button handler,
   * because that is what the adversarial review broke: both Retry buttons called
   * `submit` directly, so a first-dollar batch that failed and was retried rang
   * the room's bell with no confirm at all. Worse, the confirm used to name the
   * LIVE selection while the picker stayed interactive behind the error banner —
   * so a guide who swapped a teammate before retrying could ring the bell for a
   * child who was never named in any dialog.
   *
   * The fix is both halves: the gate cannot be bypassed, and the student list is
   * SNAPSHOT into the confirm rather than re-read from live state when it
   * resolves. What the dialog names is exactly what gets written.
   */
  const beginSubmit = (action: FwAction, studentIds: readonly string[]) => {
    if (busy || studentIds.length === 0) return;
    if (action === "checkmark" && isFirstDollarTask(taskId)) {
      setConfirming({ action, studentIds: [...studentIds] });
      return;
    }
    void submit(action, studentIds);
  };

  const retryIds = fwRetryStudentIds(surface.results);

  return (
    <div>
      <Link
        href={treeHref}
        className="inline-flex min-h-[44px] items-center gap-1.5 font-path-body text-sm text-hq-ink-soft hover:text-hq-ink"
      >
        <Icon name="chevron-left" size={16} />
        {student.firstName}&apos;s tasks
      </Link>

      {/* FW-R15: title as the headline, check-off control beside it. */}
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="font-path-mono text-[11px] uppercase tracking-[0.14em] text-hq-ink-muted">
            {taskId} · {student.firstName} {student.lastName}
            {extras.length > 0 && ` + ${extras.length}`}
          </p>
          <h1 className="mt-1 font-path-display text-2xl font-semibold leading-tight tracking-tight text-hq-ink">
            {taskTitle}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(["checkmark", "not_yet", "undo"] as const).map((action) => {
            const decision = decideFwAction({ action, from: state });
            // `undo` on a row holding no decision is not a disabled button, it
            // is not a button: showing "Undo" beside a task nobody has touched
            // invites a tap that can only ever be refused.
            if (action === "undo" && decision.kind !== "apply") return null;
            const enabled = decision.kind === "apply" || decision.kind === "re_attempt";
            const label =
              decision.kind === "re_attempt"
                ? "Not yet again"
                : decision.kind === "already_done"
                  ? action === "checkmark"
                    ? "Checked"
                    : "Not yet"
                  : ACTION_LABEL[action];
            return (
              <Button
                key={action}
                type="button"
                skin="hq"
                size="lg"
                variant={action === "checkmark" ? "primary" : "secondary"}
                disabled={!enabled || busy}
                onClick={() => beginSubmit(action, selected)}
                icon={
                  <Icon
                    name={action === "checkmark" ? "check" : action === "not_yet" ? "x" : "refresh"}
                    size={18}
                  />
                }
                className="min-h-[56px] min-w-[132px]"
              >
                {busy && lastAction === action ? "Recording…" : label}
              </Button>
            );
          })}
        </div>
      </div>

      {/* The one refusal a guide can act on, spelled as the recovery rather than
          the rule. Derived from the same predicate that disabled the button. */}
      {decideFwAction({ action: "not_yet", from: state }).kind === "refused" && (
        <p className="mt-2 font-path-body text-sm text-hq-ink-soft">
          This one is checked. Undo it first if you need to mark it Not yet.
        </p>
      )}

      {/* ── the batch picker (FW-D16) ────────────────────────────────────── */}
      <div className="mt-4 rounded-xl border border-hq-border bg-hq-surface p-3 shadow-hq">
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          aria-expanded={pickerOpen}
          className="flex min-h-[44px] w-full items-center justify-between gap-2 text-left"
        >
          <span className="font-path-body text-sm font-medium text-hq-ink">
            {extras.length === 0
              ? "Same tap for someone else?"
              : `${extras.length} teammate${extras.length === 1 ? "" : "s"} selected`}
          </span>
          <Icon
            name={pickerOpen ? "chevron-left" : "chevron-right"}
            size={18}
            className="text-hq-ink-muted"
          />
        </button>

        {extras.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2">
            {extras.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() =>
                    setExtras(
                      toggleFwBatchExtra({
                        extras,
                        studentId: id,
                        primaryStudentId: student.studentId,
                      }).extras
                    )
                  }
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-hq-border-strong bg-hq-canvas px-3 font-path-body text-sm text-hq-ink"
                >
                  {nameOf(id)}
                  <Icon name="x" size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {pickerOpen && (
          <div className="mt-3">
            <input
              type="search"
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
              placeholder="Find a teammate…"
              className="h-12 w-full rounded-lg border border-hq-border bg-hq-canvas px-3 font-path-body text-base text-hq-ink outline-none focus:border-hq-border-strong"
            />
            {pickerNote && (
              <p role="status" className="mt-2 font-path-body text-sm text-hq-ink-soft">
                {pickerNote}
              </p>
            )}
            <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
              {pickable.map((r) => {
                const on = extras.includes(r.studentId);
                return (
                  <li key={r.studentId}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        const next = toggleFwBatchExtra({
                          extras,
                          studentId: r.studentId,
                          primaryStudentId: student.studentId,
                        });
                        setExtras(next.extras);
                        // The cap SKIPS rather than truncating, and says so —
                        // the plan's no-silent-caps posture, all the way to the
                        // picker.
                        setPickerNote(
                          next.ok
                            ? null
                            : `${FW_BATCH_MAX} at a time is the maximum. Remove someone first.`
                        );
                      }}
                      className={`flex min-h-[48px] w-full items-center justify-between gap-2 rounded-lg px-3 text-left font-path-body text-sm ${
                        on ? "bg-hq-ink text-white" : "text-hq-ink active:bg-hq-sunken"
                      }`}
                    >
                      <span>
                        {r.firstName} {r.lastName}
                      </span>
                      {on && <Icon name="check" size={16} />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {/* ── outcomes, and the visibly-distinct failure ───────────────────── */}
      {error && (
        <div
          role="alert"
          className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border-2 border-not-yet bg-not-yet/10 p-4"
        >
          <Icon name="alert-triangle" size={20} className="text-not-yet" />
          <p className="flex-1 font-path-body text-sm leading-5 text-hq-ink">{error}</p>
          {/* Only for failures a retry can actually fix. Offering Retry beside
              "Your session ended" or "you can't record check-ins here" is an
              affordance that cannot succeed (correctness review). */}
          {lastAction && retryable && (
            <Button
              type="button"
              skin="hq"
              size="md"
              variant="secondary"
              disabled={busy}
              onClick={() => beginSubmit(lastAction, lastSubmitted)}
            >
              Retry
            </Button>
          )}
        </div>
      )}

      {surface.results.length > 0 && (
        <div
          className={`mt-4 rounded-xl border p-4 ${
            retryIds.length > 0
              ? // A FAILED tap is visibly distinct from a recorded one (and, from
                // Unit 8, from a queued one): heavier border, alert colour, and
                // its own retry — not a quiet line in a list.
                "border-2 border-not-yet bg-not-yet/10"
              : "border-hq-border bg-hq-surface"
          }`}
        >
          <ul className="space-y-1">
            {surface.results.map((r) => (
              <li key={r.studentId} className="font-path-body text-sm leading-5 text-hq-ink">
                {resultLine(r, nameOf)}
              </li>
            ))}
          </ul>
          {retryIds.length > 0 && lastAction && (
            <Button
              type="button"
              skin="hq"
              size="md"
              variant="secondary"
              className="mt-3"
              disabled={busy}
              onClick={() => beginSubmit(lastAction, retryIds)}
            >
              Retry {retryIds.length === 1 ? nameOf(retryIds[0]) : `${retryIds.length} students`}
            </Button>
          )}
        </div>
      )}

      {/* Offline capture acknowledgment — neutral, distinct from the red failure
          surface. The global indicator (FwPwa) carries the running queued count. */}
      {queuedNote && (
        <p
          role="status"
          className="mt-4 flex items-center gap-2 rounded-xl border border-hq-border-strong bg-hq-surface p-4 font-path-body text-sm leading-6 text-hq-ink"
        >
          <Icon name="clock" size={18} className="shrink-0 text-hq-ink-soft" />
          {queuedNote}
        </p>
      )}

      {surface.firstDollar.length > 0 && (
        <p className="mt-4 rounded-xl border border-verified/50 bg-verified/10 p-4 font-path-display text-lg font-semibold text-hq-ink">
          First dollar — {surface.firstDollar.map(nameOf).join(", ")}. Ring the bell.
        </p>
      )}

      {/* Decision 14: a prominent next-student affordance, and the view stays
          exactly where it is until the guide uses it — after a sent tap OR a queued
          one, so the offline loop moves at the same pace as the online one. */}
      {(surface.results.length > 0 || queuedNote) && (
        <Link
          href={rosterHref}
          className="mt-4 flex min-h-[56px] items-center justify-center gap-2 rounded-xl border border-hq-border-strong bg-hq-surface font-path-body text-base font-medium text-hq-ink shadow-hq active:bg-hq-sunken"
        >
          Next student
          <Icon name="arrow-right" size={18} />
        </Link>
      )}

      {/* ── the task itself (FW-R15's order: body, then done-when) ───────── */}
      <div className="mt-6 space-y-4">
        <p className="whitespace-pre-line font-path-body text-base leading-7 text-hq-ink-soft">
          {taskBody}
        </p>

        <div className="rounded-xl border border-hq-border bg-hq-surface p-4 shadow-hq">
          <p className="font-path-mono text-[11px] uppercase tracking-[0.12em] text-hq-ink-muted">
            Done when
          </p>
          <p className="mt-1 font-path-body text-base leading-7 text-hq-ink">{doneWhen}</p>
          {variant && (
            <p className="mt-3 font-path-body text-sm leading-6 text-hq-ink-soft">
              <span className="font-semibold text-hq-ink">For this band:</span> {variant}
            </p>
          )}
          {allBandsNote && (
            <p className="mt-2 font-path-body text-sm leading-6 text-hq-ink-soft">
              <span className="font-semibold text-hq-ink">All bands:</span> {allBandsNote}
            </p>
          )}
        </div>
      </div>

      {/* ── the First Dollar confirm (Decision 6) ────────────────────────── */}
      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="fw-first-dollar-title"
          className="fixed inset-0 z-20 flex items-end justify-center bg-hq-ink/40 p-4 sm:items-center"
        >
          <div className="w-full max-w-md rounded-2xl border border-hq-border bg-hq-surface p-5 shadow-hq">
            <h2
              id="fw-first-dollar-title"
              className="font-path-display text-xl font-semibold text-hq-ink"
            >
              {/* The SNAPSHOT taken when the confirm opened — never the live
                  selection. The picker stays interactive behind an error banner,
                  so re-reading `selected` here let a swapped-in teammate be
                  written under a dialog that named somebody else (adversarial
                  review). What this names is exactly what gets written. */}
              First dollar for {confirming.studentIds.map(nameOf).join(", ")}?
            </h2>
            <p className="mt-2 font-path-body text-sm leading-6 text-hq-ink-soft">
              This rings the bell.
            </p>
            <div className="mt-5 flex gap-3">
              <Button
                type="button"
                skin="hq"
                size="lg"
                className="flex-1"
                disabled={busy}
                onClick={() => {
                  const { action, studentIds } = confirming;
                  setConfirming(null);
                  void submit(action, studentIds);
                }}
              >
                Yes — ring it
              </Button>
              <Button
                type="button"
                skin="hq"
                size="lg"
                variant="secondary"
                onClick={() => setConfirming(null)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
