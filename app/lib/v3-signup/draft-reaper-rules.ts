/**
 * The v3 onboarding-draft REAPER's decisions, as pure functions. No Supabase, no
 * clock, no blob store — the core (`draft-reaper-core.ts`) sequences the effects
 * and the route (`app/api/cron/v3-draft-reaper/route.ts`) is a thin auth + deps
 * wrapper. Repo canon: pure rules → deps-injected core → thin route.
 *
 * ── WHY THIS EXISTS ──
 * The plan promises abandoned drafts are reaped after 30 days
 * (docs/plans/2026-08-05-001-feat-new-user-flow-v3-plan.md, "Draft record is a
 * table, not client state": "abandoned drafts reaped after 30 days (photo blob
 * deleted; dashboard shows the reaped state honestly)"). That is a data-
 * retention commitment about a MINOR: an `fp_onboarding_drafts` row holds a
 * child's first name, last name, AGE and free-text STORY ANSWERS, plus keys
 * naming their photo and their cover in an external store. The migration that
 * created the table (20260912120000) designed the reaper in detail and named the
 * columns it would key on. Nothing implemented it, and `vercel.json` had six
 * cron routes, none of which touched the table. A promise with no code is not a
 * retention policy.
 *
 * ── THE ONE BOUNDARY THAT MATTERS: NEVER REAP A LIVE FAMILY ──
 * Reaping a family's in-progress draft is strictly worse than not reaping at
 * all — they lose a half-finished child record, their cover, and their place in
 * the flow, silently. So every predicate here fails CLOSED, and the reap verdict
 * requires ALL of:
 *   1. `status = 'active'`. `consumed` (a child was minted) and `reaped`
 *      (already done) are terminal and are never reap candidates.
 *   2. `child_id IS NULL`. This is the draft's OWN column, stamped at
 *      provisioning — never a join to `fp_signup_attempts`, whose
 *      `child_created` advance is deliberately non-fatal, so a perfectly good
 *      child can sit behind an attempt still in state `verified` (the migration
 *      spells this out; reaping on the attempt join would delete a live child's
 *      cover blob).
 *   3. `updated_at` — the REAPING CLOCK, not `created_at` — older than
 *      `DRAFT_RETENTION_MS`. A family that started 29 days ago and came back
 *      today has an old `created_at` and a fresh `updated_at`, and must not be
 *      reaped out from under the tab they are looking at. Every writer bumps it
 *      (`writeDraft` in v3-onboarding-core.ts is the single write path).
 *   4. An UNREADABLE clock is a SKIP, never "infinitely old" — the
 *      funnel-retention cron's rule, and the same reasoning: the destructive
 *      direction may never be the default for a row we cannot date.
 *   5. A cover generation genuinely in flight is left alone
 *      (`GENERATION_IN_FLIGHT_MS`). Redundant at a 30-day bound and kept anyway:
 *      it is the guard that stays correct if the retention bound is ever
 *      shortened, and it costs one comparison.
 */

/* ------------------------------------------------------------- the bounds */

/**
 * THE RETENTION BOUNDARY, in one named constant, derived from the plan's
 * "abandoned drafts reaped after 30 days". Measured against `updated_at`.
 */
export const DRAFT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** A draft whose cover is `generating` is left alone until this much time has
 *  passed since its last write, so a live generation is never reaped mid-flight.
 *  Far shorter than the retention bound (the route's `maxDuration` is 60s, and
 *  the background regen is minutes at worst), so it never delays a reap in
 *  practice — it is the guard that keeps the sweep correct if the retention
 *  bound is ever shortened. */
export const GENERATION_IN_FLIGHT_MS = 60 * 60 * 1000;

/**
 * A TERMINAL draft (consumed / reaped) that still names a source photo is a
 * FAILED best-effort delete, not a live one: Unit 4 removes the source photo
 * immediately after a successful `final` generation, and the carry copies the
 * cover to a child-namespaced key. Anything still named a day after the draft's
 * last write is residue, and this sweep is what makes the "photo deleted
 * promptly" promise eventually-true (migration 20260912120000's reaper note).
 * Deliberately NOT the 30-day bound: a minor's photograph is the sharpest thing
 * in this table, and there is no reason to hold it for a month after the row
 * that needed it went terminal.
 */
export const RESIDUAL_PHOTO_MIN_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * A `v3AddKid` that lost the draft race compensates its own attempt + consent
 * inline (v3-onboarding-core.ts `compensateAddKid`). This sweep is the BACKSTOP
 * for when that compensation itself failed — a DB fault at exactly the wrong
 * moment. It is deliberately generous: an attempt with no draft and no child is
 * only litter once it is far too old to be part of anything in flight. A v3
 * onboarding sitting is minutes; seven days is four orders of magnitude of
 * headroom.
 */
export const ORPHAN_ATTEMPT_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Runaway protection, per run, per sweep. Mirrors the path-evidence reaper's
 *  `MAX_DELETES_PER_RUN`: a capped run is reported explicitly, because a silent
 *  truncation reads as "all clean". */
