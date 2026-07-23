/**
 * The Path notifications — the I/O executor (T1 Unit 12). PLAIN module — no
 * `server-only`, no `"use server"` — so the transition action, the cron route,
 * and any tsx script drive the exact same machinery against a caller-supplied
 * service-role client (the `sendWelcome` posture). Every DECISION here is a
 * call into `notify-rules.ts` (pure, tested); this file only composes queries,
 * claims, and provider calls.
 *
 * The claim-then-send discipline (Decision 8, the resend-safe learning):
 *   claim    = UPDATE … SET sent_at = <JS-minted opaque stamp>
 *              WHERE id = ? AND sent_at IS NULL   — cardinality is the verdict
 *   miss     = re-probe the ROW (never assume failed): stamp set → a concurrent
 *              invocation really sent; stamp null → raced, retry later
 *   failure  = CAS-guarded unclaim (WHERE sent_at = OUR stamp) — can never
 *              clobber a concurrent real send; zero rows restored = superseded
 *   retry    = the cron re-drains pending rows with a STABLE Idempotency-Key,
 *              so a lost-response send retried within Resend's 24h window is a
 *              provider-side no-op
 *
 * NOTHING in this module throws to its caller from the notify paths — a
 * notification failure must never fail the transition that produced it. Every
 * function returns a summary; errors are logged loudly and left for the cron.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/app/lib/email";
// Side-effect: registers generated program modules so getProgram resolves here
// even when this module is driven from a cron/script graph (Unit 14 learning).
import "@/app/path/content/registry";
import { getProgram } from "@/app/path/content/manifest";
import { renderSendEmail } from "./template";
import {
  MAX_SEND_ATTEMPTS,
  buildNudgeSends,
  dueNudges,
  idempotencyKeyFor,
  interpretClaim,
  interpretSendClaimMiss,
  isSendDue,
  mergePlans,
  planForReview,
  planForTaskEvent,
  reconcilePlan,
  sendUnclaimOutcome,
  supersedePlan,
  type LiveEventRow,
  type NotificationPlan,
  type ParentRecipient,
  type ReviewInput,
  type SendKind,
  type SupersedeTrigger,
  type TaskEventInput,
} from "./notify-rules";

type Db = SupabaseClient;

/* ─────────────────────────────────────────────────────── recipients */

/**
 * The family's parent recipients: parent/family grant holders resolved to
 * their auth emails. A parent whose account lookup fails is skipped WITH a
 * loud log (they will be healed by a later reconcile run once the lookup
 * recovers) — never a thrown error, never a silent null recipient.
 */
export async function resolveParentRecipients(db: Db, familyId: string): Promise<ParentRecipient[]> {
  const { data, error } = await db
    .from("path_role_grants")
    .select("user_id")
    .eq("role", "parent")
    .eq("scope_type", "family")
    .eq("scope_id", familyId);
  if (error) {
    console.error(`[path/notify] parent grants for family ${familyId} failed: ${error.message}`);
    return [];
  }
  const out: ParentRecipient[] = [];
  for (const row of data ?? []) {
    const userId = row.user_id as string;
    const { data: user, error: userError } = await db.auth.admin.getUserById(userId);
    if (userError || !user?.user) {
      console.error(`[path/notify] auth lookup for parent ${userId} failed: ${userError?.message ?? "no user"}`);
      continue;
    }
    out.push({ userId, email: user.user.email ?? null });
  }
  return out;
}

/* ─────────────────────────────────────────────────────────── enqueue */

/** Insert a plan's rows idempotently (ON CONFLICT DO NOTHING on dedupe_key —
 *  `ignoreDuplicates`, so no DO UPDATE arm exists to poison). */
