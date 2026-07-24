"use server";

/**
 * Typed read-model wrappers over the journey read layer (T1 Unit 15; the
 * Unit 14 agent-native carry-forward). Any position a user can SEE, an agent
 * (or a future client surface) can fetch through these — gated exactly like
 * the pages: requirePathUser + resolvePathAccess against the AUTHORITATIVE
 * profile row, never a client-trusted id.
 *
 * NO UI CONSUMER BY DESIGN: the RSC pages call the server-only loaders
 * directly (the repo idiom — an RSC gains nothing from routing its own reads
 * through an action). These exist for PROGRAMMATIC callers; being callable is
 * the feature. family-read.ts is the sibling surface for family/roster/invite
 * discovery.
 *
 * ⚠️ `"use server"` boundary rules (docs/solutions/runtime-errors/use-server-
 * type-reexport-registers-server-reference-referenceerror-2026-07-22.md):
 * ONLY async functions are exported — never types (even `export type` emits a
 * registerServerReference and throws at module load). Result shapes are
 * structural; callers use the `{ok, reason}` family (unwrapActionResult
 * handles both families client-side).
 */

import { z } from "zod";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { requirePathUser } from "@/app/fp/lib/auth";
import { resolvePathAccess } from "@/app/fp/lib/access-rules";
import {
  buildJourneyView,
  loadJourney,
  loadTaskDetail,
  resolveStudentSelf,
} from "@/app/fp/lib/journey-loader";
import { loadStudentContext, type StudentContext } from "@/app/fp/lib/progress-loader";
import { narrowTaskState } from "@/app/fp/lib/progress-core";
import { resolveTaskProgress } from "@/app/fp/lib/evidence-loader";

const journeySchema = z.object({ studentId: z.uuid().optional() });
const taskSchema = z.object({ taskId: z.string().regex(/^\d+\.\d+\.\d+$/), studentId: z.uuid().optional() });

/** Resolve the target student: the caller's own profile by default, or an
 *  explicit studentId checked through resolvePathAccess for the given kind. */
async function resolveTarget(
  db: ReturnType<typeof supabaseAdmin>,
  viewer: { userId: string; grants: Awaited<ReturnType<typeof requirePathUser>>["grants"] },
  studentId: string | undefined,
  kind: "position" | "evidence"
): Promise<{ ok: true; ctx: StudentContext } | { ok: false; reason: "not_found" | "forbidden" }> {
  if (!studentId) {
    const self = await resolveStudentSelf(db, viewer.grants);
    if (!self) return { ok: false, reason: "not_found" };
    return { ok: true, ctx: self.ctx };
  }
  const ctx = await loadStudentContext(db, studentId);
  if (!ctx) return { ok: false, reason: "not_found" };
  const verdict = resolvePathAccess({
    session: { user: { id: viewer.userId } },
    grants: viewer.grants,
    target: { kind, studentId: ctx.studentId, familyId: ctx.familyId, cohortId: ctx.cohortId },
  });
  if (verdict !== "ok") return { ok: false, reason: "forbidden" };
  return { ok: true, ctx };
}

/**
 * The journey read: phases, criteria statuses, the Now card, and totals for
 * the caller's own journey (no studentId) or any student their grants can see
 * at POSITION level (self, either parent, a sibling, a cohort guide).
 */
export async function getJourney(input?: unknown) {
  const viewer = await requirePathUser();
  const parsed = journeySchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false as const, reason: "invalid" as const };

  const db = supabaseAdmin();
  const target = await resolveTarget(db, viewer, parsed.data.studentId, "position");
  if (!target.ok) return { ok: false as const, reason: target.reason };

  const journey = await loadJourney(db, target.ctx, { pinnedTaskId: null });
  const { phases, now } = buildJourneyView(journey, target.ctx.band);
  return {
    ok: true as const,
    data: {
      studentId: target.ctx.studentId,
      presentation: journey.presentation,
      verifiedTotal: journey.verifiedTotal,
      totalTasks: journey.totalTasks,
      perPhaseVerified: journey.perPhaseVerified,
      phases,
      now,
    },
  };
}

/**
 * The LIGHT task-state read (T1 Unit 11): the sync engine's rebase reads the
 * task's CURRENT server state before replaying a queued submit — `getTaskDetail`
 * would drag the whole spec sheet (evidence rows, signed-URL upkeep) along for
 * one field. Evidence-level access (the drain acts on evidence). `not_found`
 * covers both an unknown task id and an unprovisioned one — the queue drops the
 * entry with a surfaced note either way.
 */
export async function getTaskState(input: unknown) {
  const viewer = await requirePathUser();
  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, reason: "invalid" as const };

  const db = supabaseAdmin();
  const target = await resolveTarget(db, viewer, parsed.data.studentId, "evidence");
  if (!target.ok) return { ok: false as const, reason: target.reason };

  let row: { id: string; state: string } | null;
  try {
    row = await resolveTaskProgress(db, target.ctx.studentId, parsed.data.taskId);
  } catch (e) {
    console.error(`[path/getTaskState] read failed for ${parsed.data.taskId}:`, e);
    return { ok: false as const, reason: "unavailable" as const };
  }
  if (!row) return { ok: false as const, reason: "not_found" as const };
  const state = narrowTaskState(row.state);
  if (state === null) {
    console.error(`[path/getTaskState] corrupt state '${row.state}' on ${parsed.data.taskId}`);
    return { ok: false as const, reason: "unavailable" as const };
  }
  return { ok: true as const, data: { studentId: target.ctx.studentId, taskId: parsed.data.taskId, state } };
}

/**
 * The task-detail read: the full spec-sheet view including evidence — the
 * EVIDENCE-level check applies (siblings refused, parents and self pass,
 * guides per D25).
 */
export async function getTaskDetail(input: unknown) {
  const viewer = await requirePathUser();
  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, reason: "invalid" as const };

  const db = supabaseAdmin();
  const target = await resolveTarget(db, viewer, parsed.data.studentId, "evidence");
  if (!target.ok) return { ok: false as const, reason: target.reason };

  const detail = await loadTaskDetail(db, target.ctx, parsed.data.taskId, {
    userId: viewer.userId,
    grants: viewer.grants,
  });
  if (!detail) return { ok: false as const, reason: "not_found" as const };
  return { ok: true as const, data: detail };
}
