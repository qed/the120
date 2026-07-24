import "server-only";

/**
 * The server-only read layer for the Unit 12 review queue: every submitted
 * task across the family's students (each with its Done-when line, evidence,
 * and waiting time) plus every criterion review underway (the §9.3 ceremony's
 * pre-read). Follows the journey/family-loader posture — FAIL LOUD on query
 * errors, decisions live in pure modules, loader output types ARE the
 * component prop types.
 *
 * Two Unit 12 derivations happen HERE, server-side, so the client renders
 * flags rather than re-deriving:
 *   * `arrivedAfterReviewOpened` — evidence `created_at` vs the progress row's
 *     `review_opened_at` (NO new column; the Unit 14 carry-forward). False
 *     whenever the review has never opened.
 *   * `addedAfterVerification` — already stored/repaired by Units 10/11; the
 *     view passes it through for the reviewer chip.
 */

import { supabaseAdmin } from "@/app/lib/supabase/admin";
// Side-effect: registers generated program modules for getProgram.
import "@/app/fp/content/registry";
import { getProgram } from "@/app/fp/content/manifest";
import { resolveVariant } from "@/app/fp/content/parse-curriculum";
import type { Band, UnitTask } from "@/app/fp/content/types";
import { resolvePathAccess, type RoleGrant } from "./access-rules";
import { loadEvidenceViews } from "./evidence-loader";
import { evidenceFingerprint } from "./evidence-rules";
import type { EvidenceItemView } from "./journey-view-types";
import { NUDGE_DEFAULT_THRESHOLD_HOURS } from "./notify/notify-rules";
import { splitCriterionLabel } from "./now-card-rules";
import { bandForGrade, gradeFromChildJoin, firstNameFromChildJoin } from "./progress-core";

type Db = ReturnType<typeof supabaseAdmin>;

export type ReviewEvidenceItem = EvidenceItemView & {
  /** created_at > review_opened_at — evidence that landed after the criterion
   *  review opened (Decision 10: evidence always attaches; never invisible). */
  arrivedAfterReviewOpened: boolean;
};

export type ReviewQueueTask = {
  studentId: string;
  studentName: string;
  band: Band;
  taskId: string;
  criterionId: string;
  title: string;
  doneWhen: string;
  /** Band-resolved variant line, when the task has one for this student. */
  variant: string | null;
  seq: number;
  taskTotal: number;
  submitReceivedAt: string | null;
  /** Whole hours since submit_received_at; null when the timestamp is absent. */
  waitingHours: number | null;
  evidence: ReviewEvidenceItem[];
  /** The evidence-set fingerprint at LOAD time — threaded through the verify
   *  click so the action can refuse with `evidence_changed` if a withdraw +
   *  resubmit swapped the set under the reviewer's open tab (TOCTOU guard). */
  evidenceFingerprint: string;
};

export type ReviewQueueCriterion = {
  studentId: string;
  studentName: string;
  criterionId: string;
  criterionTitle: string;
  attempt: number;
  openedAt: string;
  /** Every task of the criterion (all verified while review_underway) — the
   *  return ceremony's picker. */
  tasks: { id: string; title: string; seq: number }[];
};

export type ReviewQueue = {
  tasks: ReviewQueueTask[];
  criteria: ReviewQueueCriterion[];
  /** parent userId → first name, for the superseded copy ("Sarah verified
   *  this at 7:42pm"). */
  parentNames: Record<string, string>;
  /** The family's stall threshold — the queue renders waits past it amber. */
  nudgeThresholdHours: number;
};

type ProfileRow = {
  id: string;
  programVersionId: string;
  cohortId: string | null;
  firstName: string;
  band: Band | null;
};

/** Find a task (with its criterion context) in a pinned program. */
function findTask(
  programVersionId: string,
  taskId: string
): { task: UnitTask; criterionId: string; criterionTitle: string; taskTotal: number } | null {
  const program = getProgram(programVersionId);
  for (const phase of program.phases) {
    for (const criterion of phase.criteria) {
      const task = criterion.tasks.find((t) => t.id === taskId);
      if (task) {
        return {
          task: task as UnitTask,
          criterionId: criterion.id,
          criterionTitle: splitCriterionLabel(criterion.passCriterion).title,
          taskTotal: criterion.tasks.length,
        };
      }
    }
  }
  return null;
}

