/**
 * The bulk importer's db-taking orchestration (FW Unit 7; FW-R12, Decision 11,
 * gaps G7/G19) — the per-row match × provision × membership × leg-verify fold,
 * the exception park, and the ops-side exception list/resolve.
 *
 * PLAIN module by design — no `"use server"` (its exports would become public,
 * unauthenticated Server Actions and the `db` argument cannot serialize) and no
 * `import "server-only"` (so `scripts/fw-ops.ts` can drive it under `tsx`).
 * Callers own their gate: the ops action gates with `requireCohortStaff`, the CLI
 * with possession of the service-role key. Same posture and stated reason as
 * `fw-checkin-core.ts` / `fw-ops-core.ts` — the COMPOSITION is where every prior
 * FW unit shipped a P1, and a composition inside a `"use server"` file is one
 * nothing can test.
 *
 * ── What one row costs, and why it is chunked
 *
 * A mint is `provisionFwStudent` (auth user → family → profile → membership →
 * 125 locked rows) plus a match lookup and a post-write LEG VERIFICATION — ~16
 * service-role round trips. At ninety children that is far past any serverless
 * `maxDuration`, so the caller drives it in chunks (`planFwImportChunks`), and
 * every chunk is IDEMPOTENT: a re-run matches the row it already minted, sees the
 * membership, and skips it. A chunk that times out is simply re-sent — the
 * resumability the plan's Decision 11 asks for falls out of the idempotence
 * rather than out of a cursor nobody can trust after a crash.
 *
 * ── The no-auth-mail invariant, upheld by REUSE
 *
 * Every account this importer mints goes through `provisionFwStudent` →
 * `buildFwStudentCreateUserPayload`: password-less, `email_confirm: true` (a
 * compile-time literal), released-alias-excluded, and past the single
 * `assertNoAuthMailToFwStudent` choke-point. There is no second provisioning
 * path here, so a ~90-account mint cannot arm a single real minor's mailbox.
 *
 * ── No consent attestation is stamped (PROPOSED-3 REJECTED)
 *
 * The paper-weekend backfill and its retroactive-consent sequence were REJECTED
 * (2026-07-23). This importer provisions the Boston roster ONLY, so it passes
 * `noticeAttestedBy: null` — there is no per-row notice attestation, because there
 * is no notice sequence. Families' consent for a bulk-imported roster is an
 * OPERATIONAL gate (the retention-policy text due before the ~90-account mint,
 * Operational Notes), not a column this code writes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Band } from "@/app/path/content/types";
import { fetchAllRows, fwRead, fwWrite, isUniqueViolation } from "./fw-call";
import {
  decideFwImportRowMatch,
  type FwImportRowInput,
} from "./fw-import-rules";
import { loadFwMatchCandidates } from "./fw-loader";
import { fwMatchKey } from "./fw-match-rules";
import { linkFwStudentToCohort } from "./fw-ops-core";
import { verifyFwStudentLegs, type FwStudentLeg } from "./fw-student-core";
import { provisionFwStudent } from "./provision-core";

/* ═══════════════════════════════════════════════════════════ per-row outcome ══ */

export type FwImportOutcomeKind =
  /** A new dormant account + membership + 125 locked rows. */
  | "minted"
  /** A returner: a second membership on their one existing account. */
  | "linked"
  /** A (name, band) already enrolled here and fully provisioned — idempotent re-run. */
  | "skipped_existing"
  /** A stranded prior run's legs (membership landed, progress didn't) FINISHED in
   *  place on a re-run — no new account, but work happened, so it is reported
   *  distinctly from a fresh mint and from a no-op skip (maintainability review). */
  | "resumed"
  /** Parked for staff (an ambiguous match); nothing minted (G7). */
  | "exception"
  /** A pending exception for this (name, band) already sits on this cohort. */
  | "skipped_pending_exception"
  /** A per-row error; the file continued past it (G19). */
  | "failed";

