/**
 * The Path notifications — the I/O executor (T1 Unit 12). PLAIN module — no
 * `server-only`, no `"use server"` — so the transition action, the cron route,
 * and any tsx script drive the exact same machinery against a caller-supplied
 * service-role client (the `sendWelcome` posture). Every DECISION here is a
 * call into `notify-rules.ts` (pure, tested); this file only composes queries,
 * claims, and provider calls.
 *
 * The claim-then-send discipline (Decision 8 + the Unit 12 reliability
 * review's stuck-claim fix — claim and success are SEPARATE stamps):
 *   claim    = UPDATE … SET claimed_at = <JS-minted opaque stamp>
 *              WHERE id = ? AND sent_at IS NULL
 *                AND (claimed_at IS NULL OR claimed_at < stale-cutoff)
 *              — cardinality is the verdict; a claim whose process died
 *              mid-send goes stale after STALE_CLAIM_TTL_MS and the row
 *              becomes claimable again (never a permanent silent loss)
 *   success  = UPDATE … SET sent_at = stamp WHERE claimed_at = OUR stamp
 *              (CAS-guarded — a stale-reclaim racer's stamp is truth)
 *   miss     = re-probe the ROW (never assume failed): sent_at set → a
 *              concurrent invocation really sent; else → raced, retry later
 *   failure  = CAS-guarded unclaim (WHERE claimed_at = OUR stamp) — can never
 *              clobber a concurrent claim
 *   retry    = the cron re-drains pending rows with a STABLE Idempotency-Key,
 *              so a lost-response send retried within Resend's 24h window is a
 *              provider-side no-op (which is also what makes the stale-claim
 *              retake safe)
 *
 * NOTHING in this module throws to its caller from the notify paths — a
 * notification failure must never fail the transition that produced it. Every
 * function returns a summary; errors are logged loudly and left for the cron.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/app/lib/email";
// Side-effect: registers generated program modules so getProgram resolves here
// even when this module is driven from a cron/script graph (Unit 14 learning).
import "@/app/fp/content/registry";
import { getProgram } from "@/app/fp/content/manifest";
import { firstNameFromChildJoin } from "@/app/fp/lib/progress-core";
import { renderSendEmail } from "./template";
import {
  MAX_SEND_ATTEMPTS,
  NOTIFYING_TRANSITIONS,
  NUDGE_DEFAULT_THRESHOLD_HOURS,
  STALE_CLAIM_TTL_MS,
  buildNudgeSends,
  dueNudges,
  idempotencyKeyFor,
  interpretClaim,
  interpretSendClaimMiss,
  isSendDue,
  mergePlans,
  narrowSendKind,
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

/** Bounded concurrency for independent DB/auth I/O — parallel enough to kill
 *  the serial-latency tail, small enough to stay polite to the APIs. */
const IO_BATCH = 4;

/** Resend's default rate limit is 2 requests/second — batches of two sends,
 *  paced to at least a second apart (proven live: batches of 4 fired
 *  instantly returned 429 rate_limit_exceeded). The retry path absorbs any
 *  stragglers, but pacing beats retry noise. */
const SEND_BATCH = 2;
const SEND_BATCH_MIN_INTERVAL_MS = 1100;

async function inBatches<T, R>(
  items: readonly T[],
  batchSize: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    out.push(...(await Promise.all(items.slice(i, i + batchSize).map(fn))));
  }
  return out;
}

/* ────────────────────────────────────────────── per-run resolution cache */

/**
 * Memoizes family→parents and student→context WITHIN one logical run (one
 * cron invocation, one inline notify). The performance review's N+1: without
 * this, a 2-parent family with 3 active students costs 6 auth-admin lookups
 * per cron run, twice (reconcile + nudges). Promise-valued so concurrent
 * resolutions of the same key share one flight.
 */
export type NotifyRunCache = {
  parentsByFamily: Map<string, Promise<ParentRecipient[]>>;
  contextByStudent: Map<string, Promise<StudentNotifyContext | null>>;
};

export function createNotifyRunCache(): NotifyRunCache {
  return { parentsByFamily: new Map(), contextByStudent: new Map() };
}

/* ─────────────────────────────────────────────────────── recipients */

/**
 * The family's parent recipients: parent/family grant holders resolved to
 * their auth emails. A parent whose account lookup fails — or who has NO
 * email — is skipped WITH a loud log (the single chokepoint the pure
 * derivation's "never a null-recipient row" rule relies on for
 * observability); never a thrown error.
 */
