/**
 * The funnel event vocabulary and stage mapping — pure (funnel U16;
 * R56–R59). The emit helper (`events.ts`) and every loader filter consume
 * THESE exports, so the vocabulary exists exactly once and a `.in(...)`
 * filter cannot drift from the pure function's set.
 */

/* ─────────────────── R56: the event names, once ─────────────────── */

/**
 * Emitters, by name. Six names are RESERVED — vocabulary shipped so the
 * CHECK never needs migrating, emitters documented rather than silent
 * (the reviewers: an undocumented hole reads as a retrofit gap):
 * - lp_view, explainer_start: the landings are STATIC pages; a server
 *   emit needs edge middleware or a client beacon, both owned by the
 *   bot-resistance carried item before ad spend.
 * - application_started: needs a clean server transition into the wizard;
 *   the dashboard is a client SPA today. Deferred to U17 (nurture keys
 *   off abandonment points and will need the same hook). Until then the
 *   reveal_viewed → c2_applied gap approximates the stall signal.
 * - project_switched: R2's project switching is a later product op;
 *   nothing can switch projects yet.
 * - student_account_created: U15 (blocked on the mailbox vendor).
 * - c4_tuition: post-launch billing.
 */
export const FUNNEL_EVENT_NAMES = [
  "lp_view",
  "start_view",
  "explainer_start",
  "c1_captured",
  "child_added",
  "quiz_start",
  "door_confirmed",
  "project_created",
  "reveal_viewed",
  "faq_opened",
  "application_started",
  "c2_applied",
  "c3_deposit",
  "student_account_created",
  "c4_tuition",
  "project_regenerated",
  "project_switched",
  "share_card_created",
] as const;

export type FunnelEventName = (typeof FUNNEL_EVENT_NAMES)[number];

export const isFunnelEventName = (x: unknown): x is FunnelEventName =>
  typeof x === "string" && (FUNNEL_EVENT_NAMES as readonly string[]).includes(x);

/* ─────────────────── the segmentation tuple (R56/R58) ─────────────────── */

export type FunnelEventTuple = {
  familyId?: string | null;
  parentId?: string | null;
  childId?: string | null;
  /** Stamped once at C1 on the family; DENORMALIZED onto every event so the
   *  ads question is one query (R58). */
  entrySource?: string | null;
  band?: string | null;
  groupSlug?: string | null;
};

/**
 * The no-PII rule, executable (R56): event properties carry ids, enums,
 * booleans, and numbers — never names, emails, or free text. A property
 * value survives only if it looks like one of those. Asserted over the
 * whole emitted set by the tests; enforced at the emit helper so a bad
 * call site degrades to a dropped property, never a stored name.
 */
// 128, not 64: real Stripe checkout session ids are ~66 chars — the 64
// bound silently dropped the one property tying c3 to its session
// (reviewer, by execution against a real-length id).
const ID_LIKE = /^[a-z0-9_-]{1,128}$/i;
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sanitizeEventProperties(
  props: Record<string, unknown>
): Record<string, string | number | boolean> {
  const clean: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(props)) {
    if (!ID_LIKE.test(key)) continue;
    if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
      clean[key] = value;
      continue;
    }
    if (typeof value === "string" && (ID_LIKE.test(value) || UUID_LIKE.test(value))) {
      clean[key] = value;
    }
    // Anything else — free text, emails, objects — is dropped, silently:
    // an analytics property is never worth storing a child's name for.
  }
  return clean;
}

/* ─────────────────── R59: the CRM stage ladder ─────────────────── */

/** The pipeline stages the funnel's states map onto — ONE constant; the
 *  loader's `.in()` filter and the pure mapping share it by identity. */
export const FUNNEL_STAGES = [
  "email_captured",
  "child_added",
  "quiz_started",
  "project_created",
  "reveal_viewed",
  "application_started",
  "application_submitted",
  "deposit_paid",
  "enrolled",
] as const;

export type FunnelStage = (typeof FUNNEL_STAGES)[number];

/** Which stage an EVENT advances a child to (not every event is a stage
 *  boundary — faq_opened, share_card_created, regenerations are texture). */
export const STAGE_FOR_EVENT: Partial<Record<FunnelEventName, FunnelStage>> = {
  c1_captured: "email_captured",
  child_added: "child_added",
  quiz_start: "quiz_started",
  project_created: "project_created",
  reveal_viewed: "reveal_viewed",
  application_started: "application_started",
  c2_applied: "application_submitted",
  c3_deposit: "deposit_paid",
  c4_tuition: "enrolled",
};

/** The event names that ARE stage boundaries — derived from the mapping,
 *  exported once: the CRM loader's `.in(...)` filter uses THIS constant, so
 *  it cannot drift from the pure function's set (asserted by identity). */
export const STAGE_EVENT_NAMES = Object.keys(STAGE_FOR_EVENT) as FunnelEventName[];

/**
 * The furthest stage a child's event history reaches, with when they got
 * there — time-in-stage is "now minus that stamp" (R59: staff see where a
 * family stalled). Events may arrive out of order; the FURTHEST stage
 * wins, and its earliest stamp is kept.
 */
export function stageFromEvents(
  events: { name: string; created_at: string }[]
): { stage: FunnelStage; since: string } | null {
  let best: { idx: number; since: string } | null = null;
  for (const e of events) {
    if (!isFunnelEventName(e.name)) continue;
    const stage = STAGE_FOR_EVENT[e.name];
    if (!stage) continue;
    const idx = FUNNEL_STAGES.indexOf(stage);
    if (!best || idx > best.idx) {
      best = { idx, since: e.created_at };
    } else if (idx === best.idx && e.created_at < best.since) {
      best = { idx, since: e.created_at };
    }
  }
  return best ? { stage: FUNNEL_STAGES[best.idx], since: best.since } : null;
}
