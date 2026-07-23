/**
 * The Path notifications — the PURE decision core (T1 Unit 12, Decision 8).
 *
 * Everything here is a decision, never I/O, in the Unit 7/9/10 posture: no
 * next/supabase/react imports, exhaustively tested in `__tests__/notify-rules
 * .test.ts`. The `send.ts` executor and the cron route decide NOTHING — every
 * branch they take (what to enqueue, who gets an email, whether a claim won,
 * whether an unclaim may restore, which nudges are due, what reconcile must
 * backfill) is resolved by a function in this file.
 *
 * ── The durability architecture (why this survives a crash) ──────────────────
 * The durable source of truth is what the transition RPC already writes
 * ATOMICALLY with the state change: `path_task_events` (append-only, one row
 * per transition) and `path_reviews` (attempt-based). Notifications are
 * DERIVED from those spines — the inline path derives right after a
 * transition for latency, and the cron re-derives over a trailing window and
 * inserts whatever is missing (`reconcilePlan`). A crash between the RPC
 * commit and the JS-side enqueue therefore loses nothing: the next cron run
 * heals it. Dedupe keys make every insert idempotent.
 *
 * ── Channels (R12 / R27) ─────────────────────────────────────────────────────
 * `parents`  → email rows in `path_notification_sends` (claim-then-send).
 * `student`  → in-app rows in `path_notification_events` — NEVER an email.
 *   Every T1 student address is a system-generated non-deliverable `.invalid`
 *   (Unit 6), so the under-13 guarantee is structural: no student-audience
 *   derivation ever produces a send row, which the tests pin.
 *
 * ── Delivery latency (Decision 8's acceptance criterion) ─────────────────────
 * Inline delivery is immediate (attempted in the transition request). A failed
 * inline send is retried by the cron (Vercel Pro, every 10 minutes — pinned by
 * the vercel.json parity test) with a stable Resend Idempotency-Key, up to
 * MAX_SEND_ATTEMPTS. Worst case under sustained transient failure:
 * ~10 min × 5 attempts ≈ 50 minutes, after which the row parks with
 * `attempts = MAX_SEND_ATTEMPTS` and the cron reports it loudly. A parked row
 * is visible in the cron response and re-armable by resetting `attempts`.
 */

/* ───────────────────────────────────────────────────────────── kinds */

/**
 * In-app event kinds (the R27 store). Mirrored in the migration's CHECK — a
 * parity test parses the .sql so the two can never drift. `phase_returned` is
 * modeled (the engine can emit the intent) but has no T1 trigger.
 */
export const NOTIFICATION_EVENT_KINDS = [
  "verified",
  "not_yet",
  "review_underway",
  "reopened",
  "criterion_returned",
  "phase_returned",
] as const;
export type NotificationEventKind = (typeof NOTIFICATION_EVENT_KINDS)[number];

/** Email kinds (the parents channel). Same parity discipline. */
export const SEND_KINDS = ["submitted", "stall_nudge"] as const;
export type SendKind = (typeof SEND_KINDS)[number];

/** A send row is retried until this many attempts, then parked loudly. */
export const MAX_SEND_ATTEMPTS = 5;

/** Reviewer stall nudge default (hours a task sits `submitted` before the
 *  family is nudged); `path_families.review_nudge_hours` overrides per family. */
export const NUDGE_DEFAULT_THRESHOLD_HOURS = 72;

/** How far back the cron's reconcile pass re-derives notifications from the
 *  event/review spines. Bounds the query, not correctness — anything older has
 *  either been delivered or parked. */
export const RECONCILE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/* ─────────────────────────────────────────────────────── dedupe keys */

/** In-app event / send-source key for one task-transition event row. */
export function taskEventKey(taskEventId: string): string {
  return `task_event:${taskEventId}`;
}

/** The student event key for a review attempt entering review. */
export function reviewOpenedKey(reviewId: string): string {
  return `review:${reviewId}:opened`;
}

/** The student event key for a review attempt being returned. */
export function reviewReturnedKey(reviewId: string): string {
  return `review:${reviewId}:returned`;
}

/** The per-submit-cycle nudge source: keyed on the submit timestamp so a
 *  withdraw → resubmit re-arms the nudge while a sitting submit nudges once. */
export function nudgeSourceKey(taskProgressId: string, submitReceivedAt: string): string {
  return `nudge:${taskProgressId}:${submitReceivedAt}`;
}

/** A send row's identity: the source key plus the recipient — "exactly one
 *  pending notification per parent" is this key's unique constraint. */
