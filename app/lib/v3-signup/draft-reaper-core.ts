/**
 * The v3 onboarding-draft REAPER, as a deps-injected core. House core pattern:
 * NO `"use server"`, NO `server-only` — the cron route hands in a service-role
 * `db`, a blob adapter and a clock; tests hand in fakes. Every DECISION lives in
 * `draft-reaper-rules.ts`; this file sequences the effects and reports.
 *
 * Shape and posture copied from the two crons this is a sibling of:
 * `app/api/cron/path-evidence-reaper` (per-run delete cap, capped runs surfaced
 * explicitly) and `app/api/cron/funnel-retention` (unparsable timestamps skipped
 * loudly and never treated as infinitely old; a failed pass alerts rather than
 * silently missing its schedule).
 *
 * ── WHAT IT SWEEPS ──
 * 1. ABANDONED DRAFTS, past `DRAFT_RETENTION_MS` (30 days — the plan's data
 *    retention commitment about a minor's first name, last name, age and story
 *    answers). A STATUS FLIP, not a row delete: the dashboard shows the reaped
 *    state honestly, and the sweep stays idempotent and re-runnable
 *    (migration 20260912120000's own design for this reaper).
 * 2. RESIDUAL EXTERNAL OBJECTS on terminal drafts — a source photo whose
 *    best-effort delete failed, and the retry of a claimed reap whose store
 *    deletes did not finish.
 * 3. ORPHANED ADD-KID ATTEMPTS + their consent rows: the backstop for
 *    `v3AddKid`'s inline compensation failing (whole-branch review, finding 3).
 *
 * ── THE ORDER: OBJECT BEFORE THE POINTER THAT NAMES IT ──
 * docs/solutions/best-practices/an-erasure-obligation-must-be-enforced-against-
 * the-schema-not-remembered-2026-08-06.md: a row delete drops the pointer, not
 * the bytes, and a Blob URL stays readable forever until the object is deleted.
 * So the blob key column is nulled ONLY after the store confirms the object is
 * gone; a store failure leaves the key exactly where it is, which is what makes
 * the next run find it. The status flip that PRECEDES the deletes is a CLAIM,
 * not the erasure: it stops `writeDraft` (which requires `status = 'active'`)
 * from resurrecting the row underneath us, and a claimed row that still names
 * keys is re-read by the residual sweep on the next run.
 *
 * ── AND THE ONE THING IT MUST NEVER DO ──
 * Reap a live family's in-progress draft. Every guard is in the rules module and
 * every one fails closed; this file adds one more, at the write: the reap CAS
 * re-asserts `status = 'active' AND child_id IS NULL` in the WHERE, so a draft
 * that was resumed or provisioned between the read and the write matches zero
 * rows and is left completely alone.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { planSubjectBlobDeletes } from "@/app/lib/funnel/erase-family-rules";
import {
  DRAFT_RETENTION_MS,
  MAX_DRAFTS_PER_RUN,
  MAX_ORPHANS_PER_RUN,
  ORPHAN_ATTEMPT_MIN_AGE_MS,
  draftReapVerdict,
  orphanAttemptVerdict,
  parseTimestampMs,
  type DraftBlobTarget,
  type DraftReapCandidate,
  type DraftSkipReason,
} from "./draft-reaper-rules";

/* ------------------------------------------------------------------- deps */

export type DraftReaperDeps = {
  /** Service-role client. `fp_onboarding_drafts`, `fp_signup_attempts` and
   *  `fp_parental_consent` are all RLS-on with ZERO policies. */
  db: SupabaseClient;
  /**
   * Delete ONE object from the blob store, by key. SAME contract as the erasure
   * path's dep (app/lib/funnel/erase-family-core.ts): "missing" (already gone)
   * is SUCCESS; "error" is a real store failure and is stranded, never
   * swallowed. Deliberately the same shape rather than a second mechanism — one
   * adapter, wired once, serves both obligations.
   */
  deleteBlob?: (key: string) => Promise<"deleted" | "missing" | "error">;
  /**
   * False when no blob adapter is wired (today: always — covers are inline data
   * URLs and every blob-key column is NULL in production). NOT a benign skip: a
   * row that actually names an object with no way to delete it is STRANDED, so
   * the day the AI path starts writing objects without this being wired, the run
   * says so instead of quietly reporting success.
   */
  blobConfigured: boolean;
  now: () => number;
};