/**
 * Load the family's whole review queue for a verifying parent. `family` comes
 * from `resolveParentFamily` (the caller's own grant, never a client param).
 */
export async function loadReviewQueue(
  db: Db,
  family: { familyId: string; parentUserIds: string[] },
  viewer: { userId: string; grants: readonly RoleGrant[] }
): Promise<ReviewQueue> {
  const nowMs = Date.now();

  const [profilesRes, familyRes, parentsRes] = await Promise.all([
    db
      .from("path_student_profiles")
      .select("id, program_version_id, cohort_id, children(first_name, grade)")
      .eq("family_id", family.familyId),
    db.from("path_families").select("review_nudge_hours").eq("id", family.familyId).maybeSingle(),
    family.parentUserIds.length > 0
      ? db.from("parents").select("id, first_name").in("id", family.parentUserIds)
      : Promise.resolve({ data: [], error: null } as const),
  ]);
  if (profilesRes.error) {
    throw new Error(`loadReviewQueue(${family.familyId}) profiles failed: ${profilesRes.error.message}`);
  }
  if (familyRes.error) {
    throw new Error(`loadReviewQueue(${family.familyId}) family failed: ${familyRes.error.message}`);
  }
  if (parentsRes.error) {
    throw new Error(`loadReviewQueue(${family.familyId}) parents failed: ${parentsRes.error.message}`);
  }

  const profiles = new Map<string, ProfileRow>();
  for (const row of profilesRes.data ?? []) {
    profiles.set(row.id as string, {
      id: row.id as string,
      programVersionId: row.program_version_id as string,
      cohortId: (row.cohort_id as string | null) ?? null,
      firstName: firstNameFromChildJoin(row.children) ?? "",
      band: bandForGrade(gradeFromChildJoin(row.children)),
    });
  }
  const studentIds = [...profiles.keys()];

  const nudgeHours = familyRes.data?.review_nudge_hours;
  const parentNames: Record<string, string> = {};
  for (const p of parentsRes.data ?? []) {
    if (typeof p.first_name === "string" && p.first_name.length > 0) {
      parentNames[p.id as string] = p.first_name;
    }
  }

  if (studentIds.length === 0) {
    return {
      tasks: [],
      criteria: [],
      parentNames,
      nudgeThresholdHours:
        typeof nudgeHours === "number" && nudgeHours > 0 ? nudgeHours : NUDGE_DEFAULT_THRESHOLD_HOURS,
    };
  }

  const [submittedRes, reviewsRes] = await Promise.all([
    db
      .from("path_task_progress")
      .select("id, student_id, task_id, snapshot_band, submit_received_at, review_opened_at")
      .in("student_id", studentIds)
      .eq("state", "submitted")
      .order("submit_received_at", { ascending: true }),
    db
      .from("path_reviews")
      .select("id, student_id, scope_id, attempt, opened_at")
      .in("student_id", studentIds)
      .eq("scope", "criterion")
      .eq("state", "review_underway")
      .order("opened_at", { ascending: true }),
  ]);
  if (submittedRes.error) {
    throw new Error(`loadReviewQueue(${family.familyId}) submitted failed: ${submittedRes.error.message}`);
  }
  if (reviewsRes.error) {
    throw new Error(`loadReviewQueue(${family.familyId}) reviews failed: ${reviewsRes.error.message}`);
  }

  // Evidence loads concurrently per submitted task (the loadEvidenceViews
  // remint batch is the expensive part; a serial loop would pay it N times).
  const tasks = (
    await Promise.all(
      (submittedRes.data ?? []).map(async (row): Promise<ReviewQueueTask | null> => {
        const studentId = row.student_id as string;
        const profile = profiles.get(studentId);
        if (!profile) return null; // vanished mid-read — skip, logged below
        const taskId = row.task_id as string;
        const hit = findTask(profile.programVersionId, taskId);
        if (!hit) {
          console.error(
            `[path/review] submitted task ${taskId} not in ${profile.programVersionId} for ${studentId} — skipped`
          );
          return null;
        }

        // Per-student evidence access, re-run on the READ path (defense in
        // depth — the Unit 10 carry). One check per task: the target is
        // constant across its items.
        const canReadEvidence =
          resolvePathAccess({
            session: { user: { id: viewer.userId } },
            grants: viewer.grants,
            target: {
              kind: "evidence",
              studentId,
              familyId: family.familyId,
              cohortId: profile.cohortId,
            },
          }) === "ok";

        const reviewOpenedAt = (row.review_opened_at as string | null) ?? null;
        const openedMs = reviewOpenedAt ? Date.parse(reviewOpenedAt) : NaN;

        // Fingerprint from the SAME query shape the verify action recomputes
        // (id, updated_at, created_at over ALL rows — no view-layer filtering),
        // so load-time and click-time inputs can never diverge structurally.
        const { data: fpRows, error: fpError } = await db
          .from("path_evidence_items")
          .select("id, updated_at, created_at")
          .eq("task_progress_id", row.id as string);
        if (fpError) {
          throw new Error(`loadReviewQueue fingerprint read failed: ${fpError.message}`);
        }
        const fingerprint = evidenceFingerprint(
          (fpRows ?? []).map((r) => ({
            id: r.id as string,
            updatedAt: (r.updated_at as string | null) ?? null,
            createdAt: r.created_at as string,
          }))
        );

        let evidence: ReviewEvidenceItem[] = [];
        if (canReadEvidence) {
          const views = await loadEvidenceViews(db, row.id as string);
          evidence = views.map((v) => {
            const createdMs = Date.parse(v.createdAt);
            return {
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
              arrivedAfterReviewOpened:
                Number.isFinite(openedMs) && Number.isFinite(createdMs) && createdMs > openedMs,
            };
          });
        }

        const rawBand = row.snapshot_band;
        // Fail-closed band narrowing (the narrowTaskState idiom) — a corrupt
        // value falls back to the derived band, never resolves a wrong variant.
        const snapshotBand: Band | null =
          rawBand === "g3_5" || rawBand === "g6_8" || rawBand === "g9_12" ? rawBand : null;
        const band: Band = snapshotBand ?? profile.band ?? "g6_8";
        const submitReceivedAt = (row.submit_received_at as string | null) ?? null;
        const submitMs = submitReceivedAt ? Date.parse(submitReceivedAt) : NaN;
        return {
          studentId,
          studentName: profile.firstName,
          band,
          taskId,
          criterionId: hit.criterionId,
          title: hit.task.title,
          doneWhen: hit.task.doneWhen,
          variant: resolveVariant(hit.task, band) ?? null,
          seq: hit.task.seq,
          taskTotal: hit.taskTotal,
          submitReceivedAt,
          waitingHours: Number.isFinite(submitMs) ? Math.max(0, Math.floor((nowMs - submitMs) / 3600_000)) : null,
          evidence,
          evidenceFingerprint: fingerprint,
        };
      })
    )
  ).filter((t): t is ReviewQueueTask => t !== null);

  const criteria: ReviewQueueCriterion[] = [];
  for (const row of reviewsRes.data ?? []) {
    const studentId = row.student_id as string;
    const profile = profiles.get(studentId);
    if (!profile) continue;
    const criterionId = row.scope_id as string;
    const program = getProgram(profile.programVersionId);
    const criterion = program.phases.flatMap((p) => p.criteria).find((c) => c.id === criterionId);
    if (!criterion) {
      console.error(
        `[path/review] review ${String(row.id)} names criterion ${criterionId} not in ${profile.programVersionId} — skipped`
      );
      continue;
    }
    criteria.push({
      studentId,
      studentName: profile.firstName,
      criterionId,
      criterionTitle: splitCriterionLabel(criterion.passCriterion).title,
      attempt: row.attempt as number,
      openedAt: row.opened_at as string,
      tasks: criterion.tasks.map((t) => ({ id: t.id, title: t.title, seq: t.seq })),
    });
  }

  return {
    tasks,
    criteria,
    parentNames,
    nudgeThresholdHours:
        typeof nudgeHours === "number" && nudgeHours > 0 ? nudgeHours : NUDGE_DEFAULT_THRESHOLD_HOURS,
  };
}
