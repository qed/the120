import "server-only";

/**
 * The server-only read layer for the Unit 14 student surfaces: the shell's
 * student identity, the journey (territory map / phase ledger), and the task
 * detail view. Decisions live in `now-card-rules.ts` (tested); this file only
 * composes queries and narrows rows.
 *
 * FAIL LOUD, NEVER SILENT (the progress-loader posture): a query error or a
 * corrupt state string THROWS a labeled error; pages let Next's error boundary
 * catch it. A missing row is a legitimate "not found" and returns null.
 *
 * Every content lookup resolves through the STUDENT'S PINNED version (D27) via
 * `getProgram(ctx.programVersionId)` — never a "current"/"latest" global.
 */

// Side-effect: registers every generated program module so getProgram resolves
// a pinned version in THIS module graph (Unit 3 carry-forward, closed here).
import "@/app/fp/content/registry";
import { getProgram } from "@/app/fp/content/manifest";
import { evidenceSpecFor, type EvidenceSpec } from "@/app/fp/content/evidence-spec";
import { safetyFlagsFor, type SafetyFlag } from "@/app/fp/content/safety-flags";
import { logTemplateFor, type LogTemplate } from "@/app/fp/content/log-templates";
import { isStageMoment } from "@/app/fp/content/manifest";
import { resolveVariant } from "@/app/fp/content/parse-curriculum";
import type { Band, DeepReadonly, PhaseKey, ProgramContent } from "@/app/fp/content/types";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { resolvePathAccess, type RoleGrant } from "./access-rules";
import type { EvidenceItemView } from "./journey-view-types";
import { loadEvidenceViews } from "./evidence-loader";
import {
  DECISION_TRANSITIONS,
  decisionFromEvents,
  deriveCriterionView,
  deriveMutability,
  derivePhaseViews,
  journeyPresentation,
  latestReviewStateByCriterion,
  resolveTaskInProgram,
  selectNowCard,
  skinForBand,
  type CriterionView,
  type JourneyPresentation,
  type MutabilityRegime,
  type NowCandidate,
  type NowSelection,
  type PhaseView,
} from "./now-card-rules";
import { bandForGrade, firstNameFromChildJoin, gradeFromChildJoin, narrowTaskState } from "./progress-core";
import { loadStudentContext, type StudentContext } from "./progress-loader";
import type { Skin } from "./skin-tokens";
import type { TaskState } from "./transition-table";

type Db = ReturnType<typeof supabaseAdmin>;

/* ------------------------------------------------------------ student self */

export type StudentSelf = {
  ctx: StudentContext;
  firstName: string;
  grade: number | null;
  skin: Skin;
};

/**
 * Resolve the signed-in user's OWN student profile from their grants (the
 * `student`/`student` self-grant Unit 6 provisions). Null when the caller has
 * no student self-grant (a parent — their surfaces are Unit 15). The profile
 * id comes from the grant's scopeId; name and grade come from the roster join
 * (public.children stays authoritative, R31).
 */
export async function resolveStudentSelf(db: Db, grants: readonly RoleGrant[]): Promise<StudentSelf | null> {
  const selfGrant = grants.find((g) => g.role === "student" && g.scopeType === "student");
  if (!selfGrant) return null;

  const ctx = await loadStudentContext(db, selfGrant.scopeId);
  if (!ctx) return null; // grant to a since-deleted profile — treat as no student

  const { data, error } = await db
    .from("path_student_profiles")
    .select("id, children(first_name, grade)")
    .eq("id", ctx.studentId)
    .maybeSingle();
  if (error) throw new Error(`resolveStudentSelf(${ctx.studentId}) failed: ${error.message}`);
  if (!data) return null;

  // Both narrows share progress-core's tested join-shape helpers — never an
  // inline cast dance (Unit 14 review).
  const firstName = firstNameFromChildJoin(data.children) ?? "";
  const grade = gradeFromChildJoin(data.children);

  return { ctx, firstName, grade, skin: skinForBand(ctx.band ?? bandForGrade(grade)) };
}

/* ---------------------------------------------------------------- journey */

export type JourneyCriterion = {
  view: CriterionView;
  /** Task states in seq order, for the landmark pips / step rendering. */
  taskStates: Record<string, TaskState>;
};

export type Journey = {
  program: DeepReadonly<ProgramContent>;
  candidates: NowCandidate[];
  now: NowSelection;
  presentation: JourneyPresentation;
  verifiedTotal: number;
  totalTasks: number;
  /** Per-phase verified counts in phase order — ProgressMeter's perPhase. */
  perPhaseVerified: number[];
  phaseViews: PhaseView[];
  criteria: Record<string, JourneyCriterion>;
  /** review_opened_at per task id (null = unset) — withdraw legality (D6). */
  reviewOpenedAt: Record<string, string | null>;
};