export async function resolveParentRecipients(
  db: Db,
  familyId: string,
  cache?: NotifyRunCache
): Promise<ParentRecipient[]> {
  const cached = cache?.parentsByFamily.get(familyId);
  if (cached) return cached;
  const flight = (async () => {
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
    const rows = (data ?? []).map((r) => r.user_id as string);
    const out = await inBatches(rows, IO_BATCH, async (userId) => {
      const { data: user, error: userError } = await db.auth.admin.getUserById(userId);
      if (userError || !user?.user) {
        console.error(
          `[path/notify] auth lookup for parent ${userId} failed: ${userError?.message ?? "no user"}`
        );
        return null;
      }
      if (!user.user.email) {
        console.error(`[path/notify] parent ${userId} has no email — email channel skipped for them`);
      }
      return { userId, email: user.user.email ?? null } satisfies ParentRecipient;
    });
    return out.filter((p): p is ParentRecipient => p !== null);
  })();
  cache?.parentsByFamily.set(familyId, flight);
  return flight;
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
        occurred_at: e.occurredAt,
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
 *  timestamp is itself history and is never overwritten). The pure
 *  supersedePlan applies the temporal scope: only events that happened
 *  BEFORE the trigger are ever flagged. */
export async function applySupersedes(
  db: Db,
  trigger: SupersedeTrigger,
  studentId: string
): Promise<number> {
  const { data, error } = await db
    .from("path_notification_events")
    .select("id, kind, task_id, scope_id, superseded_at, occurred_at, created_at")
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
    occurredAt: (r.occurred_at as string | null) ?? null,
    createdAt: r.created_at as string,
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

/* ─────────────────────────────── the claim-then-send */

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
  const staleCutoffIso = new Date(Date.now() - STALE_CLAIM_TTL_MS).toISOString();

  // Claim = the claimed_at stamp. A fresh foreign claim blocks us; a stale one
  // (its process died mid-send) is retaken — safe under the idempotency key.
  const { data: claimed, error: claimError } = await db
    .from("path_notification_sends")
    .update({ claimed_at: stamp, attempts: row.attempts + 1, last_attempt_at: stamp })
    .eq("id", row.id)
    .is("sent_at", null)
    .or(`claimed_at.is.null,claimed_at.lt.${staleCutoffIso}`)
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

  if (sent.ok) {
    // Success stamp, CAS-guarded on OUR claim: if a stale-reclaim racer took
    // the row meanwhile, its outcome is truth (both physical sends dedupe at
    // the provider under the shared idempotency key).
    const { data: stamped, error: stampError } = await db
      .from("path_notification_sends")
      .update({ sent_at: stamp })
      .eq("id", row.id)
      .eq("claimed_at", stamp)
      .select("id");
    if (stampError) {
      console.error(
        `[path/notify] SUCCESS STAMP FAILED for ${row.dedupeKey} — the send went out but the row still reads pending; a retry will no-op at the provider: ${stampError.message}`
      );
    } else if ((stamped ?? []).length === 0) {
      return "already_sent"; // superseded by a stale-reclaim racer — its stamp is truth
    }
    return "sent";
  }

  // CAS-guarded unclaim: restore ONLY if our claim still holds.
  const { data: restored, error: unclaimError } = await db
    .from("path_notification_sends")
    .update({ claimed_at: null, last_error: (sent.error ?? "send failed").slice(0, 500) })
    .eq("id", row.id)
    .eq("claimed_at", stamp)
    .select("id");
  const outcome = sendUnclaimOutcome({
    errored: !!unclaimError,
    restoredRows: (restored ?? []).length,
  });
  if (outcome === "warn") {
    // Bounded residual: a claim left standing goes STALE after
    // STALE_CLAIM_TTL_MS and the row becomes claimable again — loud here,
    // self-healing there.
    console.error(
      `[path/notify] unclaim failed for ${row.dedupeKey} — claim will go stale and retry after the TTL: ${unclaimError?.message}`
    );
  }
  if (outcome === "superseded") return "raced_retry_later"; // a newer claim owns the row now
  return "send_failed";
}

export type DrainSummary = {
  considered: number;
  sent: number;
  alreadySent: number;
  failed: number;
  raced: number;
  errors: number;
  /** True when the wall-clock budget stopped the drain before the queue did. */
  stoppedEarly: boolean;
};