/* ---------------------------------------------------------------- summary */

export type DraftReaperSummary = {
  ok: boolean;
  drafts: {
    scanned: number;
    /** Rows flipped `active` → `reaped` on this run. */
    reaped: number;
    /** Rows whose reap CAS matched nothing — resumed or provisioned between the
     *  read and the write. The designed outcome, not a fault. */
    raced: number;
    /** Terminal rows whose residual objects were swept. */
    residualSwept: number;
    skipped: Partial<Record<DraftSkipReason, number>>;
    capped: boolean;
  };
  blobs: { deleted: number; missing: number; errored: number; refused: number; unconfigured: number };
  orphans: {
    scanned: number;
    attemptsSwept: number;
    consentSwept: number;
    capped: boolean;
  };
  /** Anything that failed. Non-empty ⇒ `ok:false`, exactly like the eraser. */
  stranded: string[];
};

const emptySummary = (): DraftReaperSummary => ({
  ok: true,
  drafts: { scanned: 0, reaped: 0, raced: 0, residualSwept: 0, skipped: {}, capped: false },
  blobs: { deleted: 0, missing: 0, errored: 0, refused: 0, unconfigured: 0 },
  orphans: { scanned: 0, attemptsSwept: 0, consentSwept: 0, capped: false },
  stranded: [],
});

const countSkip = (summary: DraftReaperSummary, reason: DraftSkipReason): void => {
  summary.drafts.skipped[reason] = (summary.drafts.skipped[reason] ?? 0) + 1;
};

/* ----------------------------------------------------------------- blobs */

const DRAFT_SELECT =
  "id, status, cover_status, child_id, updated_at, photo_blob_key, cover_blob_key";

const toCandidate = (row: Record<string, unknown>): DraftReapCandidate => ({
  id: String(row.id),
  status: String(row.status ?? ""),
  coverStatus: String(row.cover_status ?? ""),
  childId: typeof row.child_id === "string" && row.child_id.length > 0 ? row.child_id : null,
  updatedAtMs: parseTimestampMs(row.updated_at),
  photoBlobKey: typeof row.photo_blob_key === "string" ? row.photo_blob_key : null,
  coverBlobKey: typeof row.cover_blob_key === "string" ? row.cover_blob_key : null,
});

/**
 * Delete one draft's objects and null the columns the store confirmed. Returns
 * how many targets are still outstanding, so the caller can leave the row for
 * the next run instead of claiming a finished job.
 *
 * Ownership is re-checked through the erasure path's own
 * `planSubjectBlobDeletes` — a key outside the draft's namespace is REFUSED and
 * stranded, never deleted. That is not paranoia about our own writer; it is the
 * one check that keeps a corrupted or hand-edited key from aiming this loop at
 * somebody else's object.
 */
