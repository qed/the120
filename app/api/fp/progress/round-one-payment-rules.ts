/**
 * Pure classification for the optional Round One payment summary on the
 * Watchtower progress response.
 *
 * The wire contract is aggregate-only. Child ids are accepted here solely to
 * join the already-authorized FP roster to billing truth; they never leave the
 * route and must never be logged. Every enrolled child lands in exactly one
 * bucket, so the six counts always sum to the distinct roster size. Paid
 * purchases are intentionally separate from complimentary access: Watchtower
 * must never present a pilot grant as collected revenue.
 */

export type RoundOnePaymentSummary = {
  unit: "child";
  paidPurchases: number;
  complimentaryAccess: number;
  pending: number;
  unpaid: number;
  refundedPaid: number;
  revokedComplimentary: number;
};

export type RoundOnePaymentEntitlementRowLike = {
  child_id?: unknown;
  status?: unknown;
  grant_kind?: unknown;
  revoked_at?: unknown;
  updated_at?: unknown;
};

export type RoundOnePaymentOrderRowLike = {
  id?: unknown;
  child_id?: unknown;
  status?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
};

type PaymentState =
  | "paidPurchases"
  | "complimentaryAccess"
  | "pending"
  | "unpaid"
  | "refundedPaid"
  | "revokedComplimentary";

type DatedState = {
  state: PaymentState;
  at: number;
  tieBreaker: string;
};

const ACTIVE_GRANT_KINDS = new Set(["paid", "comped", "grandfathered"]);
const ORDER_STATUSES = new Set([
  "pending",
  "paid",
  // Both a processor failure and a parent-cancelled Checkout are an
  // attempted-but-unpaid child, never a reason to keep an older
  // pending/refunded state alive.
  "failed",
  "cancelled",
  "refunded",
  "comped",
  "grandfathered",
]);

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function timestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function laterState(current: DatedState | undefined, candidate: DatedState): DatedState {
  if (!current || candidate.at > current.at) return candidate;
  if (candidate.at < current.at) return current;

  // Timestamps can legitimately tie when one transaction updates an order and
  // entitlement in the same statement. A pending retry wins so staff can see
  // an in-progress Checkout; a revoke/refund wins over the older grant/payment
  // it reverses. The final stable string keeps the result independent of input
  // row order.
  const rank: Record<PaymentState, number> = {
    pending: 5,
    refundedPaid: 4,
    revokedComplimentary: 4,
    paidPurchases: 3,
    complimentaryAccess: 3,
    unpaid: 0,
  };
  if (rank[candidate.state] > rank[current.state]) return candidate;
  if (rank[candidate.state] < rank[current.state]) return current;
  return candidate.tieBreaker > current.tieBreaker ? candidate : current;
}

/**
 * Classify the current Round One funnel for an FP-enrolled child roster.
 *
 * Precedence is intentionally explicit:
 *   1. an active paid entitlement => paidPurchases; active comped or
 *      grandfathered entitlement => complimentaryAccess;
 *   2. otherwise the latest billing fact wins, preserving whether money was
 *      paid/refunded or access was complimentary/revoked;
 *   3. every other latest/no state => unpaid.
 *
 * A newer failed/cancelled order therefore moves a previously refunded child
 * back to unpaid, while a new pending retry moves them to pending. Active access
 * always wins, including when older refunded history is still present.
 */
export function deriveRoundOnePaymentSummary(
  enrolledChildIds: readonly string[],
  entitlements: readonly RoundOnePaymentEntitlementRowLike[],
  orders: readonly RoundOnePaymentOrderRowLike[]
): RoundOnePaymentSummary {
  const roster = new Set(
    enrolledChildIds.filter((id): id is string => typeof id === "string" && id.length > 0)
  );
  const activeByChild = new Map<
    string,
    "paidPurchases" | "complimentaryAccess"
  >();
  const latestByChild = new Map<string, DatedState>();

  for (const row of entitlements) {
    const childId = asNonEmptyString(row.child_id);
    if (!childId || !roster.has(childId)) continue;
    if (row.status === "active" && ACTIVE_GRANT_KINDS.has(row.grant_kind as string)) {
      activeByChild.set(
        childId,
        row.grant_kind === "paid" ? "paidPurchases" : "complimentaryAccess"
      );
      continue;
    }
    if (row.status !== "revoked") continue;
    if (!ACTIVE_GRANT_KINDS.has(row.grant_kind as string)) continue;
    const at = timestamp(row.revoked_at) ?? timestamp(row.updated_at);
    if (at === null) continue;
    latestByChild.set(
      childId,
      laterState(latestByChild.get(childId), {
        state:
          row.grant_kind === "paid" ? "refundedPaid" : "revokedComplimentary",
        at,
        tieBreaker: `entitlement:revoked:${String(row.grant_kind ?? "")}`,
      })
    );
  }

  for (const row of orders) {
    const childId = asNonEmptyString(row.child_id);
    if (!childId || !roster.has(childId) || !ORDER_STATUSES.has(row.status as string)) continue;
    const at = timestamp(row.updated_at) ?? timestamp(row.created_at);
    if (at === null) continue;
    const state: PaymentState =
      row.status === "pending"
        ? "pending"
        : row.status === "paid"
          ? "paidPurchases"
          : row.status === "refunded"
            ? "refundedPaid"
            : row.status === "comped" || row.status === "grandfathered"
              ? "complimentaryAccess"
              : "unpaid";
    latestByChild.set(
      childId,
      laterState(latestByChild.get(childId), {
        state,
        at,
        tieBreaker: `order:${asNonEmptyString(row.id) ?? ""}`,
      })
    );
  }

  const summary: RoundOnePaymentSummary = {
    unit: "child",
    paidPurchases: 0,
    complimentaryAccess: 0,
    pending: 0,
    unpaid: 0,
    refundedPaid: 0,
    revokedComplimentary: 0,
  };
  for (const childId of roster) {
    const active = activeByChild.get(childId);
    if (active) {
      summary[active] += 1;
      continue;
    }
    summary[latestByChild.get(childId)?.state ?? "unpaid"] += 1;
  }
  return summary;
}

export type RoundOnePaymentReadErrorCategory = "schema_absent" | "read_failed";

/**
 * Postgres and PostgREST use these value-free codes while a new relation or
 * selected column has not reached the deployed schema/cache yet. The route logs
 * only this category and never the database message, which can contain row
 * values supplied by a failed predicate.
 */
export function classifyRoundOnePaymentReadError(
  error: { code?: unknown } | null | undefined
): RoundOnePaymentReadErrorCategory {
  return error?.code === "42P01" || error?.code === "PGRST204" || error?.code === "PGRST205"
    ? "schema_absent"
    : "read_failed";
}
