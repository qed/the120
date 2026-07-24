/**
 * Quick-create's write path (FW Unit 4; FW-R6–R7, Decision 13, gaps G6/G10) —
 * the walk-in flow, leg-verified before a guide is ever routed into a tree.
 *
 * PLAIN module by design — no `"use server"` (its exports would become public,
 * unauthenticated Server Actions and the `db` argument cannot serialize) and no
 * `import "server-only"` (Unit 7's importer reuses the verification below).
 * Callers own their gate: `actions/fw-student.ts` gates with
 * `resolveFwActorForCohort`.
 *
 * ── What "leg-verified" means here, and why `provisionFwStudent` is not enough
 *
 * `provisionFwStudent` already sequences and compensates the four writes, and
 * already returns a profile id with a failed leg so a retry can complete it in
 * place. What it does NOT do is READ BACK. Its materialization step is an
 * `upsert … ignoreDuplicates`, so on a resume it legitimately reports
 * `created: 0` whether the student has 125 rows or 3 — the count says how many
 * this call inserted, not how many exist.
 *
 * That gap is exactly the one Decision 13 exists to close: "a kid standing at
 * the table is never handed a tap-dead tree." So this module adds the
 * post-write verification the compensation canon asks for (docs/solutions/best-
 * practices/no-transaction-multi-step-write-compensation-post-write-verify-cas-
 * scoped-claim-2026-07-22.md) and refuses to report success until all three legs
 * are observed: the account exists, the membership row exists, and every task in
 * the pinned program has a progress row.
 *
 * The verification is a SET COMPARISON, not a count. A partial materialization
 * that happens to land on the right number is not a thing that can happen — but
 * a count would also pass a student whose rows came from a different program
 * version, and the tree is rendered from the pinned version's task ids.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Band } from "@/app/path/content/types";
import { fwRead } from "./fw-call";
import { loadFwMatchCandidates } from "./fw-loader";
import { fwMatchKey, matchFwStudent, type FwMatchVerdict } from "./fw-match-rules";
import {
  provisionFwStudent,
  type ProvisionFwStudentFailure,
  type ProvisionFwStudentResult,
} from "./provision-core";

/* ════════════════════════════════════ PROPOSED-1: lookup before you create ══ */

export type FwMatchLookupResult =
  | { ok: true; verdict: FwMatchVerdict }
  /** The check did not run. Distinct from `{kind:"none"}` on purpose: the form
   *  says "we couldn't check for an existing record" and still lets the guide
   *  create, because a kid at the table outranks a duplicate we can reconcile. */
  | { ok: false; reason: "unavailable" };

/**
 * Have we met this child before? — the lookup half of PROPOSED-1, composed.
 *
 * The two halves are already tested apart (`loadFwMatchCandidates`,
 * `matchFwStudent`); this exists so the JOIN between them is tested too, and so
 * both sides key on `fwMatchKey` rather than on two independently-derived
 * strings. An unkeyable name never reaches the database — the matcher's own
 * `invalid_name` verdict is the answer, and querying `normalized_name = ''`
 * would select every un-normalized row in the table.
 */
export async function runFwMatchLookup(
  db: SupabaseClient,
  input: { firstName: string; lastName: string; cohortId: string }
): Promise<FwMatchLookupResult> {
  const key = fwMatchKey(input.firstName, input.lastName);
  if (key === null) return { ok: true, verdict: { kind: "invalid_name" } };

  const loaded = await loadFwMatchCandidates(db, key);
  if (!loaded.ok) return { ok: false, reason: "unavailable" };

  return {
    ok: true,
    verdict: matchFwStudent({
      firstName: input.firstName,
      lastName: input.lastName,
      cohortId: input.cohortId,
      candidates: loaded.candidates,
    }),
  };
}

/* ══════════════════════════════════════════════════════════ leg verification ══ */

/** Which leg of the walk-in sequence is not there yet. Named rather than
 *  booleaned so the retry copy can tell a guide what is being finished. */
export type FwStudentLeg = "account" | "membership" | "materialization";

export type FwLegVerification =
  | { ok: true }
  | { ok: false; leg: FwStudentLeg }
  /** The verification itself could not run. NOT a failed leg: reporting one
   *  would send a guide into a retry loop against a read outage. */
  | { ok: false; leg: null };

/**
 * Observe all three legs of a provisioned FW student.
 *
 * Ordered account → membership → materialization, matching the order they are
 * written, so the leg reported is the FIRST one missing rather than whichever
 * query happened to run first.
 */