async function sweepTargets(
  deps: DraftReaperDeps,
  summary: DraftReaperSummary,
  draftId: string,
  targets: readonly DraftBlobTarget[]
): Promise<number> {
  let outstanding = 0;
  for (const target of targets) {
    const [planned] = planSubjectBlobDeletes({
      scope: "draft",
      ownerId: draftId,
      keys: [target.key],
    });
    if (!planned || !planned.owned) {
      console.error(
        `[v3/draft-reaper] STRANDED: refusing to delete blob key outside draft ${draftId}'s namespace`
      );
      summary.blobs.refused++;
      summary.stranded.push(`blob:not_owned:draft:${draftId}`);
      outstanding++;
      continue;
    }
    const del = deps.deleteBlob;
    if (!deps.blobConfigured || !del) {
      console.error(
        `[v3/draft-reaper] STRANDED: draft ${draftId} names blob ${target.key} but no blob adapter is configured — the object SURVIVES; wire the adapter and re-run`
      );
      summary.blobs.unconfigured++;
      summary.stranded.push(`blob:unconfigured:draft:${draftId}`);
      outstanding++;
      continue;
    }
    let outcome: "deleted" | "missing" | "error";
    try {
      outcome = await del(target.key);
    } catch (err) {
      // A throwing adapter is an outage, not a success (the eraser's rule).
      console.error(
        `[v3/draft-reaper] blob delete threw for draft ${draftId}: ${err instanceof Error ? err.message : String(err)}`
      );
      outcome = "error";
    }
    if (outcome === "error") {
      console.error(
        `[v3/draft-reaper] STRANDED: blob delete failed for draft ${draftId} — the key is LEFT IN PLACE so the next run finds it`
      );
      summary.blobs.errored++;
      summary.stranded.push(`blob:error:draft:${draftId}`);
      outstanding++;
      continue;
    }
    if (outcome === "deleted") summary.blobs.deleted++;
    else summary.blobs.missing++; // already gone = a completed erasure

    // ONLY NOW may the pointer go. Scoped by the key as well as the column, so a
    // concurrent writer that replaced the key is not silently overwritten.
    const cleared = await deps.db
      .from("fp_onboarding_drafts")
      .update({ [target.column]: null })
      .eq("id", draftId)
      .eq(target.column, target.key);
    if (cleared.error) {
      console.error(
        `[v3/draft-reaper] STRANDED: draft ${draftId} ${target.column} clear failed after the object was deleted: ${cleared.error.message} — the row names a key whose object is gone`
      );
      summary.stranded.push(`draft:key_clear:${draftId}:${cleared.error.message}`);
      outstanding++;
    }
  }
  return outstanding;
}

/* ------------------------------------------------------------ draft sweep */

async function reapDrafts(deps: DraftReaperDeps, summary: DraftReaperSummary): Promise<void> {
  const nowMs = deps.now();
  /** Drafts pass (a) already touched. Pass (b) reads by STATUS, and pass (a)
   *  just flipped its rows to `reaped` — without this, every row reaped in this
   *  run would immediately be re-swept by pass (b), double-counting its blobs
   *  and duplicating any strand. The retry belongs to the NEXT run. */
  const handled = new Set<string>();

  // (a) ABANDONED ACTIVE DRAFTS. The cutoff is pushed into the query so the
  //     partial `(updated_at) WHERE status='active'` index does the work and a
  //     healthy table returns nothing at all. The rules module re-checks the
  //     bound anyway — the query is an optimization, never the decision.
  const retentionCutoff = new Date(nowMs - DRAFT_RETENTION_MS).toISOString();
  const active = await deps.db
    .from("fp_onboarding_drafts")
    .select(DRAFT_SELECT)
    .eq("status", "active")
    .lt("updated_at", retentionCutoff)
    .limit(MAX_DRAFTS_PER_RUN + 1);
  if (active.error) {
    console.error(`[v3/draft-reaper] active-draft read failed: ${active.error.message}`);
    summary.stranded.push(`drafts:read_active:${active.error.message}`);
  } else {
    const rows = (active.data ?? []) as unknown as Record<string, unknown>[];
    if (rows.length > MAX_DRAFTS_PER_RUN) summary.drafts.capped = true;
    for (const row of rows.slice(0, MAX_DRAFTS_PER_RUN)) {
      summary.drafts.scanned++;
      const candidate = toCandidate(row);
      const verdict = draftReapVerdict(candidate, nowMs);
      if (verdict.kind !== "reap") {
        if (verdict.kind === "skip") countSkip(summary, verdict.reason);
        continue;
      }
      // THE CLAIM. Re-asserting `status='active' AND child_id IS NULL` in the
      // WHERE is what makes "never reap a live draft" a property of the WRITE
      // rather than of how fresh the read was: a family that resumed (bumping
      // updated_at) or provisioned (stamping child_id) in the meantime matches
      // zero rows here and is untouched.
      const claimed = await deps.db
        .from("fp_onboarding_drafts")
        .update({
          status: "reaped",
          // The dashboard's honest reaped state (migration 20260912120000).
          cover_status: "reaped",
          updated_at: new Date(nowMs).toISOString(),
        })
        .eq("id", candidate.id)
        .eq("status", "active")
        .is("child_id", null)
        .select("id");
      if (claimed.error) {
        console.error(`[v3/draft-reaper] reap claim failed for ${candidate.id}: ${claimed.error.message}`);
        summary.stranded.push(`draft:claim:${candidate.id}:${claimed.error.message}`);
        continue;
      }
      if (((claimed.data as unknown[] | null) ?? []).length === 0) {
        // Somebody legitimately got there first. The designed outcome.
        summary.drafts.raced++;
        continue;
      }
      summary.drafts.reaped++;
      handled.add(candidate.id);
      await sweepTargets(deps, summary, candidate.id, verdict.targets);
    }
  }

  // (b) RESIDUE ON TERMINAL ROWS: a consumed draft's un-deleted source photo,
  //     and the retry of a claimed reap whose store deletes did not finish.
  //     Read by "not active AND names an object", so a healthy table (every key
  //     NULL — the production reality today) returns nothing.
  //     NO age filter in the QUERY, deliberately. The claim above bumps
  //     `updated_at`, so a `<  now - RESIDUAL_PHOTO_MIN_AGE_MS` predicate here
  //     would hide a just-claimed row whose store deletes failed for a whole day
  //     — the retry would be the one thing the read could not see. The AGE rule
  //     still applies; it lives in `draftReapVerdict`, which waits out the bound
  //     for a `consumed` row and applies none to a `reaped` one. The set this
  //     scans is bounded by "terminal AND names an object", which in production
  //     today is empty.
  const terminal = await deps.db
    .from("fp_onboarding_drafts")
    .select(DRAFT_SELECT)
    .neq("status", "active")
    .or("photo_blob_key.not.is.null,cover_blob_key.not.is.null")
    .limit(MAX_DRAFTS_PER_RUN);
  if (terminal.error) {
    console.error(`[v3/draft-reaper] terminal-draft read failed: ${terminal.error.message}`);
    summary.stranded.push(`drafts:read_terminal:${terminal.error.message}`);
    return;
  }
  for (const row of (terminal.data ?? []) as unknown as Record<string, unknown>[]) {
    const candidate = toCandidate(row);
    if (handled.has(candidate.id)) continue;
    summary.drafts.scanned++;
    const verdict = draftReapVerdict(candidate, nowMs);
    if (verdict.kind !== "sweep_residual") {
      if (verdict.kind === "skip") countSkip(summary, verdict.reason);
      continue;
    }
    const outstanding = await sweepTargets(deps, summary, candidate.id, verdict.targets);
    if (outstanding === 0) summary.drafts.residualSwept++;
  }
}

