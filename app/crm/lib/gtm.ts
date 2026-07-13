/**
 * GTM dashboard aggregation — pure functions, no I/O (plan Unit 6; brief §8).
 * Weekly funnel actuals compute per plan Decision 2's provisions:
 *
 *  (a) refund netting     — a deposit counts in every week whose end it was
 *      paid-and-not-yet-refunded at (`created_at` ≤ week end, `refunded_at`
 *      null or after week end), matching the thermometer's net view;
 *  (b) calls from events  — CALL BOOKED/HELD aggregate from the immutable
 *      per-stamp `family_stage_history` rows Unit 4 writes (note
 *      `stamp · <iso>`; clears write note `stamp-cleared`), never from the
 *      mutable latest-wins columns. Per family and kind, a week counts the
 *      family when (#stamps ≤ week end) − (#clears ≤ week end) > 0;
 *  (c) snapshot coalescing — accounts/dossiers coalesce the `families`
 *      snapshots (`signup_at` / `dossier_submitted_at`) with live truth
 *      rows, so an account deletion cannot rewrite past weeks;
 *  and events timestamped before Jul 13 (sprint start) are excluded from
 *  the call rows — the stamp backdate field is floored there, so this is
 *  defensive (plan Decision 2's pre-sprint exclusion).
 *
 * All counts are CUMULATIVE as of the selected week's end (exclusive
 * Toronto-midnight boundary from `weekBounds`). Zod schemas for the Unit 6
 * server actions live here too so their decision logic stays unit-testable;
 * components must import from this file with `import type` only.
 */

import { z } from "zod";
import { GROUPS, GROUP_LABELS, SOURCE_LABELS, type Source, type Stage } from "./constants";
import { daysSince } from "./dates";
import { SPRINT_WEEKS, weekBounds } from "./week";

/* --------------------------------------------------------- funnel actuals */

export interface FunnelActuals {
  interested: number;
  accounts: number;
  dossiers_submitted: number;
  calls_booked: number;
  calls_held: number;
  deposits: number;
}

export type FunnelField = keyof FunnelActuals;

/** Row/label metadata for the funnel-vs-plan table (§1 stage order). */
export const FUNNEL_FIELDS: { key: FunnelField; label: string }[] = [
  { key: "interested", label: "INTERESTED (CONSENTED)" },
  { key: "accounts", label: "ACCOUNT CREATED" },
  { key: "dossiers_submitted", label: "DOSSIER SUBMITTED" },
  { key: "calls_booked", label: "CALL BOOKED" },
  { key: "calls_held", label: "CALL HELD" },
  { key: "deposits", label: "DEPOSIT PAID" },
];

/** `gtm_weekly_targets` row (cumulative targets). */
export interface GtmTargetsRow extends FunnelActuals {
  week: number;
}

/** The `families` columns funnel aggregation reads (live rows only). */
export interface GtmFamilyInput {
  id: string;
  created_at: string;
  consent_given: boolean;
  consent_revoked_at: string | null;
  parent_id: string | null;
  signup_at: string | null;
  dossier_submitted_at: string | null;
}

export interface GtmChildInput {
  parent_id: string;
  status: string;
  submitted_at: string | null;
}

export interface GtmDepositInput {
  status: string;
  created_at: string;
  refunded_at: string | null;
}

/** `family_stage_history` rows with to_stage call_booked / call_held. */
export interface GtmStampEventInput {
  family_id: string;
  to_stage: string;
  note: string | null;
  created_at: string;
}

export interface GtmTruth {
  families: GtmFamilyInput[];
  children: GtmChildInput[];
  deposits: GtmDepositInput[];
  stampEvents: GtmStampEventInput[];
}

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
};

const STAMP_PREFIX = "stamp ·";

/**
 * A stamp's effective instant: the ISO in its `stamp · <iso>` note (Unit 4
 * stores the — possibly backdated — effective time there), falling back to
 * the history row's own `created_at` when the note doesn't parse.
 */
export function stampEffectiveMs(
  note: string | null,
  createdAt: string
): number | null {
  if (note && note.startsWith(STAMP_PREFIX)) {
    const parsed = ms(note.slice(STAMP_PREFIX.length).trim());
    if (parsed !== null) return parsed;
  }
  return ms(createdAt);
}