export async function verifyFwStudentLegs(
  db: SupabaseClient,
  input: { profileId: string; cohortId: string }
): Promise<FwLegVerification> {
  // Every call below goes through `fwRead`: four unbounded sequential I/O calls
  // on the path a guide is standing at a table waiting on, and a hang here does
  // not just stall the server — the client's `finally` never runs either,
  // because it only fires when the awaited action SETTLES (reliability review).
  const profile = await fwRead(
    () =>
      db
        .from("path_student_profiles")
        .select("id, user_id, program_version_id")
        .eq("id", input.profileId)
        .maybeSingle(),
    `leg verification profile (${input.profileId})`
  );
  if (profile.error) {
    console.error(
      `[fw/quick-create] leg verification: profile read failed for ${input.profileId}: ${profile.error.message}`
    );
    return { ok: false, leg: null };
  }
  const row = profile.data;
  if (!row || typeof row.user_id !== "string" || typeof row.program_version_id !== "string") {
    return { ok: false, leg: "account" };
  }
  const versionId = row.program_version_id;

  // The auth account itself, not just the profile's pointer at it. A profile
  // whose user was deleted (a compensation that half-ran) renders a perfectly
  // normal roster row and can never be signed into or converted.
  const account = await fwRead(
    () => db.auth.admin.getUserById(row.user_id),
    `leg verification account (${row.user_id})`
  );
  if (account.error) {
    console.error(
      `[fw/quick-create] leg verification: account lookup failed for ${row.user_id}: ${account.error.message}`
    );
    return { ok: false, leg: null };
  }
  if (!account.data?.user) return { ok: false, leg: "account" };

  const membership = await fwRead(
    () =>
      db
        .from("path_cohort_members")
        .select("student_id")
        .eq("student_id", input.profileId)
        .eq("cohort_id", input.cohortId)
        .maybeSingle(),
    `leg verification membership (${input.profileId})`
  );
  if (membership.error) {
    console.error(
      `[fw/quick-create] leg verification: membership read failed for ${input.profileId}: ${membership.error.message}`
    );
    return { ok: false, leg: null };
  }
  if (!membership.data) return { ok: false, leg: "membership" };

  const [tasks, progress] = await Promise.all([
    fwRead(
      () => db.from("path_unit_tasks").select("task_id").eq("program_version_id", versionId),
      `leg verification catalog (${versionId})`
    ),
    fwRead(
      () => db.from("path_task_progress").select("task_id").eq("student_id", input.profileId),
      `leg verification progress (${input.profileId})`
    ),
  ]);
  if (tasks.error || progress.error) {
    console.error(
      `[fw/quick-create] leg verification: materialization read failed for ${input.profileId}: ` +
        `${tasks.error?.message ?? progress.error?.message}`
    );
    return { ok: false, leg: null };
  }
  const expected = (tasks.data ?? [])
    .map((t) => t.task_id)
    .filter((id): id is string => typeof id === "string");
  if (expected.length === 0) {
    // No content for the pinned version is a deployment fault, not a missing
    // leg — "every task has a row" would be vacuously true and would route the
    // guide into an empty tree.
    console.error(`[fw/quick-create] leg verification: version ${versionId} has no tasks seeded`);
    return { ok: false, leg: null };
  }
  const have = new Set(
    (progress.data ?? []).map((p) => p.task_id).filter((id): id is string => typeof id === "string")
  );
  if (expected.some((taskId) => !have.has(taskId))) return { ok: false, leg: "materialization" };

  return { ok: true };
}

/* ═════════════════════════════════════════════════════════════ quick-create ══ */

export type FwQuickCreateInput = {
  firstName: string;
  lastName: string;
  band: Band;
  cohortId: string;
  /** The guide (or staff) at the table. Stamped as `notice_attested_by`. */
  actorUserId: string;
  /**
   * Decision 13: the attestation BLOCKS submission and is PERSISTED. Re-checked
   * here rather than trusted from the form, because a checkbox is a client-side
   * fact and the column it writes is the record that the family saw the notice.
   */
  noticeAttested: boolean;
  /**
   * Retry-in-place handle, echoed back from a previous failed leg. Used ONLY for
   * resuming this same submission — never for linking a matched student. A
   * same-cohort PROPOSED-1 match routes the guide to the student who already
   * exists; it does not re-provision them.
   */
  existingProfileId?: string | null;
};

export type FwQuickCreateFailure =
  /** The attestation was not ticked. Server-side, so a bypassed form cannot
   *  mint an account whose family never saw the notice. */
  | "notice_not_attested"
  | ProvisionFwStudentFailure
  /** Every write reported success and a leg is still not observable. */
  | "legs_unverified";

export type FwQuickCreateResult =
  | { ok: true; studentId: string; adopted: boolean }
  | {
      ok: false;
      reason: FwQuickCreateFailure;
      /** Which leg to finish, when that is known. */
      leg?: FwStudentLeg;
      /** Present once a profile exists — the handle a retry-in-place passes back
       *  so the guide finishes this child rather than minting a second one. */
      retryProfileId?: string;
    };

/**
 * Create (or finish creating) one walk-in student, and do not report success
 * until all three legs are observed.
 *
 * The failure shape is what makes retry-in-place work: every reason that leaves
 * a profile behind carries `retryProfileId`, so the form re-submits against the
 * SAME child. Losing that handle is how a guide ends up with two Maya Chens and
 * two name-derived addresses, which FW-D2 makes permanent.
 */