/** Drain pending send rows (oldest first, capped, batched IO_BATCH at a time,
 *  bounded by a wall-clock budget so a provider outage can never pin the cron
 *  to the platform kill limit). The cron's main verb, also used inline right
 *  after an enqueue for immediate delivery. */
export async function drainPendingSends(
  db: Db,
  opts: { limit: number; onlyKeys?: readonly string[]; budgetMs?: number }
): Promise<DrainSummary> {
  const startedMs = Date.now();
  const budgetMs = opts.budgetMs ?? 120_000;
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
  const summary: DrainSummary = {
    considered: 0,
    sent: 0,
    alreadySent: 0,
    failed: 0,
    raced: 0,
    errors: 0,
    stoppedEarly: false,
  };
  if (error) {
    console.error(`[path/notify] pending-send read failed: ${error.message}`);
    summary.errors++;
    return summary;
  }

  const rows: SendRowState[] = [];
  for (const raw of data ?? []) {
    // Fail-closed kind narrowing BEFORE any claim — an unknown kind must be
    // skipped loudly, never crash after stamping (kieran-typescript review).
    const kind = narrowSendKind(raw.kind);
    if (kind === null) {
      console.error(
        `[path/notify] send row ${String(raw.id)} has unrecognized kind ${String(raw.kind)} — skipped`
      );
      summary.errors++;
      continue;
    }
    if (!isSendDue({ sentAt: (raw.sent_at as string | null) ?? null, attempts: (raw.attempts as number) ?? 0 })) {
      continue;
    }
    rows.push({
      id: raw.id as string,
      dedupeKey: raw.dedupe_key as string,
      email: raw.email as string,
      kind,
      params: (raw.params as Record<string, unknown>) ?? {},
      attempts: (raw.attempts as number) ?? 0,
    });
  }

  for (let i = 0; i < rows.length; i += SEND_BATCH) {
    if (Date.now() - startedMs > budgetMs) {
      summary.stoppedEarly = true;
      console.error(
        `[path/notify] drain stopped early on budget (${budgetMs}ms) with ${rows.length - i} rows left — next run continues`
      );
      break;
    }
    const batchStartedMs = Date.now();
    const batch = rows.slice(i, i + SEND_BATCH);
    const outcomes = await Promise.all(batch.map((row) => attemptSend(db, row)));
    for (const outcome of outcomes) {
      summary.considered++;
      if (outcome === "sent") summary.sent++;
      else if (outcome === "already_sent") summary.alreadySent++;
      else if (outcome === "send_failed") summary.failed++;
      else if (outcome === "raced_retry_later") summary.raced++;
      else summary.errors++;
    }
    // Pace to the provider's rate limit before the next batch.
    if (i + SEND_BATCH < rows.length) {
      const elapsed = Date.now() - batchStartedMs;
      if (elapsed < SEND_BATCH_MIN_INTERVAL_MS) {
        await new Promise((resolve) => setTimeout(resolve, SEND_BATCH_MIN_INTERVAL_MS - elapsed));
      }
    }
  }
  return summary;
}