export function sendDedupeKey(sourceKey: string, recipientUserId: string): string {
  return `${sourceKey}:parent:${recipientUserId}`;
}

/**
 * The Resend `Idempotency-Key` for a send row — a STABLE function of the
 * dedupe key (never Date.now(), never per-attempt), so a retry after a
 * lost-response send is a provider-side no-op within Resend's 24h window
 * (retry-transient-send-failures learning).
 */
export function idempotencyKeyFor(dedupeKey: string): string {
  return `path-notify:${dedupeKey}`;
}

/* ──────────────────────────────────────────────────── plan derivation */

export type ParentRecipient = { userId: string; email: string | null };

/** One `path_task_events` row, as the derivation reads it. `transition` stays
 *  a plain string — an unknown value plans nothing rather than throwing. */
export type TaskEventInput = {
  id: string;
  studentId: string;
  taskId: string;
  transition: string;
  note: string | null;
};

/** One `path_reviews` row, as the derivation reads it. */
export type ReviewInput = {
  id: string;
  studentId: string;
  scope: string;
  scopeId: string;
  attempt: number;
  state: string;
  note: string | null;
};

export type EventInsert = {
  dedupeKey: string;
  studentId: string;
  kind: NotificationEventKind;
  taskId: string | null;
  scopeId: string | null;
  /** Render-time inputs (R27): ids and the adult's words — NEVER rendered
   *  copy; Unit 16 resolves the register (Trail/HQ) at read time. */
  params: Record<string, unknown>;
};

export type SendInsert = {
  dedupeKey: string;
  studentId: string;
  recipientUserId: string;
  email: string;
  kind: SendKind;
  /** Template inputs, snapshotted at enqueue (the version-pinned truth). */
  params: Record<string, unknown>;
};

export type NotificationPlan = { events: EventInsert[]; sends: SendInsert[] };

const EMPTY_PLAN: NotificationPlan = { events: [], sends: [] };

/** Context the task-event derivation needs beyond the event row itself. */
export type TaskEventCtx = {
  parents: readonly ParentRecipient[];
  studentFirstName: string;
  taskTitle: string;
  doneWhen: string;
};

/** The task transitions that notify the STUDENT in-app, and as what kind. */
const STUDENT_EVENT_KIND_BY_TRANSITION: Record<string, NotificationEventKind> = {
  verify: "verified",
  not_yet: "not_yet",
  revoke: "reopened",
};

/**
 * Derive the notification plan for one task-transition event (§13 / the
 * engine's NotificationIntents, resolved against the authoritative event row
 * rather than the point-in-time cascade projection — a stale projection could
 * miss a concurrent sibling's effect; the event row cannot).
 *
 *   submit  → one pending email per parent (audience: parents)
 *   verify / not_yet / revoke → one in-app student event (audience: student)
 *   everything else → nothing
 *
 * `criterion_return` task events are deliberately silent here: one ceremony is
 * one student notification, keyed off the REVIEW row (`planForReview`), not
 * one per returned task.
 */
export function planForTaskEvent(ev: TaskEventInput, ctx: TaskEventCtx): NotificationPlan {
  if (ev.transition === "submit") {
    const source = taskEventKey(ev.id);
    const sends: SendInsert[] = [];
    for (const parent of ctx.parents) {
      const email = parent.email?.trim();
      if (!email) continue; // never a null-recipient row; caller logs the skip
      sends.push({
        dedupeKey: sendDedupeKey(source, parent.userId),
        studentId: ev.studentId,
        recipientUserId: parent.userId,
        email,
        kind: "submitted",
        params: {
          studentFirstName: ctx.studentFirstName,
          taskId: ev.taskId,
          taskTitle: ctx.taskTitle,
          doneWhen: ctx.doneWhen,
        },
      });
    }
    return { events: [], sends };
  }

  const kind = STUDENT_EVENT_KIND_BY_TRANSITION[ev.transition];
  if (!kind) return EMPTY_PLAN;

  return {
    events: [
      {
        dedupeKey: taskEventKey(ev.id),
        studentId: ev.studentId,
        kind,
        taskId: ev.taskId,
        scopeId: null,
        params: { taskId: ev.taskId, note: ev.note },
      },
    ],
    sends: [],
  };
}

/**
 * Derive the plan for one review row. A `review_underway` criterion review
 * yields the "your landmark entered review" student event; a `returned` one
 * yields the ceremony's single student notification — and ALSO plans the
 * opened event (a return implies the open happened; distinct dedupe keys let
 * reconcile insert whichever is missing). `cleared` is a T2 outcome; phase
 * scope has no T1 trigger.
 */