export async function enqueuePlan(
  db: Db,
  plan: NotificationPlan
): Promise<{ eventsInserted: number; sendsInserted: number; errored: boolean }> {
  let errored = false;
  if (plan.events.length > 0) {
    const { error } = await db.from("path_notification_events").upsert(
      plan.events.map((e) => ({
        dedupe_key: e.dedupeKey,
        student_id: e.studentId,
        kind: e.kind,
        task_id: e.taskId,
        scope_id: e.scopeId,
        params: e.params,
      })),
      { onConflict: "dedupe_key", ignoreDuplicates: true }
    );
    if (error) {
      errored = true;
      console.error(`[path/notify] event enqueue failed: ${error.message}`);
    }
  }
  if (plan.sends.length > 0) {
    const { error } = await db.from("path_notification_sends").upsert(
      plan.sends.map((s) => ({
        dedupe_key: s.dedupeKey,
        student_id: s.studentId,
        recipient_user_id: s.recipientUserId,
        email: s.email,
        kind: s.kind,
        params: s.params,
      })),
      { onConflict: "dedupe_key", ignoreDuplicates: true }
    );
    if (error) {
      errored = true;
      console.error(`[path/notify] send enqueue failed: ${error.message}`);
    }
  }
  return { eventsInserted: plan.events.length, sendsInserted: plan.sends.length, errored };
}

/** Flag superseded events (null → non-null ONLY — an earlier correction's
 *  timestamp is itself history and is never overwritten). */
export async function applySupersedes(db: Db, trigger: SupersedeTrigger, studentId: string): Promise<number> {
  const { data, error } = await db
    .from("path_notification_events")
    .select("id, kind, task_id, scope_id, superseded_at")
    .eq("student_id", studentId)
    .is("superseded_at", null);
  if (error) {
    console.error(`[path/notify] supersede read for ${studentId} failed: ${error.message}`);
    return 0;
  }
  const live: LiveEventRow[] = (data ?? []).map((r) => ({
    id: r.id as string,
    kind: r.kind as string,
    taskId: (r.task_id as string | null) ?? null,
    scopeId: (r.scope_id as string | null) ?? null,
    supersededAt: (r.superseded_at as string | null) ?? null,
  }));
  const ids = supersedePlan(trigger, live);
  if (ids.length === 0) return 0;
  const { error: updateError } = await db
    .from("path_notification_events")
    .update({ superseded_at: new Date().toISOString() })
    .in("id", ids)
    .is("superseded_at", null);
  if (updateError) {
    console.error(`[path/notify] supersede flag for ${studentId} failed: ${updateError.message}`);
    return 0;
  }
  return ids.length;
}

/* ─────────────────────────────────────────────── the claim-then-send */

export type SendRowState = {
  id: string;
  dedupeKey: string;
  email: string;
  kind: SendKind;
  params: Record<string, unknown>;
  attempts: number;
};

export type AttemptOutcome =
  | "sent"
  | "already_sent"
  | "raced_retry_later"
  | "claim_error"
  | "send_failed"
  | "row_missing";

/** One claim-then-send attempt for one pending row. */
export async function attemptSend(db: Db, row: SendRowState): Promise<AttemptOutcome> {
  // Opaque stamp minted once in JS — the CAS token and the DB value must be the
  // same string end to end (never SQL now(), never re-parsed through Date).
  const stamp = new Date().toISOString();

  const { data: claimed, error: claimError } = await db
    .from("path_notification_sends")
    .update({ sent_at: stamp, attempts: row.attempts + 1, last_attempt_at: stamp })
    .eq("id", row.id)
    .is("sent_at", null)
    .select("id");

  const claim = interpretClaim({ errored: !!claimError, claimedRows: (claimed ?? []).length });
  if (claim === "error") {
    console.error(`[path/notify] claim for ${row.dedupeKey} failed: ${claimError?.message}`);
    return "claim_error";
  }
  if (claim === "miss") {
    // Zero rows is ambiguous — re-probe the stamp-owning row itself.
    const { data: probe } = await db
      .from("path_notification_sends")
      .select("id, sent_at")
      .eq("id", row.id)
      .maybeSingle();
    const miss = interpretSendClaimMiss({
      exists: !!probe,
      sentAt: (probe?.sent_at as string | null) ?? null,
    });
    if (miss.status === "row_missing") {
      console.error(`[path/notify] send row ${row.id} (${row.dedupeKey}) vanished — rows are never deleted`);
    }
    return miss.status;
  }

  // We hold the claim. Render and send with the STABLE idempotency key.
  const rendered = renderSendEmail(row.kind, row.params);
  const sent = await sendEmail({
    to: row.email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    idempotencyKey: idempotencyKeyFor(row.dedupeKey),
  });
  if (sent.ok) return "sent";

  // CAS-guarded unclaim: restore ONLY if our stamp still holds.
  const { data: restored, error: unclaimError } = await db
    .from("path_notification_sends")
    .update({ sent_at: null, last_error: (sent.error ?? "send failed").slice(0, 500) })
    .eq("id", row.id)
    .eq("sent_at", stamp)
    .select("id");
  const outcome = sendUnclaimOutcome({
    errored: !!unclaimError,
    restoredRows: (restored ?? []).length,
  });
  if (outcome === "warn") {
    // The one residual the pattern accepts: the row may be left stamped-but-
    // unsent. Loud, greppable, and visible in last_error staying null.
    console.error(
      `[path/notify] UNCLAIM FAILED for ${row.dedupeKey} — row may be stamped without a real send: ${unclaimError?.message}`
    );
  }
  if (outcome === "superseded") return "already_sent"; // a concurrent send is truth
  return "send_failed";
}

