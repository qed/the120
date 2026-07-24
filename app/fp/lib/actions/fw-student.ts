"use server";

/**
 * Quick-create's Server Actions (FW Unit 4) — the same canon as every other
 * action in this repo: gate → zod → authorize → delegate → typed result.
 *
 * DELIBERATELY THIN, for the reason this repo has now written down twice: it
 * cannot unit-test a `"use server"` module (it imports `next/headers`, which
 * does not run outside the Next runtime), and both Unit 2 and Unit 3 shipped a
 * P1 that lived in exactly that blind spot. Everything decision-bearing is one
 * line away in a plain module with its own harness:
 *
 *   - `resolveFwActorForCohort` (fw-auth.ts)        — may this caller act HERE
 *   - `runFwMatchLookup`        (fw-student-core.ts) — PROPOSED-1's whole lookup
 *   - `runFwQuickCreate`        (fw-student-core.ts) — provision + leg verification
 *
 * No type re-exports: even a `export type { … }` from a "use server" file emits
 * a `registerServerReference()` that throws at module load and takes every
 * action in the file down with it (docs/solutions/runtime-errors/use-server-
 * type-reexport-registers-server-reference-…-2026-07-22.md). Callers import the
 * result types from `fw-student-core.ts`.
 */

import { headers } from "next/headers";
import { z } from "zod";

import { supabaseAdmin } from "@/app/lib/supabase/admin";
import type { Band } from "@/app/fp/content/types";
import { narrowFwBand } from "@/app/fp/lib/fw-provision-rules";
import { resolveFwActorForCohort } from "@/app/fp/lib/fw-auth";
import {
  runFwMatchLookup,
  runFwQuickCreate,
  type FwMatchLookupActionResult,
  type FwQuickCreateActionResult,
} from "@/app/fp/lib/fw-student-core";
import { FW_MATCH_LOOKUP_RATE_LIMIT } from "@/app/fp/lib/rate-limit-rules";
import { checkAndRecordRateLimit } from "@/app/fp/lib/rate-limit-store";

/** Names are typed by a guide at a table, so the bounds are generous but
 *  present — an unbounded field reaches a normalizer that walks every code
 *  point and a column that stores what it produces. */
const nameField = z.string().trim().min(1).max(80);

const matchLookupSchema = z.object({
  cohortId: z.uuid(),
  firstName: nameField,
  lastName: nameField,
});

const quickCreateSchema = matchLookupSchema.extend({
  /**
   * Validated through `narrowFwBand` — the SAME predicate the loaders use at the
   * service-role boundary — rather than `z.enum(BANDS as unknown as …)`. The
   * double cast erased the literal union on the way in, so `parsed.data.band`
   * came out as plain `string` and had to be cast back to `Band` at the call
   * site: a bare assertion on the one value a student's record is permanently
   * stamped with (kieran-typescript review). This keeps one definition of "is
   * this a band?" and yields a properly-typed `Band`.
   */
  band: z.string().transform((value, ctx): Band => {
    const band = narrowFwBand(value);
    if (band === null) {
      ctx.addIssue({ code: "custom", message: "unknown grade band" });
      return z.NEVER;
    }
    return band;
  }),
  /**
   * Decision 13. Parsed as a LITERAL true rather than a boolean, so an unticked
   * attestation is refused at the schema — a form that posts `false` is not a
   * submission with a missing field, it is a submission that must not happen.
   * `runFwQuickCreate` re-checks anyway; two refusals, neither load-bearing
   * alone.
   */
  noticeAttested: z.literal(true),
  /** Retry-in-place handle from a previously failed leg. */
  existingProfileId: z.uuid().optional(),
});

/**
 * PROPOSED-1: does a student by this name already exist?
 *
 * Rate-limited per guide and logged. The lookup is a name-probe oracle for
 * whoever holds a guide session, and while its cross-cohort answer deliberately
 * carries nothing identifying, "yes/no by typed name" is still an answer worth
 * bounding.
 */
export async function lookupFwStudentMatch(input: unknown): Promise<FwMatchLookupActionResult> {
  const parsed = matchLookupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_input" };
  const { cohortId, firstName, lastName } = parsed.data;

  const { verdict, session } = await resolveFwActorForCohort(cohortId);
  if (!verdict.ok) {
    // `cohort_not_found`, `cohort_not_fw` and `not_a_guide` collapse to one
    // answer: distinguishing them would tell a caller which cohort ids are real.
    return {
      ok: false,
      reason: verdict.reason === "no_session" ? "no_session" : "forbidden",
    };
  }

  // Keyed on the AUTHORITATIVE session id, only reachable past the gate above —
  // `session.userId` is a synthetic "" on the no-session path, which the
  // `verdict.ok` check has already excluded.
  if (!checkAndRecordRateLimit(`fw-match-lookup:${session.userId}`, FW_MATCH_LOOKUP_RATE_LIMIT).allowed) {
    console.warn(`[fw/student] match lookup rate-limited for ${session.userId}`);
    return { ok: false, reason: "rate_limited" };
  }
  console.info(`[fw/student] match lookup by ${session.userId} in cohort ${cohortId}`);

  return runFwMatchLookup(supabaseAdmin(), { firstName, lastName, cohortId });
}

/**
 * Create a walk-in student and verify every leg before the caller routes into
 * the tree (Decision 13).
 *
 * The `headers()` call is what keeps this action out of any static render path;
 * it is also why this file cannot be unit-tested, which is why it does nothing
 * but delegate.
 */
export async function quickCreateFwStudent(input: unknown): Promise<FwQuickCreateActionResult> {
  const parsed = quickCreateSchema.safeParse(input);
  if (!parsed.success) {
    // An unticked attestation lands here (schema `literal(true)`), and it gets
    // its own reason rather than a generic one — the form has copy for it.
    const attestationMissing = parsed.error.issues.some((i) => i.path[0] === "noticeAttested");
    return { ok: false, reason: attestationMissing ? "notice_not_attested" : "invalid_input" };
  }
  const { cohortId, firstName, lastName, band, existingProfileId } = parsed.data;

  await headers(); // force dynamic; never prerendered

  const { verdict, session } = await resolveFwActorForCohort(cohortId);
  if (!verdict.ok) {
    return {
      ok: false,
      reason: verdict.reason === "no_session" ? "no_session" : "forbidden",
    };
  }

  return runFwQuickCreate(supabaseAdmin(), {
    firstName,
    lastName,
    band,
    cohortId,
    // The AUTHORITATIVE session id, never a client field: it is what lands in
    // `notice_attested_by`, which is the record of who said the family saw the
    // program notice.
    actorUserId: session.userId,
    noticeAttested: true,
    existingProfileId: existingProfileId ?? null,
  });
}
