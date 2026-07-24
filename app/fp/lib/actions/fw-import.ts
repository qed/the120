"use server";

/**
 * The bulk-importer Server Actions (FW Unit 7; FW-R12, Decision 11, gaps G7/G19):
 * provision one CHUNK of a parsed roster, and close an import exception.
 *
 * Layering canon (transition.ts): gate → zod → authorize → decide (pure) →
 * mutate via the service-role core → interpret → typed result. Every decision
 * lives in `fw-import-rules.ts`; the sequence and its compensation live in
 * `fw-import-core.ts`; this file is the boundary and holds no policy of its own.
 *
 * ⚠️ VISIBILITY IS NOT AUTHORIZATION. The import surface renders only for
 * bridge-resolved staff, but that is a rendering decision with no security
 * content — Server Actions are HTTP endpoints, so both actions re-gate
 * server-side on `isFwStaffActor` (the ONE predicate for "may this session touch
 * ops"). Neither trusts a flag the caller passed.
 *
 * ── Chunked, not whole-file
 *
 * The client parses the CSV (the pure `fw-import-rules` code), previews it, and
 * calls `importFwStudentsChunk` once per chunk — because a ~90-account mint is far
 * past any serverless `maxDuration`, and the page that hosts this action sets its
 * own. The wire payload is the STRUCTURED rows (first/last/band), never the raw
 * CSV: the core recomputes the match key server-side and re-validates every row
 * through `provisionFwStudent`, so a hand-crafted request can do nothing a staff
 * quick-create could not already do.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { BANDS } from "@/app/fp/content/types";
import { isFwStaffActor } from "@/app/fp/lib/fw-access-rules";
import { resolveFwActorForCohort } from "@/app/fp/lib/fw-auth";
import {
  resolveFwImportException,
  runFwImportChunk,
  type ImportChunkActionResult,
  type ResolveImportExceptionActionResult,
} from "@/app/fp/lib/fw-import-core";

const GENERIC_ERROR = "Something went wrong — please try again.";
/** ONE message for every refusal shape — not staff, deactivated, Path cohort,
 *  unknown cohort — so probing cannot enumerate which cohort ids are real. */
const STAFF_ONLY = "That action is staff-only.";

/**
 * The cohort-scoped staff gate every action here runs first. Mirrors
 * `fw-ops.ts`'s `requireCohortStaff`: the actor id is written into an exception's
 * `created_by`/`resolved_by` (FKs to auth.users), so the explicit length check
 * turns "`isFwStaffActor` implies a real session id" into a runtime fact a future
 * edit cannot quietly break.
 */
async function requireCohortStaff(
  cohortId: string
): Promise<{ ok: true; actorUserId: string } | { ok: false }> {
  const { verdict, session } = await resolveFwActorForCohort(cohortId);
  if (!isFwStaffActor(verdict)) return { ok: false };
  if (typeof session.userId !== "string" || session.userId.length === 0) {
    console.error("[fw/import] staff verdict passed with no session user id — refusing");
    return { ok: false };
  }
  return { ok: true, actorUserId: session.userId };
}

/* ════════════════════════════════════════════════════════ chunk provisioning ══ */

/** One roster row on the wire. `normalizedName` is deliberately NOT accepted —
 *  the core recomputes it from the name, so the client cannot steer the match. */
const importRowSchema = z.object({
  rowNumber: z.number().int().nonnegative(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  band: z.enum(BANDS),
});

const importChunkSchema = z.object({
  cohortId: z.uuid(),
  // Bound the chunk server-side (defense in depth) so one call cannot be steered
  // past the page's maxDuration regardless of what the client sends.
  rows: z.array(importRowSchema).min(1).max(25),
});

/**
 * Provision one chunk of a parsed roster.
 *
 * Idempotent by construction: a row that matches a student already enrolled in
 * this cohort is skipped, so a re-sent chunk (a timeout, a retry) mints nothing
 * new. Each row's `normalizedName` is rebuilt here from its name before it reaches
 * the core, keeping ONE definition of the match key.
 */
export async function importFwStudentsChunk(input: unknown): Promise<ImportChunkActionResult> {
  const parsed = importChunkSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: GENERIC_ERROR };

  const gate = await requireCohortStaff(parsed.data.cohortId);
  if (!gate.ok) return { success: false, error: STAFF_ONLY };

  // The rows go straight through — no `normalizedName` is computed here. The core
  // recomputes the match key itself (never trusting a client-supplied one), so
  // pre-deriving it with the THROWING `buildNormalizedFwName` would let a single
  // unfoldable name in a hand-crafted request reject the whole chunk instead of
  // failing one row (kieran-typescript review).
  const { outcomes } = await runFwImportChunk(supabaseAdmin(), {
    cohortId: parsed.data.cohortId,
    actorUserId: gate.actorUserId,
    rows: parsed.data.rows,
  });

  revalidatePath(`/fp/fw/ops/cohort/${parsed.data.cohortId}`);
  return { success: true, outcomes };
}

/* ═══════════════════════════════════════════════════ close an import exception ══ */

const resolveExceptionSchema = z.object({
  cohortId: z.uuid(),
  exceptionId: z.uuid(),
  disposition: z.enum(["resolved", "dismissed"]),
});

/**
 * Close one pending import exception once staff have handled it — `resolved`
 * (they linked or created the student) or `dismissed` (noise). The core scopes the
 * write to this cohort and CAS's on `state='pending'`, so a forged id from another
 * weekend cannot be closed and a double-submit reads honestly as "already handled".
 */
export async function resolveImportExceptionAction(
  input: unknown
): Promise<ResolveImportExceptionActionResult> {
  const parsed = resolveExceptionSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: GENERIC_ERROR };

  const gate = await requireCohortStaff(parsed.data.cohortId);
  if (!gate.ok) return { success: false, error: STAFF_ONLY };

  const res = await resolveFwImportException(supabaseAdmin(), {
    exceptionId: parsed.data.exceptionId,
    cohortId: parsed.data.cohortId,
    actorUserId: gate.actorUserId,
    disposition: parsed.data.disposition,
    now: Date.now(),
  });
  if (!res.ok) {
    return {
      success: false,
      error:
        res.reason === "not_open"
          ? "That exception is already resolved — refresh the list."
          : GENERIC_ERROR,
    };
  }

  revalidatePath(`/fp/fw/ops/cohort/${parsed.data.cohortId}`);
  return { success: true };
}
