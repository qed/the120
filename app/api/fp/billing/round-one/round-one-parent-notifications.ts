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
  productKey: string;
  productVersion: number;
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
  | "suppressed"
  | "parked";

export interface RoundOneNotificationDrainSummary {
  considered: number;
  sent: number;
  alreadySent: number;
  failed: number;
  raced: number;
  suppressed: number;
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
    || typeof raw.product_key !== "string"
    || !raw.product_key.trim()
    || typeof raw.product_version !== "number"
    || !Number.isSafeInteger(raw.product_version)
    || raw.product_version < 1
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
    productKey: raw.product_key,
    productVersion: raw.product_version,
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

async function offerReadyDeliveryIsAuthorized(
  db: Db,
  row: RoundOneParentNotificationRow,
): Promise<"authorized" | "suppressed" | "error"> {
  if (row.kind !== "offer_price_ready") return "authorized";

  const { data: entitlement, error: entitlementError } = await db
    .from("fp_billing_entitlements")
    .select("child_id, status")
    .eq("parent_id", row.parentId)
    .eq("child_id", row.childId)
    .eq("product_key", row.productKey)
    .eq("product_version", row.productVersion)
    .eq("status", "active")
    .maybeSingle();
  if (entitlementError) {
    console.error(
      `[fp/parent-notify] offer-ready entitlement check failed: ${entitlementError.message}`,
    );
    return "error";
  }
  if (!entitlement) return "suppressed";
  if (
    typeof entitlement !== "object"
    || (entitlement as { child_id?: unknown }).child_id !== row.childId
    || (entitlement as { status?: unknown }).status !== "active"
  ) {
    console.error("[fp/parent-notify] offer-ready entitlement result is malformed");
    return "error";
  }

  const { data: hold, error: holdError } = await db
    .from("fp_billing_orders")
    .select("id")
    .eq("child_id", row.childId)
    .eq("product_key", row.productKey)
    .eq("product_version", row.productVersion)
    .not("dispute_suspended_at", "is", null)
    .limit(1)
    .maybeSingle();
  if (holdError) {
    console.error(
      `[fp/parent-notify] offer-ready dispute check failed: ${holdError.message}`,
    );
    return "error";
  }
  return hold ? "suppressed" : "authorized";
}

async function suppressQueuedOfferReadyNotification(
  db: Db,
  row: RoundOneParentNotificationRow,
): Promise<"suppressed" | "raced_retry_later" | "error"> {
  const staleCutoff = new Date(
    Date.now() - ROUND_ONE_NOTIFICATION_STALE_CLAIM_MS,
  ).toISOString();
  const { data, error } = await db
    .from("fp_parent_notification_outbox")
    .delete()
    .eq("id", row.id)
    .eq("kind", "offer_price_ready")
    .is("sent_at", null)
    .or(`claimed_at.is.null,claimed_at.lt.${staleCutoff}`)
    .select("id");
  if (error) {
    console.error(
      `[fp/parent-notify] stale offer-ready suppression failed: ${error.message}`,
    );
    return "error";
  }
  return Array.isArray(data) && data.some((candidate) => candidate?.id === row.id)
    ? "suppressed"
    : "raced_retry_later";
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

  // Offer-ready mail asks the parent to activate a customer checkout. A queued
  // row can outlive the access that created it, so re-authorize immediately
  // before claiming it. Database ambiguity is fail-closed. A definitively stale
  // row is removed so it cannot starve newer mail; a future eligible save can
  // enqueue the same semantic key again.
  const offerReadyAuthorization = await offerReadyDeliveryIsAuthorized(db, row);
  if (offerReadyAuthorization === "error") return "claim_error";
  if (offerReadyAuthorization === "suppressed") {
    const suppression = await suppressQueuedOfferReadyNotification(db, row);
    return suppression === "error" ? "claim_error" : suppression;
  }

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
      "id, dedupe_key, kind, parent_id, child_id, product_key, product_version, recipient_email, parent_first_name, child_first_name, attempts, sent_at",
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
    suppressed: 0,
    errors: 0,
  };
  const { data, error } = await db
    .from("fp_parent_notification_outbox")
    .select(
      "id, dedupe_key, kind, parent_id, child_id, product_key, product_version, recipient_email, parent_first_name, child_first_name, attempts, sent_at",
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
    else if (outcome === "suppressed") summary.suppressed += 1;
    else summary.errors += 1;
    if (index < pending.length - 1) {
      const paceMs = options.paceMs ?? ROUND_ONE_NOTIFICATION_SEND_INTERVAL_MS;
      if (paceMs > 0) await new Promise((resolve) => setTimeout(resolve, paceMs));
    }
  }
  return summary;
}
