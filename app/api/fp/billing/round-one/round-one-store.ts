import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  RoundOneCoreDeps,
  RoundOneBeginRow,
} from "./round-one-core";
import type {
  RoundOneEntitlementRow,
  RoundOneOrderSummaryRow,
  RoundOneProductRow,
  RoundOneWebhookPlan,
} from "./round-one-rules";

const errorMessage = (value: unknown): string =>
  value && typeof value === "object" && typeof (value as { message?: unknown }).message === "string"
    ? (value as { message: string }).message
    : "unknown error";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STRIPE_EVENT_ID = /^evt_[A-Za-z0-9_]+$/;
const STRIPE_SESSION_ID = /^cs_[A-Za-z0-9_]+$/;

const validBoundedId = (value: string, pattern: RegExp): boolean =>
  value.length >= 4 && value.length <= 255 && pattern.test(value);

export function buildRoundOneCoreDeps(db: SupabaseClient): RoundOneCoreDeps {
  return {
    ownsChild: async (parentId, childId) => {
      const { data, error } = await db
        .from("children")
        .select("id")
        .eq("id", childId)
        .eq("parent_id", parentId)
        .maybeSingle();
      if (error) {
        console.error(`[fp/billing/round-one] child ownership read failed: ${error.message}`);
        return "error";
      }
      return data ? "owned" : "not_owned";
    },
    readProduct: async (productKey, version) => {
      const { data, error } = await db
        .from("fp_billing_products")
        .select(
          "product_key, version, display_name, subject_type, access_code, phase_key, first_locked_task_id, last_included_task_id, amount, currency, active"
        )
        .eq("product_key", productKey)
        .eq("version", version)
        .maybeSingle();
      if (error) {
        console.error(`[fp/billing/round-one] product read failed: ${error.message}`);
        return "error";
      }
      return (data as RoundOneProductRow | null) ?? null;
    },
    readEntitlement: async (parentId, childId, productKey, version) => {
      const { data, error } = await db
        .from("fp_billing_entitlements")
        .select(
          "status, grant_kind, access_code, granted_at, suspended_at, suspension_reason, revoked_at"
        )
        .eq("parent_id", parentId)
        .eq("child_id", childId)
        .eq("product_key", productKey)
        .eq("product_version", version)
        .maybeSingle();
      if (error) {
        console.error(`[fp/billing/round-one] entitlement read failed: ${error.message}`);
        return "error";
      }
      return (data as RoundOneEntitlementRow | null) ?? null;
    },
    hasDisputeHold: async (parentId, childId, productKey, version) => {
      const { data, error } = await db
        .from("fp_billing_orders")
        .select("id")
        .eq("parent_id", parentId)
        .eq("child_id", childId)
        .eq("product_key", productKey)
        .eq("product_version", version)
        .not("dispute_suspended_at", "is", null)
        .limit(1)
        .maybeSingle();
      if (error) {
        console.error(`[fp/billing/round-one] dispute-hold read failed: ${error.message}`);
        return "error";
      }
      return !!data;
    },
    readLatestOrder: async (parentId, childId, productKey, version) => {
      const { data, error } = await db
        .from("fp_billing_orders")
        .select("status, created_at, updated_at")
        .eq("parent_id", parentId)
        .eq("child_id", childId)
        .eq("product_key", productKey)
        .eq("product_version", version)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        console.error(`[fp/billing/round-one] order read failed: ${error.message}`);
        return "error";
      }
      return (data as RoundOneOrderSummaryRow | null) ?? null;
    },
    beginOrder: async (parentId, childId, productKey, version) => {
      const { data, error } = await db.rpc("fp_billing_begin_order", {
        p_parent_id: parentId,
        p_child_id: childId,
        p_product_key: productKey,
        p_product_version: version,
      });
      if (error) {
        console.error(`[fp/billing/round-one] begin-order rpc failed: ${error.message}`);
        return "error";
      }
      const row = (Array.isArray(data) ? data[0] : data) as RoundOneBeginRow | null;
      return row ?? "error";
    },
    attachCheckout: async (orderId, sessionId, expiresAtIso) => {
      const { data, error } = await db.rpc("fp_billing_attach_checkout", {
        p_order_id: orderId,
        p_stripe_session_id: sessionId,
        p_expires_at: expiresAtIso,
      });
      if (error) {
        console.error(`[fp/billing/round-one] attach-checkout rpc failed: ${error.message}`);
        return false;
      }
      return data === true;
    },
    cancelPendingOrder: async (orderId) => {
      const { data, error } = await db
        .from("fp_billing_orders")
        .update({
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", orderId)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (error) {
        console.error(`[fp/billing/round-one] stale checkout cancellation failed: ${error.message}`);
        return false;
      }
      return !!data;
    },
  };
}