export type DrainSummary = {
  considered: number;
  sent: number;
  alreadySent: number;
  failed: number;
  raced: number;
  errors: number;
};

/** Drain pending send rows (oldest first, capped). The cron's main verb, also
 *  used inline right after an enqueue for immediate delivery. */
export async function drainPendingSends(
  db: Db,
  opts: { limit: number; onlyKeys?: readonly string[] }
): Promise<DrainSummary> {
  let query = db
    .from("path_notification_sends")
    .select("id, dedupe_key, email, kind, params, attempts, sent_at")
    .is("sent_at", null)
    .lt("attempts", MAX_SEND_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(opts.limit);
  if (opts.onlyKeys && opts.onlyKeys.length > 0) {
    query = query.in("dedupe_key", opts.onlyKeys as string[]);
  }
  const { data, error } = await query;
  const summary: DrainSummary = { considered: 0, sent: 0, alreadySent: 0, failed: 0, raced: 0, errors: 0 };
  if (error) {
    console.error(`[path/notify] pending-send read failed: ${error.message}`);
    summary.errors++;
    return summary;
  }
  for (const raw of data ?? []) {
    const row: SendRowState = {
      id: raw.id as string,
      dedupeKey: raw.dedupe_key as string,
      email: raw.email as string,
      kind: raw.kind as SendKind,
      params: (raw.params as Record<string, unknown>) ?? {},
      attempts: (raw.attempts as number) ?? 0,
    };
    if (!isSendDue({ sentAt: (raw.sent_at as string | null) ?? null, attempts: row.attempts })) continue;
    summary.considered++;
    const outcome = await attemptSend(db, row);
    if (outcome === "sent") summary.sent++;
    else if (outcome === "already_sent") summary.alreadySent++;
    else if (outcome === "send_failed") summary.failed++;
    else if (outcome === "raced_retry_later") summary.raced++;
    else summary.errors++;
  }
  return summary;
}

/* ────────────────────────────────────────────── inline (post-transition) */

/** The transitions that produce notifications at all — anything else skips the
 *  reads entirely. Mirrors notify-rules' derivation (which is authoritative). */
const NOTIFYING_TRANSITIONS = new Set(["submit", "verify", "not_yet", "revoke"]);

export type InlineNotifySummary = {
  enqueuedEvents: number;
  enqueuedSends: number;
  sent: number;
  superseded: number;
  skipped?: string;
};

/**
 * The INLINE notification path, called by the transition action AFTER a
 * successful write. Derives the plan from the authoritative event row the RPC
 * just appended (never the engine's point-in-time cascade projection),
 * enqueues idempotently, applies supersede flags, and attempts the just-
 * enqueued sends immediately for real-time delivery. Never throws — the
 * transition already happened; the cron heals anything this path drops.
 */
export async function notifyAfterTransition(
  db: Db,
  input: {
    studentId: string;
    familyId: string;
    programVersionId: string;
    taskId: string;
    criterionId: string;
    transition: string;
  }
): Promise<InlineNotifySummary> {
  const none: InlineNotifySummary = { enqueuedEvents: 0, enqueuedSends: 0, sent: 0, superseded: 0 };
  try {
    if (!NOTIFYING_TRANSITIONS.has(input.transition)) {
      return { ...none, skipped: "transition does not notify" };
    }

    // The authoritative event row our CAS just appended (read back by shape —
    // a concurrent identical event would carry the same notification meaning,
    // and dedupe keys make double-enqueue a no-op).
    const { data: eventRow, error: eventError } = await db
      .from("path_task_events")
      .select("id, student_id, task_id, transition, note")
      .eq("student_id", input.studentId)
      .eq("task_id", input.taskId)
      .eq("transition", input.transition)
      .order("at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (eventError || !eventRow) {
      console.error(
        `[path/notify] event read-back for ${input.studentId}/${input.taskId}/${input.transition} failed: ${eventError?.message ?? "no row"}`
      );
      return { ...none, skipped: "event read-back failed (cron will heal)" };
    }
    const taskEvent: TaskEventInput = {
      id: eventRow.id as string,
      studentId: eventRow.student_id as string,
      taskId: eventRow.task_id as string,
      transition: eventRow.transition as string,
      note: (eventRow.note as string | null) ?? null,
    };

    // Render context: the student's first name + the pinned task content.
    const [nameRes, parents] = await Promise.all([
      db
        .from("path_student_profiles")
        .select("id, children(first_name)")
        .eq("id", input.studentId)
        .maybeSingle(),
      input.transition === "submit" ? resolveParentRecipients(db, input.familyId) : Promise.resolve([]),
    ]);
    const childJoin = nameRes.data?.children;
    const child = Array.isArray(childJoin) ? childJoin[0] : childJoin;
    const firstName =
      typeof (child as { first_name?: unknown } | null | undefined)?.first_name === "string"
        ? ((child as { first_name: string }).first_name)
        : "";
    const { taskTitle, doneWhen } = taskContent(input.programVersionId, input.taskId);

    const plans = [
      planForTaskEvent(taskEvent, {
        parents,
        studentFirstName: firstName,
        taskTitle,
        doneWhen,
      }),
    ];

    // A verify can open the criterion review atomically — probe the review row
    // (authoritative) rather than trusting the stale cascade projection.
    if (input.transition === "verify") {
      const review = await latestCriterionReview(db, input.studentId, input.criterionId);
      if (review) plans.push(planForReview(review));
    }

    const plan = mergePlans(plans);
    const enqueue = await enqueuePlan(db, plan);

    // Reversal flags: a revoke supersedes the task's live verified celebration.
    let superseded = 0;
    if (input.transition === "revoke") {
      superseded = await applySupersedes(db, { kind: "reopened", taskId: input.taskId }, input.studentId);
    }

    // Immediate delivery of what we just enqueued (claim-then-send; a race
    // with the cron resolves via the claim, never a double send).
    let sent = 0;
    if (plan.sends.length > 0) {
      const drained = await drainPendingSends(db, {
        limit: plan.sends.length,
        onlyKeys: plan.sends.map((s) => s.dedupeKey),
      });
      sent = drained.sent;
    }

    return {
      enqueuedEvents: enqueue.eventsInserted,
      enqueuedSends: enqueue.sendsInserted,
      sent,
      superseded,
    };
  } catch (e) {
    console.error(`[path/notify] inline notify failed for ${input.studentId}/${input.taskId}:`, e);
    return { ...none, skipped: "inline notify threw (cron will heal)" };
  }
}

/** The ceremony's notification path: the return action already knows the
 *  decided review row from the RPC echo — no read-back needed. */
export async function notifyCriterionReturned(
  db: Db,
  input: {
    review: ReviewInput;
    returnedTaskIds: readonly string[];
  }
): Promise<InlineNotifySummary> {
  const none: InlineNotifySummary = { enqueuedEvents: 0, enqueuedSends: 0, sent: 0, superseded: 0 };
  try {
    const plan = planForReview(input.review);
    const enqueue = await enqueuePlan(db, plan);
    const superseded = await applySupersedes(
      db,
      {
        kind: "criterion_returned",
        scopeId: input.review.scopeId,
        returnedTaskIds: input.returnedTaskIds,
      },
      input.review.studentId
    );
    return { enqueuedEvents: enqueue.eventsInserted, enqueuedSends: enqueue.sendsInserted, sent: 0, superseded };
  } catch (e) {
    console.error(`[path/notify] return notify failed for review ${input.review.id}:`, e);
    return { ...none, skipped: "return notify threw (cron will heal)" };
  }
}

/* ──────────────────────────────────────────────── reconcile + nudges */

export type ReconcileSummary = {
  scannedEvents: number;
  scannedReviews: number;
  enqueuedEvents: number;
  enqueuedSends: number;
  superseded: number;
  nudgesEnqueued: number;
  errors: number;
};

/**
 * The cron's healing pass: re-derive every notification the trailing window's
 * event/review spines imply, insert whatever is missing (dedupe keys make it
 * idempotent), re-apply supersede flags for in-window reversals, and enqueue
 * due stall nudges. A crash between a transition's RPC commit and its inline
 * enqueue is repaired here — the spine rows are the durable truth.
 */
export async function reconcileNotifications(
  db: Db,
  opts: { nowMs: number; windowMs: number; maxStudents?: number }
): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = {
    scannedEvents: 0,
    scannedReviews: 0,
    enqueuedEvents: 0,
    enqueuedSends: 0,
    superseded: 0,
    nudgesEnqueued: 0,
    errors: 0,
  };
  const cutoffIso = new Date(opts.nowMs - opts.windowMs).toISOString();

  // 1) The spines, windowed.
  const [eventsRes, reviewsRes] = await Promise.all([
    db
      .from("path_task_events")
      .select("id, student_id, task_id, transition, note, at")
      .gte("at", cutoffIso)
      .in("transition", ["submit", "verify", "not_yet", "revoke", "criterion_return"]),
    db
      .from("path_reviews")
      .select("id, student_id, scope, scope_id, attempt, state, note, opened_at, decided_at")
      .gte("opened_at", cutoffIso),
  ]);
  if (eventsRes.error || reviewsRes.error) {
    console.error(
      `[path/notify] reconcile spine read failed: ${eventsRes.error?.message ?? reviewsRes.error?.message}`
    );
    summary.errors++;
    return summary;
  }
  const events = eventsRes.data ?? [];
  const reviews = reviewsRes.data ?? [];
  summary.scannedEvents = events.length;
  summary.scannedReviews = reviews.length;

  // 2) Existing notification keys in (a superset of) the window — an
  // optimization only; the DB's ON CONFLICT DO NOTHING is the real guard.
  const [existingEventsRes, existingSendsRes] = await Promise.all([
    db.from("path_notification_events").select("dedupe_key").gte("created_at", cutoffIso),
    db.from("path_notification_sends").select("dedupe_key").gte("created_at", cutoffIso),
  ]);
  const existingEventKeys = new Set(
    (existingEventsRes.data ?? []).map((r) => r.dedupe_key as string)
  );
  const existingSendKeys = new Set((existingSendsRes.data ?? []).map((r) => r.dedupe_key as string));

  // 3) Per-student context, resolved once per student in the window.
  const studentIds = [
    ...new Set([
      ...events.map((e) => e.student_id as string),
      ...reviews.map((r) => r.student_id as string),
    ]),
  ].slice(0, opts.maxStudents ?? 200);

  for (const studentId of studentIds) {
    const ctx = await studentNotifyContext(db, studentId);
    if (!ctx) {
      summary.errors++;
      continue;
    }
    const plans: NotificationPlan[] = [];
    for (const e of events) {
      if ((e.student_id as string) !== studentId) continue;
      const { taskTitle, doneWhen } = taskContent(ctx.programVersionId, e.task_id as string);
      plans.push(
        planForTaskEvent(
          {
            id: e.id as string,
            studentId,
            taskId: e.task_id as string,
            transition: e.transition as string,
            note: (e.note as string | null) ?? null,
          },
          { parents: ctx.parents, studentFirstName: ctx.firstName, taskTitle, doneWhen }
        )
      );
    }
    for (const r of reviews) {
      if ((r.student_id as string) !== studentId) continue;
      plans.push(
        planForReview({
          id: r.id as string,
          studentId,
          scope: r.scope as string,
          scopeId: r.scope_id as string,
          attempt: r.attempt as number,
          state: r.state as string,
          note: (r.note as string | null) ?? null,
        })
      );
    }
    const missing = reconcilePlan(mergePlans(plans), { existingEventKeys, existingSendKeys });
    if (missing.events.length > 0 || missing.sends.length > 0) {
      const res = await enqueuePlan(db, missing);
      summary.enqueuedEvents += res.eventsInserted;
      summary.enqueuedSends += res.sendsInserted;
      if (res.errored) summary.errors++;
    }

    // Re-apply reversal flags for in-window reversals (idempotent: the flag
    // update guards on superseded_at IS NULL).
    for (const e of events) {
      if ((e.student_id as string) !== studentId) continue;
      if ((e.transition as string) === "revoke") {
        summary.superseded += await applySupersedes(
          db,
          { kind: "reopened", taskId: e.task_id as string },
          studentId
        );
      }
    }
    for (const r of reviews) {
      if ((r.student_id as string) !== studentId) continue;
      if ((r.state as string) === "returned" && (r.scope as string) === "criterion") {
        const returnedTaskIds = events
          .filter(
            (e) =>
              (e.student_id as string) === studentId &&
              (e.transition as string) === "criterion_return"
          )
          .map((e) => e.task_id as string);
        summary.superseded += await applySupersedes(
          db,
          { kind: "criterion_returned", scopeId: r.scope_id as string, returnedTaskIds },
          studentId
        );
      }
    }
  }

  // 4) Stall nudges: submitted tasks past their family threshold.
  summary.nudgesEnqueued = await enqueueDueNudges(db, opts.nowMs, summary);

  return summary;
}