export async function runFwQuickCreate(
  db: SupabaseClient,
  input: FwQuickCreateInput
): Promise<FwQuickCreateResult> {
  if (!input.noticeAttested) return { ok: false, reason: "notice_not_attested" };

  // ── The resume handle is scoped to THIS cohort. ──
  //
  // `provisionFwStudent` authorizes a resume by NAME MATCH alone, and names are
  // not secrets. Without this, a caller who knows another weekend's child's
  // exact name could pass that child's profile id with their own legitimately
  // authorized cohort id, and the unconditional membership upsert that follows
  // would enrol an unrelated student into this weekend — producing exactly the
  // thing `runFwCheckIn` calls unacceptable elsewhere in this unit, "a permanent
  // lie in an append-only log" (adversarial review).
  //
  // The rule that admits every legitimate retry and nothing else: a resume
  // target must either hold NO membership at all (its membership leg is what
  // failed) or already be a member of THIS cohort (its materialization leg is
  // what failed). An established member of some OTHER weekend is refused.
  if (input.existingProfileId) {
    const scoped = await fwRead(
      () =>
        db
          .from("path_cohort_members")
          .select("cohort_id")
          .eq("student_id", input.existingProfileId as string),
      `resume scope (${input.existingProfileId})`
    );
    if (scoped.error) {
      console.error(
        `[fw/quick-create] resume scope check failed for ${input.existingProfileId}: ${scoped.error.message}`
      );
      return { ok: false, reason: "unavailable" };
    }
    const cohorts = (scoped.data ?? []).map((r) => r.cohort_id);
    if (cohorts.length > 0 && !cohorts.includes(input.cohortId)) {
      console.error(
        `[fw/quick-create] refusing to resume ${input.existingProfileId}: it belongs to another weekend`
      );
      return { ok: false, reason: "identity_mismatch" };
    }
  }

  // try/catch because `provisionFwStudent`'s Auth admin calls (createUser/getUserById)
  // are NOT timeout/throw-guarded the way its PostgREST calls are — a network abort there
  // throws, and the LIVE walk-in path (quick-create) has no other guard, so an uncaught
  // throw would escape the typed `FwQuickCreateResult` and surface a raw Server Action
  // error to a guide mid-tap (reliability review). The bulk importer already wraps this
  // call; quick-create now matches. A thrown provision → a typed `unavailable` with a
  // resume handle absent (nothing verified as landed), which the guide can simply retry.
  let provisioned: ProvisionFwStudentResult;
  try {
    provisioned = await provisionFwStudent(db, {
      firstName: input.firstName,
      lastName: input.lastName,
      band: input.band,
      cohortId: input.cohortId,
      noticeAttestedBy: input.actorUserId,
      existingProfileId: input.existingProfileId ?? null,
    });
  } catch (e) {
    console.error(
      `[fw/quick-create] provisioning threw for ${input.firstName} ${input.lastName}:`,
      e
    );
    return { ok: false, reason: "unavailable" };
  }
  if (!provisioned.ok) {
    return {
      ok: false,
      reason: provisioned.reason,
      // provision-core returns a profile id for exactly the failures a retry can
      // finish; passing it straight through keeps ONE definition of "which
      // failures are resumable" rather than re-deriving the list here.
      ...(provisioned.profileId ? { retryProfileId: provisioned.profileId } : {}),
    };
  }

  const legs = await verifyFwStudentLegs(db, {
    profileId: provisioned.profileId,
    cohortId: input.cohortId,
  });
  if (!legs.ok) {
    console.error(
      `[fw/quick-create] ${provisioned.profileId} provisioned but leg ${legs.leg ?? "?"} did not verify`
    );
    return {
      ok: false,
      reason: "legs_unverified",
      ...(legs.leg ? { leg: legs.leg } : {}),
      retryProfileId: provisioned.profileId,
    };
  }

  return { ok: true, studentId: provisioned.profileId, adopted: provisioned.adopted };
}

/* ═══════════════════════════════════════════════ what the Server Actions return ══ */

/**
 * The action-layer result types live HERE, in the plain module, because
 * `actions/fw-student.ts` is a `"use server"` file and even a TYPE re-export
 * from one gets a `registerServerReference()` emitted for it — the module then
 * throws at load and takes every action in it down (docs/solutions/runtime-
 * errors/use-server-type-reexport-registers-server-reference-…-2026-07-22.md).
 *
 * The gate refusals are deliberately coarser than the verdicts they come from: a
 * caller learns "you may not do this here", never whether a cohort id exists or
 * what kind it is.
 */
export type FwQuickCreateActionResult =
  | FwQuickCreateResult
  | {
      ok: false;
      reason: "invalid_input" | "notice_not_attested" | "no_session" | "forbidden";
      /** `never`, not omitted: it keeps `result.retryProfileId` readable across
       *  the whole union without a narrowing dance at the call site, AND says
       *  the true thing — a refusal at the gate wrote nothing, so there is
       *  nothing to finish. */
      retryProfileId?: never;
      leg?: never;
    };

export type FwMatchLookupActionResult =
  | FwMatchLookupResult
  | { ok: false; reason: "invalid_input" | "no_session" | "forbidden" | "rate_limited" };
