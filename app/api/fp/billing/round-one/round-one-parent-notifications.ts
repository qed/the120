import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { sendEmail } from "@/app/lib/email";
import {
  buildRoundOneOfferReadyEmail,
  buildRoundOneStripeSetupEmail,
} from "./round-one-setup-email-rules";

export const ROUND_ONE_PARENT_NOTIFICATION_KINDS = [
  "round_one_stripe_setup",
  "offer_price_ready",
] as const;
export type RoundOneParentNotificationKind =
  (typeof ROUND_ONE_PARENT_NOTIFICATION_KINDS)[number];

export const ROUND_ONE_NOTIFICATION_MAX_ATTEMPTS = 5;
export const ROUND_ONE_NOTIFICATION_STALE_CLAIM_MS = 10 * 60 * 1000;
export const ROUND_ONE_NOTIFICATION_SEND_INTERVAL_MS = 600;

type Db = SupabaseClient;

export interface RoundOneParentNotificationRow {
  id: string;
  dedupeKey: string;
  kind: RoundOneParentNotificationKind;
  parentId: string;
  childId: string;
  recipientEmail: string;
  parentFirstName: string | null;
  childFirstName: string | null;
  attempts: number;
  sentAt: string | null;
}

export type RoundOneNotificationAttempt =
  | "sent"
  | "already_sent"
  | "send_failed"
  | "raced_retry_later"
  | "claim_error"
  | "row_missing"
  | "parked";

export interface RoundOneNotificationDrainSummary {
  considered: number;
  sent: number;
  alreadySent: number;
  failed: number;
  raced: number;
  errors: number;
}

export function narrowRoundOneParentNotificationKind(
  value: unknown,
): RoundOneParentNotificationKind | null {
  return ROUND_ONE_PARENT_NOTIFICATION_KINDS.includes(
    value as RoundOneParentNotificationKind,
  )
    ? (value as RoundOneParentNotificationKind)
    : null;
}

function mapRow(raw: Record<string, unknown>): RoundOneParentNotificationRow | null {
  const kind = narrowRoundOneParentNotificationKind(raw.kind);
  if (
    !kind
    || typeof raw.id !== "string"
    || typeof raw.dedupe_key !== "string"
    || typeof raw.parent_id !== "string"
    || typeof raw.child_id !== "string"
    || typeof raw.recipient_email !== "string"
  ) {
    return null;
  }
  return {
    id: raw.id,
    dedupeKey: raw.dedupe_key,
    kind,
    parentId: raw.parent_id,
    childId: raw.child_id,
    recipientEmail: raw.recipient_email,
    parentFirstName:
      typeof raw.parent_first_name === "string" ? raw.parent_first_name : null,
    childFirstName:
      typeof raw.child_first_name === "string" ? raw.child_first_name : null,
    attempts:
      typeof raw.attempts === "number" && Number.isSafeInteger(raw.attempts)
        ? raw.attempts
        : 0,
    sentAt: typeof raw.sent_at === "string" ? raw.sent_at : null,
  };
}

function render(row: RoundOneParentNotificationRow) {
  const input = {
    parentFirstName: row.parentFirstName,
    childFirstName: row.childFirstName,
    childId: row.childId,
  };
  return row.kind === "round_one_stripe_setup"
    ? buildRoundOneStripeSetupEmail(input)
    : buildRoundOneOfferReadyEmail(input);
}

/**
 * Claim, send, and stamp one durable row. A process death leaves a claim that
 * becomes retryable after the stale TTL. Every attempt uses the row's stable
 * semantic key as Resend's Idempotency-Key, so a lost provider response is a
 * no-op when the worker safely retries it.
 */
