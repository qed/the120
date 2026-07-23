"use client";

/**
 * The parent review queue (T1 Unit 12; Unit 16 finished the concurrency copy
 * and extracted the shared card scaffolding). ALWAYS the grounded HQ register
 * (Unit 15's parent rule; never a kid skin).
 *
 * The verification moment (§9.3, R6): the parent reads the DONE-WHEN line —
 * that is the standard, not vibes — looks at the evidence, and either
 * verifies (optional comment; adult words are the best reward in the system)
 * or says NOT YET, which REQUIRES a note, renders amber never red, and sends
 * the task back to in_progress with evidence intact (the RPC handles it — this
 * panel only drives applyTransition).
 *
 * Concurrency copy (the two-parent race, Unit 8 carry): a superseded action
 * shows the WINNER's identity, decision, and time ("Sarah said Not Yet at
 * 7:42"), never an error and never "you did it". A diverged one refreshes to
 * truth. A `retry` refusal auto-retries ONCE, then asks for a click (the
 * retry ceiling — owned by `useReviewCardScaffolding`, shared by both card
 * types). A card that VANISHES between refreshes without this session acting
 * on it gets a queue-level toast — the co-parent handled it while you read.
 *
 * Every awaited action is wrapped try/catch/finally — the auth guard can
 * redirect() (throws) before the action's own body. Free-text (captions,
 * notes) renders through React's default escaping; links only via
 * isSafeHttpUrl inside EvidenceList.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { applyTransition } from "@/app/path/lib/actions/transition";
import { applyCriterionReturn } from "@/app/path/lib/actions/review";
import type { ReviewQueue, ReviewQueueCriterion, ReviewQueueTask } from "@/app/path/lib/review-loader";
import { EvidenceList } from "./EvidenceList";
import { Button } from "./system/Button";
import { cn } from "./system/cn";

type Notice = { tone: "error" | "superseded"; text: string };

/** A short human time, or null when the timestamp is unknown — callers
 *  compose the "at …" clause only when real (never a "just now" lie). */
function formatWhen(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
}

/** " at Wed 9:41" when the time is known, "" otherwise. */
function atClause(iso: string | null | undefined): string {
  const when = formatWhen(iso);
  return when ? ` at ${when}` : "";
}

/** How long a superseded/diverged notice stays readable before the refresh
 *  that (correctly) removes the card — without this, the same call that
 *  reveals the winner's identity destroys it sub-second (race review). */
const NOTICE_LINGER_MS = 4000;

/** How long the vanished-card toast stays up. */
const VANISH_TOAST_MS = 8000;

const GENERIC_ERROR = "That didn't go through — try again in a moment.";

function waitingLabel(hours: number): string {
  if (hours < 1) return "waiting under an hour";
  if (hours < 48) return `waiting ${hours} hour${hours === 1 ? "" : "s"}`;
  return `waiting ${Math.floor(hours / 24)} days`;
}

/* ────────────────────────────── the shared card scaffolding (Unit 16) */

/**
 * Everything both card types duplicated (the Unit 12 → 16 carry): the
 * mounted ref, the linger-then-refresh timer, busy, notice, and the
 * retry-ceiling runner. `run(step)` gives the step one automatic retry for a
 * transient refusal — the step returns "retry" to spend it (only offered
 * while `canRetry`) — and owns the try/catch/finally posture: the auth guard
 * can redirect() (throws) before the action body, and busy must always clear.
 */
function useReviewCardScaffolding() {
  const router = useRouter();
  const mountedRef = useRef(true);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [notice, setNoticeState] = useState<Notice | null>(null);

  /** Mounted-guarded setter — steps call this freely after awaits. */
  const setNotice = useCallback((n: Notice | null) => {
    if (mountedRef.current) setNoticeState(n);
  }, []);

  /** Refresh after the notice has had time to be READ — the refresh removes
   *  the card (its row left the queried state), so an immediate one would
   *  destroy the copy it just revealed. Clears any prior pending timer first:
   *  a re-click inside the linger window must not leave an orphaned earlier
   *  timer firing on its original (sooner) schedule and destroying the NEW
   *  notice early (ce-review race pass). */
  const refreshAfterNotice = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      if (mountedRef.current) router.refresh();
    }, NOTICE_LINGER_MS);
  }, [router]);

  const refreshNow = useCallback(() => router.refresh(), [router]);

  const run = useCallback(
    async (step: (canRetry: boolean) => Promise<"retry" | "done">) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setNoticeState(null);
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const outcome = await step(attempt === 0);
          if (!mountedRef.current) return;
          if (outcome !== "retry") return;
        }
      } catch {
        // The guard can redirect() (throws) — anything else lands here too.
        if (mountedRef.current) setNoticeState({ tone: "error", text: GENERIC_ERROR });
      } finally {
        busyRef.current = false;
        if (mountedRef.current) setBusy(false);
      }
    },
    []
  );

  return { busy, notice, setNotice, refreshAfterNotice, refreshNow, run };
}