type ProgressRowLite = {
  id: string;
  task_id: string;
  state: string;
  review_opened_at: string | null;
  updated_at: string | null;
};

/**
 * Load the whole journey for one student: all progress rows joined against the
 * pinned program, evidence touch times folded into recency, criterion reviews
 * folded into the map states, and the Now selection applied.
 */
export async function loadJourney(
  db: Db,
  ctx: StudentContext,
  opts: { pinnedTaskId: string | null }
): Promise<Journey> {
  const program = getProgram(ctx.programVersionId);

  const [progress, reviews, evidence] = await Promise.all([
    db
      .from("path_task_progress")
      .select("id, task_id, state, review_opened_at, updated_at")
      .eq("student_id", ctx.studentId),
    db
      .from("path_reviews")
      .select("scope_id, attempt, state")
      .eq("student_id", ctx.studentId)
      .eq("scope", "criterion"),
    db
      .from("path_evidence_items")
      .select("task_progress_id, created_at, updated_at, redacted_at")
      .eq("student_id", ctx.studentId),
  ]);
  const queryError = progress.error ?? reviews.error ?? evidence.error;
  if (queryError) throw new Error(`loadJourney(${ctx.studentId}) failed: ${queryError.message}`);

  const rows = (progress.data ?? []) as ProgressRowLite[];
  const rowByTask = new Map(rows.map((r) => [r.task_id, r]));

  // Latest review state per criterion — the pure, tested fold; dropped
  // (unrecognized) states are logged loudly, never coerced.
  const reviewFold = latestReviewStateByCriterion(
    (reviews.data ?? []).map((r) => ({
      scopeId: r.scope_id as string,
      attempt: r.attempt as number,
      state: r.state as string,
    }))
  );
  for (const drop of reviewFold.dropped) {
    console.error(`[path/journey] unrecognized review state for ${ctx.studentId}: ${drop}`);
  }

  // Fold evidence activity into per-task touch times (attaching IS touching,
  // even though no transition fires), and count non-redacted items.
  const progressIdToTask = new Map(rows.map((r) => [r.id, r.task_id]));
  const evidenceTouch = new Map<string, number>();
  let evidenceCount = 0;
  for (const e of evidence.data ?? []) {
    const taskId = progressIdToTask.get(e.task_progress_id as string);
    if (!taskId) continue;
    if (!e.redacted_at) evidenceCount++;
    for (const iso of [e.created_at as string | null, e.updated_at as string | null]) {
      const ms = iso ? Date.parse(iso) : NaN;
      if (!Number.isFinite(ms)) continue;
      const prev = evidenceTouch.get(taskId);
      if (prev === undefined || ms > prev) evidenceTouch.set(taskId, ms);
    }
  }

  // Join the pinned program against the rows: every task gets a candidate; a
  // missing row reads `locked` (not yet materialized); a corrupt state THROWS.
  const candidates: NowCandidate[] = [];
  const criteria: Record<string, JourneyCriterion> = {};
  const reviewOpenedAt: Record<string, string | null> = {};
  const perPhaseVerified: number[] = [];
  const phaseInputs: { id: string; criteria: CriterionView[] }[] = [];

  for (const phase of program.phases) {
    let phaseVerified = 0;
    const phaseCriteria: CriterionView[] = [];
    for (const criterion of phase.criteria) {
      const taskStates: Record<string, TaskState> = {};
      const states: TaskState[] = [];
      for (const task of criterion.tasks) {
        const row = rowByTask.get(task.id);
        let state: TaskState = "locked";
        if (row) {
          const narrowed = narrowTaskState(row.state);
          if (narrowed === null) {
            throw new Error(`loadJourney(${ctx.studentId}): corrupt state '${row.state}' on ${task.id}`);
          }
          state = narrowed;
        }
        taskStates[task.id] = state;
        states.push(state);
        if (state === "verified") phaseVerified++;
        reviewOpenedAt[task.id] = row?.review_opened_at ?? null;

        const rowMs = row?.updated_at ? Date.parse(row.updated_at) : NaN;
        const evMs = evidenceTouch.get(task.id);
        const touchedMs = Math.max(Number.isFinite(rowMs) ? rowMs : -1, evMs ?? -1);
        candidates.push({
          taskId: task.id,
          criterionId: criterion.id,
          criterionSeq: criterion.seq,
          seq: task.seq,
          state,
          lastTouchedAt: touchedMs >= 0 ? new Date(touchedMs).toISOString() : null,
        });
      }
      const view = deriveCriterionView({
        id: criterion.id,
        taskStates: states,
        review: reviewFold.states[criterion.id] ?? "none",
      });
      criteria[criterion.id] = { view, taskStates };
      phaseCriteria.push(view);
    }
    perPhaseVerified.push(phaseVerified);
    phaseInputs.push({ id: phase.num, criteria: phaseCriteria });
  }

  const verifiedTotal = perPhaseVerified.reduce((a, b) => a + b, 0);
  const totalTasks = candidates.length;

  return {
    program,
    candidates,
    now: selectNowCard({ candidates, pinnedTaskId: opts.pinnedTaskId }),
    presentation: journeyPresentation({ candidates, verifiedTotal, evidenceCount }),
    verifiedTotal,
    totalTasks,
    perPhaseVerified,
    phaseViews: derivePhaseViews(phaseInputs),
    criteria,
    reviewOpenedAt,
  };
}

