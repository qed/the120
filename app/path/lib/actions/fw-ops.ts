"use server";

/**
 * The staff ops Server Actions (FW Unit 5; FW-R4, FW-R23, FW-R25, FW-D14;
 * Decisions 4 and 12): create a cohort with its event window, mint and revoke
 * the projected board's token, and revoke a guide's check-in power.
 *
 * Layering canon (transition.ts): gate → zod → authorize → decide (pure) →
 * mutate via the service-role core → interpret → typed result. Every decision
 * lives in `fw-board-rules.ts` / `fw-ops-rules.ts`; every sequence and its
 * compensation lives in `fw-ops-core.ts`; this file is the boundary and holds
 * no policy of its own.
 *
 * ⚠️ VISIBILITY IS NOT AUTHORIZATION.
 * The ops surface is rendered only for bridge-resolved sessions, and that is a
 * rendering decision with no security content whatsoever — a guide who learns
 * these action ids can invoke them directly, because Server Actions are HTTP
 * endpoints. EVERY action below therefore re-gates server-side on
 * `isFwStaffActor`, which is the ONE predicate for "may this session see ops"
 * (fw-access-rules.ts). None of them compares `via === "bridge"` by hand, and
 * none of them trusts a flag the caller passed.
 *
 * NOTE ON PROVISIONING: adding a guide and re-issuing their invite are NOT
 * here. They already exist, staff-gated, in `fw-guide.ts` (Unit 2), and the ops
 * surface calls those. Forking a second provisioning path so the ops page could
 * own one would give the repo two sequences to keep compensating correctly.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { isFwStaffActor } from "@/app/path/lib/fw-access-rules";
import { resolveFwActorForCohort, resolveFwStaffGate } from "@/app/path/lib/fw-auth";
import {
  anonymizeFwStudent,
  createFwCohort,
  linkFwStudentToCohort,
  loadFwMatchResolution,
  mintFwBoardToken,
  resolveFwReplayReject,
  revokeFwBoardToken,
  revokeFwGuideGrant,
  type AnonymizeStudentActionResult,
  type CreateFwCohortActionResult,
  type LinkStudentActionResult,
  type MatchLookupActionResult,
  type MintBoardTokenActionResult,
  type ResolveReplayRejectActionResult,
  type RevokeBoardTokenActionResult,
  type RevokeGuideGrantActionResult,
} from "@/app/path/lib/fw-ops-core";
import {
  fwCohortWindowFromLocal,
  normalizeFwCohortSlug,
} from "@/app/path/lib/fw-ops-rules";

const GENERIC_ERROR = "Something went wrong — please try again.";
/**
 * ONE message for every refusal shape: not signed in, signed in as a guide,
 * staff row deactivated, cohort is a Path cohort, cohort does not exist.
 *
 * Collapsed deliberately. A guide probing these endpoints must not be able to
 * tell "you are not staff" from "that cohort id is real but not fw" — the
 * second enumerates cohort ids. Staff never meet this message in normal use,
 * because the surface that calls these actions is only rendered for them.
 */
const STAFF_ONLY = "That action is staff-only.";

/**
 * The cohort-scoped staff gate every action here runs first.
 *
 * ⚠️ `resolveFwActorForCohort` returns a SYNTHETIC session (`userId: ""`) on the
 * no-session path, so `session.userId` is only meaningful once the verdict has
 * passed. `isFwStaffActor` implies `verdict.ok`, and the explicit length check
 * below makes that implication a runtime fact rather than an inference a future
 * edit could quietly break — this id is written into an audit row and a token's
 * `created_by`, both of which are FKs to `auth.users`.
 */
async function requireCohortStaff(
  cohortId: string
): Promise<{ ok: true; actorUserId: string } | { ok: false }> {
  const { verdict, session } = await resolveFwActorForCohort(cohortId);
  if (!isFwStaffActor(verdict)) return { ok: false };
  if (typeof session.userId !== "string" || session.userId.length === 0) {
    console.error("[fw/ops] staff verdict passed with no session user id — refusing");
    return { ok: false };
  }
  return { ok: true, actorUserId: session.userId };
}

