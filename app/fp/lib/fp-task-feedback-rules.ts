/**
 * First Profit TASK FEEDBACK — the pure constants + predicates for the
 * fp_task_feedback cohort stuck-report instrument (first-profit repo plan
 * docs/plans/2026-08-03-001-feat-full-path-cohort-readiness-plan.md, Unit 1;
 * migration supabase/migrations/20260905120000_fp_task_feedback.sql).
 *
 * This module is the TS side of the migration-parity contract: the DB CHECKs
 * and the values here must agree, and the parity test
 * (__tests__/fp-task-feedback-migration-parity.test.ts) parses the migration
 * as text to enforce it (no test DB in this suite). The first-profit SPA
 * mirrors these limits client-side so terminal refusals are unreachable in
 * normal use.
 *
 * Charset agreement is the NESTING invariant (docs/solutions/best-practices/
 * broadening-a-shared-charset-...-2026-08-04.md):
 *
 *   producer (client task-id synthesizer)  ⊆  DB CHECK  ===  this regex
 *
 * The acceptor pair (DB CHECK + this mirror) must stay byte-for-byte equal;
 * the producer (task ids minted from the curriculum brief, e.g. "1.2.5") may
 * be narrower but never broader.
 *
 * NO `server-only`, NO Next/Supabase imports — unit-testable in the node-only
 * harness and importable from scripts (sibling of fp-username-rules.ts).
 */

/** Grade bands a feedback row may carry. 'unknown' = the band was defaulted,
 *  not derived from a real grade — keeps the owner's band analysis unbiased.
 *  Must list EXACTLY the migration's `band` CHECK set, in order. */
export const FEEDBACK_BANDS = ["g3_5", "g6_8", "g9_12", "unknown"] as const;
export type FeedbackBand = (typeof FEEDBACK_BANDS)[number];

/** What a feedback row IS (migration 20260910120000_fp_feedback_kind.sql):
 *  'task' = the per-task "Stuck? Tell us" report; 'app' = an app-level
 *  suggestion. Must list EXACTLY the migration's `kind` CHECK set, in order.
 *  task_id stays mandatory for BOTH kinds — an app-level suggestion stamps the
 *  task that was ACTIVE at submission (where the thought occurred, not what it
 *  is about). */
export const FEEDBACK_KINDS = ["task", "app"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/** The column default. A client that omits `kind` (every build predating the
 *  column) lands a task report — backward compatible by construction. Must
 *  equal the migration's `default` literal (parity test). */
export const FEEDBACK_KIND_DEFAULT: FeedbackKind = "task";

/** Upper bound on `body`. EMPTY STRING IS VALID — a tap with no words is
 *  "I'm stuck here" signal (R11/R13); only the maximum is constrained. */
export const FEEDBACK_BODY_MAX_CHARS = 1000;

/** Per-profile per-UTC-day insert cap, enforced by the DB trigger (PostgREST
 *  writes bypass the in-memory API rate limiter). The client mirrors it so the
 *  refusal is unreachable in normal use. */
export const FEEDBACK_DAILY_CAP = 50;

/** The SQLSTATE the daily-cap trigger raises (custom class 'FP'). Client
 *  contract: FP429 = capped → show an honest "could not send" (never "saved"),
 *  never park in the outbox, never silent-drop. Distinct from P0001 so the
 *  outbox's terminal-drop default cannot swallow a legitimate capped report
 *  (two devices; local cap mirror desynced). Must equal the migration's
 *  `using errcode` literal byte-for-byte (parity test). */
export const FEEDBACK_CAP_ERRCODE = "FP429";

/** The task-id shape: three dot-separated integer components ("1.2.5").
 *  SOURCE string kept separately so the migration-parity test can compare it
 *  byte-for-byte against the SQL `~` pattern. */
export const FEEDBACK_TASK_ID_PATTERN = "^[0-9]+(\\.[0-9]+){2}$";

/** Length bound on task_id (bounding discipline; must equal the CHECK's). */
export const FEEDBACK_TASK_ID_MAX_CHARS = 16;

const TASK_ID_RE = new RegExp(FEEDBACK_TASK_ID_PATTERN);

/* -------------------------------------------------------------- predicates */

export function isValidFeedbackBand(value: string): value is FeedbackBand {
  return (FEEDBACK_BANDS as readonly string[]).includes(value);
}

export function isValidFeedbackKind(value: string): value is FeedbackKind {
  return (FEEDBACK_KINDS as readonly string[]).includes(value);
}

/** OMISSION normalization, both sides of the wire:
 *  - write side (the FP client's optional `kind` field): undefined → the
 *    default; a valid literal passes through. An INVALID literal also
 *    collapses to the default rather than being smuggled to the DB CHECK —
 *    callers that must REFUSE bad input run isValidFeedbackKind first.
 *  - read side (GET /api/fp/suggestions): a row read before the kind
 *    migration applied has no `kind`; absence means 'task' by the same rule
 *    the column default encodes. */
export function normalizeFeedbackKind(value: unknown): FeedbackKind {
  return typeof value === "string" && isValidFeedbackKind(value)
    ? value
    : FEEDBACK_KIND_DEFAULT;
}

export function isValidFeedbackTaskId(value: string): boolean {
  return value.length <= FEEDBACK_TASK_ID_MAX_CHARS && TASK_ID_RE.test(value);
}

/** Body acceptance mirrors the CHECK exactly: any string up to the cap,
 *  including "". */
export function isValidFeedbackBody(value: string): boolean {
  return value.length <= FEEDBACK_BODY_MAX_CHARS;
}