export function planForReview(review: ReviewInput): NotificationPlan {
  if (review.scope !== "criterion") return EMPTY_PLAN;
  if (review.state !== "review_underway" && review.state !== "returned") return EMPTY_PLAN;

  const events: EventInsert[] = [
    {
      dedupeKey: reviewOpenedKey(review.id),
      studentId: review.studentId,
      kind: "review_underway",
      taskId: null,
      scopeId: review.scopeId,
      params: { criterionId: review.scopeId, attempt: review.attempt },
    },
  ];
  if (review.state === "returned") {
    events.push({
      dedupeKey: reviewReturnedKey(review.id),
      studentId: review.studentId,
      kind: "criterion_returned",
      taskId: null,
      scopeId: review.scopeId,
      params: { criterionId: review.scopeId, attempt: review.attempt, note: review.note },
    });
  }
  return { events, sends: [] };
}

export function mergePlans(plans: readonly NotificationPlan[]): NotificationPlan {
  return {
    events: plans.flatMap((p) => p.events),
    sends: plans.flatMap((p) => p.sends),
  };
}

/* ─────────────────────────────────────────────────── supersede rules */

/** A live in-app event row, as the supersede derivation reads it. */
export type LiveEventRow = {
  id: string;
  kind: string;
  taskId: string | null;
  scopeId: string | null;
  supersededAt: string | null;
};

export type SupersedeTrigger =
  | { kind: "reopened"; taskId: string }
  | { kind: "criterion_returned"; scopeId: string; returnedTaskIds: readonly string[] }
  | { kind: string; taskId?: string; scopeId?: string };

/**
 * Which existing event rows a reversal supersedes (INSERT-plus-supersede-flag,
 * never UPDATE-in-place — Unit 16 renders a superseded event past-tense with
 * the correction inline, history intact):
 *
 *   reopened (revoke of task T)      → T's live `verified` events
 *   criterion_returned (criterion C) → C's live `review_underway` events plus
 *                                      the returned tasks' live `verified` events
 *   anything else                    → nothing (forward progress never erases)
 *
 * Already-superseded rows are never re-flagged (the original correction's
 * timestamp is itself history).
 */
export function supersedePlan(trigger: SupersedeTrigger, live: readonly LiveEventRow[]): string[] {
  const alive = live.filter((e) => e.supersededAt === null);
  if (trigger.kind === "reopened" && "taskId" in trigger && trigger.taskId) {
    return alive
      .filter((e) => e.kind === "verified" && e.taskId === trigger.taskId)
      .map((e) => e.id);
  }
  if (trigger.kind === "criterion_returned" && "scopeId" in trigger && trigger.scopeId) {
    const returned = new Set("returnedTaskIds" in trigger ? trigger.returnedTaskIds : []);
    return alive
      .filter(
        (e) =>
          (e.kind === "review_underway" && e.scopeId === trigger.scopeId) ||
          (e.kind === "verified" && e.taskId !== null && returned.has(e.taskId))
      )
      .map((e) => e.id);
  }
  return [];
}

/* ─────────────────────────────── the claim / unclaim state machine */

export type ClaimOutcome = "claimed" | "miss" | "error";

/** The conditional `UPDATE … WHERE sent_at IS NULL` verdict: row cardinality.
 *  An errored claim is an error even if the driver echoed rows — fail safe. */
export function interpretClaim(input: { errored: boolean; claimedRows: number }): ClaimOutcome {
  if (input.errored) return "error";
  return input.claimedRows > 0 ? "claimed" : "miss";
}

export type ClaimMiss =
  | { status: "already_sent" }
  | { status: "raced_retry_later" }
  | { status: "row_missing" };

/**
 * Zero rows claimed is AMBIGUOUS — disambiguate by re-probing the send row
 * itself (the stamp-owning table, never a parent entity):
 *   stamp set   → a concurrent invocation really sent — success, not failure
 *   stamp null  → raced a claim that later unclaimed (or is mid-flight) —
 *                 retry on a later run, never double-send now
 *   row gone    → an anomaly to log (send rows are never deleted)
 */
export function interpretSendClaimMiss(probe: { exists: boolean; sentAt: string | null }): ClaimMiss {
  if (!probe.exists) return { status: "row_missing" };
  if (probe.sentAt !== null) return { status: "already_sent" };
  return { status: "raced_retry_later" };
}