/** DISTINCT families with a positive stamp-minus-clear balance by `endMs`. */
function countCallFamilies(
  events: GtmStampEventInput[],
  toStage: "call_booked" | "call_held",
  sprintStartMs: number,
  endMs: number
): number {
  const net = new Map<string, number>();
  for (const e of events) {
    if (e.to_stage !== toStage) continue;
    const note = e.note ?? "";
    if (note.startsWith(STAMP_PREFIX)) {
      const at = stampEffectiveMs(note, e.created_at);
      // Pre-sprint events are excluded (Decision 2); week end is exclusive.
      if (at === null || at < sprintStartMs || at >= endMs) continue;
      net.set(e.family_id, (net.get(e.family_id) ?? 0) + 1);
    } else if (note === "stamp-cleared") {
      const at = ms(e.created_at);
      if (at === null || at >= endMs) continue;
      net.set(e.family_id, (net.get(e.family_id) ?? 0) - 1);
    }
    // Other history rows for these stages (none today) are ignored.
  }
  let count = 0;
  for (const balance of net.values()) if (balance > 0) count += 1;
  return count;
}

/**
 * Cumulative funnel actuals as of week `week`'s end. Definitions (also the
 * table footnote): INTERESTED counts consented live families only — consent
 * given, not revoked by the week's end (revocation nets out forward, like
 * refunds); every other row counts everyone.
 */
export function computeFunnelActuals(
  week: number,
  truth: GtmTruth
): FunnelActuals {
  const endMs = weekBounds(week).end.getTime();
  const sprintStartMs = weekBounds(1).start.getTime();

  let interested = 0;
  let accounts = 0;
  let dossiers = 0;

  // Earliest live dossier submission per parent (coalesced with snapshots).
  const firstSubmitByParent = new Map<string, number>();
  for (const c of truth.children) {
    const at = ms(c.submitted_at);
    if (at === null) continue;
    const prev = firstSubmitByParent.get(c.parent_id);
    if (prev === undefined || at < prev) firstSubmitByParent.set(c.parent_id, at);
  }

  for (const f of truth.families) {
    const createdAt = ms(f.created_at);

    if (
      f.consent_given &&
      createdAt !== null &&
      createdAt < endMs &&
      (ms(f.consent_revoked_at) ?? Infinity) >= endMs
    ) {
      interested += 1;
    }

    // Snapshot first (survives account deletion — Decision 2c), live link
    // second (trigger-synced rows carry signup_at; created_at is the
    // defensive fallback for a linked row missing its snapshot).
    const accountAt =
      ms(f.signup_at) ?? (f.parent_id ? createdAt : null);
    if (accountAt !== null && accountAt < endMs) accounts += 1;

    const submitAt =
      ms(f.dossier_submitted_at) ??
      (f.parent_id ? firstSubmitByParent.get(f.parent_id) ?? null : null);
    if (submitAt !== null && submitAt < endMs) dossiers += 1;
  }

  let deposits = 0;
  for (const d of truth.deposits) {
    // A refunded row was necessarily paid first; `refunded_at` nets it out
    // of every week ending after the refund (Decision 2a).
    const wasPaid = d.status === "paid" || d.refunded_at !== null;
    const paidAt = ms(d.created_at);
    if (!wasPaid || paidAt === null || paidAt >= endMs) continue;
    const refundedAt = ms(d.refunded_at);
    if (refundedAt !== null && refundedAt < endMs) continue;
    deposits += 1;
  }

  return {
    interested,
    accounts,
    dossiers_submitted: dossiers,
    calls_booked: countCallFamilies(
      truth.stampEvents, "call_booked", sprintStartMs, endMs
    ),
    calls_held: countCallFamilies(
      truth.stampEvents, "call_held", sprintStartMs, endMs
    ),
    deposits,
  };
}

/* ------------------------------------------------------------ delta rule */

export type DeltaTone = "green" | "amber" | "red";

export interface FunnelDelta {
  diff: number;
  tone: DeltaTone;
}

