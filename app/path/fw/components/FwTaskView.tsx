"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/app/path/components/system/Button";
import { Icon } from "@/app/path/components/system/Icon";
import { applyFwCheckIn } from "@/app/path/lib/actions/fw-checkin";
import type { FwCheckInActionResult } from "@/app/path/lib/fw-checkin-core";
import type { FwRosterEntry } from "@/app/path/lib/fw-loader";
import { fwBatchStudentIds, searchFwRoster, toggleFwBatchExtra } from "@/app/path/lib/fw-nav-rules";
import {
  createFwClientIdLedger,
  decideFwAction,
  fwRetryStudentIds,
  isFirstDollarTask,
  FW_BATCH_MAX,
  type FwAction,
  type FwStudentResult,
} from "@/app/path/lib/fw-rules";
import type { TaskState } from "@/app/path/lib/transition-table";

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

const OUTCOME_COPY: Record<string, string> = {
  applied: "recorded",
  re_attempt: "not yet again — recorded",
  already_done: "was already done — nothing changed",
  replayed: "already recorded from an earlier tap",
  refused: "couldn't change — undo it first",
  skipped: "not applied",
  failed: "didn't go through",
};

const ACTION_LABEL: Record<FwAction, string> = {
  checkmark: "Checkmark",
  not_yet: "Not yet",
  undo: "Undo",
};

/** The one place a per-student result becomes a line of copy. Named by the
 *  RESULT KIND, so a new kind is a compile error here rather than silence in
 *  front of a guide. */
function resultLine(result: FwStudentResult, nameOf: (id: string) => string): string {
  const who = nameOf(result.studentId);
  if (result.kind === "skipped") {
    return result.reason === "not_in_cohort"
      ? `${who} — isn't on this weekend's roster, so nothing was recorded`
      : `${who} — not applied (only ${FW_BATCH_MAX} at a time)`;
  }
  if (result.kind === "failed") {
    return result.reason === "missing_progress"
      ? `${who} — their task list isn't ready. Find The 120 staff.`
      : result.reason === "cohort_invalid"
        ? `${who} — isn't on this weekend's roster, so nothing was recorded`
        : `${who} — didn't go through. Tap Retry.`;
  }
  return `${who} — ${OUTCOME_COPY[result.kind] ?? result.kind}`;
}

export default function FwTaskView({
  cohortId,
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
  student: { studentId: string; firstName: string; lastName: string };
  /** The whole cohort, for the batch picker. Roster-scoped by construction —
   *  there is nobody here who is not in this weekend. */
  roster: readonly FwRosterEntry[];
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
  const [results, setResults] = useState<FwStudentResult[] | null>(null);
  const [lastAction, setLastAction] = useState<FwAction | null>(null);
  const [firstDollar, setFirstDollar] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<FwAction | null>(null);

  // One ledger per mounted task view. `randomUUID` is injected rather than
  // called inside the rules module, which is imported by tests and by the
  // offline queue and must not depend on which runtime's crypto is present.
  const ledger = useRef(createFwClientIdLedger(() => crypto.randomUUID())).current;

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

  const submit = async (action: FwAction, studentIds: readonly string[]) => {
    if (busy || studentIds.length === 0) return;
    setBusy(true);
    setError(null);
    setLastAction(action);
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
        setError(
          res.reason === "no_session"
            ? "Your session ended. Sign in again."
            : res.reason === "forbidden"
              ? "You can't record check-ins for this weekend. Find The 120 staff."
              : res.reason === "invalid_input"
                ? "Something about that tap didn't look right. Try again."
                : "That didn't go through. Tap Retry."
        );
        return;
      }

      // Release the keys of every student the server actually decided; the
      // ambiguous ones keep theirs for the retry.
      ledger.settle({ taskId, action }, res.outcomes);
      setResults(res.outcomes);
      setFirstDollar(res.firstDollar);

      const mine = res.outcomes.find((o) => o.studentId === student.studentId);
      // The AUTHORITATIVE state, echoed from under the RPC's row lock — never a
      // local guess at what the action must have done. A `skipped`/`failed`
      // result carries no state, and leaving the control where it was is the
      // truthful rendering of "we don't know that it moved".
      if (mine && "state" in mine) setState(mine.state);

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
    } catch {
      // A Server Action can REJECT rather than return — on venue wifi that is
      // the likely shape (docs/solutions/ui-bugs/server-action-rejection-no-try-
      // finally-freezes-capture-modal-2026-07-20.md).
      setError("That didn't go through. Tap Retry.");
    } finally {
      // EVERY exit path. A stuck flag is a dead iPad in front of a queue.
      setBusy(false);
    }
  };

  /** Decision 6: the confirm fires ONCE PER ACTION and names every selected
   *  student — never per-student, never skipped, and only on 1.2.4's checkmark. */
  const request = (action: FwAction) => {
    if (action === "checkmark" && isFirstDollarTask(taskId)) {
      setConfirming(action);
      return;
    }
    void submit(action, selected);
  };

  const retryIds = results ? fwRetryStudentIds(results) : [];

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
                onClick={() => request(action)}
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
          {lastAction && (
            <Button
              type="button"
              skin="hq"
              size="md"
              variant="secondary"
              disabled={busy}
              onClick={() => void submit(lastAction, selected)}
            >
              Retry
            </Button>
          )}
        </div>
      )}

      {results && results.length > 0 && (
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
            {results.map((r) => (
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
              onClick={() => void submit(lastAction, retryIds)}
            >
              Retry {retryIds.length === 1 ? nameOf(retryIds[0]) : `${retryIds.length} students`}
            </Button>
          )}
        </div>
      )}

      {firstDollar.length > 0 && (
        <p className="mt-4 rounded-xl border border-verified/50 bg-verified/10 p-4 font-path-display text-lg font-semibold text-hq-ink">
          First dollar — {firstDollar.map(nameOf).join(", ")}. Ring the bell.
        </p>
      )}

      {/* Decision 14: a prominent next-student affordance, and the view stays
          exactly where it is until the guide uses it. */}
      {results && (
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
              First dollar for {selected.map(nameOf).join(", ")}?
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
                  const action = confirming;
                  setConfirming(null);
                  void submit(action, selected);
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