/* ══════════════════════════════════════════════════════════ cohort creation ══ */

const createCohortSchema = z.object({
  slug: z.string().min(1).max(120),
  startDate: z.string().min(1).max(20),
  startTime: z.string().min(1).max(10),
  endDate: z.string().min(1).max(20),
  endTime: z.string().min(1).max(10),
  timeZone: z.string().min(1).max(60),
});

/**
 * Create one Founders Weekend cohort.
 *
 * Gated by `resolveFwStaffGate` — the COHORT-FREE gate — because there is no
 * cohort yet to resolve an actor against. Same two inputs as the bridge and the
 * same rule (admin claim AND live active staff row), so a deactivated staff
 * member cannot create weekends with a stale JWT.
 *
 * The window conversion is the load-bearing step (Decision 4): staff type a
 * local wall clock and a city's zone, and `ends_at` is what every board token's
 * expiry derives from. Each conversion refusal is reported with its own sentence
 * so the form can say which field is wrong rather than "invalid dates".
 */
export async function createFwCohortAction(
  input: unknown
): Promise<CreateFwCohortActionResult> {
  const gate = await resolveFwStaffGate();
  if (!gate.ok) return { success: false, error: STAFF_ONLY };

  const parsed = createCohortSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Fill in every field." };

  const slug = normalizeFwCohortSlug(parsed.data.slug);
  if (slug === null) {
    return {
      success: false,
      error: "Give the weekend a name of 3–60 letters or numbers (e.g. boston-2026-08).",
    };
  }

  const window = fwCohortWindowFromLocal({
    startDate: parsed.data.startDate,
    startTime: parsed.data.startTime,
    endDate: parsed.data.endDate,
    endTime: parsed.data.endTime,
    timeZone: parsed.data.timeZone,
  });
  if (!window.ok) return { success: false, error: windowFailureMessage(window.reason) };

  const created = await createFwCohort(supabaseAdmin(), {
    slug,
    startsAt: window.startsAt,
    endsAt: window.endsAt,
    timeZone: parsed.data.timeZone,
    createdBy: gate.userId,
  });
  if (!created.ok) {
    return { success: false, error: createCohortFailureMessage(created.reason, slug) };
  }

  revalidatePath("/path/fw/ops");
  return { success: true, cohortId: created.cohortId, slug: created.slug };
}

/* ─────────────────────────────────────────────────────── failure copy ──── */
/**
 * EVERY refusal-to-copy mapping in this file is an extracted function with a
 * declared `string` return and a `default`-less `switch`, so TS2366 makes a
 * newly added union member a COMPILE error rather than a silent fallthrough.
 *
 * That uniformity is the fix for a real hole (kieran-typescript review). Three
 * of these switches used to sit inline inside their action, where they appeared
 * to be protected — but only INCIDENTALLY, because the code after the `if
 * (!x.ok)` block happened to dereference a success-only property, which is what
 * actually made an incomplete switch a type error. `revokeBoardTokenAction`'s
 * success arm is a bare `{ ok: true }` with no property to dereference, so its
 * inline switch had NO tripwire at all: a reason added later (Unit 5b) and not
 * handled here would have fallen through and reported a FAILED board-token
 * revoke as `{ success: true }` — staff told the projector link was dead while
 * it kept working. Extracted, the return type is the guarantee, and it does not
 * depend on what the surrounding code happens to do next.
 */
function createCohortFailureMessage(
  reason: "slug_taken" | "invalid_time_zone" | "unavailable",
  slug: string
): string {
  switch (reason) {
    case "slug_taken":
      return `"${slug}" is already taken — pick another name.`;
    case "invalid_time_zone":
      return "Pick the city's timezone.";
    case "unavailable":
      return GENERIC_ERROR;
  }
}