export type FwImportOutcome = {
  rowNumber: number;
  firstName: string;
  lastName: string;
  band: Band;
  kind: FwImportOutcomeKind;
  /** The student the row resolved to (minted / linked / skipped_existing / resumed). */
  profileId?: string;
  /** The machine reason — the failure on `failed`, or the park reason
   *  (`ambiguous_match`) on `exception` so the report explains the parking. */
  reason?: string;
  /** `failed` only — the leg that could not be verified, and a retry handle. */
  leg?: FwStudentLeg;
  retryProfileId?: string;
};

type RowBase = Pick<FwImportOutcome, "rowNumber" | "firstName" | "lastName" | "band">;

/* ═══════════════════════════════════════════════════════════ the exception park ══ */

type ParkFwImportExceptionResult = { ok: true; alreadyParked: boolean } | { ok: false };

/**
 * Park one ambiguous row as a pending exception — idempotent by the partial
 * unique index on `(cohort_id, normalized_name, band) where state='pending'`.
 *
 * A re-import of the same ambiguous (name, band) must not stack a second
 * exception, so a unique violation is SUCCESS (already parked). And because
 * `fwWrite` may report a timeout on a write that actually landed, the error branch
 * POST-WRITE VERIFIES: a pending row for this (cohort, name, band) now present
 * means the park is done.
 *
 * NOT exported: its only caller is `exceptionRow` below (maintainability review —
 * "an export whose only caller is its own test is not doing its job"). The park
 * path, including this post-write-verify branch, is tested through
 * `runFwImportChunk`'s exception outcome.
 */
async function parkFwImportException(
  db: SupabaseClient,
  input: { cohortId: string; row: FwImportRowInput; reason: string; createdBy: string }
): Promise<ParkFwImportExceptionResult> {
  const key = fwMatchKey(input.row.firstName, input.row.lastName);
  if (key === null) return { ok: false };

  const inserted = await fwWrite(
    () =>
      db
        .from("path_fw_import_exceptions")
        .insert([
          {
            cohort_id: input.cohortId,
            first_name: input.row.firstName.trim(),
            last_name: input.row.lastName.trim(),
            band: input.row.band,
            normalized_name: key,
            reason: input.reason,
            created_by: input.createdBy,
          },
        ])
        .select("id"),
    `import exception park (${input.cohortId})`
  );
  if (inserted.error) {
    if (isUniqueViolation(inserted.error)) return { ok: true, alreadyParked: true };
    const present = await fwRead(
      () =>
        db
          .from("path_fw_import_exceptions")
          .select("id")
          .eq("cohort_id", input.cohortId)
          .eq("normalized_name", key)
          .eq("band", input.row.band)
          .eq("state", "pending")
          .maybeSingle(),
      `import exception verify (${input.cohortId})`
    );
    if (present.error || !present.data) {
      console.error(
        `[fw/import] failed to park exception for ${key} (${input.row.band}) in ${input.cohortId}: ${inserted.error.message}`
      );
      return { ok: false };
    }
    return { ok: true, alreadyParked: true };
  }
  return { ok: true, alreadyParked: (inserted.data ?? []).length === 0 };
}

/* ═══════════════════════════════════════════════════════════════ the per-row fold ══ */

/**
 * Provision (or resolve) one roster row: match → decide → mint / link / finish /
 * park. Never throws — every failure is a `failed` outcome so the chunk keeps
 * going (reject the row, never the file — G19). The compensation is inherited
 * from `provisionFwStudent`, which best-effort deletes a half-minted account on a
 * profile-insert failure and KEEPS the profile (returning its id) on a membership
 * or materialization failure, so the retry finishes it in place.
 */
export async function runFwImportRow(
  db: SupabaseClient,
  input: { cohortId: string; actorUserId: string; row: FwImportRowInput }
): Promise<FwImportOutcome> {
  const { cohortId, actorUserId, row } = input;
  const base: RowBase = {
    rowNumber: row.rowNumber,
    firstName: row.firstName,
    lastName: row.lastName,
    band: row.band,
  };

  // Recompute the key SERVER-SIDE — never trust a client-supplied normalizedName,
  // because it is what `loadFwMatchCandidates` looks the child up by. A key that
  // cannot be built is the same refusal `provisionFwStudent` would raise moments
  // later, surfaced as a per-row failure here.
  const key = fwMatchKey(row.firstName, row.lastName);
  if (key === null) return { ...base, kind: "failed", reason: "invalid_name" };

  const candidates = await loadFwMatchCandidates(db, key);
  if (!candidates.ok) return { ...base, kind: "failed", reason: "match_unavailable" };

  const decision = decideFwImportRowMatch({
    candidates: candidates.candidates,
    cohortId,
    band: row.band,
  });

  switch (decision.action) {
    case "skip_pending_exception":
      return { ...base, kind: "skipped_pending_exception" };
    case "mint":
      return mintRow(db, { cohortId, row, base });
    case "link":
      return linkRow(db, { cohortId, profileId: decision.profileId, base });
    case "skip_existing":
      return finishExistingRow(db, { cohortId, profileId: decision.profileId, base });
    case "exception":
      return exceptionRow(db, { cohortId, row, reason: decision.reason, actorUserId, base });
  }
}