/* ─────────────────────────────────────────────────────────── the panel */

/** Keyed per SUBMISSION CYCLE (submitReceivedAt), mirroring criterionCardKey's
 *  `attempt`: a task that cycles through review twice in one mounted session
 *  must not inherit the first cycle's "this session acted on it" mark — the
 *  second cycle's co-parent-handled vanish would be silently swallowed
 *  (ce-review correctness pass). A fresh cycle also remounts the card, which
 *  correctly resets its comment/note drafts. */
function taskCardKey(task: ReviewQueueTask): string {
  return `task:${task.studentId}:${task.taskId}:${task.submitReceivedAt ?? "unsubmitted"}`;
}

function criterionCardKey(criterion: ReviewQueueCriterion): string {
  return `criterion:${criterion.studentId}:${criterion.criterionId}:${criterion.attempt}`;
}

export function ReviewPanel({ queue }: { queue: ReviewQueue }) {
  const empty = queue.tasks.length === 0 && queue.criteria.length === 0;

  // The vanishing-untouched-card toast (Unit 12 → 16 carry): a card that
  // leaves the queue WITHOUT this session acting on it was handled elsewhere
  // — most likely the co-parent. Cards this session decided register in
  // actedRef (their own notice already names the winner).
  const actedRef = useRef<Set<string>>(new Set());
  const prevKeysRef = useRef<Map<string, string> | null>(null);
  const [vanishToast, setVanishToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  const markActed = useCallback((key: string) => {
    actedRef.current.add(key);
  }, []);

  useEffect(() => {
    const currentKeys = new Map<string, string>();
    for (const task of queue.tasks) {
      currentKeys.set(taskCardKey(task), `${task.studentName} · ${task.taskId}`);
    }
    for (const criterion of queue.criteria) {
      currentKeys.set(criterionCardKey(criterion), `${criterion.studentName} · Landmark ${criterion.criterionId}`);
    }
    const prev = prevKeysRef.current;
    prevKeysRef.current = currentKeys;
    if (!prev) return;
    const vanished = [...prev.entries()].filter(([key]) => !currentKeys.has(key) && !actedRef.current.has(key));
    if (vanished.length === 0) return;
    const labels = vanished.map(([, label]) => label);
    setVanishToast(
      labels.length === 1
        ? `${labels[0]} was handled while you were reading — likely your co-parent. Nothing left to do there.`
        : `${labels.length} items were handled while you were reading — likely your co-parent.`
    );
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setVanishToast(null), VANISH_TOAST_MS);
  }, [queue]);

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="font-path-display text-[22px] font-semibold text-hq-ink">Review queue</h1>
        <p className="mt-1 font-path-body text-[13px] text-hq-ink-soft">
          {empty
            ? "Nothing is waiting for you."
            : `${queue.tasks.length} task${queue.tasks.length === 1 ? "" : "s"} to verify${
                queue.criteria.length > 0
                  ? ` · ${queue.criteria.length} landmark${queue.criteria.length === 1 ? "" : "s"} in review`
                  : ""
              }`}
        </p>
      </header>

      {vanishToast && (
        <p role="status" className="rounded-lg bg-hq-sunken px-3 py-2 font-path-body text-[12.5px] text-hq-ink">
          {vanishToast}
        </p>
      )}

      {empty && (
        <div className="rounded-xl border border-hq-border bg-hq-surface p-6 text-center shadow-hq">
          <p className="font-path-body text-[14px] text-hq-ink">The queue is clear.</p>
          <p className="mt-1 font-path-body text-[12.5px] text-hq-ink-soft">
            When a founder submits work, it lands here — and you&apos;ll get an email.
          </p>
        </div>
      )}

      {queue.tasks.map((task) => (
        <ReviewTaskCard
          key={taskCardKey(task)}
          task={task}
          parentNames={queue.parentNames}
          nudgeThresholdHours={queue.nudgeThresholdHours}
          onActed={() => markActed(taskCardKey(task))}
        />
      ))}

      {queue.criteria.length > 0 && (
        <section className="mt-2 flex flex-col gap-4">
          <h2 className="font-path-display text-[16px] font-semibold text-hq-ink">Landmarks in review</h2>
          {queue.criteria.map((criterion) => (
            <CriterionReviewCard
              key={criterionCardKey(criterion)}
              criterion={criterion}
              parentNames={queue.parentNames}
              onActed={() => markActed(criterionCardKey(criterion))}
            />
          ))}
        </section>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────── one submitted task */

function ReviewTaskCard({
  task,
  parentNames,
  nudgeThresholdHours,
  onActed,
}: {
  task: ReviewQueueTask;
  parentNames: Record<string, string>;
  nudgeThresholdHours: number;
  /** Tells the panel this session decided the card — the vanish toast must
   *  not fire for a removal this card's own notice already explains. */
  onActed: () => void;
}) {
  const { busy, notice, setNotice, refreshAfterNotice, refreshNow, run } = useReviewCardScaffolding();

  const [mode, setMode] = useState<"idle" | "not_yet">("idle");
  const [comment, setComment] = useState("");
  const [note, setNote] = useState("");

  const stale = task.waitingHours !== null && task.waitingHours >= nudgeThresholdHours;

  const decide = useCallback(
    (transition: "verify" | "not_yet", noteText: string | undefined) =>
      run(async (canRetry) => {
        const result = await applyTransition({
          studentId: task.studentId,
          taskId: task.taskId,
          transition,
          ...(noteText ? { note: noteText } : {}),
          // The TOCTOU guard: verify attests to the evidence the page LOADED.
          ...(transition === "verify"
            ? { expectedEvidenceFingerprint: task.evidenceFingerprint }
            : {}),
        });
        if (result.ok) {
          onActed();
          if (!result.byCaller) {
            const winner = result.winner;
            const who = winner?.verifiedBy
              ? (parentNames[winner.verifiedBy] ?? "Your co-parent")
              : "Your co-parent";
            // Richer superseded copy (Unit 16): name the DECISION, not just
            // "handled" — a Not Yet and a verify are different news.
            setNotice({
              tone: "superseded",
              text:
                result.state === "verified"
                  ? `${who} verified this${atClause(winner?.decidedAt)} — nothing left to do.`
                  : result.state === "not_yet"
                    ? `${who} said Not Yet${atClause(winner?.decidedAt)} — the note is with ${task.studentName}.`
                    : `Already handled${atClause(winner?.decidedAt)}.`,
            });
            refreshAfterNotice();
          } else {
            refreshNow();
          }
          return "done";
        }
        // Refusals — closed union.
        if (result.reason === "retry" && canRetry) return "retry";
        if (result.reason === "diverged") {
          onActed();
          const winner = result.winner;
          const who = winner?.verifiedBy ? (parentNames[winner.verifiedBy] ?? "your co-parent") : "someone";
          setNotice({
            tone: "superseded",
            text: `This task changed while you were looking (${who}${atClause(winner?.decidedAt)}) — refreshing.`,
          });
          refreshAfterNotice();
          return "done";
        }
        if (result.reason === "evidence_changed") {
          setNotice({
            tone: "superseded",
            text: `${task.studentName}'s satchel changed since you loaded this — take another look, then verify.`,
          });
          refreshAfterNotice();
          return "done";
        }
        if (result.reason === "note_required") {
          setNotice({ tone: "error", text: "Not Yet needs a note — say what to work on." });
          return "done";
        }
        setNotice({ tone: "error", text: GENERIC_ERROR });
        return "done";
      }),
    [run, task, parentNames, setNotice, refreshAfterNotice, refreshNow, onActed]
  );

  return (
    <article className="rounded-xl border border-hq-border bg-hq-surface p-4 shadow-hq">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-path-body text-[12px] font-medium text-hq-ink-soft">
            {task.studentName} · Task {task.taskId} · step {task.seq} of {task.taskTotal}
          </p>
          <h3 className="mt-0.5 font-path-display text-[16px] font-semibold text-hq-ink">{task.title}</h3>
        </div>
        {task.waitingHours !== null && (
          <span
            className={cn(
              "rounded-full px-2.5 py-1 font-path-body text-[11px] font-semibold",
              stale ? "bg-not-yet/10 text-not-yet" : "bg-hq-sunken text-hq-ink-soft"
            )}
          >
            {waitingLabel(task.waitingHours)}
          </span>
        )}
      </div>

      {/* The verification standard — the Done-when line, prominent. */}
      <div className="mt-3 rounded-lg border border-hq-border bg-hq-canvas p-3">
        <p className="font-path-body text-[11px] font-semibold uppercase tracking-wide text-hq-ink-muted">
          Done when
        </p>
        <p className="mt-1 font-path-body text-[13.5px] leading-relaxed text-hq-ink">{task.doneWhen}</p>
        {task.variant && (
          <p className="mt-2 font-path-body text-[12px] text-hq-ink-soft">
            For {task.studentName}&apos;s level: {task.variant}
          </p>
        )}
      </div>

      <div className="mt-3">
        <p className="mb-1.5 font-path-body text-[11px] font-semibold uppercase tracking-wide text-hq-ink-muted">
          Evidence
        </p>
        <EvidenceList
          studentId={task.studentId}
          taskId={task.taskId}
          band={task.band}
          skin="hq"
          items={task.evidence}
          renderItemActions={(item) => {
            const flagged = task.evidence.find((e) => e.id === item.id);
            if (!flagged?.addedAfterVerification && !flagged?.arrivedAfterReviewOpened) return null;
            return (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {flagged.addedAfterVerification && (
                  <span className="rounded-full border border-not-yet/40 px-2 py-0.5 font-path-body text-[10.5px] font-medium text-not-yet">
                    Added after verification
                  </span>
                )}
                {flagged.arrivedAfterReviewOpened && (
                  <span className="rounded-full border border-not-yet/40 px-2 py-0.5 font-path-body text-[10.5px] font-medium text-not-yet">
                    Arrived after this review opened
                  </span>
                )}
              </div>
            );
          }}
        />
      </div>

      {notice && (
        <p
          className={cn(
            "mt-3 rounded-lg px-3 py-2 font-path-body text-[12.5px]",
            notice.tone === "error" ? "bg-not-yet/10 text-not-yet" : "bg-hq-sunken text-hq-ink"
          )}
          role="status"
        >
          {notice.text}
        </p>
      )}

      {mode === "idle" ? (
        <div className="mt-4 flex flex-col gap-2">
          <label htmlFor={`comment-${task.studentId}-${task.taskId}`} className="sr-only">
            A word for {task.studentName} (optional)
          </label>
          <input
            id={`comment-${task.studentId}-${task.taskId}`}
            type="text"
            value={comment}
            maxLength={2000}
            onChange={(e) => setComment(e.target.value)}
            placeholder={`A word for ${task.studentName} (optional — it shows with the verification)`}
            className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 font-path-body text-[13px] text-hq-ink placeholder:text-hq-ink-muted focus:outline-none focus:ring-2 focus:ring-hq-ink/20"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              skin="hq"
              size="sm"
              disabled={busy}
              onClick={() => void decide("verify", comment.trim() || undefined)}
            >
              {busy ? "Working…" : "Verify — it meets the line"}
            </Button>
            <Button
              skin="hq"
              variant="secondary"
              size="sm"
              disabled={busy}
              className="border-not-yet/40 text-not-yet hover:bg-not-yet/10"
              onClick={() => {
                setNotice(null);
                setMode("not_yet");
              }}
            >
              Not yet…
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-not-yet/40 bg-not-yet/5 p-3">
          <p className="font-path-body text-[12.5px] font-semibold text-not-yet">
            Not yet — one more pass
          </p>
          <p className="mt-0.5 font-path-body text-[12px] text-hq-ink-soft">
            Say what to work on. {task.studentName} keeps every piece of evidence and picks the task
            back up — this is information, not judgement.
          </p>
          <label htmlFor={`note-${task.studentId}-${task.taskId}`} className="sr-only">
            What should {task.studentName} work on?
          </label>
          <textarea
            id={`note-${task.studentId}-${task.taskId}`}
            value={note}
            maxLength={2000}
            rows={3}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Great start — try saying the pitch without reading it."
            className="mt-2 w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 font-path-body text-[13px] text-hq-ink placeholder:text-hq-ink-muted focus:outline-none focus:ring-2 focus:ring-not-yet/30"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              skin="hq"
              size="sm"
              disabled={busy || note.trim().length === 0}
              className="bg-not-yet text-white hover:bg-not-yet/90"
              onClick={() => void decide("not_yet", note.trim())}
            >
              {busy ? "Working…" : "Send back with this note"}
            </Button>
            <Button skin="hq" variant="ghost" size="sm" disabled={busy} onClick={() => setMode("idle")}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}

/* ───────────────────────────────────────── one criterion in review */

function CriterionReviewCard({
  criterion,
  parentNames,
  onActed,
}: {
  criterion: ReviewQueueCriterion;
  parentNames: Record<string, string>;
  onActed: () => void;
}) {
  const { busy, notice, setNotice, refreshAfterNotice, refreshNow, run } = useReviewCardScaffolding();

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [note, setNote] = useState("");

  const toggle = (taskId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const submitReturn = useCallback(() => {
    if (selected.size === 0 || note.trim().length === 0) return;
    return run(async (canRetry) => {
      const result = await applyCriterionReturn({
        studentId: criterion.studentId,
        criterionId: criterion.criterionId,
        attempt: criterion.attempt,
        returnedTaskIds: [...selected],
        note: note.trim(),
      });
      if (result.ok) {
        onActed();
        if (!result.byCaller) {
          const who = result.winner?.decidedBy
            ? (parentNames[result.winner.decidedBy] ?? "Your co-parent")
            : "Your co-parent";
          setNotice({
            tone: "superseded",
            text: `${who} already decided this review${atClause(result.winner?.decidedAt)}.`,
          });
          refreshAfterNotice();
        } else {
          refreshNow();
        }
        return "done";
      }
      if (result.reason === "retry" && canRetry) return "retry";
      if (result.reason === "stale_review") {
        onActed();
        setNotice({ tone: "superseded", text: "This review moved on while you were looking — refreshing." });
        refreshAfterNotice();
        return "done";
      }
      if (result.reason === "note_required") {
        setNotice({ tone: "error", text: "A return needs a note — say why." });
        return "done";
      }
      setNotice({ tone: "error", text: GENERIC_ERROR });
      return "done";
    });
  }, [run, selected, note, criterion, parentNames, setNotice, refreshAfterNotice, refreshNow, onActed]);

  return (
    <article className="rounded-xl border border-hq-border bg-hq-surface p-4 shadow-hq">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-path-body text-[12px] font-medium text-hq-ink-soft">
            {criterion.studentName} · Landmark {criterion.criterionId}
            {criterion.attempt > 1 ? ` · pass ${criterion.attempt}` : ""}
          </p>
          <h3 className="mt-0.5 font-path-display text-[16px] font-semibold text-hq-ink">
            {criterion.criterionTitle}
          </h3>
        </div>
        <span className="rounded-full bg-awaiting/10 px-2.5 py-1 font-path-body text-[11px] font-semibold text-awaiting">
          in review since {formatWhen(criterion.openedAt)}
        </span>
      </div>

      <p className="mt-2 font-path-body text-[12.5px] leading-relaxed text-hq-ink-soft">
        Every task here is verified. Leaving it in review is fine — the crest ceremony comes in a
        later release. If something needs another pass, return it with a note.
      </p>

      {notice && (
        <p
          className={cn(
            "mt-3 rounded-lg px-3 py-2 font-path-body text-[12.5px]",
            notice.tone === "error" ? "bg-not-yet/10 text-not-yet" : "bg-hq-sunken text-hq-ink"
          )}
          role="status"
        >
          {notice.text}
        </p>
      )}

      {!open ? (
        <div className="mt-3">
          <Button
            skin="hq"
            variant="secondary"
            size="sm"
            className="border-not-yet/40 text-not-yet hover:bg-not-yet/10"
            onClick={() => setOpen(true)}
          >
            Return tasks for another pass…
          </Button>
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-not-yet/40 bg-not-yet/5 p-3">
          <p className="font-path-body text-[12.5px] font-semibold text-not-yet">
            Which tasks need another pass?
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {criterion.tasks.map((t) => (
              <li key={t.id}>
                <label className="flex items-center gap-2 font-path-body text-[13px] text-hq-ink">
                  <input
                    type="checkbox"
                    checked={selected.has(t.id)}
                    onChange={() => toggle(t.id)}
                    className="h-4 w-4 rounded border-hq-border"
                  />
                  <span>
                    {t.id} · {t.title}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <label htmlFor={`return-note-${criterion.studentId}-${criterion.criterionId}`} className="sr-only">
            Why is this coming back?
          </label>
          <textarea
            id={`return-note-${criterion.studentId}-${criterion.criterionId}`}
            value={note}
            maxLength={2000}
            rows={3}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why is this coming back? The note shows beside the returned tasks."
            className="mt-2 w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 font-path-body text-[13px] text-hq-ink placeholder:text-hq-ink-muted focus:outline-none focus:ring-2 focus:ring-not-yet/30"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              skin="hq"
              size="sm"
              disabled={busy || selected.size === 0 || note.trim().length === 0}
              className="bg-not-yet text-white hover:bg-not-yet/90"
              onClick={() => void submitReturn()}
            >
              {busy ? "Working…" : `Return ${selected.size || ""} task${selected.size === 1 ? "" : "s"}`}
            </Button>
            <Button skin="hq" variant="ghost" size="sm" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}