function windowFailureMessage(
  reason:
    | "invalid_time_zone"
    | "invalid_start"
    | "invalid_end"
    | "nonexistent_start"
    | "nonexistent_end"
    | "window_not_ordered"
): string {
  switch (reason) {
    case "invalid_time_zone":
      return "Pick the city's timezone.";
    case "invalid_start":
      return "Check the start date and time.";
    case "invalid_end":
      return "Check the end date and time.";
    case "nonexistent_start":
      return "That start time doesn't exist on that date — the clocks move forward. Pick another.";
    case "nonexistent_end":
      return "That end time doesn't exist on that date — the clocks move forward. Pick another.";
    case "window_not_ordered":
      return "The weekend has to end after it starts.";
  }
}

/* ═════════════════════════════════════════════════════════════ board tokens ══ */

const cohortSchema = z.object({ cohortId: z.uuid() });
/** Revoke NAMES the token it means to kill — see revokeFwBoardToken's CAS. */
const revokeTokenSchema = z.object({ cohortId: z.uuid(), expectedTokenId: z.uuid() });

/**
 * Mint the projected board's URL token. The raw value is returned ONCE and never
 * stored; only its SHA-256 reaches the database.
 *
 * A re-mint revokes the prior token, which is exactly what kills a projector
 * mid-event — reported as `revokedPrior` so the surface's copy can warn before
 * and confirm after (a guide-briefing line in the plan's Operational Notes).
 */
export async function mintBoardTokenAction(
  input: unknown
): Promise<MintBoardTokenActionResult> {
  const parsed = cohortSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: GENERIC_ERROR };

  const gate = await requireCohortStaff(parsed.data.cohortId);
  if (!gate.ok) return { success: false, error: STAFF_ONLY };

  const minted = await mintFwBoardToken(supabaseAdmin(), {
    cohortId: parsed.data.cohortId,
    actorUserId: gate.actorUserId,
    now: Date.now(),
  });
  if (!minted.ok) return { success: false, error: mintFailureMessage(minted.reason) };

  revalidatePath(`/path/fw/ops/cohort/${parsed.data.cohortId}`);
  return {
    success: true,
    token: minted.token,
    expiresAt: minted.expiresAt,
    revokedPrior: minted.revokedPrior,
  };
}

/** Kill the live board token with no replacement. */
export async function revokeBoardTokenAction(
  input: unknown
): Promise<RevokeBoardTokenActionResult> {
  const parsed = revokeTokenSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: GENERIC_ERROR };

  const gate = await requireCohortStaff(parsed.data.cohortId);
  if (!gate.ok) return { success: false, error: STAFF_ONLY };

  const revoked = await revokeFwBoardToken(supabaseAdmin(), {
    cohortId: parsed.data.cohortId,
    actorUserId: gate.actorUserId,
    now: Date.now(),
    expectedTokenId: parsed.data.expectedTokenId,
  });
  if (!revoked.ok) {
    return { success: false, error: revokeTokenFailureMessage(revoked.reason) };
  }

  revalidatePath(`/path/fw/ops/cohort/${parsed.data.cohortId}`);
  return { success: true };
}

function mintFailureMessage(
  reason:
    | "cohort_not_found"
    | "cohort_not_fw"
    | "no_event_window"
    | "window_passed"
    | "unavailable"
): string {
  switch (reason) {
    case "cohort_not_found":
      return "That cohort no longer exists.";
    case "cohort_not_fw":
      return "Boards are only for Founders Weekend cohorts.";
    case "no_event_window":
      return "This weekend has no end date yet — the board's expiry comes from it.";
    case "window_passed":
      return "This weekend has already finished, so a new board link would be dead on arrival.";
    case "unavailable":
      return GENERIC_ERROR;
  }
}

function revokeTokenFailureMessage(
  reason: "no_active_token" | "stale_view" | "unavailable"
): string {
  switch (reason) {
    case "no_active_token":
      return "There's no live board link to revoke.";
    case "stale_view":
      return "This page is out of date — a different board link is live now. Reload, then revoke.";
    case "unavailable":
      return GENERIC_ERROR;
  }
}

/* ══════════════════════════════════════════════════════════ grant revocation ══ */

const revokeGrantSchema = z.object({ cohortId: z.uuid(), userId: z.uuid() });