/* ────────────────────────────────────────────── inline (post-transition) */

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
    if (!NOTIFYING_TRANSITIONS.includes(input.transition)) {
      return { ...none, skipped: "transition does not notify" };
    }

    // The authoritative event row our CAS just appended (read back by shape —
    // a concurrent identical event would carry the same notification meaning,
    // and dedupe keys make double-enqueue a no-op).
    const { data: eventRow, error: eventError } = await db
      .from("path_task_events")
      .select("id, student_id, task_id, transition, note, at")
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
      at: eventRow.at as string,
    };

    // Render context: the student's first name + the pinned task content.
    const [nameRes, parents] = await Promise.all([
      db
        .from("path_student_profiles")
        .select("id, children(first_name)")
        .eq("id", input.studentId)
        .maybeSingle(),
      input.transition === "submit"
        ? resolveParentRecipients(db, input.familyId)
        : Promise.resolve([]),
    ]);
    const firstName = firstNameFromChildJoin(nameRes.data?.children) ?? "";
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

    // Reversal flags: a revoke supersedes the task's PRIOR live verified
    // celebration (temporal scope: only events before the revoke's own time).
    let superseded = 0;
    if (input.transition === "revoke") {
      superseded = await applySupersedes(
        db,
        { kind: "reopened", taskId: input.taskId, occurredAt: taskEvent.at },
        input.studentId
      );
    }

    // Immediate delivery of what we just enqueued (claim-then-send; a race
    // with the cron resolves via the claim, never a double send).
    let sent = 0;
    if (plan.sends.length > 0) {
      const drained = await drainPendingSends(db, {
        limit: plan.sends.length,
        onlyKeys: plan.sends.map((s) => s.dedupeKey),
        budgetMs: 20_000,
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
        occurredAt: input.review.decidedAt ?? null,
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
  studentsCapped: number;
  errors: number;
};

/**
 * The cron's healing pass: re-derive every notification the trailing window's
 * event/review spines imply, insert whatever is missing (dedupe keys make it
 * idempotent), re-apply supersede flags for in-window reversals (temporally
 * scoped — a stale reversal can never flag a fresher celebration), and enqueue
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
    studentsCapped: 0,
    errors: 0,
  };
  const cutoffIso = new Date(opts.nowMs - opts.windowMs).toISOString();
  const cache = createNotifyRunCache();

  // 1) The spines, windowed and deterministically ordered. Reviews window on
  // opened_at OR decided_at — a review returned long after it opened must
  // still heal (the reliability review's opened_at-only gap).
  const [eventsRes, reviewsRes] = await Promise.all([
    db
      .from("path_task_events")
      .select("id, student_id, task_id, transition, note, at")
      .gte("at", cutoffIso)
      .in("transition", [...NOTIFYING_TRANSITIONS, "criterion_return"])
      .order("at", { ascending: true }),
    db
      .from("path_reviews")
      .select("id, student_id, scope, scope_id, attempt, state, note, opened_at, decided_at")
      .or(`opened_at.gte.${cutoffIso},decided_at.gte.${cutoffIso}`)
      .order("opened_at", { ascending: true }),
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

  // 3) Per-student derivation, context resolved once per student per run and
  // processed in bounded parallel batches (the N+1 fix).
  const allStudentIds = [
    ...new Set([
      ...events.map((e) => e.student_id as string),
      ...reviews.map((r) => r.student_id as string),
    ]),
  ];
  const maxStudents = opts.maxStudents ?? 200;
  const studentIds = allStudentIds.slice(0, maxStudents);
  if (allStudentIds.length > studentIds.length) {
    summary.studentsCapped = allStudentIds.length - studentIds.length;
    console.error(
      `[path/notify] reconcile capped at ${maxStudents} students — ${summary.studentsCapped} deferred to the next run`
    );
  }

  await inBatches(studentIds, IO_BATCH, async (studentId) => {
    const ctx = await studentNotifyContext(db, studentId, cache);
    if (!ctx) {
      summary.errors++;
      return;
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
            at: e.at as string,
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
          openedAt: (r.opened_at as string | null) ?? null,
          decidedAt: (r.decided_at as string | null) ?? null,
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

    // Re-apply reversal flags for in-window reversals — idempotent (the flag
    // update guards on superseded_at IS NULL) and temporally scoped (the
    // trigger's own time bounds what it may flag).
    for (const e of events) {
      if ((e.student_id as string) !== studentId) continue;
      if ((e.transition as string) === "revoke") {
        summary.superseded += await applySupersedes(
          db,
          { kind: "reopened", taskId: e.task_id as string, occurredAt: (e.at as string) ?? null },
          studentId
        );
      }
    }
    for (const r of reviews) {
      if ((r.student_id as string) !== studentId) continue;
      if ((r.state as string) === "returned" && (r.scope as string) === "criterion") {
        const scopeId = r.scope_id as string;
        // Scope the returned-task set to THIS criterion (task ids are
        // "{criterion}.{seq}") — never the student's whole return history
        // (correctness review's per-review scoping note).
        const returnedTaskIds = events
          .filter(
            (e) =>
              (e.student_id as string) === studentId &&
              (e.transition as string) === "criterion_return" &&
              (e.task_id as string).startsWith(`${scopeId}.`)
          )
          .map((e) => e.task_id as string);
        summary.superseded += await applySupersedes(
          db,
          {
            kind: "criterion_returned",
            scopeId,
            returnedTaskIds,
            occurredAt: (r.decided_at as string | null) ?? null,
          },
          studentId
        );
      }
    }
  });

  // 4) Stall nudges: submitted tasks past their family threshold.
  summary.nudgesEnqueued = await enqueueDueNudges(db, opts.nowMs, summary, cache);

  return summary;
}

/** Enqueue nudge send rows for submitted tasks sitting past the family
 *  threshold. Returns how many rows were enqueued. */
async function enqueueDueNudges(
  db: Db,
  nowMs: number,
  summary: ReconcileSummary,
  cache: NotifyRunCache
): Promise<number> {
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

  // Existing nudge SOURCE keys. Bounded precisely: a nudge row for a live
  // submit cycle is always created AFTER that cycle's submit_received_at, so
  // reading from the oldest candidate submit onward covers every relevant key
  // without ever scanning the table's full history (performance review).
  const submitTimes = rows
    .map((r) => Date.parse((r.submit_received_at as string | null) ?? ""))
    .filter((ms) => Number.isFinite(ms));
  const oldestIso = new Date(submitTimes.length > 0 ? Math.min(...submitTimes) : nowMs).toISOString();
  const { data: nudgeSends, error: nudgeKeysError } = await db
    .from("path_notification_sends")
    .select("dedupe_key")
    .eq("kind", "stall_nudge")
    .gte("created_at", oldestIso);
  if (nudgeKeysError) {
    // Fail the pass rather than re-deriving against an incomplete key set —
    // the DB unique constraint would still block duplicates, but a loud skip
    // beats silent redundant work (reliability review).
    console.error(`[path/notify] nudge key read failed: ${nudgeKeysError.message}`);
    summary.errors++;
    return 0;
  }
  const existingSourceKeys = new Set(
    (nudgeSends ?? [])
      .map((r) => r.dedupe_key as string)
      .map((k) => k.slice(0, k.indexOf(":parent:")))
      .filter((k) => k.length > 0)
  );

  let enqueued = 0;
  // Group by student so context resolves once each (shared run cache).
  const byStudent = new Map<string, typeof rows>();
  for (const r of rows) {
    const sid = r.student_id as string;
    const list = byStudent.get(sid) ?? [];
    list.push(r);
    byStudent.set(sid, list);
  }
  await inBatches([...byStudent.entries()], IO_BATCH, async ([studentId, studentRows]) => {
    const ctx = await studentNotifyContext(db, studentId, cache);
    if (!ctx) {
      summary.errors++;
      return;
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
  });
  return enqueued;
}

/* ─────────────────────────────────────────────────────────── helpers */

/** The latest criterion review row — the post-verify review-opened probe, the
 *  review ceremony's pre-read (actions/review.ts), and the fast-path winner's
 *  identity source. Exported: plain I/O. */
export async function latestCriterionReview(
  db: Db,
  studentId: string,
  criterionId: string
): Promise<ReviewInput | null> {
  const { data, error } = await db
    .from("path_reviews")
    .select("id, student_id, scope, scope_id, attempt, state, note, opened_at, decided_at, decided_by")
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
    openedAt: (data.opened_at as string | null) ?? null,
    decidedAt: (data.decided_at as string | null) ?? null,
    decidedBy: (data.decided_by as string | null) ?? null,
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
 *  parent recipients. Memoized per run; null (logged) on any failure — the
 *  caller skips. */
async function studentNotifyContext(
  db: Db,
  studentId: string,
  cache: NotifyRunCache
): Promise<StudentNotifyContext | null> {
  const cached = cache.contextByStudent.get(studentId);
  if (cached) return cached;
  const flight = (async (): Promise<StudentNotifyContext | null> => {
    const { data, error } = await db
      .from("path_student_profiles")
      .select("id, program_version_id, family_id, children(first_name), path_families(review_nudge_hours)")
      .eq("id", studentId)
      .maybeSingle();
    if (error || !data) {
      console.error(`[path/notify] context for ${studentId} failed: ${error?.message ?? "no row"}`);
      return null;
    }
    const firstName = firstNameFromChildJoin(data.children) ?? "";
    const famJoin = data.path_families;
    const fam = Array.isArray(famJoin) ? famJoin[0] : famJoin;
    const nudgeHours = (fam as { review_nudge_hours?: unknown } | null | undefined)?.review_nudge_hours;
    const parents = await resolveParentRecipients(db, data.family_id as string, cache);
    return {
      firstName,
      programVersionId: data.program_version_id as string,
      familyId: data.family_id as string,
      parents,
      reviewNudgeHours:
        typeof nudgeHours === "number" && nudgeHours > 0 ? nudgeHours : NUDGE_DEFAULT_THRESHOLD_HOURS,
    };
  })();
  cache.contextByStudent.set(studentId, flight);
  return flight;
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