/* ---------------------------------------------------------- view mapping */

import type { JourneyCriterionCard, JourneyPhaseCard, NowCardData } from "./journey-view-types";
import { splitCriterionLabel } from "./now-card-rules";

/**
 * Map a loaded Journey onto the serializable props the client views render.
 * Pure mapping — no I/O. The Now card resolves its band variant against the
 * student's LIVE band (the task page re-resolves against the frozen snapshot;
 * for a card teaser the live band is correct and cheap).
 */
export function buildJourneyView(journey: Journey, band: Band | null): {
  phases: JourneyPhaseCard[];
  now: NowCardData | null;
} {
  const phases: JourneyPhaseCard[] = journey.program.phases.map((phase, i) => {
    const view = journey.phaseViews[i];
    const criteria: JourneyCriterionCard[] = phase.criteria.map((criterion) => {
      const jc = journey.criteria[criterion.id];
      const label = splitCriterionLabel(criterion.passCriterion);
      return {
        id: criterion.id,
        seq: criterion.seq,
        title: label.title,
        detail: label.detail,
        status: jc.view.status,
        verifiedCount: jc.view.verifiedCount,
        taskTotal: jc.view.taskTotal,
      };
    });
    return {
      num: phase.num,
      key: phase.key,
      status: view.status,
      tasksVerified: view.tasksVerified,
      tasksTotal: view.tasksTotal,
      criteriaComplete: view.criteriaComplete,
      criteria,
    };
  });

  let now: NowCardData | null = null;
  if (journey.now.kind === "task") {
    const taskId = journey.now.taskId;
    // Both lookups are guaranteed to hit: selectNowCard only ever picks from
    // journey.candidates, which are built from this same program's tasks. A
    // miss would mean the invariant broke — fail loud, never render a
    // fabricated state (Unit 14 review).
    const hit = resolveTaskInProgram(journey.program, taskId);
    const candidate = journey.candidates.find((c) => c.taskId === taskId);
    if (!hit || !candidate) {
      throw new Error(`buildJourneyView: Now task ${taskId} not found in program/candidates`);
    }
    now = {
      taskId,
      criterionId: hit.criterion.id,
      criterionTitle: splitCriterionLabel(hit.criterion.passCriterion).title,
      title: hit.task.title,
      body: hit.task.body,
      doneWhen: hit.task.doneWhen,
      variant: band ? (resolveVariant(hit.task, band) ?? null) : null,
      state: candidate.state,
      phaseKey: hit.phase.key,
      liveMoment: isStageMoment(hit.criterion.id),
      pinned: journey.now.pinned,
      seq: hit.task.seq,
      taskTotal: hit.criterion.tasks.length,
    };
  }

  return { phases, now };
}

/* ------------------------------------------------------------- task detail */

export type TaskDetail = {
  taskId: string;
  criterionId: string;
  phaseKey: PhaseKey;
  phaseNum: string;
  title: string;
  body: string;
  doneWhen: string;
  /** The band-resolved variant line, if this task has one for this band. */
  variant: string | null;
  allBandsNote: string | null;
  seq: number;
  taskTotal: number;
  state: TaskState;
  mutability: MutabilityRegime;
  reviewOpenedAt: string | null;
  band: Band;
  liveMoment: boolean;
  safetyFlags: readonly SafetyFlag[];
  evidenceSpec: EvidenceSpec | null;
  logTemplate: LogTemplate | null;
  /** The latest reviewer decision note (verify comment / Not-Yet note). */
  decision: { kind: "verified" | "not_yet"; note: string } | null;
  evidence: EvidenceItemView[];
};

