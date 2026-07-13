/**
 * CRM domain constants (plan Unit 1; brief §5.1 / §5.2 / §7 / §11).
 * Single source of truth for every enum-ish value the CRM writes or renders —
 * the DB stores these as unconstrained text and Zod validates against these
 * lists at the action layer (plan Decision "single enum source of truth").
 * Pure data: no React, no Supabase, no next imports.
 */

/* ---------------------------------------------------------------- stages */

/** Derived pipeline stages, in GTM funnel order (brief §5.2). */
export const STAGES = [
  "interested",
  "account_created",
  "dossier_started",
  "dossier_submitted",
  "call_booked",
  "call_held",
  "deposit_paid",
  "member",
  "lost",
  "waitlist",
] as const;

export type Stage = (typeof STAGES)[number];

/** The two manual-exit override values (`families.stage_override`). */
export const OVERRIDE_STAGES = ["lost", "waitlist"] as const;

export type OverrideStage = (typeof OVERRIDE_STAGES)[number];

/**
 * The only stages a kanban drop may write (they set the underlying call
 * stamp). Everything else is derived truth or drawer-only overrides.
 */
export const MANUAL_STAMP_STAGES = ["call_booked", "call_held"] as const;

export type ManualStampStage = (typeof MANUAL_STAMP_STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  interested: "INTERESTED",
  account_created: "ACCOUNT CREATED",
  dossier_started: "DOSSIER STARTED",
  dossier_submitted: "DOSSIER SUBMITTED",
  call_booked: "CALL BOOKED",
  call_held: "CALL HELD",
  deposit_paid: "DEPOSIT PAID",
  member: "MEMBER",
  lost: "LOST",
  waitlist: "WAITLIST",
};

/**
 * Stage pill colors per brief §11 component rules (plan Decision 12 —
 * CRM-scoped hex tokens, additive to the marketing palette).
 * INTERESTED/ACCOUNT bone/muted · DOSSIER+CALL blue/white ·
 * DEPOSIT PAID & MEMBER red/white · LOST ink/white-60 · WAITLIST blush/ink.
 */
export const STAGE_COLORS: Record<Stage, { bg: string; text: string }> = {
  interested: { bg: "#E0DDD7", text: "#55585E" },
  account_created: { bg: "#E0DDD7", text: "#55585E" },
  dossier_started: { bg: "#0300ED", text: "#FFFFFF" },
  dossier_submitted: { bg: "#0300ED", text: "#FFFFFF" },
  call_booked: { bg: "#0300ED", text: "#FFFFFF" },
  call_held: { bg: "#0300ED", text: "#FFFFFF" },
  deposit_paid: { bg: "#D92632", text: "#FFFFFF" },
  member: { bg: "#D92632", text: "#FFFFFF" },
  lost: { bg: "#131416", text: "rgba(255,255,255,0.6)" },
  waitlist: { bg: "#EFC5B8", text: "#131416" },
};

/* -------------------------------------------------------------- concerns */

/** The 120 concern set (brief §7 — replaces alphahub's). */
export const CONCERNS = [
  "price-value",
  "full-core-cost",
  "refund-terms",
  "time-commitment",
  "screen-time",
  "socialization",
  "curriculum-fit",
  "selectivity-anxiety",
  "spouse-buy-in",
  "logistics",
] as const;

export type Concern = (typeof CONCERNS)[number];

export const CONCERN_LABELS: Record<Concern, string> = {
  "price-value": "Price vs. value",
  "full-core-cost": "Full Core cost",
  "refund-terms": "Refund terms",
  "time-commitment": "Time commitment",
  "screen-time": "Screen time",
  socialization: "Socialization",
  "curriculum-fit": "Curriculum fit",
  "selectivity-anxiety": "Selectivity anxiety",
  "spouse-buy-in": "Spouse buy-in",
  logistics: "Logistics",
};

export function isConcern(value: string): value is Concern {
  return (CONCERNS as readonly string[]).includes(value);
}

/* --------------------------------------------------------------- signals */

/** The 120 engagement-signal set (brief §7; warm-convo added for GTM W1 —
 *  every warm conversation is recorded on the family, never a bare tally). */
export const ENGAGEMENT_SIGNALS = [
  "warm-convo",
  "explainer-sent",
  "gauntlet-played",
  "info-session",
  "group-sheet-sent",
  "parents-story-sent",
  "deposit-link-shared",
  "ambassador-connected",
  "dossier-nudged",
] as const;

export type EngagementSignal = (typeof ENGAGEMENT_SIGNALS)[number];

export const SIGNAL_LABELS: Record<EngagementSignal, string> = {
  "warm-convo": "Warm convo held",
  "explainer-sent": "Explainer sent",
  "gauntlet-played": "Gauntlet played",
  "info-session": "Info session",
  "group-sheet-sent": "Group sheet sent",
  "parents-story-sent": "Parents story sent",
  "deposit-link-shared": "Deposit link shared",
  "ambassador-connected": "Ambassador connected",
  "dossier-nudged": "Dossier nudged",
};

export function isEngagementSignal(value: string): value is EngagementSignal {
  return (ENGAGEMENT_SIGNALS as readonly string[]).includes(value);
}

/* --------------------------------------------------------------- sources */

/** Lead sources, mirroring the GTM channels (brief §5.1). */
export const SOURCES = [
  "warm-network",
  "ambassador",
  "gauntlet",
  "facebook-group",
  "abc-ontario",
  "math-contest",
  "sports-arts",
  "info-session",
  "coffee-intro",
  "website",
  "other",
] as const;

export type Source = (typeof SOURCES)[number];

export const SOURCE_LABELS: Record<Source, string> = {
  "warm-network": "Warm network",
  ambassador: "Ambassador",
  gauntlet: "Gauntlet",
  "facebook-group": "Facebook group",
  "abc-ontario": "ABC Ontario",
  "math-contest": "Math contest",
  "sports-arts": "Sports & arts",
  "info-session": "Info session",
  "coffee-intro": "Coffee intro",
  website: "Website",
  other: "Other",
};

/* ------------------------------------------------------- review statuses */

/**
 * Dossier review statuses — one enum, one spelling: reuses the existing
 * `SeatStatus` values from `app/dashboard/data.ts` (plan Decision 6).
 * Labels are display-layer; the brief's hyphenated stage names map here.
 */
export const REVIEW_STATUSES = [
  "draft",
  "submitted",
  "in_review",
  "invited",
  "offered",
  "member",
] as const;

export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  in_review: "In review",
  invited: "Invited to assessment",
  offered: "Offered a seat",
  member: "Member of the 120",
};

/* ---------------------------------------------------------------- groups */

/** The five groups — single-select per child, stored as `group_assignment`. */
export const GROUPS = [
  "athletes",
  "founders",
  "makers",
  "scholars",
  "givers",
] as const;

export type Group = (typeof GROUPS)[number];

export const GROUP_LABELS: Record<Group, string> = {
  athletes: "Athletes",
  founders: "Founders",
  makers: "Makers",
  scholars: "Scholars",
  givers: "Givers",
};

/* --------------------------------------------------------- audit actions */

/** Allowlist for `crm_audit_log.action` (one entry per staff server action). */
export const AUDIT_ACTIONS = [
  "family-add",
  "stamp-call",
  "clear-stamp",
  "set-override",
  "reopen",
  "note-add",
  "contact-update",
  "consent-revoke",
  "merge",
  "review-move",
  "group-assign",
  "signal-toggle",
  "concern-update",
  "heat-override",
  "library-send",
  "gtm-edit",
  "drill-down",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