/**
 * Δ vs cumulative target (sprint §1 rule): on/over target green, under
 * amber, RED when actual < 70% of target ("30% under → that stage is next
 * week's push"). Exactly 70% is amber. Missing target → null (em-dash cell,
 * never a crash).
 */
export function funnelDelta(
  actual: number,
  target: number | null | undefined
): FunnelDelta | null {
  if (target === null || target === undefined) return null;
  const diff = actual - target;
  if (actual >= target) return { diff, tone: "green" };
  return { diff, tone: actual >= target * 0.7 ? "amber" : "red" };
}

/* -------------------------------------------------------------- week tick */

export type WeekTick = "done" | "missed" | "future" | "current";

/**
 * Week-strip tick: past weeks read ✓/✗ from their funnel delta at their own
 * end (missed = any stage red), the current week is filled, later weeks are
 * bone. `currentWeek` is the caller's sprint position — pass 0 before the
 * sprint (everything future) and SPRINT_WEEKS+1 after it (everything past).
 * A week with no targets row can't be missed against nothing → done.
 */
export function weekTick(
  week: number,
  currentWeek: number,
  actuals: FunnelActuals,
  targets: GtmTargetsRow | null
): WeekTick {
  if (week > currentWeek) return "future";
  if (week === currentWeek) return "current";
  if (!targets) return "done";
  for (const { key } of FUNNEL_FIELDS) {
    if (funnelDelta(actuals[key], targets[key])?.tone === "red") {
      return "missed";
    }
  }
  return "done";
}

/** Phase name per week (fallback when `gtm_weeks` isn't seeded). */
export const WEEK_PHASES = [
  "ARM", "ARM", "SEED", "SEED", "SURGE", "SURGE", "LAND", "LAND",
] as const;

/** Phase number 1–4 (ARM=1 … LAND=4) for the mono kicker. */
export const phaseNumber = (week: number): number => Math.ceil(week / 2);

/* --------------------------------------------- week card jsonb structures */

export interface WeekAction {
  id: string;
  text: string;
  done: boolean;
  done_by: string | null;
  done_at: string | null;
  /** The week's asset ships as an action flagged 'asset' (distinct row). */
  kind?: "asset";
}

export interface NonFunnelTarget {
  key: string;
  label: string;
  target: number;
  /** true → hand-kept tally with ± steppers; false → `key` names a funnel
   *  field and the chip computes from truth (count ignored). */
  manual: boolean;
  count: number;
}

/** Defensive jsonb parse — malformed rows render as empty, never crash. */
export function asWeekActions(value: unknown): WeekAction[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (a): a is WeekAction =>
      typeof a === "object" &&
      a !== null &&
      typeof (a as WeekAction).id === "string" &&
      typeof (a as WeekAction).text === "string" &&
      typeof (a as WeekAction).done === "boolean"
  );
}

export function asNonFunnelTargets(value: unknown): NonFunnelTarget[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (t): t is NonFunnelTarget =>
      typeof t === "object" &&
      t !== null &&
      typeof (t as NonFunnelTarget).key === "string" &&
      typeof (t as NonFunnelTarget).label === "string" &&
      typeof (t as NonFunnelTarget).target === "number" &&
      typeof (t as NonFunnelTarget).manual === "boolean"
  );
}

/**
 * Flip one action's done state (immutably). Checking stamps who/when;
 * unchecking clears both. Null when the id isn't in the list.
 */
export function applyActionToggle(
  actions: WeekAction[],
  actionId: string,
  staffId: string,
  nowIso: string
): { actions: WeekAction[]; done: boolean } | null {
  const target = actions.find((a) => a.id === actionId);
  if (!target) return null;
  const done = !target.done;
  return {
    done,
    actions: actions.map((a) =>
      a.id === actionId
        ? {
            ...a,
            done,
            done_by: done ? staffId : null,
            done_at: done ? nowIso : null,
          }
        : a
    ),
  };
}

/**
 * Bump one MANUAL counter by ±1, floored at 0 (immutably). Null when the
 * key is missing or the chip is funnel-derived (those compute from truth).
 */