export async function applyRoundOneWebhookPlan(
  db: SupabaseClient,
  plan: Extract<RoundOneWebhookPlan, { kind: "apply" }>
): Promise<{ ok: true; outcome: string } | { ok: false }> {
  try {
    const { data, error } = await db.rpc("fp_billing_apply_stripe_event", {
      p_event_id: plan.eventId,
      p_event_type: plan.eventType,
      p_effect: plan.effect,
      p_order_id: plan.orderId,
      p_session_id: plan.sessionId,
      p_payment_intent_id: plan.paymentIntentId,
      p_parent_id: plan.parentId,
      p_child_id: plan.childId,
      p_product_key: plan.productKey,
      p_product_version: plan.productVersion,
      p_amount: plan.amount,
      p_currency: plan.currency,
      p_processor_object_id: plan.processorObjectId,
      p_processor_status: plan.processorStatus,
      p_processor_reason: plan.processorReason,
      p_processor_amount: plan.processorAmount,
    });
    if (error) {
      console.error(`[fp/billing/round-one] webhook rpc failed: ${error.message}`);
      return { ok: false };
    }
    return typeof data === "string"
      ? { ok: true, outcome: data }
      : { ok: false };
  } catch (err) {
    console.error(`[fp/billing/round-one] webhook rpc threw: ${errorMessage(err)}`);
    return { ok: false };
  }
}

export type RoundOnePendingCheckout = {
  orderId: string;
  sessionId: string;
};

export type RoundOneWebhookCleanupScope = {
  orderId: string;
  parentId: string;
  childId: string;
  productKey: string;
  productVersion: number;
};

export type RoundOneWebhookCleanupProvenance =
  | { state: "complete" }
  | { state: "pending"; scope: RoundOneWebhookCleanupScope };

/**
 * Resolve dispute cleanup only from the immutable event ledger and its order
 * FK. Stripe metadata is required to apply a new event, but it is deliberately
 * not authoritative on replay: PaymentIntent metadata can be edited later.
 */
export async function readRoundOneWebhookCleanupProvenance(
  db: SupabaseClient,
  eventId: string,
  eventType: "charge.dispute.created" | "charge.dispute.closed"
): Promise<RoundOneWebhookCleanupProvenance | "missing" | "error"> {
  try {
    if (!validBoundedId(eventId, STRIPE_EVENT_ID)) {
      console.error("[fp/billing/round-one] dispute cleanup event id is malformed");
      return "error";
    }
    const { data: event, error: eventError } = await db
      .from("fp_billing_webhook_events")
      .select("event_type, order_id, checkout_cleanup_completed_at")
      .eq("stripe_event_id", eventId)
      .maybeSingle();
    if (eventError) {
      console.error(
        `[fp/billing/round-one] dispute cleanup ledger read failed: ${eventError.message}`
      );
      return "error";
    }
    if (!event) return "missing";
    const eventRow = event as {
      event_type?: unknown;
      order_id?: unknown;
      checkout_cleanup_completed_at?: unknown;
    };
    if (eventRow.event_type !== eventType) {
      console.error("[fp/billing/round-one] dispute cleanup ledger type mismatch");
      return "error";
    }
    if (eventRow.checkout_cleanup_completed_at !== null) {
      return typeof eventRow.checkout_cleanup_completed_at === "string"
        && Number.isFinite(Date.parse(eventRow.checkout_cleanup_completed_at))
        ? { state: "complete" }
        : "error";
    }
    if (typeof eventRow.order_id !== "string" || !UUID.test(eventRow.order_id)) {
      console.error("[fp/billing/round-one] dispute cleanup ledger order is unavailable");
      return "error";
    }

    const { data: order, error: orderError } = await db
      .from("fp_billing_orders")
      .select("id, parent_id, child_id, product_key, product_version")
      .eq("id", eventRow.order_id)
      .maybeSingle();
    if (orderError || !order) {
      console.error(
        `[fp/billing/round-one] dispute cleanup order read failed: ${orderError?.message ?? "missing order"}`
      );
      return "error";
    }
    const row = order as {
      id?: unknown;
      parent_id?: unknown;
      child_id?: unknown;
      product_key?: unknown;
      product_version?: unknown;
    };
    if (
      row.id !== eventRow.order_id
      || typeof row.parent_id !== "string"
      || !UUID.test(row.parent_id)
      || typeof row.child_id !== "string"
      || !UUID.test(row.child_id)
      || typeof row.product_key !== "string"
      || !row.product_key.trim()
      || !Number.isInteger(row.product_version)
      || (row.product_version as number) < 1
    ) {
      console.error("[fp/billing/round-one] dispute cleanup provenance is malformed");
      return "error";
    }
    return {
      state: "pending",
      scope: {
        orderId: row.id,
        parentId: row.parent_id,
        childId: row.child_id,
        productKey: row.product_key,
        productVersion: row.product_version as number,
      },
    };
  } catch (err) {
    console.error(
      `[fp/billing/round-one] dispute cleanup provenance threw: ${errorMessage(err)}`
    );
    return "error";
  }
}

