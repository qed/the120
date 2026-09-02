import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { roundOneSetupEmailIdempotencyKey } from "./round-one-setup-email-rules";
import { deliverRoundOneParentNotification } from "./round-one-parent-notifications";

type SetupEmailOutcome =
  | { status: "sent" }
  | { status: "not_found" }
  | { status: "send_failed"; error?: string }
  | { status: "error"; error: string };

/**
 * Immediate delivery attempt for the outbox row committed by the signed
 * payment RPC. A failure leaves the row pending for the notification cron;
 * billing access is already durable and is never rolled back by email.
 */
export async function sendRoundOneStripeSetupEmail(
  db: SupabaseClient,
  input: { orderId: string; parentId: string; childId: string }
): Promise<SetupEmailOutcome> {
  try {
    const delivered = await deliverRoundOneParentNotification(db, {
      dedupeKey: roundOneSetupEmailIdempotencyKey(input.orderId),
      parentId: input.parentId,
      childId: input.childId,
    });
    if (delivered === "sent" || delivered === "already_sent") {
      return { status: "sent" };
    }
    if (delivered === "row_missing") return { status: "not_found" };
    if (delivered === "claim_error") {
      return { status: "error", error: "notification claim failed" };
    }
    return { status: "send_failed", error: delivered };
  } catch (err) {
    console.error(
      `[fp/billing/round-one] setup-email hook threw: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return { status: "error", error: "setup-email hook threw" };
  }
}
