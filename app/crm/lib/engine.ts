/**
 * CRM domain engine — pure functions, no I/O (plan Unit 1; brief §5.2 / §7).
 * Every business rule the pipeline, kanban, KPIs, and co-pilot depend on
 * lives here so it can be unit-tested without a database (alphahub's
 * copilot-engine posture, re-plumbed for The 120's derived pipeline).
 */

import {
  CONCERN_LABELS,
  isConcern,
  isEngagementSignal,
  type Concern,
  type OverrideStage,
  type Stage,
} from "@/app/crm/lib/constants";

/* ------------------------------------------------------ stage derivation */

/**
 * The system truth a family's stage derives from. Shapes mirror the rows
 * the CRM reads: `child_reviews`, `deposits`, `families` stamps, `children`.
 * Statuses are plain strings so callers can pass DB rows straight through;
 * only the values the derivation trusts (`member`, `paid`, `draft`) matter.
 */
export interface FamilyTruth {
  override: OverrideStage | null;
  reviews: { review_status: string }[];
  deposits: { status: string }[];
  callBookedAt: string | null;
  callHeldAt: string | null;
  children: { status: string }[];
  parentId: string | null;
}

const hasMemberReview = (truth: FamilyTruth): boolean =>
  truth.reviews.some((r) => r.review_status === "member");

const hasPaidDeposit = (truth: FamilyTruth): boolean =>
  truth.deposits.some((d) => d.status === "paid");

/**
 * Derived pipeline stage — first match wins, GTM funnel order (brief §5.2).
 *
 * Decision 5: an override is VOID against higher truth. When deposit-paid
 * or member truth exists, the derived truth stage is returned and the stale
 * override is ignored by construction — the CRM can never disagree with
 * `seats_claimed()`. (`shouldClearOverride` flags the row for bookkeeping.)
 *
 * MEMBER is read only from `child_reviews` (staff-only table, Decision 1);
 * `children.status` is trusted only for started/submitted — the states
 * parents legitimately control.
 */
export function deriveStage(truth: FamilyTruth): Stage {
  const member = hasMemberReview(truth);
  const paid = hasPaidDeposit(truth);

  if (truth.override && !member && !paid) return truth.override;
  if (member) return "member";
  if (paid) return "deposit_paid";
  if (truth.callHeldAt) return "call_held";
  if (truth.callBookedAt) return "call_booked";
  if (truth.children.some((c) => c.status !== "draft")) {
    return "dossier_submitted";
  }
  if (truth.children.length > 0) return "dossier_started";
  if (truth.parentId) return "account_created";
  return "interested";
}

/**
 * Bookkeeping helper (Decision 5): true when an override is set but voided
 * by higher truth (paid deposit or member review). The next staff action
 * that touches the family clears the stale override row and logs it.
 */
export function shouldClearOverride(truth: FamilyTruth): boolean {
  if (!truth.override) return false;
  return hasPaidDeposit(truth) || hasMemberReview(truth);
}

/* ----------------------------------------------------------- suggestHeat */

/**
 * HEAT_BASE per brief §7, with one documented choice: `call_booked` gets 4
 * (not the dossier-tier 3) — a booked call is a stated intent to talk, the
 * strongest pre-call signal we have, so it sits with `call_held`.
 * LOST/WAITLIST short-circuit to 1 before any modifiers.
 */
const HEAT_BASE: Record<Stage, number> = {
  interested: 2,
  account_created: 3,
  dossier_started: 3,
  dossier_submitted: 3,
  call_booked: 4,
  call_held: 4,
  deposit_paid: 5,
  member: 5,
  lost: 1,
  waitlist: 1,
};

/**
 * Auto-suggested heat 1–5 (alphahub's shape): stage base, +2 for ≥5 signals
 * or +1 for ≥3, −2 for >21 days since last touch or −1 for >14, clamped.
 * Unknown signal strings are ignored by scoring — never thrown on.
 */
export function suggestHeat(
  signals: string[],
  daysSinceLastTouch: number,
  stage: Stage
): number {
  if (stage === "lost" || stage === "waitlist") return 1;

  const known = signals.filter(isEngagementSignal);
  let heat = HEAT_BASE[stage];
  if (known.length >= 5) heat += 2;
  else if (known.length >= 3) heat += 1;
  if (daysSinceLastTouch > 21) heat -= 2;
  else if (daysSinceLastTouch > 14) heat -= 1;
  return Math.max(1, Math.min(5, heat));
}

/* -------------------------------------------------------- deriveNextMove */

export interface NextMoveResult {
  message: string;
  ruleId: number;
}