export type UnclaimOutcome = "restored" | "superseded" | "warn";

/**
 * The CAS-guarded unclaim's verdict (`UPDATE … SET sent_at = null WHERE id = ?
 * AND sent_at = <the stamp THIS invocation wrote>`): one row restored means
 * the retry path is re-armed; zero rows means a concurrent invocation
 * superseded our stamp — its send is truth, do NOT warn; an error means the
 * row may be left stamped-but-unsent, which the caller logs loudly (the one
 * residual the pattern accepts — resend-safe-atomic-claim learning).
 */
export function sendUnclaimOutcome(input: { errored: boolean; restoredRows: number }): UnclaimOutcome {
  if (input.errored) return "warn";
  return input.restoredRows > 0 ? "restored" : "superseded";
}

/** Whether a send row is still owed an attempt: pending, under the ceiling. */
export function isSendDue(
  row: { sentAt: string | null; attempts: number },
  maxAttempts: number = MAX_SEND_ATTEMPTS
): boolean {
  return row.sentAt === null && row.attempts < maxAttempts;
}

/* ───────────────────────────────────────────────────── stall nudges */

export type SubmittedTaskRow = {
  taskProgressId: string;
  studentId: string;
  taskId: string;
  /** `submit_received_at` — the SERVER timestamp (R30 instruments off it). */
  submitReceivedAt: string | null;
};

export type DueNudge = {
  sourceKey: string;
  taskProgressId: string;
  studentId: string;
  taskId: string;
  waitingHours: number;
};

/**
 * Which submitted tasks have sat past the family's threshold with no nudge yet
 * this submit cycle. `>=` at the boundary (72h exactly IS due); a row with no
 * submit timestamp is skipped (never nudge on a guess); an existing source key
 * suppresses (one nudge per cycle — a resubmit stamps a fresh timestamp and
 * therefore a fresh key, re-arming the nudge).
 */
export function dueNudges(input: {
  submitted: readonly SubmittedTaskRow[];
  thresholdHours: number;
  existingSourceKeys: ReadonlySet<string>;
  nowMs: number;
}): DueNudge[] {
  const out: DueNudge[] = [];
  for (const row of input.submitted) {
    if (!row.submitReceivedAt) continue;
    const submittedMs = Date.parse(row.submitReceivedAt);
    if (!Number.isFinite(submittedMs)) continue;
    const waitedMs = input.nowMs - submittedMs;
    if (waitedMs < input.thresholdHours * 3600_000) continue;
    const sourceKey = nudgeSourceKey(row.taskProgressId, row.submitReceivedAt);
    if (input.existingSourceKeys.has(sourceKey)) continue;
    out.push({
      sourceKey,
      taskProgressId: row.taskProgressId,
      studentId: row.studentId,
      taskId: row.taskId,
      waitingHours: Math.floor(waitedMs / 3600_000),
    });
  }
  return out;
}

/** Expand one due nudge into one send per parent (same recipient keying as
 *  every other send — the unique constraint dedupes across runs). */
export function buildNudgeSends(
  nudge: DueNudge,
  ctx: { parents: readonly ParentRecipient[]; studentFirstName: string; taskTitle: string }
): SendInsert[] {
  const sends: SendInsert[] = [];
  for (const parent of ctx.parents) {
    const email = parent.email?.trim();
    if (!email) continue;
    sends.push({
      dedupeKey: sendDedupeKey(nudge.sourceKey, parent.userId),
      studentId: nudge.studentId,
      recipientUserId: parent.userId,
      email,
      kind: "stall_nudge",
      params: {
        studentFirstName: ctx.studentFirstName,
        taskId: nudge.taskId,
        taskTitle: ctx.taskTitle,
        waitingHours: nudge.waitingHours,
      },
    });
  }
  return sends;
}

/* ─────────────────────────────────────────────── reconcile (the healer) */

/**
 * Reduce a fully-derived plan to what is actually MISSING, given the dedupe
 * keys that already exist. This is the cron's healing pass: re-derive
 * everything in the window, keep only the holes, insert those. Idempotent by
 * construction — running it twice plans nothing the second time.
 */
export function reconcilePlan(
  full: NotificationPlan,
  existing: { existingEventKeys: ReadonlySet<string>; existingSendKeys: ReadonlySet<string> }
): NotificationPlan {
  return {
    events: full.events.filter((e) => !existing.existingEventKeys.has(e.dedupeKey)),
    sends: full.sends.filter((s) => !existing.existingSendKeys.has(s.dedupeKey)),
  };
}
