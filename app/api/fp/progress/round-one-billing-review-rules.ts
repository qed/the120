/**
 * Pure, fail-closed shaping for the staff-only Round One billing-review seam.
 *
 * The database keeps processor identifiers and financial details for audit and
 * provenance. Watchtower receives none of them: only the smallest contact and
 * reason payload staff need to follow up. If any selected row is malformed or
 * points outside the already-authorized roster, the route omits this entire
 * optional enrichment rather than returning a plausible partial queue.
 */

export type RoundOneBillingReviewReason = "partial_refund" | "stripe_dispute";

export type RoundOneBillingReviewSummary = {
  unit: "review_item";
  openCount: number;
  items: Array<{
    reviewKey: string;
    parentKey: string;
    parentName: string | null;
    parentPhone: string | null;
    childUsername: string;
    childName: string | null;
    reason: RoundOneBillingReviewReason;
    observedAt: string;
  }>;
};

export type RoundOneBillingReviewRowLike = {
  [key: string]: unknown;
  id?: unknown;
  child_id?: unknown;
  review_kind?: unknown;
  review_state?: unknown;
  last_observed_at?: unknown;
};

export type RoundOneBillingReviewChildLike = {
  id?: unknown;
  fp_username?: unknown;
  follow_up_parent_key?: unknown;
  follow_up_parent_name?: unknown;
  follow_up_parent_phone?: unknown;
  follow_up_child_name?: unknown;
};

export type RoundOneBillingReviewShapeResult =
  | { ok: true; value: RoundOneBillingReviewSummary }
  | { ok: false };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function boundedRequired(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

function boundedNullable(value: unknown, max: number): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed || null : undefined;
}

export function deriveRoundOneBillingReviews(
  children: readonly RoundOneBillingReviewChildLike[],
  rows: readonly RoundOneBillingReviewRowLike[]
): RoundOneBillingReviewShapeResult {
  if (rows.length === 0) {
    return {
      ok: true,
      value: { unit: "review_item", openCount: 0, items: [] },
    };
  }

  const neededChildIds = new Set<string>();
  for (const row of rows) {
    const childId = boundedRequired(row.child_id, 64);
    if (!childId) return { ok: false };
    neededChildIds.add(childId);
  }

  const childById = new Map<string, {
    parentKey: string;
    parentName: string | null;
    parentPhone: string | null;
    childUsername: string;
    childName: string | null;
  }>();

  for (const child of children) {
    const childId = boundedRequired(child.id, 64);
    if (!childId || !neededChildIds.has(childId)) continue;
    const childUsername = boundedRequired(child.fp_username, 80);
    const parentKey = boundedRequired(child.follow_up_parent_key, 64);
    const parentName = boundedNullable(child.follow_up_parent_name, 160);
    const parentPhone = boundedNullable(child.follow_up_parent_phone, 40);
    const childName = boundedNullable(child.follow_up_child_name, 160);
    if (
      !childUsername
      || !parentKey
      || parentName === undefined
      || parentPhone === undefined
      || childName === undefined
      || childById.has(childId)
    ) {
      return { ok: false };
    }
    childById.set(childId, {
      parentKey,
      parentName,
      parentPhone,
      childUsername,
      childName,
    });
  }

  const seenReviewKeys = new Set<string>();
  const items: RoundOneBillingReviewSummary["items"] = [];
  for (const row of rows) {
    const reviewKey = boundedRequired(row.id, 36);
    const childId = boundedRequired(row.child_id, 64);
    const contact = childId ? childById.get(childId) : undefined;
    const reason = row.review_kind;
    const observedAt = boundedRequired(row.last_observed_at, 64);
    const observedAtMs = observedAt
      ? Date.parse(observedAt)
      : Number.NaN;
    if (
      !reviewKey
      || !UUID.test(reviewKey)
      || seenReviewKeys.has(reviewKey)
      || !contact
      || row.review_state !== "open"
      || (reason !== "partial_refund" && reason !== "stripe_dispute")
      || !Number.isFinite(observedAtMs)
    ) {
      return { ok: false };
    }
    seenReviewKeys.add(reviewKey);
    items.push({
      reviewKey,
      ...contact,
      reason,
      observedAt: new Date(observedAtMs).toISOString(),
    });
  }

  items.sort((a, b) =>
    b.observedAt.localeCompare(a.observedAt) || a.reviewKey.localeCompare(b.reviewKey)
  );
  return {
    ok: true,
    value: { unit: "review_item", openCount: items.length, items },
  };
}