/**
 * Co-pilot input. `stage` is the DERIVED stage, so several of the brief's
 * rule guards hold by construction and need no extra fields:
 * - `call_held` implies no paid deposit / member (they outrank it) — rule 3
 * - `dossier_submitted` implies no call booked (call stages outrank) — rule 4
 * - `account_created` implies no child rows (children derive dossier) — rule 6
 */
export interface FamilyForCopilot {
  stage: Stage;
  heat_score: number;
  concerns: string[];
  daysSinceLastTouch: number;
  deposit_asked_referral: boolean;
}

/**
 * First concern that is (a) a known constant and (b) has no matching
 * library send. Unknown concern strings are skipped, never thrown on.
 */
function firstUnaddressedConcern(
  concerns: string[],
  sentConcerns: Set<string>
): Concern | null {
  for (const concern of concerns) {
    if (!isConcern(concern)) continue;
    if (!sentConcerns.has(concern)) return concern;
  }
  return null;
}

/**
 * The nine GTM next-move rules (brief §7), first match wins. Deterministic,
 * no LLM. `sentConcerns` = concerns already addressed via library sends.
 */
export function deriveNextMove(
  family: FamilyForCopilot,
  sentConcerns: Set<string>
): NextMoveResult {
  const { stage, heat_score, concerns, daysSinceLastTouch: days } = family;

  // 1. Lost is terminal (waitlist is not — it falls through to the rules).
  if (stage === "lost") {
    return { message: "Lost. No action.", ruleId: 1 };
  }

  // 2. Founding-120 referral ask (GTM §5 nurture).
  if (
    (stage === "member" || stage === "deposit_paid") &&
    !family.deposit_asked_referral
  ) {
    return {
      message: "Founding 120 welcome — ask for one introduction.",
      ruleId: 2,
    };
  }

  // 3. Call held, no deposit (implied by derived stage), T+1 (GTM nurture).
  if (stage === "call_held" && days >= 1) {
    return {
      message: "Send the T+1 recap + deposit link. Refundable until Sept 30.",
      ruleId: 3,
    };
  }

  // 4. Dossier submitted, no call booked (implied), 2+ days (W7 play).
  if (stage === "dossier_submitted" && days >= 2) {
    return {
      message: "Call them personally — submitted dossier, no call.",
      ruleId: 4,
    };
  }

  // 5. First unaddressed concern → send the answer.
  const unaddressed = firstUnaddressedConcern(concerns, sentConcerns);
  if (unaddressed) {
    return {
      message: `Send an answer to their '${CONCERN_LABELS[unaddressed]}' concern.`,
      ruleId: 5,
    };
  }

  // 6. Account created, no child rows (implied), 2+ days → dossier nudge.
  if (stage === "account_created" && days >= 2) {
    return {
      message: "Dossier nudge — 'the dossier is the application.'",
      ruleId: 6,
    };
  }

  // 7. Cold: 21+ days and low heat → one last invite.
  if (days > 21 && heat_score <= 2) {
    return {
      message: "Cold. One last info-session invite, then mark lost.",
      ruleId: 7,
    };
  }

  // 8. Hot and cooling early-funnel family → offer the call.
  if (
    (stage === "interested" || stage === "account_created") &&
    heat_score >= 4 &&
    days > 5
  ) {
    return {
      message: "Hot and cooling — offer the 20-min call or a coffee.",
      ruleId: 8,
    };
  }

  // 9. Fallback.
  return { message: "Check in with a personal note.", ruleId: 9 };
}

/* -------------------------------------------------- suggestedLibraryItems */

/** The fields suggestion scoring needs from a `library_items` row. */
export interface LibraryItemForSuggestion {
  id: string;
  concern: string | null;
  helpfulness: number;
  send_count: number;
}

/**
 * Top-3 suggested library items (alphahub R23): items matching the first
 * unaddressed concern, scored `helpfulness*2 + send_count` descending,
 * backfilled globally by `send_count` when fewer than three match.
 */
export function suggestedLibraryItems<T extends LibraryItemForSuggestion>(
  items: T[],
  concerns: string[],
  sentConcerns: Set<string>
): T[] {
  const target = firstUnaddressedConcern(concerns, sentConcerns);
  const score = (item: T) => item.helpfulness * 2 + item.send_count;

  const picks = target
    ? items
        .filter((item) => item.concern === target)
        .sort((a, b) => score(b) - score(a))
        .slice(0, 3)
    : [];

  if (picks.length < 3) {
    const chosen = new Set(picks.map((p) => p.id));
    const backfill = [...items]
      .filter((item) => !chosen.has(item.id))
      .sort((a, b) => b.send_count - a.send_count);
    for (const item of backfill) {
      if (picks.length >= 3) break;
      picks.push(item);
    }
  }

  return picks;
}
