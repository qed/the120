import "server-only";

/**
 * The server-only read layer for the R27 in-app notification surface
 * (T1 Unit 16). Unit 12 stored `path_notification_events`; this is its FIRST
 * reader. Follows the journey/review-loader posture — FAIL LOUD on query
 * errors, every decision in the pure `celebration-tier1-rules` module, loader
 * output types ARE the component prop types.
 *
 * Register discipline (R27): rows carry kind + params, never rendered copy.
 * The caller passes the CURRENT skin (band-derived at the shell root) and the
 * rules resolve the register at read time — an event queued under Trail and
 * read in HQ renders HQ.
 *
 * Subjects resolve through the student's PINNED program version (D27) — a
 * task no longer in their program yields the skip-with-a-note item, never a
 * blank card and never a throw.
 */

import { supabaseAdmin } from "@/app/lib/supabase/admin";
// Side-effect: registers generated program modules for getProgram.
import "@/app/fp/content/registry";
import { getProgram } from "@/app/fp/content/manifest";
import {
  buildFeed,
  planReplay,
  type FeedEventRow,
  type FeedItem,
  type Moment,
  type ProgramResolvers,
} from "./celebration-tier1-rules";
import { resolveTaskInProgram, splitCriterionLabel } from "./now-card-rules";
import type { StudentContext } from "./progress-loader";
import type { Skin } from "./skin-tokens";

type Db = ReturnType<typeof supabaseAdmin>;

/** The feed read is capped generously — a T1 student produces a few hundred
 *  events a YEAR (125 verifies + review ceremonies). Revisit with T2's
 *  recaps/wisdom if the volume model changes. */
const FEED_ROW_CAP = 400;

export type NotificationFeed = {
  items: FeedItem[];
  /** Unseen ids in the loaded window — the page's mount effect stamps them. */
  unseenIds: string[];
};

export type ReplayPlan = {
  moments: Moment[];
  /** Unseen events that must advance the cursor WITHOUT playing (superseded /
   *  unresolvable) — stamped alongside the played moments. */
  stampWithoutPlaying: string[];
};

/** Program-pinned resolvers for the rules (D27 — never a "latest" global). */
function resolversFor(programVersionId: string): ProgramResolvers {
  const program = getProgram(programVersionId);
  return {
    taskTitle: (taskId) => resolveTaskInProgram(program, taskId)?.task.title ?? null,
    criterionTitle: (criterionId) => {
      for (const phase of program.phases) {
        const criterion = phase.criteria.find((c) => c.id === criterionId);
        if (criterion) return splitCriterionLabel(criterion.passCriterion).title;
      }
      return null;
    },
  };
}

function totalTasksOf(programVersionId: string): number {
  return getProgram(programVersionId).phases.reduce(
    (sum, phase) => sum + phase.criteria.reduce((s, c) => s + c.tasks.length, 0),
    0
  );
}

type EventRow = {
  id: string;
  kind: string;
  task_id: string | null;
  scope_id: string | null;
  params: unknown;
  occurred_at: string | null;
  superseded_at: string | null;
  seen_at: string | null;
  created_at: string;
};

function toFeedEventRow(row: EventRow): FeedEventRow {
  return {
    id: row.id,
    kind: row.kind,
    taskId: row.task_id,
    scopeId: row.scope_id,
    params: row.params,
    occurredAt: row.occurred_at,
    supersededAt: row.superseded_at,
    seenAt: row.seen_at,
    createdAt: row.created_at,
  };
}

const EVENT_COLUMNS = "id, kind, task_id, scope_id, params, occurred_at, superseded_at, seen_at, created_at";

/** The student's verified-task count — the moment's truthful meter. */
async function loadVerifiedCount(db: Db, studentId: string): Promise<number> {
  const { count, error } = await db
    .from("path_task_progress")
    .select("id", { count: "exact", head: true })
    .eq("student_id", studentId)
    .eq("state", "verified");
  if (error) throw new Error(`[path/notifications-loader] verified count failed: ${error.message}`);
  return count ?? 0;
}

/**
 * The full feed for /fp/notifications — newest first, register resolved
 * from `skin` at read time. (The cap orders on created_at server-side; the
 * rules re-order by the coalesced source moment client of the cap.)
 */
export async function loadNotificationFeed(db: Db, ctx: StudentContext, skin: Skin): Promise<NotificationFeed> {
  const { data, error } = await db
    .from("path_notification_events")
    .select(EVENT_COLUMNS)
    .eq("student_id", ctx.studentId)
    .order("created_at", { ascending: false })
    .limit(FEED_ROW_CAP);
  if (error) throw new Error(`[path/notifications-loader] feed load failed: ${error.message}`);

  const rows = ((data ?? []) as EventRow[]).map(toFeedEventRow);
  const items = buildFeed({ rows, resolvers: resolversFor(ctx.programVersionId), skin });
  return { items, unseenIds: rows.filter((r) => r.seenAt === null).map((r) => r.id) };
}

/**
 * The replay for the moment host (the app-shell layout): every unseen event,
 * planned into ordered moments + the stamp-without-playing remainder. Loads
 * the verified count only when something will actually play a meter.
 */
export async function loadReplayPlan(db: Db, ctx: StudentContext, skin: Skin): Promise<ReplayPlan> {
  const { data, error } = await db
    .from("path_notification_events")
    .select(EVENT_COLUMNS)
    .eq("student_id", ctx.studentId)
    .is("seen_at", null)
    .order("created_at", { ascending: true })
    .limit(FEED_ROW_CAP);
  if (error) throw new Error(`[path/notifications-loader] replay load failed: ${error.message}`);

  const rows = ((data ?? []) as EventRow[]).map(toFeedEventRow);
  if (rows.length === 0) return { moments: [], stampWithoutPlaying: [] };

  const verifiedCount = await loadVerifiedCount(db, ctx.studentId);
  const plan = planReplay({
    rows,
    resolvers: resolversFor(ctx.programVersionId),
    skin,
    verifiedCount,
    totalTasks: totalTasksOf(ctx.programVersionId),
  });
  return { moments: plan.moments, stampWithoutPlaying: plan.stampWithoutPlaying };
}