/**
 * Take away one guide's check-in power for one weekend.
 *
 * The account, its password, and its invite all survive — this is a scope
 * change, not an offboarding, and a guide working two weekends keeps the other.
 * Their live session is not killed either, and does not need to be: the FW gate
 * re-reads grants on every page and every action, so the revoked cohort refuses
 * on their very next tap.
 *
 * Writes an audit row (Scope Boundaries: guide-grant changes are one of the two
 * liability actions). `audited: false` means the revoke landed but its record
 * did not — surfaced rather than swallowed.
 */
export async function revokeGuideGrantAction(
  input: unknown
): Promise<RevokeGuideGrantActionResult> {
  const parsed = revokeGrantSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: GENERIC_ERROR };

  const gate = await requireCohortStaff(parsed.data.cohortId);
  if (!gate.ok) return { success: false, error: STAFF_ONLY };

  const revoked = await revokeFwGuideGrant(supabaseAdmin(), {
    cohortId: parsed.data.cohortId,
    userId: parsed.data.userId,
    actorUserId: gate.actorUserId,
  });
  if (!revoked.ok) {
    return { success: false, error: revokeGrantFailureMessage(revoked.reason) };
  }

  revalidatePath(`/path/fw/ops/cohort/${parsed.data.cohortId}`);
  return { success: true, audited: revoked.audited };
}

function revokeGrantFailureMessage(reason: "grant_not_found" | "unavailable"): string {
  switch (reason) {
    case "grant_not_found":
      return "That guide no longer has access to this weekend — refresh the list.";
    case "unavailable":
      return GENERIC_ERROR;
  }
}

/* ═══════════════════════════════════════════════ Unit 5b — replay rejects ══ */

const resolveRejectSchema = z.object({ cohortId: z.uuid(), rejectId: z.uuid() });

/**
 * Close one replay reject (Decision 9 / G11). NOT a liability action, so it
 * writes no audit row — just `resolved_by`/`resolved_at` on the row. Re-gated on
 * `isFwStaffActor` like every action here; a guide who learns the id cannot call
 * it, and the core additionally scopes the write to this cohort.
 */
export async function resolveReplayRejectAction(
  input: unknown
): Promise<ResolveReplayRejectActionResult> {
  const parsed = resolveRejectSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: GENERIC_ERROR };

  const gate = await requireCohortStaff(parsed.data.cohortId);
  if (!gate.ok) return { success: false, error: STAFF_ONLY };

  const resolved = await resolveFwReplayReject(supabaseAdmin(), {
    rejectId: parsed.data.rejectId,
    cohortId: parsed.data.cohortId,
    actorUserId: gate.actorUserId,
    now: Date.now(),
  });
  if (!resolved.ok) return { success: false, error: resolveRejectFailureMessage(resolved.reason) };

  revalidatePath(`/path/fw/ops/cohort/${parsed.data.cohortId}`);
  return { success: true };
}

function resolveRejectFailureMessage(reason: "not_open" | "unavailable"): string {
  switch (reason) {
    case "not_open":
      return "That reject is already resolved — refresh the list.";
    case "unavailable":
      return GENERIC_ERROR;
  }
}

/* ══════════════════════════════════════════════ Unit 5b — anonymize ══ */

const anonymizeSchema = z.object({
  cohortId: z.uuid(),
  studentId: z.uuid(),
  /** The typed confirm — the child's own name. Verified in the core against the
   *  stored name, not trusted from here. */
  confirmName: z.string().min(1).max(200),
});

/**
 * Anonymize-in-place: the FW deletion action (Decision 10, G8).
 *
 * IRREVERSIBLE, so the surface makes staff TYPE the child's name and this action
 * re-verifies it server-side (`fwAnonymizeConfirmMatches`, in the core) — a typed
 * confirm only the browser checks is not a confirm. Writes the second of the two
 * liability audit rows. `audited: false` means the anonymization happened but its
 * record did not save, surfaced rather than swallowed; `openRejects` carries the
 * warning that unresolved rejects still point at the now-removed student.
 */