export const MAX_DRAFTS_PER_RUN = 500;
export const MAX_ORPHANS_PER_RUN = 500;

/* --------------------------------------------------------- draft verdicts */

/** The draft columns the sweep reads, already parsed. `updatedAtMs` is `null`
 *  when the stored timestamp is absent or unparsable — which is a SKIP. */
export type DraftReapCandidate = {
  id: string;
  /** `active` | `consumed` | `reaped` (the table's CHECK). */
  status: string;
  /** The cover status CHECK's value; only `generating` changes the verdict. */
  coverStatus: string;
  /** The draft's OWN child stamp. Non-null = a child was minted: never reap. */
  childId: string | null;
  updatedAtMs: number | null;
  photoBlobKey: string | null;
  coverBlobKey: string | null;
};

export type DraftSkipReason =
  | "not_active"
  | "carried_to_child"
  | "within_retention"
  | "unreadable_clock"
  | "nothing_to_sweep";

/** One object to delete, WITH the column that names it — the core nulls exactly
 *  that column once the store confirms the object is gone, so a partial failure
 *  leaves the surviving key (and therefore the retry) precisely targeted. */
export type DraftBlobTarget = {
  column: "photo_blob_key" | "cover_blob_key";
  key: string;
};

export type DraftReapVerdict =
  /** Abandoned past the retention bound: claim the row (`status = 'reaped'`),
   *  delete every object it names, then null each key the store confirmed. */
  | { kind: "reap"; targets: DraftBlobTarget[] }
  /**
   * A TERMINAL draft still naming an object. Two cases, both residue:
   *   - `consumed` — the source photo whose best-effort delete failed. Only the
   *     PHOTO: a consumed draft's `cover_blob_key` is deliberately left alone,
   *     because "the carry copies the cover to a child-namespaced key" is a
   *     property of the carry, and if it ever failed to copy, deleting here
   *     would erase a live child's cover. Residue is cheap; that is not.
   *   - `reaped` — a prior run claimed the row and then could not finish the
   *     store deletes (an outage, or no adapter). BOTH keys, no extra age gate:
   *     the row is past retention by construction and this is the retry.
   * The row's status is NOT changed by this sweep.
   */
  | { kind: "sweep_residual"; targets: DraftBlobTarget[] }
  | { kind: "skip"; reason: DraftSkipReason };

/** The targets a candidate names, in a stable order, blanks and repeats
 *  dropped. */
function targetsOf(
  candidate: DraftReapCandidate,
  columns: readonly DraftBlobTarget["column"][]
): DraftBlobTarget[] {
  const out: DraftBlobTarget[] = [];
  const seen = new Set<string>();
  for (const column of columns) {
    const raw = column === "photo_blob_key" ? candidate.photoBlobKey : candidate.coverBlobKey;
    const key = (raw ?? "").trim();
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push({ column, key });
  }
  return out;
}

/**
 * How old an ACTIVE draft must be before it may be reaped: the retention bound,
 * and — for a draft whose cover is still `generating` — never less than the
 * generation timeout either.
 *
 * Written as a MAX rather than as a second `if` on purpose. The migration asked
 * for a "skip fresh `generating` rows" guard, but at today's 30-day retention
 * that guard is FULLY SUBSUMED: nothing can be simultaneously 30 days stale and
 * within an hour of a live generation, so a separate branch would be code no
 * test could ever reach — and unreachable code that guards a destructive action
 * is worse than none, because it reads as protection. As a max it is honest
 * (identical behaviour today, one comparison) and it becomes load-bearing the
 * instant someone shortens the retention bound, which is exactly the moment it
 * has to already be here.
 */
export function effectiveReapBoundMs(coverStatus: string): number {
  return coverStatus === "generating"
    ? Math.max(DRAFT_RETENTION_MS, GENERATION_IN_FLIGHT_MS)
    : DRAFT_RETENTION_MS;
}

/**
 * The whole decision for one draft. Total, pure, and ordered so the SAFE
 * refusals are checked before anything destructive is contemplated.
 */