export async function markRoundOneWebhookCleanupComplete(
  db: SupabaseClient,
  input: { eventId: string; orderId: string }
): Promise<boolean> {
  try {
    if (!validBoundedId(input.eventId, STRIPE_EVENT_ID) || !UUID.test(input.orderId)) {
      return false;
    }
    const { data, error } = await db
      .from("fp_billing_webhook_events")
      .update({ checkout_cleanup_completed_at: new Date().toISOString() })
      .eq("stripe_event_id", input.eventId)
      .eq("order_id", input.orderId)
      .in("event_type", ["charge.dispute.created", "charge.dispute.closed"])
      .select("stripe_event_id")
      .maybeSingle();
    if (error) {
      console.error(`[fp/billing/round-one] dispute cleanup stamp failed: ${error.message}`);
      return false;
    }
    return data?.stripe_event_id === input.eventId;
  } catch (err) {
    console.error(
      `[fp/billing/round-one] dispute cleanup stamp threw: ${errorMessage(err)}`
    );
    return false;
  }
}

/**
 * Read every still-pending Checkout Session for the disputed child/product.
 * The signed event has already installed the durable database hold before this
 * is called. This list exists only to close Stripe URLs that were returned in
 * the small cross-system window before that hold committed.
 */
export async function readRoundOnePendingCheckouts(
  db: SupabaseClient,
  input: RoundOneWebhookCleanupScope
): Promise<RoundOnePendingCheckout[] | "error"> {
  try {
    if (
      !UUID.test(input.orderId)
      || !UUID.test(input.parentId)
      || !UUID.test(input.childId)
      || !/^[a-z0-9_]{1,80}$/.test(input.productKey)
      || !Number.isSafeInteger(input.productVersion)
      || input.productVersion < 1
    ) {
      console.error("[fp/billing/round-one] pending Checkout scope is malformed");
      return "error";
    }
    const { data, error } = await db
      .from("fp_billing_orders")
      .select("id, stripe_checkout_session_id")
      .eq("parent_id", input.parentId)
      .eq("child_id", input.childId)
      .eq("product_key", input.productKey)
      .eq("product_version", input.productVersion)
      .eq("status", "pending")
      .not("stripe_checkout_session_id", "is", null);
    if (error) {
      console.error(`[fp/billing/round-one] pending Checkout read failed: ${error.message}`);
      return "error";
    }
    if (!Array.isArray(data)) {
      console.error("[fp/billing/round-one] pending Checkout result is malformed");
      return "error";
    }
    const parsed: RoundOnePendingCheckout[] = [];
    for (const row of data) {
      const candidate = row as {
        id?: unknown;
        stripe_checkout_session_id?: unknown;
      };
      if (
        typeof candidate.id !== "string"
        || !UUID.test(candidate.id)
        || typeof candidate.stripe_checkout_session_id !== "string"
        || !validBoundedId(candidate.stripe_checkout_session_id, STRIPE_SESSION_ID)
      ) {
        console.error("[fp/billing/round-one] pending Checkout row is malformed");
        return "error";
      }
      parsed.push({
        orderId: candidate.id,
        sessionId: candidate.stripe_checkout_session_id,
      });
    }
    return parsed;
  } catch (err) {
    console.error(
      `[fp/billing/round-one] pending Checkout read threw: ${errorMessage(err)}`
    );
    return "error";
  }
}