export function applyCounterBump(
  targets: NonFunnelTarget[],
  key: string,
  delta: 1 | -1
): { targets: NonFunnelTarget[]; count: number } | null {
  const target = targets.find((t) => t.key === key);
  if (!target || !target.manual) return null;
  const count = Math.max(0, (target.count ?? 0) + delta);
  return {
    count,
    targets: targets.map((t) => (t.key === key ? { ...t, count } : t)),
  };
}

/* ------------------------------------------------------- action schemas */

const weekSchema = z.number().int().min(1).max(SPRINT_WEEKS);

export const toggleWeekActionSchema = z.object({
  week: weekSchema,
  actionId: z.string().min(1).max(60),
});

export const bumpCounterSchema = z.object({
  week: weekSchema,
  key: z.string().min(1).max(60),
  delta: z.union([z.literal(1), z.literal(-1)]),
});

export const updateTargetSchema = z.object({
  week: weekSchema,
  field: z.enum([
    "interested",
    "accounts",
    "dossiers_submitted",
    "calls_booked",
    "calls_held",
    "deposits",
  ]),
  value: z.number().int().min(0).max(100_000),
});

/* ------------------------------------------------------ Today's Briefing */

/** One composed family, shaped by the page from pipeline truth. */
export interface BriefingFamily {
  id: string;
  name: string;
  stage: Stage;
  heat: number;
  lastTouchAt: string | null;
  createdAt: string;
  nextMove: string;
}

const staleness = (f: BriefingFamily, now: Date): number =>
  daysSince(f.lastTouchAt ?? f.createdAt, now) ?? 0;

/**
 * Follow-ups due: stalest first (days since last touch, creation for the
 * never-touched), LOST excluded — its next move is "no action" by rule 1.
 */
export function followUpsDue(
  families: BriefingFamily[],
  now: Date,
  limit = 8
): (BriefingFamily & { days: number })[] {
  return families
    .filter((f) => f.stage !== "lost")
    .map((f) => ({ ...f, days: staleness(f, now) }))
    .sort((a, b) => b.days - a.days)
    .slice(0, limit);
}

/** Cooling off (brief §8): heat ≥ 3 AND no touch in > 7 days. LOST excluded. */
export function coolingOff(
  families: BriefingFamily[],
  now: Date,
  limit = 8
): (BriefingFamily & { days: number })[] {
  return families
    .filter((f) => f.stage !== "lost" && f.heat >= 3)
    .map((f) => ({ ...f, days: staleness(f, now) }))
    .filter((f) => f.days > 7)
    .sort((a, b) => b.days - a.days)
    .slice(0, limit);
}

/**
 * Warming up: families with an engagement-signal toggle in the last 7 days
 * (from 'signal-toggle' audit rows — empty until Unit 8 ships the toggles).
 */
export function warmingUp(
  families: BriefingFamily[],
  recentSignalFamilyIds: ReadonlySet<string>,
  limit = 8
): BriefingFamily[] {
  return families.filter((f) => recentSignalFamilyIds.has(f.id)).slice(0, limit);
}

/* ------------------------------------------------------------ source tally */

export interface SourceTallyFamily {
  id: string;
  source: string;
  referralCode: string;
}

export interface SourceTallyRow {
  source: string;
  label: string;
  leads: number;
  deposits: number;
}

export interface AmbassadorTallyRow {
  code: string;
  leads: number;
  deposits: number;
}

const AMB_RE = /^AMB-/i;

/**
 * Leads + deposits by source, with the ambassador sub-table grouped by
 * AMB-* referral code (GTM §3's "weekly tally in the Friday review").
 * `depositFamilyIds` carries one entry per counted deposit (duplicates OK).
 */
