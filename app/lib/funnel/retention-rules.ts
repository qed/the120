/**
 * The retention schedule — written, automated, pure (funnel U17; R55/R55a).
 *
 * R55: never-deposited families are never REAPED — the application stays on
 * file like any competitive school's applicant file. R55a: the child's
 * FREE TEXT (quiz answers, the generated project, the family goal) is
 * de-identified after a defined inactivity period; aggregate analytics live
 * in funnel_events as ids-only counts, so retention never costs
 * measurement. The file is the APPLICATION (children row: name, grade,
 * school, status, pitch — the wizard's own fields), not the free text.
 *
 * Both review agents reshaped this module:
 * - INACTIVITY is the max of the project's AND the child's last write — a
 *   family working their dossier for a year while the project row sat
 *   still was purge-eligible under the first draft.
 * - GRACE IS STATEFUL: a candidate is STAMPED when it first surfaces
 *   (projects.purge_noticed_at) and purges only when the stamp is older
 *   than the grace window. The first enabled run therefore notices the
 *   whole backlog and destroys nothing; a cron outage cannot carry rows
 *   across the band unseen.
 * - Unparsable timestamps FAIL CLOSED (skipped and logged), never
 *   "infinitely old".
 */

/** THE WRITTEN SCHEDULE (R55a) — CONFIRMED 2026-07-28 (Peter, decision batch). */
export const RETENTION_SCHEDULE = {
  /** Days since the LAST activity on either the project row or the child
   *  row before free text becomes a candidate. */
  inactivityDays: 365,
  /** Days a candidate must sit STAMPED (purge_noticed_at) before the
   *  irreversible pass touches it. */
  graceDays: 14,
} as const;

export const RETENTION_CLAIMS_FOR_PETER: string[] = [
  "365 days of inactivity before de-identification — CONFIRMED 2026-07-28 (Peter)",
  "14-day stamped grace window before the irreversible pass — CONFIRMED 2026-07-28 (Peter)",
  "Inactivity DEFINITION: the max of the project row's and the child row's last write — CONFIRMED 2026-07-28 (Peter)",
  "Scope: projects free text + quiz answers + family_goal; the application fields on children are KEPT (R55) — CONFIRMED 2026-07-28 (Peter)",
];

/** What de-identified fields read as afterwards. Purged projects also flip
 *  to status 'abandoned' so no active-project read (prefill, CRM, the
 *  reveal) ever renders the marker back to a family as their project. */
export const PURGED_MARKER = "[de-identified per retention schedule]";

export type RetentionCandidate = {
  projectId: string;
  childId: string;
  /** ms of the LATEST write on project or child; null = unparsable → skip. */
  lastActiveMs: number | null;
  noticedAtMs: number | null;
  /** A live paid deposit means an active customer: never purged. */
  hasLivePaidDeposit: boolean;
  alreadyPurged: boolean;
};

export type RetentionPlan = {
  /** Stamped past the grace window AND still inactive: de-identify NOW. */
  purge: RetentionCandidate[];
  /** Past inactivity, not yet stamped: stamp purge_noticed_at this run. */
  notice: RetentionCandidate[];
  /** Unparsable timestamps — logged, never acted on (fail closed). */
  skipped: RetentionCandidate[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function retentionPlan(
  candidates: RetentionCandidate[],
  nowMs: number
): RetentionPlan {
  const inactiveBefore = nowMs - RETENTION_SCHEDULE.inactivityDays * DAY_MS;
  const noticedBefore = nowMs - RETENTION_SCHEDULE.graceDays * DAY_MS;
  const plan: RetentionPlan = { purge: [], notice: [], skipped: [] };
  for (const c of candidates) {
    if (c.hasLivePaidDeposit || c.alreadyPurged) continue;
    if (c.lastActiveMs === null) {
      plan.skipped.push(c);
      continue;
    }
    if (c.lastActiveMs > inactiveBefore) continue; // active — clear any stale notice is the cron's job
    if (c.noticedAtMs === null) {
      plan.notice.push(c);
    } else if (c.noticedAtMs <= noticedBefore) {
      plan.purge.push(c);
    }
    // Stamped but inside the grace window: wait.
  }
  return plan;
}