/**
 * Observe the three legs (account, membership, 125 rows) and, if a prior run left
 * them PARTIAL, finish them in place via `provisionFwStudent`'s idempotent resume
 * — which NEVER mints a new account, so "zero new accounts on a re-run" holds.
 *
 * Returning `resumed` lets the caller converge a crash-window (membership landed,
 * progress did not) in ONE pass instead of the two the plain verify-then-fail path
 * needed — and report it honestly rather than as a bare `legs_unverified` failure
 * for a row that actually made progress (adversarial review).
 */
async function completeStudentLegs(
  db: SupabaseClient,
  input: { cohortId: string; profileId: string; base: RowBase }
): Promise<{ ok: true; resumed: boolean } | { ok: false; reason: string; leg?: FwStudentLeg }> {
  const { cohortId, profileId, base } = input;
  const legs = await verifyFwStudentLegs(db, { profileId, cohortId });
  if (legs.ok) return { ok: true, resumed: false };

  const prov = await provisionFwStudent(db, {
    firstName: base.firstName,
    lastName: base.lastName,
    band: base.band,
    cohortId,
    existingProfileId: profileId,
    noticeAttestedBy: null,
  });
  if (!prov.ok) return { ok: false, reason: prov.reason };
  const legs2 = await verifyFwStudentLegs(db, { profileId, cohortId });
  if (!legs2.ok) return { ok: false, reason: "legs_unverified", ...(legs2.leg ? { leg: legs2.leg } : {}) };
  return { ok: true, resumed: true };
}

async function mintRow(
  db: SupabaseClient,
  input: { cohortId: string; row: FwImportRowInput; base: RowBase }
): Promise<FwImportOutcome> {
  const { cohortId, row, base } = input;
  const prov = await provisionFwStudent(db, {
    firstName: row.firstName,
    lastName: row.lastName,
    band: row.band,
    cohortId,
    // No attestation stamped — PROPOSED-3 rejected; see the module header.
    noticeAttestedBy: null,
  });
  if (!prov.ok) {
    return {
      ...base,
      kind: "failed",
      reason: prov.reason,
      ...(prov.profileId ? { retryProfileId: prov.profileId } : {}),
    };
  }
  const legs = await completeStudentLegs(db, { cohortId, profileId: prov.profileId, base });
  if (!legs.ok) {
    return {
      ...base,
      kind: "failed",
      reason: legs.reason,
      ...(legs.leg ? { leg: legs.leg } : {}),
      retryProfileId: prov.profileId,
    };
  }
  return { ...base, kind: "minted", profileId: prov.profileId };
}

async function linkRow(
  db: SupabaseClient,
  input: { cohortId: string; profileId: string; base: RowBase }
): Promise<FwImportOutcome> {
  const { cohortId, profileId, base } = input;
  // Membership only: a returner's 125 rows already exist (progress is per-student),
  // so their record arrives filled (Decision 16). `linkFwStudentToCohort` guards
  // FW-shape, cohort kind, and — the P1 the review found — an anonymized profile.
  const linked = await linkFwStudentToCohort(db, { studentId: profileId, cohortId });
  if (!linked.ok) {
    return { ...base, kind: "failed", reason: linked.reason, retryProfileId: profileId };
  }
  // Then ensure the legs — normally a no-op for a real returner, but this path also
  // catches a stranded mint (profile existed, membership didn't) that decided as a
  // "link"; completing progress here converges it in ONE pass (adversarial review).
  const legs = await completeStudentLegs(db, { cohortId, profileId, base });
  if (!legs.ok) {
    return {
      ...base,
      kind: "failed",
      reason: legs.reason,
      ...(legs.leg ? { leg: legs.leg } : {}),
      retryProfileId: profileId,
    };
  }
  return { ...base, kind: "linked", profileId };
}