export function draftReapVerdict(
  candidate: DraftReapCandidate,
  nowMs: number
): DraftReapVerdict {
  // Fail closed on a row we cannot date. An unparsable clock must never read as
  // "old enough" — that is the one mistake with no undo.
  if (candidate.updatedAtMs === null || !Number.isFinite(candidate.updatedAtMs)) {
    return { kind: "skip", reason: "unreadable_clock" };
  }
  const ageMs = nowMs - candidate.updatedAtMs;

  if (candidate.status !== "active") {
    // Terminal. Collect residue only — see `sweep_residual`'s doc for why a
    // `consumed` draft's COVER key is deliberately out of scope. (This is
    // checked on terminal rows only: an ACTIVE draft's photo may still be
    // wanted for a regeneration, so it rides along with the reap or not at
    // all.)
    const reapedRetry = candidate.status === "reaped";
    const targets = targetsOf(
      candidate,
      reapedRetry ? ["photo_blob_key", "cover_blob_key"] : ["photo_blob_key"]
    );
    if (targets.length === 0) return { kind: "skip", reason: "not_active" };
    // A reaped row is the RETRY of a claimed reap: no extra wait, it is already
    // past retention. A consumed row waits out the residual-photo bound.
    if (reapedRetry || ageMs >= RESIDUAL_PHOTO_MIN_AGE_MS) {
      return { kind: "sweep_residual", targets };
    }
    return { kind: "skip", reason: "nothing_to_sweep" };
  }

  // A child was minted from this draft. Its cover blob has been carried, its
  // answers belong to a real account, and the dashboard renders it. Never.
  if (candidate.childId !== null) return { kind: "skip", reason: "carried_to_child" };

  // THE RETENTION BOUNDARY. `>=`, not `>`: at exactly the bound the row has
  // served its full 30 days.
  if (ageMs < effectiveReapBoundMs(candidate.coverStatus)) {
    return { kind: "skip", reason: "within_retention" };
  }

  return { kind: "reap", targets: targetsOf(candidate, ["photo_blob_key", "cover_blob_key"]) };
}

/* -------------------------------------------------- orphan attempt verdicts */

/**
 * An `fp_signup_attempts` row the sweep may consider collecting, with the facts
 * that decide it already gathered.
 *
 * ── THE DISCRIMINATOR: A LOOP-ENTRY ATTEMPT CARRIES NO SECRET ──
 * `v3AddKid` inserts its per-kid attempt in state `verified` with NO
 * verification secret at all (v3-onboarding-core.ts's module header states this
 * as an invariant: no code hash, no token hash, no expiry). Every OTHER verified
 * attempt got there by redeeming something, and neither redeem path ever clears
 * the hash it matched — so `verification_code_hash IS NULL AND
 * verification_token_hash IS NULL` selects add-kid attempts and nothing else. A
 * parent's step-1 attempt keeps its code hash forever and is invisible here.
 */
export type OrphanAttemptCandidate = {
  id: string;
  /** `started` | `verified` | `child_created` | `complete` | `abandoned`. */
  state: string;
  /** True when `verification_code_hash` or `verification_token_hash` is set. */
  hasVerificationSecret: boolean;
  /** The attempt's own child stamp (`createChild` writes it). */
  childId: string | null;
  /** True when ANY `fp_onboarding_drafts` row names this attempt. */
  hasDraft: boolean;
  /** True when ANY of this attempt's consent rows is BOUND to a child —
   *  `consentGate` binds `child_id` before the child is minted, so a bound
   *  consent means a real child exists even if the attempt's own bookkeeping
   *  never caught up (child-core's state advance is deliberately non-fatal). */
  hasChildBoundConsent: boolean;
  updatedAtMs: number | null;
};

export type OrphanSkipReason =
  | "not_loop_entry_state"
  | "carries_a_verification_secret"
  | "has_child"
  | "has_draft"
  | "consent_bound_to_child"
  | "too_recent"
  | "unreadable_clock";

export type OrphanAttemptVerdict =
  | { kind: "sweep" }
  | { kind: "skip"; reason: OrphanSkipReason };

/**
 * Collect an add-kid attempt (and the consent recorded against it) that reached
 * neither a draft nor a child. Five independent proofs of "nothing real depends
 * on this row" must ALL hold, because the row's consent record is legal evidence
 * and deleting live evidence is the failure mode with no undo.
 */
export function orphanAttemptVerdict(
  candidate: OrphanAttemptCandidate,
  nowMs: number
): OrphanAttemptVerdict {
  if (candidate.updatedAtMs === null || !Number.isFinite(candidate.updatedAtMs)) {
    return { kind: "skip", reason: "unreadable_clock" };
  }
  // `started` belongs to the signup path (its own resume/abandon machinery owns
  // it); `child_created` / `complete` / `abandoned` are all terminal answers
  // this sweep has no business touching.
  if (candidate.state !== "verified") return { kind: "skip", reason: "not_loop_entry_state" };
  if (candidate.hasVerificationSecret) {
    return { kind: "skip", reason: "carries_a_verification_secret" };
  }
  if (candidate.childId !== null) return { kind: "skip", reason: "has_child" };
  if (candidate.hasDraft) return { kind: "skip", reason: "has_draft" };
  if (candidate.hasChildBoundConsent) return { kind: "skip", reason: "consent_bound_to_child" };
  if (nowMs - candidate.updatedAtMs < ORPHAN_ATTEMPT_MIN_AGE_MS) {
    return { kind: "skip", reason: "too_recent" };
  }
  return { kind: "sweep" };
}

/* --------------------------------------------------------------- parsing */

/** Parse a stored timestamp to epoch ms, or `null` when it is absent or
 *  unparsable. `null` is a SKIP everywhere above — never "infinitely old". */
export function parseTimestampMs(iso: unknown): number | null {
  if (typeof iso !== "string" || iso.trim().length === 0) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}