/** Enqueue nudge send rows for submitted tasks sitting past the family
 *  threshold. Returns how many rows were enqueued. */
async function enqueueDueNudges(db: Db, nowMs: number, summary: ReconcileSummary): Promise<number> {
  const { data: submittedRows, error } = await db
    .from("path_task_progress")
    .select("id, student_id, task_id, submit_received_at")
    .eq("state", "submitted");
  if (error) {
    console.error(`[path/notify] nudge scan failed: ${error.message}`);
    summary.errors++;
    return 0;
  }
  const rows = submittedRows ?? [];
  if (rows.length === 0) return 0;

  // Existing nudge SOURCE keys, derived from the send rows' dedupe keys.
  const { data: nudgeSends } = await db
    .from("path_notification_sends")
    .select("dedupe_key")
    .eq("kind", "stall_nudge");
  const existingSourceKeys = new Set(
    (nudgeSends ?? [])
      .map((r) => r.dedupe_key as string)
      .map((k) => k.slice(0, k.indexOf(":parent:")))
      .filter((k) => k.length > 0)
  );

  let enqueued = 0;
  // Group by student so context resolves once each.
  const byStudent = new Map<string, typeof rows>();
  for (const r of rows) {
    const sid = r.student_id as string;
    const list = byStudent.get(sid) ?? [];
    list.push(r);
    byStudent.set(sid, list);
  }
  for (const [studentId, studentRows] of byStudent) {
    const ctx = await studentNotifyContext(db, studentId);
    if (!ctx) {
      summary.errors++;
      continue;
    }
    const due = dueNudges({
      submitted: studentRows.map((r) => ({
        taskProgressId: r.id as string,
        studentId,
        taskId: r.task_id as string,
        submitReceivedAt: (r.submit_received_at as string | null) ?? null,
      })),
      thresholdHours: ctx.reviewNudgeHours,
      existingSourceKeys,
      nowMs,
    });
    for (const nudge of due) {
      const { taskTitle } = taskContent(ctx.programVersionId, nudge.taskId);
      const sends = buildNudgeSends(nudge, {
        parents: ctx.parents,
        studentFirstName: ctx.firstName,
        taskTitle,
      });
      if (sends.length > 0) {
        const res = await enqueuePlan(db, { events: [], sends });
        enqueued += res.sendsInserted;
        if (res.errored) summary.errors++;
      }
    }
  }
  return enqueued;
}