async function finishExistingRow(
  db: SupabaseClient,
  input: { cohortId: string; profileId: string; base: RowBase }
): Promise<FwImportOutcome> {
  const { cohortId, profileId, base } = input;
  // A (name, band) already a member here. Usually a completed row on a re-run —
  // but a mint that crashed AFTER the membership landed and BEFORE the 125 rows
  // did leaves exactly this shape with partial progress, so complete-and-verify
  // rather than hand the event a tap-dead tree.
  const legs = await completeStudentLegs(db, { cohortId, profileId, base });
  if (!legs.ok) {
    return {
      ...base,
      kind: "failed",
      reason: legs.reason,
      ...(legs.leg ? { leg: legs.leg } : {}),
      retryProfileId: profileId,
    };
  }
  // resumed → a partial was finished this run; else nothing needed doing.
  return { ...base, kind: legs.resumed ? "resumed" : "skipped_existing", profileId };
}

async function exceptionRow(
  db: SupabaseClient,
  input: {
    cohortId: string;
    row: FwImportRowInput;
    reason: string;
    actorUserId: string;
    base: RowBase;
  }
): Promise<FwImportOutcome> {
  const parked = await parkFwImportException(db, {
    cohortId: input.cohortId,
    row: input.row,
    reason: input.reason,
    createdBy: input.actorUserId,
  });
  if (!parked.ok) return { ...input.base, kind: "failed", reason: "exception_park_failed" };
  // Carry the reason (`ambiguous_match`) onto the outcome so the report explains
  // WHY the row was parked, not merely that it was (agent-native review).
  return { ...input.base, kind: "exception", reason: input.reason };
}

/* ═══════════════════════════════════════════════════════════════ the chunk ══ */

export type RunFwImportChunkResult = { outcomes: FwImportOutcome[] };

/**
 * Provision one chunk of rows, in order, SEQUENTIALLY.
 *
 * Sequential deliberately: each mint hits the Auth admin API, and hammering it in
 * parallel across a chunk risks rate limits and muddies the per-row report; the
 * chunk boundary (client-driven) is where throughput comes from, not per-row
 * concurrency. Never rejects — a row that throws or fails is one `failed` outcome,
 * and the chunk keeps going (G19).
 */
export async function runFwImportChunk(
  db: SupabaseClient,
  input: { cohortId: string; actorUserId: string; rows: readonly FwImportRowInput[] }
): Promise<RunFwImportChunkResult> {
  const outcomes: FwImportOutcome[] = [];
  for (const row of input.rows) {
    try {
      outcomes.push(
        await runFwImportRow(db, {
          cohortId: input.cohortId,
          actorUserId: input.actorUserId,
          row,
        })
      );
    } catch (e) {
      // A throw from deep in the provisioning stack must not take the chunk down.
      console.error(`[fw/import] row ${row.rowNumber} (${row.firstName} ${row.lastName}) threw:`, e);
      outcomes.push({
        rowNumber: row.rowNumber,
        firstName: row.firstName,
        lastName: row.lastName,
        band: row.band,
        kind: "failed",
        reason: "unexpected_error",
      });
    }
  }
  return { outcomes };
}

/* ═══════════════════════════════════════════════ the ops-side exception list ══ */

export type FwOpsImportException = {
  id: string;
  firstName: string;
  lastName: string;
  band: string;
  reason: string;
  state: string;
  createdAt: string | null;
  resolvedAt: string | null;
};

const EXCEPTION_COLUMNS =
  "id, first_name, last_name, band, reason, state, created_at, resolved_at";

/**
 * The cohort's import exceptions — pending by default, all when staff ask.
 *
 * PAGINATED with the deterministic `.order("id")` before `.range()` (the 1000-row
 * cliff discipline). Fails the WHOLE read on error rather than rendering an empty
 * list — a pre-event checklist that silently shows "no exceptions" over a blip
 * passes a gate it should fail (G7). Sorted newest-first in memory after the
 * id-ordered paging, with a stable id tiebreaker.
 */