export async function anonymizeStudentAction(
  input: unknown
): Promise<AnonymizeStudentActionResult> {
  const parsed = anonymizeSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: GENERIC_ERROR };

  const gate = await requireCohortStaff(parsed.data.cohortId);
  if (!gate.ok) return { success: false, error: STAFF_ONLY };

  const result = await anonymizeFwStudent(supabaseAdmin(), {
    studentId: parsed.data.studentId,
    cohortId: parsed.data.cohortId,
    actorUserId: gate.actorUserId,
    confirmName: parsed.data.confirmName,
  });
  if (!result.ok) return { success: false, error: anonymizeFailureMessage(result.reason) };

  revalidatePath(`/path/fw/ops/cohort/${parsed.data.cohortId}`);
  return {
    success: true,
    alreadyAnonymized: result.alreadyAnonymized,
    audited: result.audited,
    openRejects: result.openRejects,
  };
}

function anonymizeFailureMessage(
  reason:
    | "student_not_found"
    | "not_in_cohort"
    | "not_fw_profile"
    | "account_missing"
    | "confirm_mismatch"
    | "unavailable"
): string {
  switch (reason) {
    case "confirm_mismatch":
      return "The typed name doesn't match this student — nothing was changed.";
    case "not_in_cohort":
      return "That student isn't in this weekend — refresh the roster.";
    case "student_not_found":
      return "That student no longer exists.";
    case "not_fw_profile":
      return "That isn't a Founders Weekend student record.";
    case "account_missing":
      return "This student's account could not be found — tell an engineer.";
    case "unavailable":
      return GENERIC_ERROR;
  }
}

/* ═══════════════════════════════════ Unit 5b — PROPOSED-1 match resolution ══ */

const matchLookupSchema = z.object({
  cohortId: z.uuid(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
});

/**
 * The full cross-cohort match detail staff see and the guide's minimal signal
 * withheld (PROPOSED-1, accepted). A READ, but a Server Action so the free-text
 * name never renders a candidate list to a session that is not staff.
 */
export async function lookupMatchAction(input: unknown): Promise<MatchLookupActionResult> {
  const parsed = matchLookupSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: GENERIC_ERROR };

  const gate = await requireCohortStaff(parsed.data.cohortId);
  if (!gate.ok) return { success: false, error: STAFF_ONLY };

  const resolution = await loadFwMatchResolution(supabaseAdmin(), {
    cohortId: parsed.data.cohortId,
    firstName: parsed.data.firstName,
    lastName: parsed.data.lastName,
  });
  if (!resolution.ok) return { success: false, error: GENERIC_ERROR };
  if (resolution.kind === "invalid_name") return { success: true, kind: "invalid_name" };
  return { success: true, kind: "matches", entries: resolution.entries };
}

const linkStudentSchema = z.object({ cohortId: z.uuid(), studentId: z.uuid() });

/**
 * Link an existing FW student into this weekend — the "link membership" half of
 * the match resolution. Adds a membership only (progress is per-student and
 * already exists for a returner); not an audit action.
 */
export async function linkStudentAction(input: unknown): Promise<LinkStudentActionResult> {
  const parsed = linkStudentSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: GENERIC_ERROR };

  const gate = await requireCohortStaff(parsed.data.cohortId);
  if (!gate.ok) return { success: false, error: STAFF_ONLY };

  const linked = await linkFwStudentToCohort(supabaseAdmin(), {
    studentId: parsed.data.studentId,
    cohortId: parsed.data.cohortId,
  });
  if (!linked.ok) return { success: false, error: linkFailureMessage(linked.reason) };

  revalidatePath(`/path/fw/ops/cohort/${parsed.data.cohortId}`);
  return { success: true, alreadyMember: linked.alreadyMember };
}

function linkFailureMessage(
  reason: "student_not_found" | "not_fw_profile" | "cohort_not_fw" | "unavailable"
): string {
  switch (reason) {
    case "student_not_found":
      return "That student no longer exists — search again.";
    case "not_fw_profile":
      return "That isn't a Founders Weekend student record.";
    case "cohort_not_fw":
      return "Students can only be linked into Founders Weekend cohorts.";
    case "unavailable":
      return GENERIC_ERROR;
  }
}