/* ─────────────────────────────────────────────────────────── helpers */

/** The latest criterion review row — the post-verify review-opened probe, and
 *  the review ceremony's pre-read (actions/review.ts). Exported: plain I/O. */
export async function latestCriterionReview(
  db: Db,
  studentId: string,
  criterionId: string
): Promise<ReviewInput | null> {
  const { data, error } = await db
    .from("path_reviews")
    .select("id, student_id, scope, scope_id, attempt, state, note")
    .eq("student_id", studentId)
    .eq("scope", "criterion")
    .eq("scope_id", criterionId)
    .order("attempt", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error(`[path/notify] review probe for ${studentId}/${criterionId} failed: ${error.message}`);
    return null;
  }
  if (!data) return null;
  return {
    id: data.id as string,
    studentId: data.student_id as string,
    scope: data.scope as string,
    scopeId: data.scope_id as string,
    attempt: data.attempt as number,
    state: data.state as string,
    note: (data.note as string | null) ?? null,
  };
}

type StudentNotifyContext = {
  firstName: string;
  programVersionId: string;
  familyId: string;
  parents: ParentRecipient[];
  reviewNudgeHours: number;
};

/** One student's notification context: name, pinned version, family threshold,
 *  parent recipients. Null (logged) on any failure — the caller skips. */
