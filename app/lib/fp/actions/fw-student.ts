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

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { supabaseAdmin } from "@/app/lib/supabase/admin";
import type { Band } from "@/app/lib/fp/content/types";
import { narrowFwBand } from "@/app/lib/fp/fw-provision-rules";
import { resolveFwActorForCohort } from "@/app/lib/fp/fw-auth";
import { isIdentityUnavailable } from "@/app/lib/identity-unavailable";
import {
  runFwMatchLookup,
  runFwQuickCreate,
  type FwMatchLookupActionResult,
  type FwQuickCreateActionResult,
} from "@/app/lib/fp/fw-student-core";
import { FW_MATCH_LOOKUP_RATE_LIMIT } from "@/app/lib/fp/rate-limit-rules";
import { checkAndRecordRateLimit } from "@/app/lib/fp/rate-limit-store";

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
  /** Retry-in-place handle from a previously failed leg. */
  existingProfileId: z.uuid().optional(),
});
// No `noticeAttested` field and deliberately NOT `.strict()` (2026-07-28,
// ops-guide redesign R17): the attestation checkbox is retired, and an old
// cached client that still posts `noticeAttested: true` mid-deploy must keep
// succeeding — zod's default unknown-key stripping is the skew tolerance.

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

  // Unit 5 (B4): an unreadable session THROWS from the resolver; here it becomes the
  // typed `unavailable` the client already renders as "That didn't go through. Try
  // again." — never `forbidden`, which is a verdict about the account this path did
  // not reach. Actions never throw (canon).
  let resolved;
  try {
    resolved = await resolveFwActorForCohort(cohortId);
  } catch (e) {
    if (isIdentityUnavailable(e)) {
      console.error(`[fw/student] actor resolve could not read identity: ${e.message}`);
      return { ok: false, reason: "unavailable" };
    }
    throw e;
  }
  const { verdict, session } = resolved;
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
 * Create a walk-in student, verify every leg, and only then route into the
 * tree (Decision 13) — the routing now happens HERE, via `redirect`, so the
 * mutation, the cache invalidation and the navigation are one round trip.
 * On success this action never resolves: callers see a NEXT_REDIRECT
 * rejection while the router navigates. Every `!ok` shape still returns the
 * typed result unchanged.
 *
 * The `headers()` call is what keeps this action out of any static render path;
 * it is also why this file cannot be unit-tested, which is why it does nothing
 * but delegate.
 */
export async function quickCreateFwStudent(input: unknown): Promise<FwQuickCreateActionResult> {
  const parsed = quickCreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_input" };
  const { cohortId, firstName, lastName, band, existingProfileId } = parsed.data;

  await headers(); // force dynamic; never prerendered

  // Unit 5 (B4): an unreadable session THROWS from the resolver; here it becomes the
  // typed `unavailable` the client already renders as "That didn't go through. Try
  // again." — never `forbidden`, which is a verdict about the account this path did
  // not reach. Actions never throw (canon).
  let resolved;
  try {
    resolved = await resolveFwActorForCohort(cohortId);
  } catch (e) {
    if (isIdentityUnavailable(e)) {
      console.error(`[fw/student] actor resolve could not read identity: ${e.message}`);
      return { ok: false, reason: "unavailable" };
    }
    throw e;
  }
  const { verdict, session } = resolved;
  if (!verdict.ok) {
    return {
      ok: false,
      reason: verdict.reason === "no_session" ? "no_session" : "forbidden",
    };
  }

  const created = await runFwQuickCreate(supabaseAdmin(), {
    firstName,
    lastName,
    band,
    cohortId,
    // The AUTHORITATIVE session id, never a client field: it is what lands in
    // `notice_attested_by` — since 2026-07-28 a silent provenance stamp of the
    // guide who quick-created the row (the notice itself is covered by online
    // registration), and the discriminator the unfinished-student banner keys on.
    actorUserId: session.userId,
    existingProfileId: existingProfileId ?? null,
  });
  if (!created.ok) {
    // A retryable failure (the presence of `retryProfileId` is the one
    // definition of that set) just left a half-created student behind — the
    // roster's unfinished-student banner is derived server-side, so revalidate
    // the roster now and the banner is there the moment the guide dismisses
    // the form, not only after the next full load (todo 001).
    if (created.retryProfileId) revalidatePath(`/fp/fw/cohort/${cohortId}`);
    return created;
  }

  // Success navigates FROM HERE, not from the client (2026-07-28 work order,
  // RC-1): the old client-side `router.push` + `router.refresh` pair raced —
  // the push painted the destination from the client cache before the refresh
  // landed, and the roster/search never saw the new student without a reload.
  // `revalidatePath` invalidates both surfaces that list students, and the
  // redirect's 303 carries fresh RSC for the destination in the same round
  // trip. `redirect()` throws NEXT_REDIRECT by design, so it sits OUTSIDE any
  // try/catch (canon: app/start/page.tsx, funnel-child-rules.test.ts:341).
  revalidatePath(`/fp/fw/cohort/${cohortId}`);
  revalidatePath(`/fp/fw/ops/cohort/${cohortId}`);
  redirect(`/fp/fw/cohort/${cohortId}/student/${created.studentId}`);
}