/**
 * Load one task's full spec-sheet view for a student. Returns null when the
 * task id does not exist in the student's pinned program — the page maps that
 * to `notFound()` (never a partial render). Access is the CALLER's job
 * (`requirePathUser` + resolvePathAccess on the profile); this re-runs the
 * per-item evidence check as defense in depth (Unit 10 carry-forward).
 */
export async function loadTaskDetail(
  db: Db,
  ctx: StudentContext,
  taskId: string,
  viewer: { userId: string; grants: readonly RoleGrant[] }
): Promise<TaskDetail | null> {
  const program = getProgram(ctx.programVersionId);
  // The pure, tested not-found contract: null when the task is not in the
  // student's pinned program — the page maps this to notFound().
  const hit = resolveTaskInProgram(program, taskId);
  if (!hit) return null;
  const { phase, criterion, task } = hit;
  const criterionId = criterion.id;

  const { data: row, error } = await db
    .from("path_task_progress")
    .select("id, state, review_opened_at, snapshot_band")
    .eq("student_id", ctx.studentId)
    .eq("task_id", taskId)
    .maybeSingle();
  if (error) throw new Error(`loadTaskDetail(${ctx.studentId}, ${taskId}) failed: ${error.message}`);

  let state: TaskState = "locked";
  if (row) {
    const narrowed = narrowTaskState(row.state);
    if (narrowed === null) {
      throw new Error(`loadTaskDetail(${ctx.studentId}): corrupt state '${row.state}' on ${taskId}`);
    }
    state = narrowed;
  }
  const reviewOpenedAt = row?.review_opened_at ?? null;

  // Band: the snapshot frozen at unlock wins (a live grade change never moves
  // an already-available task's variant); fall back to the live derived band.
  const snapshotBand = row?.snapshot_band as Band | null | undefined;
  const band: Band = snapshotBand ?? ctx.band ?? "g6_8";

  // The latest reviewer decision on this task (verifier comment / Not-Yet
  // note). The query filter is DECISION_TRANSITIONS — the same list the pure
  // decisionFromEvents narrows on, so the two can never drift (Unit 16's
  // live drill caught exactly that: a hand-listed filter here dropped
  // 'criterion_return' before the rules ever saw it, leaving a returned
  // task's chip with no explanation — the revoke omission's sibling).
  let decision: TaskDetail["decision"] = null;
  if (row) {
    const { data: events, error: evError } = await db
      .from("path_task_events")
      .select("transition, note, at")
      .eq("student_id", ctx.studentId)
      .eq("task_id", taskId)
      .in("transition", [...DECISION_TRANSITIONS])
      .order("at", { ascending: false })
      .limit(3);
    if (evError) throw new Error(`loadTaskDetail(${ctx.studentId}, ${taskId}) events failed: ${evError.message}`);
    decision = decisionFromEvents(
      (events ?? []).map((e) => ({
        transition: e.transition as string,
        note: typeof e.note === "string" && e.note.length > 0 ? e.note : null,
      }))
    );
  }

  // Evidence, with per-item access re-run (defense in depth on the READ path).
  let evidence: EvidenceItemView[] = [];
  if (row) {
    const views = await loadEvidenceViews(db, row.id as string);
    const target = {
      kind: "evidence" as const,
      studentId: ctx.studentId,
      familyId: ctx.familyId,
      cohortId: ctx.cohortId,
    };
    evidence = views
      .filter(() => resolvePathAccess({ session: { user: { id: viewer.userId } }, grants: viewer.grants, target }) === "ok")
      .map((v) => ({
        id: v.id,
        kind: v.kind,
        url: v.url,
        posterUrl: v.posterUrl,
        contentType: v.contentType,
        caption: v.caption,
        linkUrl: v.linkUrl,
        logRows: v.logRows,
        redactedAt: v.redactedAt,
        addedAfterVerification: v.addedAfterVerification,
      }));
  }

  return {
    taskId,
    criterionId,
    phaseKey: phase.key,
    phaseNum: phase.num,
    title: task.title,
    body: task.body,
    doneWhen: task.doneWhen,
    variant: resolveVariant(task, band) ?? null,
    allBandsNote: task.allBandsNote ?? null,
    seq: task.seq,
    taskTotal: criterion.tasks.length,
    state,
    mutability: deriveMutability(state, reviewOpenedAt),
    reviewOpenedAt,
    band,
    liveMoment: isStageMoment(criterionId),
    safetyFlags: safetyFlagsFor(taskId),
    evidenceSpec: evidenceSpecFor(taskId) ?? null,
    logTemplate: logTemplateFor(taskId) ?? null,
    decision,
    evidence,
  };
}