async function studentNotifyContext(db: Db, studentId: string): Promise<StudentNotifyContext | null> {
  const { data, error } = await db
    .from("path_student_profiles")
    .select("id, program_version_id, family_id, children(first_name), path_families(review_nudge_hours)")
    .eq("id", studentId)
    .maybeSingle();
  if (error || !data) {
    console.error(`[path/notify] context for ${studentId} failed: ${error?.message ?? "no row"}`);
    return null;
  }
  const childJoin = data.children;
  const child = Array.isArray(childJoin) ? childJoin[0] : childJoin;
  const firstName =
    typeof (child as { first_name?: unknown } | null | undefined)?.first_name === "string"
      ? (child as { first_name: string }).first_name
      : "";
  const famJoin = data.path_families;
  const fam = Array.isArray(famJoin) ? famJoin[0] : famJoin;
  const nudgeHours = (fam as { review_nudge_hours?: unknown } | null | undefined)?.review_nudge_hours;
  const parents = await resolveParentRecipients(db, data.family_id as string);
  return {
    firstName,
    programVersionId: data.program_version_id as string,
    familyId: data.family_id as string,
    parents,
    reviewNudgeHours: typeof nudgeHours === "number" && nudgeHours > 0 ? nudgeHours : 72,
  };
}

/** The pinned task's title + Done-when for email params. Neutral fallbacks on
 *  an unknown version/task — the email renders, the anomaly logs. */
function taskContent(programVersionId: string, taskId: string): { taskTitle: string; doneWhen: string } {
  try {
    const program = getProgram(programVersionId);
    for (const phase of program.phases) {
      for (const criterion of phase.criteria) {
        const task = criterion.tasks.find((t) => t.id === taskId);
        if (task) return { taskTitle: task.title, doneWhen: task.doneWhen };
      }
    }
  } catch (e) {
    console.error(`[path/notify] content lookup ${programVersionId}/${taskId} failed:`, e);
  }
  return { taskTitle: "", doneWhen: "" };
}