export function computeSourceTally(
  families: SourceTallyFamily[],
  depositFamilyIds: string[]
): { rows: SourceTallyRow[]; ambassadors: AmbassadorTallyRow[] } {
  const byId = new Map(families.map((f) => [f.id, f]));
  const depositsBySource = new Map<string, number>();
  const depositsByCode = new Map<string, number>();
  for (const id of depositFamilyIds) {
    const f = byId.get(id);
    if (!f) continue;
    depositsBySource.set(f.source, (depositsBySource.get(f.source) ?? 0) + 1);
    if (AMB_RE.test(f.referralCode)) {
      const code = f.referralCode.toUpperCase();
      depositsByCode.set(code, (depositsByCode.get(code) ?? 0) + 1);
    }
  }

  const leadsBySource = new Map<string, number>();
  const leadsByCode = new Map<string, number>();
  for (const f of families) {
    leadsBySource.set(f.source, (leadsBySource.get(f.source) ?? 0) + 1);
    if (AMB_RE.test(f.referralCode)) {
      const code = f.referralCode.toUpperCase();
      leadsByCode.set(code, (leadsByCode.get(code) ?? 0) + 1);
    }
  }

  const rows: SourceTallyRow[] = [...leadsBySource.entries()]
    .map(([source, leads]) => ({
      source,
      label: (SOURCE_LABELS[source as Source] ?? source).toUpperCase(),
      leads,
      deposits: depositsBySource.get(source) ?? 0,
    }))
    .sort((a, b) => b.deposits - a.deposits || b.leads - a.leads);

  const ambassadors: AmbassadorTallyRow[] = [...leadsByCode.entries()]
    .map(([code, leads]) => ({
      code,
      leads,
      deposits: depositsByCode.get(code) ?? 0,
    }))
    .sort((a, b) => b.deposits - a.deposits || b.leads - a.leads);

  return { rows, ambassadors };
}

/* ---------------------------------------------------------- seats by group */

export interface SeatsGroupRow {
  group: string;
  label: string;
  /** member review OR paid deposit (deposit truth, never hand-entered). */
  committed: number;
  /** children assigned to the group in `child_reviews.group_assignment`. */
  assigned: number;
}

export interface SeatsByGroupResult {
  rows: SeatsGroupRow[];
  /** Committed children with no group assignment yet. */
  unassignedCommitted: number;
  /** GTM Open Q2: Scholars likely caps first at ~24. */
  scholarsWarning: boolean;
}

export const SCHOLARS_CAP = 24;

export function computeSeatsByGroup(
  reviews: {
    child_id: string;
    review_status: string;
    group_assignment: string | null;
  }[],
  paidDepositChildIds: ReadonlySet<string>
): SeatsByGroupResult {
  const reviewByChild = new Map(reviews.map((r) => [r.child_id, r]));
  const childIds = new Set<string>([
    ...reviewByChild.keys(),
    ...paidDepositChildIds,
  ]);

  const assigned = new Map<string, number>();
  const committed = new Map<string, number>();
  let unassignedCommitted = 0;

  for (const childId of childIds) {
    const review = reviewByChild.get(childId);
    const group = review?.group_assignment ?? null;
    const isCommitted =
      review?.review_status === "member" || paidDepositChildIds.has(childId);
    if (group) {
      assigned.set(group, (assigned.get(group) ?? 0) + 1);
      if (isCommitted) committed.set(group, (committed.get(group) ?? 0) + 1);
    } else if (isCommitted) {
      unassignedCommitted += 1;
    }
  }

  const rows: SeatsGroupRow[] = GROUPS.map((g) => ({
    group: g,
    label: GROUP_LABELS[g].toUpperCase(),
    committed: committed.get(g) ?? 0,
    assigned: assigned.get(g) ?? 0,
  }));

  return {
    rows,
    unassignedCommitted,
    scholarsWarning: (assigned.get("scholars") ?? 0) > SCHOLARS_CAP,
  };
}

/* --------------------------------------------------------- week activity */

export interface ThisWeekStats {
  notesAdded: number;
  callsLogged: number;
  dossiersReviewed: number;
  familiesAdded: number;
}

/** Staff activity within the selected week, from audit rows (brief §8 #6). */
export function computeThisWeekStats(
  auditRows: { action: string }[]
): ThisWeekStats {
  const count = (action: string) =>
    auditRows.filter((r) => r.action === action).length;
  return {
    notesAdded: count("note-add"),
    callsLogged: count("stamp-call"),
    dossiersReviewed: count("review-move"),
    familiesAdded: count("family-add"),
  };
}