/* ----------------------------------------------------------- orphan sweep */

/**
 * The backstop for `v3AddKid`'s inline compensation (whole-branch review,
 * finding 3). An add-kid call that lost the draft race unwinds its own attempt
 * and consent; if THAT fails, the rows are litter — an attempt bound to nothing
 * and a consent affirmation for a child that never came into being.
 *
 * The consent row is why this is written the careful way round. It is legal
 * evidence, so the sweep proves FIVE independent times that nothing real depends
 * on the attempt (see `orphanAttemptVerdict`), and deletes the consent FIRST:
 * `fp_parental_consent.signup_attempt_id` is ON DELETE SET NULL, so removing the
 * attempt first would null the only link and leave the evidence permanently
 * unfindable by attempt — the precise orphan this exists to collect.
 */
async function sweepOrphanAttempts(
  deps: DraftReaperDeps,
  summary: DraftReaperSummary
): Promise<void> {
  const nowMs = deps.now();
  const cutoff = new Date(nowMs - ORPHAN_ATTEMPT_MIN_AGE_MS).toISOString();
  const attempts = await deps.db
    .from("fp_signup_attempts")
    .select(
      "id, state, child_id, updated_at, verification_code_hash, verification_token_hash"
    )
    .eq("state", "verified")
    .is("child_id", null)
    .is("verification_code_hash", null)
    .is("verification_token_hash", null)
    .lt("updated_at", cutoff)
    .limit(MAX_ORPHANS_PER_RUN + 1);
  if (attempts.error) {
    console.error(`[v3/draft-reaper] orphan-attempt read failed: ${attempts.error.message}`);
    summary.stranded.push(`attempts:read:${attempts.error.message}`);
    return;
  }
  const rows = (attempts.data ?? []) as unknown as Record<string, unknown>[];
  if (rows.length > MAX_ORPHANS_PER_RUN) summary.orphans.capped = true;

  for (const row of rows.slice(0, MAX_ORPHANS_PER_RUN)) {
    summary.orphans.scanned++;
    const id = String(row.id);

    // The two facts the query cannot express, read per candidate. BOTH fail
    // CLOSED: a read error means "assume something depends on this row".
    const drafts = await deps.db
      .from("fp_onboarding_drafts")
      .select("id")
      .eq("signup_attempt_id", id)
      .limit(1);
    if (drafts.error) {
      console.error(`[v3/draft-reaper] draft-link read failed for attempt ${id}: ${drafts.error.message}`);
      summary.stranded.push(`attempts:draft_link:${id}:${drafts.error.message}`);
      continue;
    }
    const consents = await deps.db
      .from("fp_parental_consent")
      .select("id, child_id")
      .eq("signup_attempt_id", id);
    if (consents.error) {
      console.error(`[v3/draft-reaper] consent read failed for attempt ${id}: ${consents.error.message}`);
      summary.stranded.push(`attempts:consent_read:${id}:${consents.error.message}`);
      continue;
    }
    const consentRows = (consents.data ?? []) as unknown as Record<string, unknown>[];

    const verdict = orphanAttemptVerdict(
      {
        id,
        state: String(row.state ?? ""),
        hasVerificationSecret:
          row.verification_code_hash != null || row.verification_token_hash != null,
        childId: typeof row.child_id === "string" && row.child_id.length > 0 ? row.child_id : null,
        hasDraft: ((drafts.data as unknown[] | null) ?? []).length > 0,
        hasChildBoundConsent: consentRows.some((c) => c.child_id != null),
        updatedAtMs: parseTimestampMs(row.updated_at),
      },
      nowMs
    );
    if (verdict.kind !== "sweep") continue;

    // Consent FIRST (the SET-NULL link), then the attempt.
    const consentDel = await deps.db
      .from("fp_parental_consent")
      .delete()
      .eq("signup_attempt_id", id)
      .select("id");
    if (consentDel.error) {
      console.error(
        `[v3/draft-reaper] STRANDED: orphan consent delete failed for attempt ${id}: ${consentDel.error.message} — the attempt is LEFT so the link survives for the next run`
      );
      summary.stranded.push(`consent:delete:${id}:${consentDel.error.message}`);
      continue;
    }
    summary.orphans.consentSwept += ((consentDel.data as unknown[] | null) ?? []).length;

    const attemptDel = await deps.db.from("fp_signup_attempts").delete().eq("id", id).select("id");
    if (attemptDel.error) {
      console.error(
        `[v3/draft-reaper] STRANDED: orphan attempt delete failed for ${id}: ${attemptDel.error.message}`
      );
      summary.stranded.push(`attempts:delete:${id}:${attemptDel.error.message}`);
      continue;
    }
    summary.orphans.attemptsSwept += ((attemptDel.data as unknown[] | null) ?? []).length;
  }
}

/* -------------------------------------------------------------- entrypoint */

/**
 * One reaper run. NEVER throws — returns a typed summary with a `stranded` list,
 * exactly like `eraseFamily`, so a partial failure is triaged and re-run rather
 * than mistaken for a clean pass. Idempotent and re-runnable end to end.
 */
export async function reapOnboardingDrafts(
  deps: DraftReaperDeps
): Promise<DraftReaperSummary> {
  const summary = emptySummary();
  try {
    await reapDrafts(deps, summary);
  } catch (err) {
    console.error(`[v3/draft-reaper] draft sweep threw: ${err instanceof Error ? err.message : String(err)}`);
    summary.stranded.push(`exception:drafts:${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    // Independently try/caught: a draft-sweep fault must not starve the orphan
    // backstop (the funnel-retention cron's rule about its own sweeps).
    await sweepOrphanAttempts(deps, summary);
  } catch (err) {
    console.error(`[v3/draft-reaper] orphan sweep threw: ${err instanceof Error ? err.message : String(err)}`);
    summary.stranded.push(`exception:orphans:${err instanceof Error ? err.message : String(err)}`);
  }
  summary.ok = summary.stranded.length === 0;
  return summary;
}