export async function listFwImportExceptions(
  db: SupabaseClient,
  input: { cohortId: string; includeResolved?: boolean }
): Promise<{ ok: true; exceptions: FwOpsImportException[] } | { ok: false }> {
  const rows = await fetchAllRows<Record<string, unknown>>(
    `import exceptions (${input.cohortId})`,
    (from, to) => {
      const q = db
        .from("path_fw_import_exceptions")
        .select(EXCEPTION_COLUMNS)
        .eq("cohort_id", input.cohortId);
      return (input.includeResolved ? q : q.eq("state", "pending"))
        .order("id", { ascending: true })
        .range(from, to);
    }
  );
  if (!rows.ok) return { ok: false };

  const exceptions: FwOpsImportException[] = [];
  for (const row of rows.rows) {
    if (
      typeof row.id !== "string" ||
      typeof row.first_name !== "string" ||
      typeof row.last_name !== "string" ||
      typeof row.band !== "string"
    ) {
      console.error(`[fw/import] dropped an unreadable exception row (id=${String(row.id)})`);
      continue;
    }
    exceptions.push({
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      band: row.band,
      reason: typeof row.reason === "string" ? row.reason : "",
      state: typeof row.state === "string" ? row.state : "",
      createdAt: typeof row.created_at === "string" ? row.created_at : null,
      resolvedAt: typeof row.resolved_at === "string" ? row.resolved_at : null,
    });
  }
  exceptions.sort((a, b) => {
    const byTime = (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
    return byTime !== 0 ? byTime : b.id.localeCompare(a.id);
  });
  return { ok: true, exceptions };
}

export type FwImportExceptionDisposition = "resolved" | "dismissed";

export type ResolveFwImportExceptionResult =
  | { ok: true }
  | { ok: false; reason: "not_open" | "unavailable" };

/**
 * Close one pending exception — `resolved` (staff linked/created the student) or
 * `dismissed` (staff judged it noise). NOT an audit action (Scope Boundaries scope
 * the liability audit to anonymize and guide-grant changes); `resolved_by`/`_at`
 * on the row itself is its attribution, the same as a replay reject.
 *
 * SCOPED to the cohort AND CAS'd on `state='pending'`, so a forged id from another
 * weekend cannot be closed, and a double-submit (or a timed-out write that
 * actually landed) re-reads zero pending rows and reports `not_open` — the truth.
 */
export async function resolveFwImportException(
  db: SupabaseClient,
  input: {
    exceptionId: string;
    cohortId: string;
    actorUserId: string;
    disposition: FwImportExceptionDisposition;
    now: number;
  }
): Promise<ResolveFwImportExceptionResult> {
  const res = await fwWrite(
    () =>
      db
        .from("path_fw_import_exceptions")
        .update({
          state: input.disposition,
          resolved_at: new Date(input.now).toISOString(),
          resolved_by: input.actorUserId,
        })
        .eq("id", input.exceptionId)
        .eq("cohort_id", input.cohortId)
        .eq("state", "pending")
        .select("id"),
    `import exception resolve (${input.exceptionId})`
  );
  if (res.error) {
    console.error(`[fw/import] exception resolve failed for ${input.exceptionId}: ${res.error.message}`);
    return { ok: false, reason: "unavailable" };
  }
  if ((res.data ?? []).length === 0) return { ok: false, reason: "not_open" };
  return { ok: true };
}

/* ═══════════════════════════════════════════════ what the Server Actions return ══ */

/**
 * The action-layer result types live HERE, in the plain module — a type leaving a
 * `"use server"` file gets a `registerServerReference` wrapper emitted for it and
 * throws at module load (docs/solutions/runtime-errors/use-server-type-reexport-
 * registers-server-reference-referenceerror-2026-07-22.md).
 */
export type ImportChunkActionResult =
  | { success: true; outcomes: FwImportOutcome[] }
  | { success: false; error: string };

export type ResolveImportExceptionActionResult =
  | { success: true }
  | { success: false; error: string };