/** Mark an order cancelled only after Stripe proves its Session is expired. */
export async function cancelRoundOneExpiredCheckout(
  db: SupabaseClient,
  input: { orderId: string; sessionId: string }
): Promise<boolean> {
  try {
    const { error } = await db
      .from("fp_billing_orders")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.orderId)
      .eq("status", "pending")
      .eq("stripe_checkout_session_id", input.sessionId);
    if (error) {
      console.error(`[fp/billing/round-one] expired Checkout cancellation failed: ${error.message}`);
      return false;
    }
    // A concurrent signed event may already have moved the order to a terminal
    // state. A zero-row conditional update is therefore also a safe outcome.
    return true;
  } catch (err) {
    console.error(
      `[fp/billing/round-one] expired Checkout cancellation threw: ${errorMessage(err)}`
    );
    return false;
  }
}

/**
 * Fill a missing parent support phone from Stripe's signed Checkout Session.
 * The database function is the concurrency arbiter: it validates the bounded
 * international shape and never overwrites a nonblank number.
 */
export async function fillRoundOneParentPhone(
  db: SupabaseClient,
  input: { parentId: string; phone: string }
): Promise<boolean> {
  try {
    const { data, error } = await db.rpc("fp_billing_fill_parent_phone", {
      p_parent_id: input.parentId,
      p_phone: input.phone,
    });
    if (error) {
      console.error(`[fp/billing/round-one] parent phone fill rpc failed: ${error.message}`);
      return false;
    }
    return data === true;
  } catch (err) {
    console.error(`[fp/billing/round-one] parent phone fill rpc threw: ${errorMessage(err)}`);
    return false;
  }
}

export type RoundOneStaffAccessOutcome =
  | "granted"
  | "revoked"
  | "already_active"
  | "already_revoked"
  | "paid_stands"
  | "paid_requires_refund"
  | "dispute_requires_review";

export async function setRoundOneComplimentaryAccess(
  db: SupabaseClient,
  input: {
    childId: string;
    action: "comped" | "grandfathered" | "revoke";
    note: string;
    actorId: string;
    requestId: string;
  }
): Promise<
  | {
      ok: true;
      outcome: RoundOneStaffAccessOutcome;
      orderId: string | null;
      parentId: string;
    }
  | { ok: false }
> {
  try {
    const { data, error } = await db.rpc("fp_billing_set_round_one_access", {
      p_child_id: input.childId,
      p_action: input.action,
      p_note: input.note,
      p_actor: input.actorId,
      p_request_id: input.requestId,
    });
    if (error) {
      console.error(`[fp/billing/round-one] staff access rpc failed: ${error.message}`);
      return { ok: false };
    }
    const row = (Array.isArray(data) ? data[0] : data) as
      | { outcome?: unknown; order_id?: unknown; parent_id?: unknown }
      | null;
    const outcomes = new Set([
      "granted",
      "revoked",
      "already_active",
      "already_revoked",
      "paid_stands",
      "paid_requires_refund",
      "dispute_requires_review",
    ]);
    if (
      !row
      || typeof row.outcome !== "string"
      || !outcomes.has(row.outcome)
      || (row.order_id !== null && typeof row.order_id !== "string")
      || typeof row.parent_id !== "string"
    ) {
      return { ok: false };
    }
    return {
      ok: true,
      outcome: row.outcome as RoundOneStaffAccessOutcome,
      orderId: row.order_id as string | null,
      parentId: row.parent_id,
    };
  } catch (err) {
    console.error(`[fp/billing/round-one] staff access rpc threw: ${errorMessage(err)}`);
    return { ok: false };
  }
}