export async function attemptRoundOneParentNotification(
  db: Db,
  row: RoundOneParentNotificationRow,
): Promise<RoundOneNotificationAttempt> {
  if (row.sentAt) return "already_sent";
  if (row.attempts >= ROUND_ONE_NOTIFICATION_MAX_ATTEMPTS) return "parked";

  const stamp = new Date().toISOString();
  const staleCutoff = new Date(
    Date.now() - ROUND_ONE_NOTIFICATION_STALE_CLAIM_MS,
  ).toISOString();
  const { data: claimed, error: claimError } = await db
    .from("fp_parent_notification_outbox")
    .update({
      claimed_at: stamp,
      attempts: row.attempts + 1,
      last_attempt_at: stamp,
    })
    .eq("id", row.id)
    .is("sent_at", null)
    .or(`claimed_at.is.null,claimed_at.lt.${staleCutoff}`)
    .select("id");

  if (claimError) {
    console.error(
      `[fp/parent-notify] claim for ${row.dedupeKey} failed: ${claimError.message}`,
    );
    return "claim_error";
  }
  if ((claimed ?? []).length === 0) {
    const { data: probe } = await db
      .from("fp_parent_notification_outbox")
      .select("id, sent_at")
      .eq("id", row.id)
      .maybeSingle();
    if (!probe) return "row_missing";
    return probe.sent_at ? "already_sent" : "raced_retry_later";
  }

  const mail = render(row);
  const sent = await sendEmail({
    to: row.recipientEmail,
    from: "First Profit <hello@the120.school>",
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    idempotencyKey: row.dedupeKey,
  });

  if (sent.ok) {
    const { data: stamped, error: stampError } = await db
      .from("fp_parent_notification_outbox")
      .update({ sent_at: stamp, claimed_at: null, last_error: null })
      .eq("id", row.id)
      .eq("claimed_at", stamp)
      .select("id");
    if (stampError) {
      console.error(
        `[fp/parent-notify] success stamp failed for ${row.dedupeKey}: ${stampError.message}`,
      );
      return "claim_error";
    }
    return (stamped ?? []).length > 0 ? "sent" : "already_sent";
  }

  const { error: unclaimError } = await db
    .from("fp_parent_notification_outbox")
    .update({
      claimed_at: null,
      last_error: (sent.error ?? "send failed").slice(0, 500),
    })
    .eq("id", row.id)
    .eq("claimed_at", stamp)
    .select("id");
  if (unclaimError) {
    console.error(
      `[fp/parent-notify] unclaim failed for ${row.dedupeKey}; the claim will retry after its stale TTL: ${unclaimError.message}`,
    );
  }
  return "send_failed";
}

async function readRowByKey(
  db: Db,
  dedupeKey: string,
): Promise<RoundOneParentNotificationRow | null> {
  const { data, error } = await db
    .from("fp_parent_notification_outbox")
    .select(
      "id, dedupe_key, kind, parent_id, child_id, recipient_email, parent_first_name, child_first_name, attempts, sent_at",
    )
    .eq("dedupe_key", dedupeKey)
    .maybeSingle();
  if (error) {
    console.error(
      `[fp/parent-notify] outbox read for ${dedupeKey} failed: ${error.message}`,
    );
    return null;
  }
  return data ? mapRow(data as Record<string, unknown>) : null;
}

export async function deliverRoundOneParentNotification(
  db: Db,
  input: { dedupeKey: string; parentId: string; childId: string },
): Promise<RoundOneNotificationAttempt> {
  const row = await readRowByKey(db, input.dedupeKey);
  if (!row || row.parentId !== input.parentId || row.childId !== input.childId) {
    return "row_missing";
  }
  return attemptRoundOneParentNotification(db, row);
}

export async function drainRoundOneParentNotifications(
  db: Db,
  options: { limit: number; paceMs?: number },
): Promise<RoundOneNotificationDrainSummary> {
  const summary: RoundOneNotificationDrainSummary = {
    considered: 0,
    sent: 0,
    alreadySent: 0,
    failed: 0,
    raced: 0,
    errors: 0,
  };
  const { data, error } = await db
    .from("fp_parent_notification_outbox")
    .select(
      "id, dedupe_key, kind, parent_id, child_id, recipient_email, parent_first_name, child_first_name, attempts, sent_at",
    )
    .is("sent_at", null)
    .lt("attempts", ROUND_ONE_NOTIFICATION_MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(options.limit);
  if (error) {
    console.error(`[fp/parent-notify] pending read failed: ${error.message}`);
    summary.errors += 1;
    return summary;
  }

  const pending = data ?? [];
  for (let index = 0; index < pending.length; index += 1) {
    const raw = pending[index];
    if (!raw) continue;
    const row = mapRow(raw as Record<string, unknown>);
    if (!row) {
      summary.errors += 1;
      continue;
    }
    summary.considered += 1;
    const outcome = await attemptRoundOneParentNotification(db, row);
    if (outcome === "sent") summary.sent += 1;
    else if (outcome === "already_sent") summary.alreadySent += 1;
    else if (outcome === "send_failed" || outcome === "parked") summary.failed += 1;
    else if (outcome === "raced_retry_later") summary.raced += 1;
    else summary.errors += 1;
    if (index < pending.length - 1) {
      const paceMs = options.paceMs ?? ROUND_ONE_NOTIFICATION_SEND_INTERVAL_MS;
      if (paceMs > 0) await new Promise((resolve) => setTimeout(resolve, paceMs));
    }
  }
  return summary;
}
