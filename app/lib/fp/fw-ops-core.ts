/**
 * FW staff-ops core (FW Unit 5; FW-R4, FW-R23, FW-R25, FW-D14) — the db-taking
 * half of the affordances Boston cannot run without: cohorts with dates, board
 * tokens, the guide roster behind a cohort, grant revocation, and the audit row
 * the two liability actions write.
 *
 * PLAIN module by design — no `"use server"` (its exports would become public,
 * unauthenticated Server Actions and the `db` argument cannot serialize) and no
 * `import "server-only"` (so `scripts/fw-ops.ts` can drive it under tsx). Callers
 * own their gate: the ops pages resolve `isFwStaffActor` first and every action
 * re-gates server-side. Same posture and the same stated reason as
 * `fw-guide-core.ts`, `fw-checkin-core.ts`, and `fw-loader.ts` — the COMPOSITION
 * is where this repo has now shipped three P1s, and a composition inside a
 * `"use server"` file is one nothing can test.
 *
 * Every decision that could be wrong lives in `fw-board-rules.ts` /
 * `fw-ops-rules.ts` / `fw-access-rules.ts`; this file adds I/O, sequencing, and
 * compensation.
 *
 * ── Dependency direction
 *
 * The audit writer lives in its own small module, `fw-audit-core.ts`, because
 * `fw-guide-core.ts` needs it too — putting the audit write inside the one
 * function that mutates grants is what makes it un-bypassable, but importing it
 * from HERE dragged cohorts, board tokens and the ops roster reads into the
 * guide door's module graph (maintainability review). Nothing here imports
 * `fw-guide-core`: the ops cohort read wants a wider column set than
 * `loadFwCohort`'s authorization read and is its own query.
 */

import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { FW_COHORT_KIND, fwGuideInviteVerdict } from "./fw-access-rules";
import { hashFwBoardToken } from "./fw-board-token";
import {
  fwBoardTokenMintVerdict,
  fwBoardTokenVerdict,
  pickFwCurrentBoardToken,
} from "./fw-board-rules";
import { recordFwOpsAudit } from "./fw-audit-core";
import { fetchAllRows, fwRead, fwWrite, isUniqueViolation } from "./fw-call";
import { fwMatchKey } from "./fw-match-rules";
import {
  FW_TOMBSTONE_FIRST_NAME,
  FW_TOMBSTONE_LAST_NAME,
  fwAnonymizeConfirmMatches,
  fwArchiveConfirmMatches,
  fwCohortWindowFromLocal,
  isFwTombstoneName,
  narrowFwEventTimeZone,
} from "./fw-ops-rules";
import {
  buildFwTombstoneEmail,
  fwLocalPartFromEmail,
  narrowFwBand,
} from "./fw-provision-rules";

/** SHA-256 hex — the ONLY form a board token is ever stored in, so a database
 *  read can never reconstruct a live projector URL. Sibling of
 *  `hashGuideInviteToken`; Unit 6's board route hashes the presented token with
 *  this same function before looking it up. The definition moved to
 *  `fw-board-token.ts` (a tiny module) so that unauthenticated route need not
 *  import this whole ops core to hash a token; re-exported here so the mint
 *  sequence below and every existing caller keep one import site. */
export { hashFwBoardToken };

/**
 * `isUniqueViolation` moved to `fw-call.ts` in Unit 7's review (one definition,
 * beside `fwRead`/`fwWrite`). Its contract is unchanged: it takes the WIDER error
 * union because an `fwWrite` failure can be a PostgrestError that carries `code`
 * OR the synthetic `{ message }` a timeout/throw produces, which does not — a
 * timed-out insert is emphatically NOT a unique violation, so this returns false
 * for it, routing it to "unavailable" rather than "that slug is taken".
 */

/** Re-exported so the ops surface and its tests have one import site for the
 *  whole ops core. The definition lives in `fw-audit-core.ts` — see the
 *  dependency-direction note above. */
export { recordFwOpsAudit };
export type { RecordFwOpsAuditInput } from "./fw-audit-core";

/* ═════════════════════════════════════════════════════════════════ the cohort ══ */

/** The ops view of a cohort — deliberately wider than `loadFwCohort`'s
 *  authorization shape, which reads `{id, kind}` only. */
export type FwOpsCohort = {
  id: string;
  slug: string;
  kind: string;
  startsAt: string | null;
  endsAt: string | null;
  timeZone: string | null;
  /**
   * Archive state (Unit 7; columns from Unit 6's migration). The READ carries it
   * and callers decide — the plan's settled decision, because the one cohort list
   * feeds surfaces with opposite filters: the header's weekend name must render
   * for an archived cohort a staff member opens, while the guide picker hides
   * archived cohorts from its default view.
   */
  archivedAt: string | null;
  archivedBy: string | null;
};

const COHORT_COLUMNS = "id, slug, kind, starts_at, ends_at, time_zone, archived_at, archived_by";

/**
 * Fail-closed narrowing of a `path_cohorts` row at the service-role boundary.
 *
 * `db` is untyped, so a bare `as string` here would be a promise to the compiler
 * with nothing behind it — and `kind` gates whether a board token may exist at
 * all, while `ends_at` sets how long an unauthenticated read door stays open.
 * `time_zone` is narrowed against the allowlist rather than trusted, because
 * `Intl` throws a RangeError on an unrecognised zone from inside a render.
 */
function narrowOpsCohort(row: Record<string, unknown> | null): FwOpsCohort | null {
  if (!row || typeof row.id !== "string" || typeof row.kind !== "string") return null;
  return {
    id: row.id,
    slug: typeof row.slug === "string" ? row.slug : row.id,
    kind: row.kind,
    startsAt: typeof row.starts_at === "string" ? row.starts_at : null,
    endsAt: typeof row.ends_at === "string" ? row.ends_at : null,
    timeZone: narrowFwEventTimeZone(row.time_zone),
    // FAIL-CLOSED direction, chosen deliberately (plan, deferred item): a value
    // that is not a string — including a row shape from before the Unit 6
    // migration, or a null — reads as NOT archived. Fail-closed here means "the
    // cohort stays VISIBLE": the harmful direction is a phantom archive hiding a
    // live weekend from the ops list, not a stale row rendering one extra line.
    archivedAt: typeof row.archived_at === "string" ? row.archived_at : null,
    archivedBy: typeof row.archived_by === "string" ? row.archived_by : null,
  };
}

/** One fw cohort, with the window and zone the ops surface renders. */
export async function loadFwOpsCohort(
  db: SupabaseClient,
  cohortId: string
): Promise<FwOpsCohort | null> {
  const res = await fwRead(
    () => db.from("path_cohorts").select(COHORT_COLUMNS).eq("id", cohortId).maybeSingle(),
    `ops cohort load (${cohortId})`
  );
  if (res.error) {
    console.error(`[fw/ops] cohort load failed for ${cohortId}: ${res.error.message}`);
    return null;
  }
  return narrowOpsCohort(res.data as Record<string, unknown> | null);
}

export type CreateFwCohortInput = {
  slug: string;
  /** Already converted from local wall clock by `fwCohortWindowFromLocal`. */
  startsAt: string;
  endsAt: string;
  /** The zone staff typed the window in — display provenance, not a comparison
   *  input. Narrowed here again rather than trusted from the action layer. */
  timeZone: string;
  createdBy: string;
};

export type CreateFwCohortResult =
  | { ok: true; cohortId: string; slug: string }
  | { ok: false; reason: "slug_taken" | "invalid_time_zone" | "unavailable" };

/**
 * Create one `kind='fw'` cohort with its event window.
 *
 * `kind` is written as a LITERAL here and never taken from the caller. It is the
 * flag the FW-D3 bridge turns on and the flag `fwBoardTokenMintVerdict` gates a
 * public read door on; a cohort-creation form that could set it would let anyone
 * with staff access mint an unauthenticated board over a Path cohort's children.
 *
 * A slug collision is reported as its own reason, not as "unavailable": the slug
 * is what a guide reads in their header to confirm they are in the right
 * weekend, and "boston-2026-08 is taken" is a sentence staff can act on.
 */
export async function createFwCohort(
  db: SupabaseClient,
  input: CreateFwCohortInput
): Promise<CreateFwCohortResult> {
  const timeZone = narrowFwEventTimeZone(input.timeZone);
  if (!timeZone) return { ok: false, reason: "invalid_time_zone" };

  const res = await fwWrite(
    () =>
      db
        .from("path_cohorts")
        .insert([
          {
            slug: input.slug,
            kind: FW_COHORT_KIND,
            starts_at: input.startsAt,
            ends_at: input.endsAt,
            time_zone: timeZone,
            created_by: input.createdBy,
          },
        ])
        .select("id, slug")
        .maybeSingle(),
    `cohort insert (${input.slug})`
  );

  if (res.error) {
    if (isUniqueViolation(res.error)) return { ok: false, reason: "slug_taken" };
    console.error(`[fw/ops] cohort insert failed for ${input.slug}: ${res.error.message}`);
    return { ok: false, reason: "unavailable" };
  }
  const row = res.data;
  if (!row || typeof row.id !== "string") {
    console.error(`[fw/ops] cohort insert returned no id for ${input.slug}`);
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true, cohortId: row.id, slug: typeof row.slug === "string" ? row.slug : input.slug };
}

export type UpdateFwCohortWindowInput = {
  cohortId: string;
  /** The LOCAL wall-clock parts staff typed — converted here via
   *  `fwCohortWindowFromLocal`, never pre-converted by the caller, so the
   *  DST-gap refusals and the zone allowlist run inside the sequence. */
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  timeZone: string;
  actorUserId: string;
  now: number;
};

export type UpdateFwCohortWindowResult =
  | { ok: true; startsAt: string; endsAt: string }
  | {
      ok: false;
      reason:
        | "cohort_not_found"
        | "cohort_not_fw"
        /** Archived weekends are read-only for window edits — restore first,
         *  the same archive-gate posture as `linkFwStudentToCohort` and the
         *  mint verdict. */
        | "cohort_archived"
        /** The window-rules refusals, passed through verbatim so the form can
         *  say which field is wrong (`fwCohortWindowFromLocal`'s contract). */
        | "invalid_time_zone"
        | "invalid_start"
        | "invalid_end"
        | "nonexistent_start"
        | "nonexistent_end"
        | "window_not_ordered"
        | "unavailable";
    };

/**
 * Correct one weekend's event window and zone after creation (ops redesign
 * Unit 4; R14) — the fix for the Chicago weekend stuck on Pacific time.
 *
 * NO new window math: the local→instant conversion is `fwCohortWindowFromLocal`,
 * the SAME pure rule creation uses, so an edit can never accept a window
 * creation would have refused (DST gaps, zone allowlist, ordering).
 *
 * ── `starts_at` and `ends_at` are ALWAYS written together
 *
 * `path_cohorts_window_ordered` (CHECK: ends_at > starts_at) evaluates against
 * the whole post-update row, so a partial update — writing only the new
 * `ends_at` against an old `starts_at`, or vice versa — can 23514 on a window
 * that is perfectly valid as a pair. The core therefore has no single-bound
 * entry point at all: one payload, both instants, structurally.
 *
 * ── Attribution is per-row, NOT an audit row (plan Key Decision)
 *
 * `path_fw_ops_audit.subject_user_id` is NOT NULL (a window edit has no human
 * subject) and that table's charter is the two liability actions. The
 * `window_edited_by/at` columns (20260811140000) follow the `created_by` /
 * `revoked_by` per-row pattern and are stamped in the SAME update as the
 * window, so the answer to "who last moved this window" can never be recorded
 * without the move or vice versa.
 *
 * ── What this deliberately does NOT touch: the live board token
 *
 * A live token keeps the `expires_at` it was issued for (stored-at-mint,
 * `fw-board-rules.ts`'s documented decision) — editing the window neither
 * extends nor kills a projected board. Re-minting for the corrected window is
 * its own explicit action (`remintFwBoardTokenForWindow`). An edit that lands
 * the window in the past is ALLOWED (the row is the truth staff typed); the
 * re-mint is what refuses (`window_passed`).
 *
 * No post-write verify on the error branch: a landed-but-reported-failed
 * update retried with the same inputs re-applies the identical values, so the
 * retry is naturally idempotent — the archive/unarchive posture, not the
 * delete/grant-revoke one (where a retry would misreport).
 */
export async function updateFwCohortWindow(
  db: SupabaseClient,
  input: UpdateFwCohortWindowInput
): Promise<UpdateFwCohortWindowResult> {
  const cohort = await loadFwOpsCohort(db, input.cohortId);
  if (!cohort) return { ok: false, reason: "cohort_not_found" };
  if (cohort.kind !== FW_COHORT_KIND) return { ok: false, reason: "cohort_not_fw" };
  if (cohort.archivedAt !== null) return { ok: false, reason: "cohort_archived" };

  const window = fwCohortWindowFromLocal({
    startDate: input.startDate,
    startTime: input.startTime,
    endDate: input.endDate,
    endTime: input.endTime,
    timeZone: input.timeZone,
  });
  if (!window.ok) return { ok: false, reason: window.reason };
  // `fwCohortWindowFromLocal` already refused a non-allowlisted zone, so this
  // narrowing cannot fail here — it exists so the WRITE takes the narrowed
  // union member, never the raw caller string (the createFwCohort posture).
  const timeZone = narrowFwEventTimeZone(input.timeZone);
  if (!timeZone) return { ok: false, reason: "invalid_time_zone" };

  const res = await fwWrite(
    () =>
      db
        .from("path_cohorts")
        .update({
          // THE PAIR, always — see the docblock's `path_cohorts_window_ordered`
          // note. Do not split this payload.
          starts_at: window.startsAt,
          ends_at: window.endsAt,
          time_zone: timeZone,
          window_edited_at: new Date(input.now).toISOString(),
          window_edited_by: input.actorUserId,
        })
        .eq("id", input.cohortId)
        // Belt over the pre-read, same as delete: even a stale read can never
        // turn this statement into a Path-cohort window edit.
        .eq("kind", FW_COHORT_KIND)
        .select("id"),
    `cohort window update (${input.cohortId})`
  );
  if (res.error) {
    console.error(
      `[fw/ops] window update failed for ${input.cohortId}: ${res.error.message}`
    );
    return { ok: false, reason: "unavailable" };
  }
  if ((res.data ?? []).length === 0) {
    // The pre-read saw the cohort; the update matched nothing — it was deleted
    // (or stopped being fw) mid-flight. Report the truth the caller can act on;
    // the copy collapses it to the staff-only sentence regardless.
    return { ok: false, reason: "cohort_not_found" };
  }
  return { ok: true, startsAt: window.startsAt, endsAt: window.endsAt };
}

/* ═══════════════════════════════════════════════════════════════ board tokens ══ */

/**
 * What the ops surface says about a cohort's projector door.
 *
 * Four states, and each one has a different next action for staff — which is the
 * whole reason `fwBoardTokenVerdict` keeps its refusals apart instead of
 * collapsing them the way Unit 6's route must.
 */
export type FwBoardTokenStatus = "never_minted" | "live" | "expired" | "revoked";

export type FwOpsBoardToken = {
  status: FwBoardTokenStatus;
  /** The row this status describes. Carried so a revoke can name the exact
   *  token staff were looking at — see `revokeFwBoardToken`. Null only when the
   *  cohort has never had one. */
  tokenId: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string | null;
};

const TOKEN_COLUMNS = "id, cohort_id, expires_at, revoked_at, created_at";

function tokenStatus(
  row: { expiresAt: string; revokedAt: string | null } | null,
  now: number
): FwBoardTokenStatus {
  const verdict = fwBoardTokenVerdict({ token: row, now });
  if (verdict.ok) return "live";
  return verdict.reason === "not_found" ? "never_minted" : verdict.reason;
}

/** Narrow a `path_fw_board_tokens` row to what the pick and the verdict need.
 *  A row without a readable `expires_at` cannot be judged live or dead, so it
 *  is dropped rather than defaulted into either. */
function narrowTokenRow(
  row: Record<string, unknown>
): { id: string; expiresAt: string; revokedAt: string | null; createdAt: string | null } | null {
  if (typeof row.id !== "string" || typeof row.expires_at !== "string") return null;
  return {
    id: row.id,
    expiresAt: row.expires_at,
    revokedAt: typeof row.revoked_at === "string" ? row.revoked_at : null,
    createdAt: typeof row.created_at === "string" ? row.created_at : null,
  };
}

/**
 * The cohort's CURRENT board token — live if there is one, else the most
 * recently revoked (see `pickFwCurrentBoardToken` for why that rule, and why it
 * is not an `order by`).
 *
 * Reports a read failure as its own result rather than folding it into
 * `never_minted`: "nobody ever minted one" is the answer that invites staff to
 * mint, and minting on top of a token that is actually live kills a projector.
 */
export async function loadFwOpsBoardToken(
  db: SupabaseClient,
  input: { cohortId: string; now: number }
): Promise<{ ok: true; token: FwOpsBoardToken } | { ok: false }> {
  const rows = await fetchAllRows<Record<string, unknown>>(
    `board tokens (${input.cohortId})`,
    (from, to) =>
      db
        .from("path_fw_board_tokens")
        .select(TOKEN_COLUMNS)
        .eq("cohort_id", input.cohortId)
        .order("id", { ascending: true })
        .range(from, to)
  );
  if (!rows.ok) return { ok: false };

  const current = pickFwCurrentBoardToken(
    rows.rows.map(narrowTokenRow).filter((t): t is NonNullable<typeof t> => t !== null)
  );
  if (!current) {
    return {
      ok: true,
      token: {
        status: "never_minted",
        tokenId: null,
        expiresAt: null,
        revokedAt: null,
        createdAt: null,
      },
    };
  }
  return {
    ok: true,
    token: {
      status: tokenStatus(current, input.now),
      tokenId: current.id,
      expiresAt: current.expiresAt,
      revokedAt: current.revokedAt,
      createdAt: current.createdAt,
    },
  };
}

export type MintFwBoardTokenResult =
  | {
      ok: true;
      /** The RAW token. Shown to staff exactly once, never stored, never
       *  logged — only its SHA-256 reaches the database. */
      token: string;
      expiresAt: string;
      /** True when a previously live token was killed to make room for this one
       *  — the ops copy has to say so, because the projector goes dark until
       *  somebody types the new URL. */
      revokedPrior: boolean;
    }
  | {
      ok: false;
      reason:
        | "cohort_not_found"
        | "cohort_not_fw"
        /** Unit 7: minted-then-archived compensation, or the pre-flight refusal. */
        | "cohort_archived"
        | "no_event_window"
        | "window_passed"
        /** Redesign Unit 4, reachable only with `expectedTokenId`: the CAS
         *  matched zero rows and a DIFFERENT token is live — the caller's page
         *  is out of date. NOTHING was revoked. */
        | "stale_view"
        /** Redesign Unit 4, reachable only with `expectedTokenId`: the CAS
         *  matched zero rows and nothing is live at all. NOTHING was revoked. */
        | "no_active_token"
        | "unavailable";
    };

/**
 * Mint a board token: 256 bits of entropy, raw shown once, SHA-256 stored with
 * the derived expiry.
 *
 * ORDER IS FORCED BY THE SCHEMA. `path_fw_board_tokens_one_active_per_cohort` is
 * a partial unique index on `(cohort_id) where revoked_at is null`, so an
 * insert-then-revoke ordering cannot exist — the insert would collide with the
 * token it is about to replace. Revoke-then-insert is therefore the only
 * sequence, and it has exactly one failure mode: a revoked prior token and no
 * replacement, i.e. a board that is dark with no URL to fix it.
 *
 * That mode is COMPENSATED (the multi-step-write canon): the prior row's
 * revocation is undone. The compensation is safe precisely BECAUSE of the same
 * partial index — if a concurrent mint has meanwhile created a live token, the
 * restore violates the index and is refused by the database rather than
 * producing two live tokens for one cohort. A refused restore is logged loudly
 * because it means staff must re-mint by hand.
 */
export async function mintFwBoardToken(
  db: SupabaseClient,
  input: {
    cohortId: string;
    actorUserId: string;
    now: number;
    /**
     * Redesign Unit 4: a compare-and-set on the revoke-prior step — the same
     * stale-view guard `revokeFwBoardToken` carries, threaded through THIS
     * sequence rather than built as a sibling (two mint sequences with subtly
     * different compensation would be the drift hazard). When set, the prior
     * revoke matches only this token id; zero rows revokes nothing blind and
     * refuses (`stale_view` / `no_active_token`) with the live board untouched.
     */
    expectedTokenId?: string;
  }
): Promise<MintFwBoardTokenResult> {
  const cohort = await loadFwOpsCohort(db, input.cohortId);
  const verdict = fwBoardTokenMintVerdict({
    // `archivedAt` FORWARDED (Unit 7 review — the verdict had the archived branch's
    // slot planned for Unit 8, but the field silently dropped here would have let a
    // bookmarked mint re-open a retired weekend's projector the moment Unit 7
    // merged; the guard moved up rather than merging a known hole).
    cohort: cohort
      ? { kind: cohort.kind, endsAt: cohort.endsAt, archivedAt: cohort.archivedAt }
      : null,
    now: input.now,
  });
  if (!verdict.ok) return { ok: false, reason: verdict.reason };

  const revokedAt = new Date(input.now).toISOString();
  const revoked = await fwWrite(
    () => {
      const base = db
        .from("path_fw_board_tokens")
        .update({ revoked_at: revokedAt, revoked_by: input.actorUserId })
        .eq("cohort_id", input.cohortId)
        .is("revoked_at", null);
      // The CAS: revoke THE TOKEN THE CALLER SAW, not "whatever is live now"
      // (see `revokeFwBoardToken`'s docblock for the race this closes).
      return (input.expectedTokenId ? base.eq("id", input.expectedTokenId) : base).select("id");
    },
    `prior token revoke (${input.cohortId})`
  );
  if (revoked.error) {
    console.error(
      `[fw/ops] prior token revoke failed for ${input.cohortId}: ${revoked.error.message}`
    );
    return { ok: false, reason: "unavailable" };
  }
  const priorIds = (revoked.data ?? [])
    .map((r) => r.id)
    .filter((id): id is string => typeof id === "string");
  if (input.expectedTokenId && priorIds.length === 0) {
    // Zero-row CAS. NOTHING was revoked, so there is nothing to compensate —
    // refuse before minting, exactly as revokeFwBoardToken does, and take the
    // same second look to tell "someone else's token is live" (stale_view)
    // apart from "nothing is live at all" (no_active_token).
    const current = await loadFwOpsBoardToken(db, { cohortId: input.cohortId, now: input.now });
    if (current.ok && current.token.status === "live") {
      console.warn(
        `[fw/ops] refusing a stale re-mint for ${input.cohortId}: caller expected ${input.expectedTokenId}, but a different token is live`
      );
      return { ok: false, reason: "stale_view" };
    }
    return { ok: false, reason: "no_active_token" };
  }

  const token = randomBytes(32).toString("base64url");
  const inserted = await fwWrite(
    () =>
      db.from("path_fw_board_tokens").insert([
        {
          cohort_id: input.cohortId,
          token_hash: hashFwBoardToken(token),
          expires_at: verdict.expiresAt,
          created_by: input.actorUserId,
        },
      ]),
    `token insert (${input.cohortId})`
  );

  if (inserted.error) {
    console.error(
      `[fw/ops] token insert failed for ${input.cohortId}: ${inserted.error.message}`
    );
    if (priorIds.length > 0) {
      const restored = await fwWrite(
        () =>
          db
            .from("path_fw_board_tokens")
            .update({ revoked_at: null, revoked_by: null })
            .in("id", priorIds),
        `token restore (${input.cohortId})`
      );
      if (restored.error) {
        // Do NOT assert the board is dark here (correctness review). A restore
        // fails for two very different reasons, and the partial unique index is
        // what tells them apart: either the write genuinely failed (dark board,
        // staff must re-mint), or a CONCURRENT mint already put a live token in
        // place and the index correctly refused to create a second one — in
        // which case a projector somewhere is working fine and an operator
        // acting on a "no live token" line would re-mint and kill it. So we
        // re-read and log what is actually true.
        const now = await loadFwOpsBoardToken(db, { cohortId: input.cohortId, now: input.now });
        if (now.ok && now.token.status === "live") {
          console.warn(
            `[fw/ops] could not restore the prior board token for ${input.cohortId} (${restored.error.message}), but a live token EXISTS — a concurrent mint won. Do not re-mint; find whoever holds that URL.`
          );
        } else {
          console.error(
            `[fw/ops] COULD NOT RESTORE the prior board token for ${input.cohortId}: ${restored.error.message} — this cohort now has NO live token; staff must mint a new one and re-enter the URL on the projector`
          );
        }
      } else {
        console.warn(
          `[fw/ops] restored the prior board token for ${input.cohortId} after a failed mint — the projector URL in use is still valid`
        );
      }
    }
    return { ok: false, reason: "unavailable" };
  }

  // THE INSERT-TIME RE-CHECK (Unit 7 review, adversarial finding 2). The pre-flight
  // verdict above is a read, and mint's own write is two steps — revoke-prior, then
  // insert. A concurrent archive landing BETWEEN them passes cleanly (its revoke
  // finds zero live rows and folds to success; its CAS archives), after which the
  // insert above lands a live token on an archived cohort: the exact invisible-and-
  // harmful state the archive's ordering exists to prevent, surviving the naive
  // check-at-read-time fix. So the mint re-reads AFTER its insert and compensates —
  // revoking the token it just made — when the cohort archived underneath it. The
  // token was never returned to anyone, so nothing is lost; the archive's promise
  // holds; the caller is told the truth.
  const post = await loadFwOpsCohort(db, input.cohortId);
  if (post !== null && post.archivedAt !== null) {
    console.warn(
      `[fw/ops] cohort ${input.cohortId} was archived while a mint was in flight — revoking the just-minted token`
    );
    const undo = await revokeFwBoardToken(db, {
      cohortId: input.cohortId,
      actorUserId: input.actorUserId,
      now: input.now,
    });
    if (!undo.ok && undo.reason !== "no_active_token") {
      // The compensation itself failed: an archived cohort MAY hold a live token
      // until someone revokes it by hand. Loud, specific, and actionable — the
      // one state this whole ordering discipline exists to keep impossible.
      console.error(
        `[fw/ops] URGENT: cohort ${input.cohortId} is ARCHIVED but its just-minted board token could not be revoked (${undo.reason}) — revoke it manually (npm run fw -- token-revoke --cohort ${input.cohortId})`
      );
    }
    return { ok: false, reason: "cohort_archived" };
  }

  return { ok: true, token, expiresAt: verdict.expiresAt, revokedPrior: priorIds.length > 0 };
}

export type RevokeFwBoardTokenResult =
  | { ok: true }
  | { ok: false; reason: "no_active_token" | "stale_view" | "unavailable" };

/**
 * Kill the cohort's live board token with no replacement.
 *
 * Distinct from a re-mint, and the difference is the whole reason `revoked_by`
 * exists: a re-mint attributes itself through the replacement row's
 * `created_by`, while this leaves a board dark and previously named nobody.
 *
 * ── It revokes THE TOKEN STAFF SAW, not "whatever is live now"
 *
 * `expectedTokenId` is a compare-and-set, and it closes a race that kills a
 * working projector (adversarial review). Without it the predicate is "the live
 * row for this cohort" — which is a DIFFERENT row by the time a slow request
 * lands. Staff B reads the page showing token T0 and clicks Revoke; staff A
 * re-mints meanwhile, killing T0 and making TA live; B's request finally
 * executes and kills TA — the token A minted seconds ago and may already have
 * typed into the projector — while B's own confirm dialog described T0. Both
 * get a success response and neither can tell.
 *
 * With the CAS, B's update matches zero rows and reports `stale_view`, which is
 * the truth: the thing they were looking at is already gone, and the surface
 * reloads rather than destroying somebody else's work.
 *
 * `no_active_token` and `stale_view` are kept apart because they need different
 * copy — "there is nothing live to revoke" versus "this page is out of date".
 */
export async function revokeFwBoardToken(
  db: SupabaseClient,
  input: {
    cohortId: string;
    actorUserId: string;
    now: number;
    /** The token id the caller believes is live. Omitted only by callers with
     *  no view that could be stale — the CLI reads and acts in one breath. */
    expectedTokenId?: string;
  }
): Promise<RevokeFwBoardTokenResult> {
  const res = await fwWrite(
    () => {
      const base = db
        .from("path_fw_board_tokens")
        .update({ revoked_at: new Date(input.now).toISOString(), revoked_by: input.actorUserId })
        .eq("cohort_id", input.cohortId)
        .is("revoked_at", null);
      return (input.expectedTokenId ? base.eq("id", input.expectedTokenId) : base).select("id");
    },
    `token revoke (${input.cohortId})`
  );
  if (res.error) {
    console.error(`[fw/ops] token revoke failed for ${input.cohortId}: ${res.error.message}`);
    return { ok: false, reason: "unavailable" };
  }
  if ((res.data ?? []).length === 0) {
    // Zero rows means one of two things and only a second look tells them
    // apart: nothing is live at all, or something ELSE is.
    if (!input.expectedTokenId) return { ok: false, reason: "no_active_token" };
    const current = await loadFwOpsBoardToken(db, { cohortId: input.cohortId, now: input.now });
    if (current.ok && current.token.status === "live") {
      console.warn(
        `[fw/ops] refusing a stale revoke for ${input.cohortId}: caller expected ${input.expectedTokenId}, but a different token is live`
      );
      return { ok: false, reason: "stale_view" };
    }
    return { ok: false, reason: "no_active_token" };
  }
  return { ok: true };
}

/**
 * Revoke + re-mint the board for a corrected window (ops redesign Unit 4;
 * R14a) — the explicit follow-up to `updateFwCohortWindow`, because a live
 * token keeps its STORED expiry and never follows the edit.
 *
 * ── Verdict FIRST, and this function is deliberately THIN
 *
 * The whole safety argument is `mintFwBoardToken`'s own ordering, reused, not
 * rebuilt: it reads the cohort FRESH (so the verdict runs against the
 * corrected window), runs `fwBoardTokenMintVerdict` BEFORE touching any token
 * row (a non-mintable corrected window — `window_passed`, `cohort_archived` —
 * refuses with the old token still live), and only then revokes-prior-then-
 * inserts with compensation. This wrapper exists to make the intent a named
 * call site and to make `expectedTokenId` REQUIRED: the re-mint always acts
 * from a page showing a specific live token, so a blind revoke has no caller
 * here. A zero-row CAS refuses (`stale_view` / `no_active_token`) with
 * nothing revoked.
 *
 * Invariant carried over from the mint (plan sequence diagram): **no path
 * revokes the prior token without minting a replacement** — the refusal
 * branches revoke nothing, and the failed-insert branch restores what it
 * revoked. The result carries the new raw token exactly as mint does: shown
 * once, only its hash stored.
 */
export async function remintFwBoardTokenForWindow(
  db: SupabaseClient,
  input: { cohortId: string; expectedTokenId: string; actorUserId: string; now: number }
): Promise<MintFwBoardTokenResult> {
  return mintFwBoardToken(db, input);
}

/**
 * The hub's weekend figure (Unit 9, for Unit 11) — ONE paginated query.
 *
 * The plan's decision verbatim: the existing dated read fans out to three further
 * paginated scans for one integer, so the hub gets its own narrow read. Returns the
 * active (non-archived) fw cohorts with their windows; the hub derives its count and
 * its "next weekend" from this, and a failure is a typed `{ok:false}` the card
 * degrades on (R4's asymmetry) — never a fabricated zero.
 */
export type FwActiveWeekend = {
  id: string;
  slug: string;
  startsAt: string | null;
  endsAt: string | null;
};

export async function listFwActiveWeekends(
  db: SupabaseClient
): Promise<{ ok: true; weekends: FwActiveWeekend[] } | { ok: false }> {
  const rows = await fetchAllRows<Record<string, unknown>>("active weekends", (from, to) =>
    db
      .from("path_cohorts")
      .select("id, slug, kind, starts_at, ends_at, archived_at")
      .eq("kind", FW_COHORT_KIND)
      .is("archived_at", null)
      .order("id", { ascending: true })
      .range(from, to)
  );
  if (!rows.ok) return { ok: false };
  return {
    ok: true,
    weekends: rows.rows
      .filter(
        (r): r is Record<string, unknown> & { id: string; slug: string } =>
          typeof r.id === "string" && typeof r.slug === "string" && r.kind === FW_COHORT_KIND &&
          // Belt over the SQL predicate, same both-layers posture as the list above.
          typeof r.archived_at !== "string"
      )
      .map((r) => ({
        id: r.id,
        slug: r.slug,
        startsAt: typeof r.starts_at === "string" ? r.starts_at : null,
        endsAt: typeof r.ends_at === "string" ? r.ends_at : null,
      })),
  };
}

/* ═══════════════════════════════════════════════════════ archive / unarchive ══ */

export type ArchiveFwCohortResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "cohort_not_found"
        | "cohort_not_fw"
        | "already_archived"
        /** The typed confirm did not match the STORED slug. Verified here, in
         *  the core, before anything is touched (ops redesign Unit 2) — a typed
         *  confirm only the browser checks is not a confirm. */
        | "confirm_mismatch"
        /** The token revoke failed for a reason OTHER than "nothing was live".
         *  The archive did NOT proceed — see the ordering note below. */
        | "revoke_failed"
        | "unavailable";
    };

/**
 * Archive one FW cohort: verify the typed confirm, revoke the live board token,
 * THEN set archive state.
 *
 * ── The confirm is server-verified (ops redesign Unit 2)
 *
 * `confirmSlug` is the slug staff TYPED, re-checked here against the stored slug
 * via `fwArchiveConfirmMatches` before the sequence runs — the same posture as
 * `anonymizeFwStudent`'s `confirmName`. Every front door supplies it: the two
 * browser controls send what was typed, and the CLI takes `--confirm-slug`.
 *
 * ── The ordering is the decision (plan, Key Technical Decisions)
 *
 * Archive-then-revoke failing between the two leaves an ARCHIVED cohort with a
 * LIVE board — hidden from the ops list (so nobody is looking at it) while an
 * unauthenticated projector URL keeps serving children's names. Invisible and
 * harmful. Revoke-then-archive failing between leaves an ACTIVE cohort with a
 * dark board — visible on the list, mint again and move on. Visible and
 * recoverable. So the revoke goes first, and a failed revoke STOPS the archive.
 *
 * `revokeFwBoardToken` is called with NO `expectedTokenId` — the CLI-shaped call:
 * this sequence reads and acts in one breath, there is no stale view to protect.
 * Its `no_active_token` is folded into success HERE, in the archive's own
 * interpretation, not inside the revoke core (whose callers need the distinction).
 * A cohort whose board was never minted archives cleanly.
 *
 * ── CAS, and what zero rows means
 *
 * The UPDATE carries `is("archived_at", null)` and returns the id it touched.
 * Zero rows with the cohort known to exist means someone else archived it first:
 * `already_archived`, and `archived_by` keeps naming the FIRST actor — attribution
 * is who actually did it, not who clicked last.
 *
 * ── Guards live HERE, not in the action layer
 *
 * `scripts/fw-ops.ts` drives this core under service-role credentials with no
 * action-layer gate, so the kind guard cannot live only in `requireCohortStaff`.
 * A `kind='path'` id is refused by this function no matter who calls it.
 */
export async function archiveFwCohort(
  db: SupabaseClient,
  input: { cohortId: string; actorUserId: string; now: number; confirmSlug: string }
): Promise<ArchiveFwCohortResult> {
  const cohort = await loadFwOpsCohort(db, input.cohortId);
  if (!cohort) return { ok: false, reason: "cohort_not_found" };
  if (cohort.kind !== FW_COHORT_KIND) return { ok: false, reason: "cohort_not_fw" };
  // The typed confirm, verified against the STORED slug before anything is
  // touched — including before the archived-state check, so a mismatched
  // confirm learns nothing about the row beyond its existence (which the
  // staff gate already grants). The anonymize posture (ops redesign Unit 2):
  // the browser's disabled-until-match button is UX; THIS is the confirm.
  if (!fwArchiveConfirmMatches(input.confirmSlug, cohort.slug)) {
    return { ok: false, reason: "confirm_mismatch" };
  }
  if (cohort.archivedAt !== null) return { ok: false, reason: "already_archived" };

  const revoked = await revokeFwBoardToken(db, {
    cohortId: input.cohortId,
    actorUserId: input.actorUserId,
    now: input.now,
  });
  if (!revoked.ok && revoked.reason !== "no_active_token") {
    console.error(
      `[fw/ops] archive of ${input.cohortId} stopped: token revoke reported ${revoked.reason}`
    );
    return { ok: false, reason: "revoke_failed" };
  }

  const res = await fwWrite(
    () =>
      db
        .from("path_cohorts")
        .update({
          archived_at: new Date(input.now).toISOString(),
          archived_by: input.actorUserId,
        })
        .eq("id", input.cohortId)
        .is("archived_at", null)
        .select("id"),
    `cohort archive (${input.cohortId})`
  );
  if (res.error) {
    console.error(`[fw/ops] archive write failed for ${input.cohortId}: ${res.error.message}`);
    return { ok: false, reason: "unavailable" };
  }
  if ((res.data ?? []).length === 0) {
    // The pre-read said active; the CAS found it archived. A concurrent archive
    // won the race — report the truth rather than claiming this actor's work.
    return { ok: false, reason: "already_archived" };
  }
  return { ok: true };
}

export type UnarchiveFwCohortResult =
  | { ok: true }
  | {
      ok: false;
      reason: "cohort_not_found" | "cohort_not_fw" | "already_active" | "unavailable";
    };

/**
 * Reverse an archive: null BOTH columns.
 *
 * Attribution describes the CURRENT state, not a history — no audit row exists
 * for cohort archives (the audit table's subject is `not null` and a cohort has
 * no human subject), so unarchiving genuinely loses who archived it. Accepted in
 * planning, recorded here so nobody "fixes" the nulled `archived_by` into a
 * half-remembered history column.
 *
 * Deliberately does NOT touch the board: unarchive restores staff visibility,
 * and minting a fresh token is its own decision on the ops surface — the old
 * token stays revoked, so the old projector URL never resolves again (R25's
 * "revocation is permanent" survives the round trip).
 *
 * The CAS direction is `not("archived_at", "is", null)`: zero rows on a cohort
 * that exists means it was already active — `already_active`, not an error.
 */
export async function unarchiveFwCohort(
  db: SupabaseClient,
  input: { cohortId: string }
): Promise<UnarchiveFwCohortResult> {
  const cohort = await loadFwOpsCohort(db, input.cohortId);
  if (!cohort) return { ok: false, reason: "cohort_not_found" };
  if (cohort.kind !== FW_COHORT_KIND) return { ok: false, reason: "cohort_not_fw" };
  if (cohort.archivedAt === null) return { ok: false, reason: "already_active" };

  const res = await fwWrite(
    () =>
      db
        .from("path_cohorts")
        .update({ archived_at: null, archived_by: null })
        .eq("id", input.cohortId)
        .not("archived_at", "is", null)
        .select("id"),
    `cohort unarchive (${input.cohortId})`
  );
  if (res.error) {
    console.error(`[fw/ops] unarchive write failed for ${input.cohortId}: ${res.error.message}`);
    return { ok: false, reason: "unavailable" };
  }
  if ((res.data ?? []).length === 0) {
    return { ok: false, reason: "already_active" };
  }
  return { ok: true };
}

/* ═══════════════════════════════════ truly-untouched delete (redesign Unit 3) ══ */

/**
 * Postgres foreign-key violation (SQLSTATE 23503), checked by CODE like
 * `isUniqueViolation` and for the same reason: messages are unstable. A timed-out
 * write's synthetic `{ message }` has no `code`, so this returns false for it —
 * routing it to the post-write verify rather than to the FK backstop.
 */
function isFkViolation(error: { code?: string } | { message: string } | null): boolean {
  return error !== null && "code" in error && error.code === "23503";
}

export type FwCohortUntouchedVerdict =
  | { ok: true; untouched: true }
  | { ok: true; untouched: false; touchedBy: string }
  | /** A probe failed — could not tell. Fail CLOSED: no delete on partial
     *  knowledge, and no Delete affordance either. */
    { ok: false };

/**
 * ONE classifier for "has anything ever referenced this weekend?" — the plan's
 * settled decision (Key Technical Decisions; learning 2026-07-27): the list
 * affordance (whether the ⋯ menu offers Delete) and `deleteFwCohort` itself BOTH
 * call this, and there is no second hand-written predicate anywhere. Two
 * predicates is how a menu shows Delete on a weekend the core refuses forever.
 *
 * NINE surfaces, every table that can point at a `path_cohorts` row:
 *
 *   1. path_cohort_members            — anyone ever enrolled
 *   2. path_task_events               — any check-in ever captured
 *   3. path_fw_board_tokens           — ANY row ever, REVOKED INCLUDED: a
 *                                       minted-then-revoked board is history
 *                                       (origin decision), not a clean slate
 *   4. path_fw_replay_rejects         — any offline capture ever refused
 *   5. path_fw_ops_audit              — any liability action ever recorded
 *   6. path_fw_import_exceptions      — any CSV import ever stumbled
 *   7. path_student_profiles.intended_cohort_id — any unfinished quick-create
 *   8. path_student_profiles.cohort_id — the Path-side column (its RESTRICT FK
 *                                       exists even though FW never sets it)
 *   9. path_role_grants (role='guide', scope_type='cohort') — any guide ever
 *                                       granted. THIS PROBE IS LOAD-BEARING in a
 *                                       way the others are not: `scope_id` is
 *                                       deliberately polymorphic with NO foreign
 *                                       key, so the DELETE's 23503 backstop
 *                                       cannot catch a grant. This probe (plus
 *                                       the post-delete sweep in
 *                                       `deleteFwCohort`) is the ONLY guard
 *                                       against orphaning one.
 *
 * Surfaces 1–8 are ALSO defended by the schema (every FK into `path_cohorts` is
 * RESTRICT, or NO ACTION on `intended_cohort_id` — equivalent for non-deferrable
 * constraints), so a row landing between this probe and the DELETE surfaces as a
 * 23503 the delete maps to `not_untouched`. The probes still run first because
 * the same answer gates the AFFORDANCE, where there is no write to backstop.
 *
 * ── Probe shape: nine parallel `.limit(1)` existence reads
 *
 * NOT `head:true` count probes — the repo has a documented false positive from a
 * HEAD count probe (docs/solutions/integration-issues/postgrest-head-count-probe-
 * false-positive-existence-check-2026-07-21.md) — and not full paginated scans
 * either: existence is the question, and `.limit(1).maybeSingle()` is the same
 * probe shape `ensureAnonymizeAudit` uses. All nine fire in one `Promise.all`.
 *
 * ANY probe error → `{ok:false}` (fail closed). A verdict built on eight answers
 * and one guess is exactly the partial knowledge a hard delete must never act on.
 */
export async function fwCohortUntouchedVerdict(
  db: SupabaseClient,
  cohortId: string
): Promise<FwCohortUntouchedVerdict> {
  const probes: [surface: string, call: () => PromiseLike<{ data: unknown; error: { message: string } | null }>][] = [
    [
      "path_cohort_members",
      () => db.from("path_cohort_members").select("id").eq("cohort_id", cohortId).limit(1).maybeSingle(),
    ],
    [
      "path_task_events",
      () => db.from("path_task_events").select("id").eq("cohort_id", cohortId).limit(1).maybeSingle(),
    ],
    [
      // No `.is("revoked_at", null)` — any token EVER, revoked included.
      "path_fw_board_tokens",
      () => db.from("path_fw_board_tokens").select("id").eq("cohort_id", cohortId).limit(1).maybeSingle(),
    ],
    [
      "path_fw_replay_rejects",
      () => db.from("path_fw_replay_rejects").select("id").eq("cohort_id", cohortId).limit(1).maybeSingle(),
    ],
    [
      "path_fw_ops_audit",
      () => db.from("path_fw_ops_audit").select("id").eq("cohort_id", cohortId).limit(1).maybeSingle(),
    ],
    [
      "path_fw_import_exceptions",
      () => db.from("path_fw_import_exceptions").select("id").eq("cohort_id", cohortId).limit(1).maybeSingle(),
    ],
    [
      "path_student_profiles.intended_cohort_id",
      () =>
        db.from("path_student_profiles").select("id").eq("intended_cohort_id", cohortId).limit(1).maybeSingle(),
    ],
    [
      "path_student_profiles.cohort_id",
      () => db.from("path_student_profiles").select("id").eq("cohort_id", cohortId).limit(1).maybeSingle(),
    ],
    [
      // Served by `path_role_grants_scope_idx` (20260801140000).
      "path_role_grants",
      () =>
        db
          .from("path_role_grants")
          .select("id")
          .eq("role", "guide")
          .eq("scope_type", "cohort")
          .eq("scope_id", cohortId)
          .limit(1)
          .maybeSingle(),
    ],
  ];

  const results = await Promise.all(
    probes.map(async ([surface, call]) => ({
      surface,
      res: await fwRead(call, `untouched probe ${surface} (${cohortId})`),
    }))
  );

  // Errors decide FIRST: an "untouched" verdict is only trustworthy when all
  // nine probes answered, however many of the others found rows.
  let touchedBy: string | null = null;
  for (const { surface, res } of results) {
    if (res.error) {
      console.error(
        `[fw/ops] untouched probe ${surface} failed for ${cohortId}: ${res.error.message} — verdict unavailable (fail closed)`
      );
      return { ok: false };
    }
    if (res.data !== null && touchedBy === null) touchedBy = surface;
  }
  return touchedBy === null
    ? { ok: true, untouched: true }
    : { ok: true, untouched: false, touchedBy };
}

export type DeleteFwCohortResult =
  | {
      ok: true;
      /** The post-delete guide-grant sweep confirmed clean. `false` = the cohort
       *  row IS gone (the delete succeeded) but the sweep write failed, so an
       *  orphaned guide grant MAY remain in `path_role_grants` — surfaced as a
       *  fact rather than swallowed, the `audited: false` convention. The log
       *  names the manual fix. */
      grantSweep: boolean;
    }
  | {
      ok: false;
      reason:
        | "cohort_not_found"
        | "cohort_not_fw"
        /** The typed confirm did not match the STORED slug — same rule and same
         *  in-core posture as the archive confirm. */
        | "confirm_mismatch"
        /** Something references this weekend — from the re-run classifier OR
         *  from the DELETE's own 23503 (a row landed between check and delete).
         *  The copy says the weekend stopped qualifying; archive is the path. */
        | "not_untouched"
        | "unavailable";
    };

/**
 * Hard-delete a truly-untouched weekend (ops redesign Unit 3; R7/R8/R8a) — the
 * ONE row-removal path in the FW ops surface, offered only for cohorts nothing
 * has ever referenced (a slug typo caught seconds after creation, a duplicate).
 * Anything with history archives instead; that boundary is the classifier above.
 *
 * Sequence: load (not_found / not_fw collapse per the enumeration canon) →
 * verify the typed confirm IN-CORE (`fwArchiveConfirmMatches`, the same rule the
 * archive uses — one slug, one match rule) → RE-RUN the classifier (the list's
 * verdict is stale by definition) → DELETE with the schema as backstop → verify
 * → sweep grants.
 *
 * ── The 23503 backstop and its one hole
 *
 * Every FK'd table self-defends: a member/event/token/reject/audit/exception/
 * profile row landing between the classifier and the DELETE turns the DELETE
 * into a 23503, mapped to `not_untouched`. `path_role_grants` has NO FK (its
 * scope_id is polymorphic), so a grant landing in that window would be silently
 * orphaned — hence the POST-delete sweep: once the cohort row is verified gone,
 * cohort-scoped guide grants are deleted unconditionally. The sweep is safe at
 * any time (the cohort no longer exists; a grant on it authorizes nothing that
 * resolves) and closes the probe→delete race for the one non-FK table.
 *
 * ── Post-write verify (the multi-step-write canon, 2026-07-22)
 *
 * `fwWrite`'s contract: a timed-out DELETE may still have landed. The error
 * branch re-reads the row; GONE after a reported error is SUCCESS (the caller
 * asked for the row to not exist, and it doesn't), and the sweep still runs.
 *
 * ── NO audit row, deliberately
 *
 * `path_fw_ops_audit.cohort_id` is a NOT NULL RESTRICT FK into `path_cohorts` —
 * an audit row cannot anchor to a cohort that no longer exists, and writing it
 * BEFORE the delete would make the cohort non-deletable (the audit row is
 * surface #5). The origin decision accepts this: only truly-untouched weekends
 * reach here, so what is lost is a record that a record-less thing was removed.
 *
 * `actorUserId` is accepted for call-site symmetry with the other destructive
 * cores but is UNUSED — there is no audit row and no surviving column to
 * attribute to. Kept in the signature so a future attribution home (e.g. an
 * app-level log table) is a body change, not a caller change.
 */
export async function deleteFwCohort(
  db: SupabaseClient,
  input: { cohortId: string; confirmSlug: string; actorUserId?: string }
): Promise<DeleteFwCohortResult> {
  const cohort = await loadFwOpsCohort(db, input.cohortId);
  if (!cohort) return { ok: false, reason: "cohort_not_found" };
  if (cohort.kind !== FW_COHORT_KIND) return { ok: false, reason: "cohort_not_fw" };
  // The typed confirm, verified against the STORED slug before anything else is
  // even probed — the archive's posture, with the archive's rule.
  if (!fwArchiveConfirmMatches(input.confirmSlug, cohort.slug)) {
    return { ok: false, reason: "confirm_mismatch" };
  }

  // Re-run the classifier HERE, inside the sequence: the verdict that made the
  // menu show Delete is however old the page is.
  const verdict = await fwCohortUntouchedVerdict(db, input.cohortId);
  if (!verdict.ok) return { ok: false, reason: "unavailable" };
  if (!verdict.untouched) {
    console.warn(
      `[fw/ops] delete of ${input.cohortId} refused: touched via ${verdict.touchedBy}`
    );
    return { ok: false, reason: "not_untouched" };
  }

  // `.eq("kind", …)` as a belt over the pre-read: even a stale read can never
  // turn this statement into a Path-cohort delete.
  const deleted = await fwWrite(
    () =>
      db.from("path_cohorts").delete().eq("id", input.cohortId).eq("kind", FW_COHORT_KIND).select("id"),
    `cohort delete (${input.cohortId})`
  );
  if (deleted.error) {
    if (isFkViolation(deleted.error)) {
      // The DB backstop fired: a referencing row landed between the classifier
      // and the DELETE. The weekend stopped qualifying — same refusal as the
      // classifier's, because it is the same fact learned later.
      console.warn(
        `[fw/ops] delete of ${input.cohortId} hit the FK backstop (23503) — it stopped being untouched mid-flight`
      );
      return { ok: false, reason: "not_untouched" };
    }
    // POST-WRITE VERIFY: a timed-out delete may have landed. A row that is GONE
    // after a reported error is success; still-there (or unreadable) is not.
    const still = await fwRead(
      () => db.from("path_cohorts").select("id").eq("id", input.cohortId).maybeSingle(),
      `cohort delete verify (${input.cohortId})`
    );
    if (still.error || still.data) {
      console.error(
        `[fw/ops] cohort delete failed for ${input.cohortId}: ${deleted.error.message}`
      );
      return { ok: false, reason: "unavailable" };
    }
    console.warn(
      `[fw/ops] cohort delete for ${input.cohortId} reported an error but LANDED — continuing to the grant sweep`
    );
  }

  // THE POST-DELETE GRANT SWEEP — the close of the one race the schema cannot
  // referee (see the docblock). Runs unconditionally: normally it deletes zero
  // rows (the classifier saw none), and when a grant slipped in between probe
  // and delete it removes the orphan instead of leaving it.
  const sweep = await fwWrite(
    () =>
      db
        .from("path_role_grants")
        .delete()
        .eq("role", "guide")
        .eq("scope_type", "cohort")
        .eq("scope_id", input.cohortId)
        .select("id"),
    `post-delete grant sweep (${input.cohortId})`
  );
  if (sweep.error) {
    // The cohort is gone — that part of the truth is settled and reported as
    // success. The sweep failing means an orphaned guide grant MAY remain;
    // surfaced as `grantSweep: false` (the `audited: false` convention) with
    // the manual fix named here, never swallowed into a clean success.
    console.error(
      `[fw/ops] post-delete grant sweep failed for ${input.cohortId}: ${sweep.error.message} — ` +
        `check path_role_grants for role='guide', scope_type='cohort', scope_id='${input.cohortId}' and delete by hand`
    );
    return { ok: true, grantSweep: false };
  }
  return { ok: true, grantSweep: true };
}

/* ═══════════════════════════════════════════════════════════ the cohort list ══ */

export type FwOpsCohortSummary = FwOpsCohort & {
  studentCount: number;
  guideCount: number;
  boardTokenStatus: FwBoardTokenStatus;
  /** The ⋯ menu's Delete affordance gate (redesign Unit 3): true only when
   *  `fwCohortUntouchedVerdict` — the SAME classifier the delete re-runs —
   *  answered `untouched` for this row. An unavailable verdict reads as `false`
   *  (fail closed: no affordance on partial knowledge; the list still renders). */
  untouched: boolean;
};

/**
 * Every fw cohort with the three numbers the ops home shows: how many students,
 * how many guides, and whether the board door is open.
 *
 * PAGINATED on every list read. The cohort list is genuinely small, but the
 * membership and grant reads behind these counts are not — ninety students per
 * cohort across a season of weekends is exactly where the 1000-row cliff starts
 * silently under-reporting, and an under-reported roster count on the pre-event
 * checklist is a checklist that passes when it should fail.
 *
 * Counted in memory from paginated reads rather than by a `count` probe: the
 * repo has a documented false-positive from a HEAD count probe
 * (docs/solutions/integration-issues/postgrest-head-count-probe-false-positive-
 * existence-check-2026-07-21.md), and at these volumes there is nothing to buy.
 */
export async function listFwOpsCohorts(
  db: SupabaseClient,
  input: {
    now: number;
    /** Unit 9: the ops list hides archived by default — staff visibility is the
     *  point of archiving. `true` is the "show archived" view, whose counts must
     *  describe the same widened set (R3's count contract). */
    includeArchived?: boolean;
  }
): Promise<{ ok: true; cohorts: FwOpsCohortSummary[] } | { ok: false }> {
  const cohortRows = await fetchAllRows<Record<string, unknown>>("ops cohort list", (from, to) =>
    db
      .from("path_cohorts")
      .select(COHORT_COLUMNS)
      .eq("kind", FW_COHORT_KIND)
      .order("created_at", { ascending: false })
      .range(from, to)
  );
  if (!cohortRows.ok) return { ok: false };

  const cohorts: FwOpsCohort[] = [];
  for (const row of cohortRows.rows) {
    const narrowed = narrowOpsCohort(row);
    // The SQL filter already restricts to fw, but the narrowing re-checks: this
    // list is the entry point to every ops action below, and "the query said so"
    // is a safety property of one query's shape rather than of this code.
    if (!narrowed || narrowed.kind !== FW_COHORT_KIND) continue;
    // Excluded BEFORE the three-way count fan-out (the plan's line): the member,
    // guide and token reads below are scoped to `ids`, so a filtered cohort costs
    // nothing downstream and the counts describe exactly the returned set.
    if (!input.includeArchived && narrowed.archivedAt !== null) continue;
    cohorts.push(narrowed);
  }
  if (cohorts.length === 0) return { ok: true, cohorts: [] };

  const ids = cohorts.map((c) => c.id);
  // The untouched flag runs the SHARED classifier per cohort — nine `.limit(1)`
  // probes each — rather than a hand-batched `.in(...)` variant. Documented
  // choice (plan, Unit 3): a cross-cohort batch would have to fetch every
  // referencing row per surface (PostgREST has no DISTINCT), which is the
  // expensive direction exactly when a cohort is touched; the list is genuinely
  // small (a season is single-digit weekends), so N × 9 tiny existence reads is
  // the cheap side AND keeps one classifier instead of a drifting twin. An
  // unavailable verdict degrades to `untouched: false` for that row (no Delete
  // affordance) without failing the list — the affordance fails closed; the
  // delete core re-runs the classifier itself, so nothing downstream trusts this.
  const [members, grants, tokens, verdicts] = await Promise.all([
    fetchAllRows<Record<string, unknown>>("ops member counts", (from, to) =>
      db
        .from("path_cohort_members")
        .select("cohort_id")
        .in("cohort_id", ids)
        .order("id", { ascending: true })
        .range(from, to)
    ),
    fetchAllRows<Record<string, unknown>>("ops guide counts", (from, to) =>
      db
        .from("path_role_grants")
        .select("scope_id")
        .eq("role", "guide")
        .eq("scope_type", "cohort")
        .in("scope_id", ids)
        .order("id", { ascending: true })
        .range(from, to)
    ),
    fetchAllRows<Record<string, unknown>>("ops token statuses", (from, to) =>
      db
        .from("path_fw_board_tokens")
        .select(TOKEN_COLUMNS)
        .in("cohort_id", ids)
        .order("id", { ascending: true })
        .range(from, to)
    ),
    Promise.all(
      cohorts.map(async (c) => ({
        id: c.id,
        verdict: await fwCohortUntouchedVerdict(db, c.id),
      }))
    ),
  ]);
  if (!members.ok || !grants.ok || !tokens.ok) return { ok: false };

  const untouchedById = new Map<string, boolean>();
  for (const { id, verdict } of verdicts) {
    untouchedById.set(id, verdict.ok && verdict.untouched);
  }

  const tally = (rows: Record<string, unknown>[], key: string): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const id = row[key];
      if (typeof id === "string") counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  };
  const studentCounts = tally(members.rows, "cohort_id");
  const guideCounts = tally(grants.rows, "scope_id");

  // Grouped by cohort, then reduced by the SAME pure rule the per-cohort read
  // uses — so the list and the detail page can never disagree about whether a
  // weekend's board door is open.
  const byCohort = new Map<string, ReturnType<typeof narrowTokenRow>[]>();
  for (const row of tokens.rows) {
    const cohortId = row.cohort_id;
    const narrowed = narrowTokenRow(row);
    if (typeof cohortId !== "string" || !narrowed) continue;
    const bucket = byCohort.get(cohortId);
    if (bucket) bucket.push(narrowed);
    else byCohort.set(cohortId, [narrowed]);
  }
  const currentToken = new Map<string, { expiresAt: string; revokedAt: string | null }>();
  for (const [cohortId, rows] of byCohort) {
    const current = pickFwCurrentBoardToken(
      rows.filter((t): t is NonNullable<typeof t> => t !== null)
    );
    if (current) currentToken.set(cohortId, current);
  }

  return {
    ok: true,
    cohorts: cohorts.map((c) => ({
      ...c,
      studentCount: studentCounts.get(c.id) ?? 0,
      guideCount: guideCounts.get(c.id) ?? 0,
      boardTokenStatus: tokenStatus(currentToken.get(c.id) ?? null, input.now),
      untouched: untouchedById.get(c.id) ?? false,
    })),
  };
}

/* ═════════════════════════════════════════════════════════════ the guide list ══ */

/** Where a guide stands on the pre-event checklist's "all guides claimed" line. */
export type FwGuideCredentialStatus =
  /** Grant exists, no invite row was ever written — a hand-made grant, or a
   *  provisioning run that failed after the grant and before the invite. */
  | "no_invite"
  /** A live, unclaimed link is in their inbox. */
  | "invited"
  /** They have set a password and can sign in. */
  | "claimed"
  /** Their link died before they used it — Friday-morning re-issue territory. */
  | "expired";

export type FwOpsGuide = {
  userId: string;
  email: string | null;
  credential: FwGuideCredentialStatus;
  invitedAt: string | null;
  claimedAt: string | null;
  /** Ops redesign Unit 5: the grant-holder is LIVE 120 staff. Staff have no
   *  invite row EVER (the grant path skips issuance), so without this flag they
   *  are indistinguishable from a guide whose invite issuance failed
   *  (`no_invite`) — and the roster would offer a re-send that can never work.
   *  Staff rows carry no credential state and sit outside the "all guides
   *  claimed" line. */
  isStaff: boolean;
};

/**
 * Every guide granted into one cohort, with their credential state.
 *
 * THREE reads, not N+1: the grants, then every invite row for those user ids in
 * one `.in(...)`, then one batched staff probe for the same ids (Unit 5's
 * roster discriminator). The invite row also carries the guide's EMAIL, which is what
 * staff recognise them by — so the common path never touches the Admin API at
 * all. Only a grant with no invite row falls back to `getUserById`, and that set
 * is normally empty (provisioning always ensures an invite).
 *
 * The credential state is derived by `fwGuideInviteVerdict` — the SAME pure
 * verdict the claim page, the claim action, and `issueFwGuideInvite`'s "ensure"
 * mode use. If this list said "claimed" while the claim page said "dead link",
 * the checklist would be worse than not existing.
 */
export async function listFwCohortGuides(
  db: SupabaseClient,
  input: { cohortId: string; now: number }
): Promise<{ ok: true; guides: FwOpsGuide[] } | { ok: false }> {
  const grants = await fetchAllRows<Record<string, unknown>>(
    `guide grants (${input.cohortId})`,
    (from, to) =>
      db
        .from("path_role_grants")
        .select("user_id, created_at")
        .eq("role", "guide")
        .eq("scope_type", "cohort")
        .eq("scope_id", input.cohortId)
        .order("id", { ascending: true })
        .range(from, to)
  );
  if (!grants.ok) return { ok: false };

  const userIds: string[] = [];
  for (const row of grants.rows) {
    if (typeof row.user_id === "string" && !userIds.includes(row.user_id)) {
      userIds.push(row.user_id);
    }
  }
  if (userIds.length === 0) return { ok: true, guides: [] };

  const invites = await fetchAllRows<Record<string, unknown>>(
    `guide invites (${input.cohortId})`,
    (from, to) =>
      db
        .from("path_fw_guide_invites")
        .select("user_id, email, expires_at, claimed_at, issued_at")
        .in("user_id", userIds)
        .order("id", { ascending: true })
        .range(from, to)
  );
  if (!invites.ok) return { ok: false };

  // The staff discriminator (ops redesign Unit 5) — the SAME table and liveness
  // rule the bridge reads (`loadStaffRowActive`: a row with `is_active = true`),
  // batched over the grant-holders instead of probed per row. Fail posture
  // matches the other two reads: a probe outage fails the whole list rather
  // than silently painting a staff grant-holder as credential-less (`no_invite`
  // would invite a re-send that structurally cannot work).
  const staffRows = await fetchAllRows<Record<string, unknown>>(
    `guide staff probe (${input.cohortId})`,
    (from, to) =>
      db
        .from("staff")
        .select("id, is_active")
        .in("id", userIds)
        .order("id", { ascending: true })
        .range(from, to)
  );
  if (!staffRows.ok) return { ok: false };
  const staffIds = new Set<string>();
  for (const row of staffRows.rows) {
    if (typeof row.id === "string" && row.is_active === true) staffIds.add(row.id);
  }

  const byUser = new Map<string, Record<string, unknown>>();
  for (const row of invites.rows) {
    if (typeof row.user_id === "string") byUser.set(row.user_id, row);
  }

  const guides: FwOpsGuide[] = userIds.map((userId) => {
    const invite = byUser.get(userId);
    const expiresAt = invite && typeof invite.expires_at === "string" ? invite.expires_at : null;
    const claimedAt = invite && typeof invite.claimed_at === "string" ? invite.claimed_at : null;
    const verdict = fwGuideInviteVerdict({
      invite: expiresAt === null ? null : { expiresAt, claimedAt },
      now: input.now,
    });
    const credential: FwGuideCredentialStatus = verdict.ok
      ? "invited"
      : verdict.reason === "already_claimed"
        ? "claimed"
        : verdict.reason === "expired"
          ? "expired"
          : "no_invite";
    return {
      userId,
      email: invite && typeof invite.email === "string" ? invite.email : null,
      credential,
      invitedAt: invite && typeof invite.issued_at === "string" ? invite.issued_at : null,
      claimedAt,
      isStaff: staffIds.has(userId),
    };
  });

  // The rare tail: a grant with no invite row still has to be identifiable, or
  // staff cannot decide whether to revoke it. Bounded by the number of MISSING
  // rows (normally zero), so this is not an N+1 on the common path.
  //
  // Through `fwRead`, which is doing two jobs here (reliability review). The
  // timeout is the obvious one. The THROW GUARD is the load-bearing one: this
  // sits inside a `Promise.all` inside a function the ops page calls from
  // another `Promise.all`, so an Admin API call that THROWS — a network abort,
  // a malformed response — would reject all the way out of the render and take
  // down the whole cohort page, including the header and the board-token panel
  // that had already loaded fine. Naming a guide is the least important thing
  // on that page; it must not be the thing that can break it.
  const unnamed = guides.filter((g) => g.email === null);
  if (unnamed.length > 0) {
    await Promise.all(
      unnamed.map(async (guide) => {
        const account = await fwRead(
          () => db.auth.admin.getUserById(guide.userId),
          `guide account load (${guide.userId})`
        );
        const user = account.data?.user;
        if (account.error || !user) {
          console.error(
            `[fw/ops] could not name guide ${guide.userId}: ${account.error?.message ?? "no user"}`
          );
          return;
        }
        if (typeof user.email === "string") guide.email = user.email;
      })
    );
  }

  return { ok: true, guides };
}

export type RevokeFwGuideGrantResult =
  | { ok: true; audited: boolean }
  | { ok: false; reason: "grant_not_found" | "unavailable" };

/**
 * Remove one guide's check-in power for one cohort, and record who did it.
 *
 * DELETES THE GRANT ONLY. The account, its password, and its invite row all
 * survive — this is not an offboarding action, it is a scope change, and a guide
 * who works Boston and Hamptons must keep working Hamptons. Their existing
 * session is not killed either, and does not need to be: `resolveFwActorForCohort`
 * re-reads grants on every page and every action, so the revoked cohort refuses
 * on their very next tap. (Pinned by test — "revoke-grant removes check-in power
 * on next action" is the plan's own edge case.)
 *
 * `grant_not_found` is reported rather than treated as success, because the two
 * are different answers to "does this person still have access?" — and a
 * double-submit that silently reports success would leave staff believing they
 * revoked a grant that a different spelling of the same name still holds.
 */
export async function revokeFwGuideGrant(
  db: SupabaseClient,
  input: { cohortId: string; userId: string; actorUserId: string; metadata?: Record<string, unknown> }
): Promise<RevokeFwGuideGrantResult> {
  const deleted = await fwWrite(
    () =>
      db
        .from("path_role_grants")
        .delete()
        .eq("user_id", input.userId)
        .eq("role", "guide")
        .eq("scope_type", "cohort")
        .eq("scope_id", input.cohortId)
        .select("id"),
    `grant revoke (${input.userId}/${input.cohortId})`
  );
  if (deleted.error) {
    console.error(
      `[fw/ops] grant revoke failed for ${input.userId}/${input.cohortId}: ${deleted.error.message}`
    );
    // POST-WRITE VERIFY, not a bare return (adversarial review). `fwWrite`'s own
    // contract is that a timed-out write MAY still have landed, and this call is
    // load-bearing for a LIABILITY RECORD, not just for a mutation: returning
    // here would leave a grant genuinely deleted with no `guide_grant_revoked`
    // row, and the retry would then report `grant_not_found` — truthful about
    // access, permanently silent about who removed it. That is exactly the
    // invariant the audit table exists to hold, so we go and look.
    const stillThere = await fwRead(
      () =>
        db
          .from("path_role_grants")
          .select("id")
          .eq("user_id", input.userId)
          .eq("role", "guide")
          .eq("scope_type", "cohort")
          .eq("scope_id", input.cohortId)
          .maybeSingle(),
      `grant revoke verify (${input.userId}/${input.cohortId})`
    );
    if (stillThere.error || stillThere.data) {
      // Either we cannot tell, or the grant is genuinely still there. Both mean
      // "report the failure"; only the second means nothing happened.
      return { ok: false, reason: "unavailable" };
    }
    // The delete DID land. Record it and report the truth.
    console.warn(
      `[fw/ops] grant revoke for ${input.userId}/${input.cohortId} reported an error but LANDED — auditing it`
    );
    const auditedAnyway = await recordFwOpsAudit(db, {
      actor: input.actorUserId,
      action: "guide_grant_revoked",
      subjectUserId: input.userId,
      cohortId: input.cohortId,
      metadata: { ...input.metadata, recoveredFromReportedFailure: true },
    });
    return { ok: true, audited: auditedAnyway };
  }
  if ((deleted.data ?? []).length === 0) return { ok: false, reason: "grant_not_found" };

  const audited = await recordFwOpsAudit(db, {
    actor: input.actorUserId,
    action: "guide_grant_revoked",
    subjectUserId: input.userId,
    cohortId: input.cohortId,
    metadata: input.metadata,
  });
  return { ok: true, audited };
}

/* ═══════════════════════════════════════════════════ the replay-reject list ══ */
/* FW Unit 5b, Decision 9 / gap G11. Rows are WRITTEN by Unit 8's drain (not yet
 * built); this is the LIST + resolve surface, buildable now against the Unit 1
 * table. A reject list with no way to close a row is a list nobody reads twice. */

/** One `path_fw_replay_rejects` row, joined to the student's name, for the ops
 *  surface. `reason` is the raw machine string; the surface renders copy from it
 *  via `fwReplayRejectReasonCopy`, so a Unit-8 reason this build has no copy for
 *  still shows itself rather than a blank. */
export type FwOpsReplayReject = {
  id: string;
  studentId: string;
  /** null when the profile row will not narrow — the reject is still listed and
   *  resolvable (a reject nobody can name is still a reject staff must close). */
  studentName: string | null;
  taskId: string;
  action: string;
  reason: string;
  capturedAt: string | null;
  createdAt: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
};

const REJECT_COLUMNS =
  "id, student_id, task_id, action, reason, client_id, captured_at, created_at, resolved_at, resolved_by";

/**
 * The cohort's replay rejects — open ones by default, all of them when staff
 * ask for history.
 *
 * PAGINATED with the deterministic `.order("id")` before `.range()` that Unit 5
 * pinned: a mid-weekend outage can drain dozens of rejects at once (the "replay
 * bell salvo" the plan names), so this is exactly a read that can clear the
 * 1000-row cliff over a season. Sorted newest-first in memory for display, after
 * the id-ordered paging — the ops default view is "what still needs closing".
 *
 * Fails the WHOLE read on error rather than rendering an empty list: an open
 * reject silently dropped is a correction nobody makes, and the surface renders
 * a truthful "couldn't load" for `{ok:false}` — the `listFwCohortGuides` posture.
 */
export async function listFwReplayRejects(
  db: SupabaseClient,
  input: { cohortId: string; includeResolved?: boolean }
): Promise<{ ok: true; rejects: FwOpsReplayReject[] } | { ok: false }> {
  const rows = await fetchAllRows<Record<string, unknown>>(
    `replay rejects (${input.cohortId})`,
    (from, to) => {
      const base = db
        .from("path_fw_replay_rejects")
        .select(REJECT_COLUMNS)
        .eq("cohort_id", input.cohortId);
      return (input.includeResolved ? base : base.is("resolved_at", null))
        .order("id", { ascending: true })
        .range(from, to);
    }
  );
  if (!rows.ok) return { ok: false };

  const studentIds = [
    ...new Set(
      rows.rows.map((r) => r.student_id).filter((id): id is string => typeof id === "string")
    ),
  ];
  const names = await loadFwStudentNames(db, studentIds);
  if (!names.ok) return { ok: false };

  const rejects: FwOpsReplayReject[] = [];
  for (const row of rows.rows) {
    if (typeof row.id !== "string" || typeof row.student_id !== "string") {
      console.error(`[fw/ops] dropped a reject row with no id/student_id`);
      continue;
    }
    rejects.push({
      id: row.id,
      studentId: row.student_id,
      studentName: names.byId.get(row.student_id) ?? null,
      taskId: typeof row.task_id === "string" ? row.task_id : "",
      action: typeof row.action === "string" ? row.action : "",
      reason: typeof row.reason === "string" ? row.reason : "",
      capturedAt: typeof row.captured_at === "string" ? row.captured_at : null,
      createdAt: typeof row.created_at === "string" ? row.created_at : null,
      resolvedAt: typeof row.resolved_at === "string" ? row.resolved_at : null,
      resolvedBy: typeof row.resolved_by === "string" ? row.resolved_by : null,
    });
  }
  // Newest first, with a stable id tiebreaker so two rejects sharing a
  // created_at do not reorder between loads (the `pickFwCurrentBoardToken`
  // lesson: never let the database's row order decide what staff see).
  rejects.sort((a, b) => {
    const byTime = (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
    return byTime !== 0 ? byTime : b.id.localeCompare(a.id);
  });
  return { ok: true, rejects };
}

export type ResolveFwReplayRejectResult =
  | { ok: true }
  | { ok: false; reason: "not_open" | "unavailable" };

/**
 * Mark one open reject resolved — who closed it and when.
 *
 * NOT a liability-audit action: the plan's Scope Boundaries scope audit rows to
 * the two actions whose consequence lands in a child's permanent record
 * (anonymize and guide-grant changes). Closing a reject is `resolved_by` on the
 * row itself, the same actor-attribution cohort/token metadata mutations get.
 *
 * SCOPED to the cohort (`.eq("cohort_id", …)`) as well as the id, so a forged
 * reject id from another weekend cannot be closed from this one's surface — the
 * predicate is the guard, not the surface's visibility.
 *
 * `not_open` covers both "already resolved" and "no such row in this cohort" with
 * one message: staff cannot enumerate reject ids they were not shown, and a
 * double-submit reads honestly as "already handled — refresh". A timed-out write
 * that actually landed is safe under exactly this: the retry re-reads zero open
 * rows and reports `not_open`, which is the truth.
 */
export async function resolveFwReplayReject(
  db: SupabaseClient,
  input: { rejectId: string; cohortId: string; actorUserId: string; now: number }
): Promise<ResolveFwReplayRejectResult> {
  const res = await fwWrite(
    () =>
      db
        .from("path_fw_replay_rejects")
        .update({ resolved_at: new Date(input.now).toISOString(), resolved_by: input.actorUserId })
        .eq("id", input.rejectId)
        .eq("cohort_id", input.cohortId)
        .is("resolved_at", null)
        .select("id"),
    `reject resolve (${input.rejectId})`
  );
  if (res.error) {
    console.error(`[fw/ops] reject resolve failed for ${input.rejectId}: ${res.error.message}`);
    return { ok: false, reason: "unavailable" };
  }
  if ((res.data ?? []).length === 0) return { ok: false, reason: "not_open" };
  return { ok: true };
}

/* ══════════════════════════════════════════════ the cohort's student roster ══ */
/* The list the anonymize surface acts on. Deliberately NOT loadFwCohortRoster
 * (fw-loader): that read builds the guide's resume chips over a paginated
 * decided-rows scan the ops view never renders. This one wants names, band, the
 * anonymized marker, and the open-reject count — the pre-anonymize warning. */

export type FwOpsStudent = {
  studentId: string;
  firstName: string;
  lastName: string;
  band: string;
  /** The name is the anonymize tombstone — the row reads as removed. */
  anonymized: boolean;
  /** The anonymize sequence FINISHED (a `student_anonymized` audit row exists),
   *  distinct from `anonymized` (name tombstoned). A run whose rename or audit
   *  failed mid-way leaves `anonymized: true, anonymizeComplete: false` — a
   *  RESUMABLE state, and the surface must offer to finish it rather than treat
   *  it as done (correctness review: the name alone hid the resume affordance). */
  anonymizeComplete: boolean;
  /** Unresolved replay rejects still pointing at this student, ACROSS cohorts.
   *  Surfaced so anonymizing does not silently leave orphan rejects (plan's
   *  error scenario) — staff see the count and can resolve them first. */
  openRejects: number;
};

/** Narrow the id/first/last/band a profile read returns, fail-closed. */
function narrowFwProfileName(
  row: Record<string, unknown>
): { studentId: string; firstName: string; lastName: string; band: string } | null {
  const band = narrowFwBand(row.band);
  if (
    typeof row.id !== "string" ||
    typeof row.first_name !== "string" ||
    typeof row.last_name !== "string" ||
    band === null
  ) {
    return null;
  }
  return { studentId: row.id, firstName: row.first_name, lastName: row.last_name, band };
}

/** `studentId → "First Last"` for a set of ids, dropping (not failing on) a row
 *  that will not narrow — a reject or roster entry stays listed even when its
 *  profile is unreadable. */
async function loadFwStudentNames(
  db: SupabaseClient,
  studentIds: readonly string[]
): Promise<{ ok: true; byId: Map<string, string> } | { ok: false }> {
  const byId = new Map<string, string>();
  if (studentIds.length === 0) return { ok: true, byId };
  const res = await fetchAllRows<Record<string, unknown>>("ops student names", (from, to) =>
    db
      .from("path_student_profiles")
      .select("id, first_name, last_name")
      .in("id", [...studentIds])
      .order("id", { ascending: true })
      .range(from, to)
  );
  if (!res.ok) return { ok: false };
  for (const row of res.rows) {
    if (
      typeof row.id === "string" &&
      typeof row.first_name === "string" &&
      typeof row.last_name === "string"
    ) {
      byId.set(row.id, `${row.first_name} ${row.last_name}`);
    }
  }
  return { ok: true, byId };
}

/**
 * Every student enrolled in a cohort, with the anonymized marker and the count
 * of unresolved rejects still pointing at them.
 *
 * Three paginated reads, then the reject tally is computed in memory — the same
 * shape `listFwOpsCohorts` uses for its counts, and for the same reason
 * (docs/solutions/…/postgrest-head-count-probe-false-positive-…: at these
 * volumes an in-memory count off a paginated read has nothing to buy from a HEAD
 * probe, and the probe has a documented false positive).
 */
export async function listFwOpsStudents(
  db: SupabaseClient,
  input: { cohortId: string }
): Promise<{ ok: true; students: FwOpsStudent[] } | { ok: false }> {
  const members = await fetchAllRows<Record<string, unknown>>(
    `ops member ids (${input.cohortId})`,
    (from, to) =>
      db
        .from("path_cohort_members")
        .select("student_id")
        .eq("cohort_id", input.cohortId)
        .order("id", { ascending: true })
        .range(from, to)
  );
  if (!members.ok) return { ok: false };
  const studentIds = members.rows
    .map((r) => r.student_id)
    .filter((id): id is string => typeof id === "string");
  if (studentIds.length === 0) return { ok: true, students: [] };

  const [profiles, rejects] = await Promise.all([
    fetchAllRows<Record<string, unknown>>(`ops student profiles (${input.cohortId})`, (from, to) =>
      db
        .from("path_student_profiles")
        .select("id, user_id, first_name, last_name, band")
        .in("id", studentIds)
        .order("id", { ascending: true })
        .range(from, to)
    ),
    fetchAllRows<Record<string, unknown>>(`ops student rejects (${input.cohortId})`, (from, to) =>
      db
        .from("path_fw_replay_rejects")
        .select("student_id")
        .in("student_id", studentIds)
        .is("resolved_at", null)
        .order("id", { ascending: true })
        .range(from, to)
    ),
  ]);
  if (!profiles.ok || !rejects.ok) return { ok: false };

  const openRejects = new Map<string, number>();
  for (const row of rejects.rows) {
    if (typeof row.student_id === "string") {
      openRejects.set(row.student_id, (openRejects.get(row.student_id) ?? 0) + 1);
    }
  }

  // First pass: narrow, and note the auth id of every ALREADY-tombstoned student
  // — the only ones whose anonymize might be incomplete (correctness review).
  type Narrowed = ReturnType<typeof narrowFwProfileName> & { userId: string | null; anonymized: boolean };
  const narrowedRows: NonNullable<Narrowed>[] = [];
  const tombstonedUserIds: string[] = [];
  for (const row of profiles.rows) {
    const narrowed = narrowFwProfileName(row);
    if (!narrowed) {
      console.error(`[fw/ops] dropped a non-FW-shaped profile row (id=${String(row.id)})`);
      continue;
    }
    const userId = typeof row.user_id === "string" ? row.user_id : null;
    const anonymized = isFwTombstoneName(narrowed.firstName, narrowed.lastName);
    if (anonymized && userId) tombstonedUserIds.push(userId);
    narrowedRows.push({ ...narrowed, userId, anonymized });
  }

  // Which tombstoned students have a `student_anonymized` audit row — i.e. their
  // removal FINISHED. Only read when some student is tombstoned; a read failure
  // fails the whole roster (fail closed) rather than mislabelling a partial
  // removal as complete.
  const completedUserIds = new Set<string>();
  if (tombstonedUserIds.length > 0) {
    const audits = await fetchAllRows<Record<string, unknown>>(
      `ops anonymize audits (${input.cohortId})`,
      (from, to) =>
        db
          .from("path_fw_ops_audit")
          .select("subject_user_id")
          .eq("action", "student_anonymized")
          .in("subject_user_id", tombstonedUserIds)
          .order("id", { ascending: true })
          .range(from, to)
    );
    if (!audits.ok) return { ok: false };
    for (const row of audits.rows) {
      if (typeof row.subject_user_id === "string") completedUserIds.add(row.subject_user_id);
    }
  }

  const students: FwOpsStudent[] = narrowedRows.map((r) => ({
    studentId: r.studentId,
    firstName: r.firstName,
    lastName: r.lastName,
    band: r.band,
    anonymized: r.anonymized,
    anonymizeComplete: r.anonymized && r.userId !== null && completedUserIds.has(r.userId),
    openRejects: openRejects.get(r.studentId) ?? 0,
  }));
  students.sort(
    (a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName)
  );
  return { ok: true, students };
}

/* ═══════════════════════════════════════════════ anonymize-in-place (Dec. 10) ══ */

export type AnonymizeFwStudentResult =
  | {
      ok: true;
      /** True when the account was ALREADY renamed to its tombstone — an
       *  idempotent no-op run that still ensures the audit row exists. */
      alreadyAnonymized: boolean;
      /** The liability record landed. `false` = the anonymize happened but its
       *  audit row did not save (surfaced, never swallowed). */
      audited: boolean;
      /** Unresolved rejects still pointing at this student — the warning the
       *  plan's error scenario asks for, not a block. */
      openRejects: number;
    }
  | {
      ok: false;
      reason:
        | "student_not_found"
        | "not_in_cohort"
        | "not_fw_profile"
        | "account_missing"
        | "confirm_mismatch"
        | "unavailable";
    };

/**
 * Anonymize-in-place: the FW deletion action (plan Decision 10, gap G8).
 *
 * "Deletion" is a promise of PII REMOVAL, not a row delete — every FK into an FW
 * student is ON DELETE RESTRICT precisely so this is the only path. One
 * service-role sequence, compensable and RESUMABLE:
 *
 *   1. verify membership (the audit's cohort_id must name a cohort the student
 *      is actually in) and load the FW-shaped profile;
 *   2. the TYPED CONFIRM: the caller must have typed this child's own name
 *      (`fwAnonymizeConfirmMatches`) — checked before the account fetch so a
 *      mismatch is cheap, and skipped only when the names are already tombstoned,
 *      i.e. a prior run got that far (resume, don't re-ask);
 *   3. load the auth account (a read error is transient `unavailable`, not
 *      `account_missing`); if it is already at its tombstone address → already
 *      done; ensure the audit row exists (self-healing) and return;
 *   4. record the freed local part in `path_fw_released_aliases`;
 *   5. tombstone the profile's name columns (XOR CHECK still satisfied — band
 *      stays, names become the sentinel, normalized_name is NULLed so the child
 *      is unfindable by name forever);
 *   6. rename the auth email to the tombstone address;
 *   7. write the `student_anonymized` audit row (idempotent — a partial unique
 *      index and probe-then-insert make a concurrent double-write impossible).
 *
 * ── Ordering deviates from Decision 10's PROSE for crash-safety, deliberately
 *
 * The plan lists "tombstone names → rename email → insert alias → audit". This
 * records the freed alias BEFORE the rename, because that is the only order under
 * which the freed-address invariant survives a crash: once the email is renamed
 * to `removed-<id>.fw@`, the original local part (`maya.chen2`, suffix and all)
 * is UNRECOVERABLE — so a rename-then-alias order that died between the two would
 * free `maya.chen` with no ledger row, and the next Maya Chen could be minted
 * onto a channel the first family still holds (the exact harm FW-D2/Decision 10
 * exist to prevent). Recording the alias first makes the ledger consistent at
 * every intermediate state; the two writes both happen, and the deviation only
 * concerns which lands first. (The name tombstone can go before or after; it is
 * placed before the rename so a resumed run detects "names tombstoned, email
 * not" and skips the confirm.)
 *
 * ── The side-records survive a landed-but-reported-failed primary write
 *
 * docs/solutions/logic-errors/audit-side-record-gated-on-primary-writes-reported-
 * success-…: a `fwWrite` that times out MAY have committed. The RENAME is the
 * primary write the audit is gated behind, so its error branch POST-WRITE
 * VERIFIES (re-reads the account); if the rename actually landed, the audit is
 * written anyway rather than lost. The alias insert is idempotent (a unique
 * violation is success) and, being before the rename, is safe to retry. And the
 * already-anonymized path re-attempts the audit if none exists — so the liability
 * record is self-healing across every partial-failure shape.
 */
export async function anonymizeFwStudent(
  db: SupabaseClient,
  input: { studentId: string; cohortId: string; actorUserId: string; confirmName: string }
): Promise<AnonymizeFwStudentResult> {
  // 1a. Membership — the audit's cohort_id must name a real membership, and this
  //     is also what scopes the action to a cohort staff can see the student in.
  const membership = await fwRead(
    () =>
      db
        .from("path_cohort_members")
        .select("student_id")
        .eq("cohort_id", input.cohortId)
        .eq("student_id", input.studentId)
        .maybeSingle(),
    `anonymize membership (${input.studentId}/${input.cohortId})`
  );
  if (membership.error) return { ok: false, reason: "unavailable" };
  if (!membership.data) return { ok: false, reason: "not_in_cohort" };

  // 1b. The FW-shaped profile.
  const profileRes = await fwRead(
    () =>
      db
        .from("path_student_profiles")
        .select("id, user_id, child_id, first_name, last_name, band, normalized_name")
        .eq("id", input.studentId)
        .maybeSingle(),
    `anonymize profile (${input.studentId})`
  );
  if (profileRes.error) return { ok: false, reason: "unavailable" };
  const profile = profileRes.data;
  if (!profile) return { ok: false, reason: "student_not_found" };
  if (typeof profile.id !== "string" || typeof profile.user_id !== "string") {
    console.error(`[fw/ops] anonymize: profile ${input.studentId} has a malformed id/user_id`);
    return { ok: false, reason: "unavailable" };
  }
  // Never anonymize a Path student through this path: a Path row has a child_id
  // and derives its name from public.children, so tombstoning THESE columns would
  // do nothing and the auth-email rename would corrupt a real family's login.
  if (profile.child_id !== null || typeof profile.band !== "string") {
    return { ok: false, reason: "not_fw_profile" };
  }
  const userId = profile.user_id;
  const storedFirst = typeof profile.first_name === "string" ? profile.first_name : "";
  const storedLast = typeof profile.last_name === "string" ? profile.last_name : "";

  // 2. The typed confirm — checked FIRST, before the account fetch and the reject
  //    count, so a mismatch returns without paying for either (performance
  //    review). Depends only on the stored name, already in hand. Skipped only for
  //    a resume (names already tombstoned by a prior partial run; the confirm was
  //    passed then and the name is gone now). Safe to move ahead of the
  //    already-anonymized check: this sequence tombstones the name (step 5) BEFORE
  //    renaming the email (step 6), so `email === tombstone` never holds while
  //    `nameTombstoned` is false — a fresh, un-anonymized student always confirms.
  const nameTombstoned = isFwTombstoneName(storedFirst, storedLast);
  if (!nameTombstoned && !fwAnonymizeConfirmMatches(input.confirmName, storedFirst, storedLast)) {
    return { ok: false, reason: "confirm_mismatch" };
  }

  // 3. The auth account — needed for the current address (the freed local part)
  //     and to perform the rename. A READ ERROR is a transient "no answer"
  //     (reliability review): a timed-out getUserById on venue wifi must read as
  //     `unavailable` ("try again"), not `account_missing` ("their record is gone
  //     — tell an engineer"), which is what the same function's membership/profile
  //     reads above already do. Only a clean "no such user" is `account_missing`.
  const account = await fwRead(
    () => db.auth.admin.getUserById(userId),
    `anonymize account (${userId})`
  );
  if (account.error) return { ok: false, reason: "unavailable" };
  const user = account.data?.user;
  if (!user) {
    console.error(`[fw/ops] anonymize: no auth account for ${userId} (student ${input.studentId})`);
    return { ok: false, reason: "account_missing" };
  }
  const currentEmail = typeof user.email === "string" ? user.email : "";
  const tombstoneEmail = buildFwTombstoneEmail(input.studentId);

  // Count open rejects up front (across cohorts) so the warning is in the result
  // whichever branch returns — an anonymize that leaves orphan rejects behind is
  // the plan's named error, and this is the count that surfaces it.
  const openRejects = await countOpenRejectsForStudent(db, input.studentId);

  // 4. Already at the tombstone address → idempotent no-op. Ensure the liability
  //    row exists even here: if the run that renamed the email failed to audit,
  //    a retry lands on THIS branch, and returning without checking would make
  //    the audit gap permanent.
  if (currentEmail === tombstoneEmail) {
    const audited = await ensureAnonymizeAudit(db, {
      actorUserId: input.actorUserId,
      subjectUserId: userId,
      cohortId: input.cohortId,
    });
    return { ok: true, alreadyAnonymized: true, audited, openRejects };
  }

  // 5. Record the freed local part FIRST (see the ordering note above). Only an
  //    FW address has a name-derived local part to protect; anything else has
  //    nothing to release, so the alias step is skipped rather than guessed.
  const releasedLocalPart = fwLocalPartFromEmail(currentEmail);
  if (releasedLocalPart !== null) {
    const alias = await fwWrite(
      () =>
        db
          .from("path_fw_released_aliases")
          .insert([{ local_part: releasedLocalPart, released_profile_id: input.studentId }]),
      `released alias insert (${releasedLocalPart})`
    );
    if (alias.error && !isUniqueViolation(alias.error)) {
      // A unique violation is SUCCESS (already released — idempotent). Any other
      // error: post-write verify, because a timed-out insert may have landed.
      const present = await fwRead(
        () =>
          db
            .from("path_fw_released_aliases")
            .select("local_part")
            .eq("local_part", releasedLocalPart)
            .maybeSingle(),
        `released alias verify (${releasedLocalPart})`
      );
      if (present.error || !present.data) {
        // Genuinely not recorded. The email is NOT yet renamed (alias is first),
        // so the current address still yields this local part on retry — return
        // and let staff retry rather than free an address the ledger forgot.
        console.error(
          `[fw/ops] anonymize: could not record released alias ${releasedLocalPart} for ${input.studentId} — refusing to rename before the ledger holds it`
        );
        return { ok: false, reason: "unavailable" };
      }
    }
  }

  // 6. Tombstone the name columns (skip if a prior run already did). No
  //    post-write-verify needed: a landed-but-failed tombstone is recovered by
  //    the resume path — the retry sees the tombstone name, skips the confirm,
  //    and continues.
  if (!nameTombstoned) {
    const tombstoned = await fwWrite(
      () =>
        db
          .from("path_student_profiles")
          .update({
            first_name: FW_TOMBSTONE_FIRST_NAME,
            last_name: FW_TOMBSTONE_LAST_NAME,
            normalized_name: null,
          })
          .eq("id", input.studentId),
      `profile tombstone (${input.studentId})`
    );
    if (tombstoned.error) {
      console.error(
        `[fw/ops] anonymize: name tombstone failed for ${input.studentId}: ${tombstoned.error.message}`
      );
      return { ok: false, reason: "unavailable" };
    }
  }

  // 7. Rename the auth email to the tombstone address. `email_confirm: true`
  //    marks the new address confirmed so no Supabase change-confirmation flow is
  //    triggered (the no-auth-mail hold): the rename sets the email directly, and
  //    the target lives inside the `.fw@` namespace the guard covers regardless.
  const renamed = await fwWrite(
    () => db.auth.admin.updateUserById(userId, { email: tombstoneEmail, email_confirm: true }),
    `anonymize rename (${userId})`
  );
  let recovered = false;
  if (renamed.error) {
    // POST-WRITE VERIFY: a timed-out rename may have landed. If it did, the audit
    // must still be written (it is the liability record, gated behind this write).
    const after = await fwRead(
      () => db.auth.admin.getUserById(userId),
      `anonymize rename verify (${userId})`
    );
    const landedEmail = typeof after.data?.user?.email === "string" ? after.data.user.email : "";
    if (after.error || landedEmail !== tombstoneEmail) {
      // Not renamed. Alias is recorded, name is tombstoned — a resume completes
      // it (currentEmail is still original, so the retry re-renames).
      console.error(
        `[fw/ops] anonymize: rename failed for ${userId}: ${renamed.error.message} — name tombstoned and alias recorded; retry to finish`
      );
      return { ok: false, reason: "unavailable" };
    }
    console.warn(
      `[fw/ops] anonymize rename for ${userId} reported an error but LANDED — auditing it`
    );
    recovered = true;
  }

  // 8. The liability record — through `ensureAnonymizeAudit` (probe-then-insert,
  //    unique-violation-as-success), NOT a blind insert. Two staff anonymizing
  //    the same student concurrently both reach here after sharing the idempotent
  //    alias/tombstone/rename writes; a blind insert would write TWO immutable
  //    `student_anonymized` rows for one event, and the partial unique index
  //    (20260801160000) plus this idempotent writer make a second row impossible
  //    rather than merely unlikely (correctness + adversarial review).
  const audited = await ensureAnonymizeAudit(db, {
    actorUserId: input.actorUserId,
    subjectUserId: userId,
    cohortId: input.cohortId,
    metadata: {
      releasedLocalPart,
      ...(recovered ? { recoveredFromReportedFailure: true } : {}),
    },
  });
  return { ok: true, alreadyAnonymized: false, audited, openRejects };
}

/** Count unresolved rejects still pointing at a student, across cohorts. Returns
 *  0 on a read failure — the warning is best-effort and must never block the
 *  anonymize it annotates. */
async function countOpenRejectsForStudent(
  db: SupabaseClient,
  studentId: string
): Promise<number> {
  const res = await fetchAllRows<Record<string, unknown>>(
    `open rejects for student (${studentId})`,
    (from, to) =>
      db
        .from("path_fw_replay_rejects")
        .select("id")
        .eq("student_id", studentId)
        .is("resolved_at", null)
        .order("id", { ascending: true })
        .range(from, to)
  );
  return res.ok ? res.rows.length : 0;
}

/**
 * Ensure exactly one `student_anonymized` audit row exists for this subject —
 * the SOLE audit writer for the anonymize action, used by both the primary
 * completion path and the already-anonymized self-heal path.
 *
 * Idempotent and concurrency-safe (correctness + adversarial review): a blind
 * insert would let two staff anonymizing the same student write two immutable
 * liability rows for one event. This probes first, and treats the unique
 * violation from the partial index (`path_fw_ops_audit_one_anonymize_idx`,
 * 20260801160000) as SUCCESS — a concurrent run already recorded it. The probe
 * is `.limit(1)` so it stays multiplicity-safe even if a pre-index row pair
 * somehow exists (a bare `.maybeSingle()` errors on two rows and would report
 * `audited: false` over a record that IS present).
 *
 * `metadata` is the primary path's `{ releasedLocalPart, … }`; the self-heal
 * path omits it and the writer stamps `recoveredFromReportedFailure`.
 */
async function ensureAnonymizeAudit(
  db: SupabaseClient,
  input: {
    actorUserId: string;
    subjectUserId: string;
    cohortId: string;
    metadata?: Record<string, unknown>;
  }
): Promise<boolean> {
  const probe = () =>
    fwRead(
      () =>
        db
          .from("path_fw_ops_audit")
          .select("id")
          .eq("subject_user_id", input.subjectUserId)
          .eq("action", "student_anonymized")
          .limit(1)
          .maybeSingle(),
      `anonymize audit probe (${input.subjectUserId})`
    );

  const existing = await probe();
  if (existing.error) {
    // Cannot tell — report false so the surface says "the record didn't save",
    // which is the honest, fail-closed answer rather than a fabricated "saved".
    return false;
  }
  if (existing.data) return true;

  const inserted = await fwWrite(
    () =>
      db.from("path_fw_ops_audit").insert([
        {
          actor: input.actorUserId,
          action: "student_anonymized",
          subject_user_id: input.subjectUserId,
          cohort_id: input.cohortId,
          metadata: input.metadata ?? { recoveredFromReportedFailure: true },
        },
      ]),
    `anonymize audit write (${input.subjectUserId})`
  );
  if (!inserted.error) return true;
  // A unique violation means a concurrent anonymize already recorded it — the row
  // exists, so the record is present: success.
  if (isUniqueViolation(inserted.error)) return true;
  // Any other error (incl. a timed-out write that may have landed): re-probe.
  const after = await probe();
  return !after.error && after.data !== null;
}

/* ═════════════════════════════════════ PROPOSED-1: staff match resolution ══ */
/* Accepted 2026-07-23. The guide's quick-create shows a MINIMAL cross-cohort
 * signal (a count, no detail — fw-match-rules.ts); staff, already authorized
 * across cohorts, see the FULL detail here and either link the existing student
 * into this weekend or confirm a genuinely new student. */

export type FwMatchResolutionEntry = {
  profileId: string;
  firstName: string;
  lastName: string;
  band: string;
  /** Every cohort this student is a member of, named. The detail the guide's
   *  minimal signal withheld and staff need to settle identity. */
  memberships: { cohortId: string; slug: string }[];
  /** Already a member of the cohort staff are resolving from — nothing to link. */
  inActiveCohort: boolean;
};

export type FwMatchResolution =
  | { ok: true; kind: "invalid_name" }
  | { ok: true; kind: "matches"; entries: FwMatchResolutionEntry[] }
  | { ok: false };

/**
 * The full picture behind a typed name: every existing FW student who keys to it,
 * with their bands and cohort memberships.
 *
 * Exact match on the stored `normalized_name` column (the same key
 * `loadFwMatchCandidates` uses), so an anonymized student — whose
 * normalized_name the anonymize sequence NULLs — never appears: the record stays,
 * but it is unfindable by name, which is the whole point of anonymization.
 *
 * FAILS the whole read on a malformed row, like `loadFwMatchCandidates` and
 * unlike the roster: this feeds a link/new-student decision, and a silently
 * dropped candidate is how staff confirm "new student" for a child who already
 * has an account.
 */
export async function loadFwMatchResolution(
  db: SupabaseClient,
  input: { cohortId: string; firstName: string; lastName: string }
): Promise<FwMatchResolution> {
  const key = fwMatchKey(input.firstName, input.lastName);
  if (key === null) return { ok: true, kind: "invalid_name" };

  const profiles = await fetchAllRows<Record<string, unknown>>("match resolution", (from, to) =>
    db
      .from("path_student_profiles")
      .select("id, first_name, last_name, band, normalized_name")
      .eq("normalized_name", key)
      .order("id", { ascending: true })
      .range(from, to)
  );
  if (!profiles.ok) return { ok: false };
  if (profiles.rows.length === 0) return { ok: true, kind: "matches", entries: [] };

  const entries: FwMatchResolutionEntry[] = [];
  for (const row of profiles.rows) {
    const narrowed = narrowFwProfileName(row);
    if (!narrowed) {
      console.error(
        `[fw/ops] refusing a match resolution with an unreadable candidate (id=${String(row.id)})`
      );
      return { ok: false };
    }
    entries.push({
      profileId: narrowed.studentId,
      firstName: narrowed.firstName,
      lastName: narrowed.lastName,
      band: narrowed.band,
      memberships: [],
      inActiveCohort: false,
    });
  }

  const members = await fetchAllRows<Record<string, unknown>>(
    "match resolution memberships",
    (from, to) =>
      db
        .from("path_cohort_members")
        .select("student_id, cohort_id")
        .in("student_id", entries.map((e) => e.profileId))
        .order("id", { ascending: true })
        .range(from, to)
  );
  if (!members.ok) return { ok: false };

  const cohortIds = [
    ...new Set(
      members.rows.map((m) => m.cohort_id).filter((id): id is string => typeof id === "string")
    ),
  ];
  const slugs = await loadFwCohortSlugs(db, cohortIds);
  if (!slugs.ok) return { ok: false };

  const byStudent = new Map<string, { cohortId: string; slug: string }[]>();
  for (const m of members.rows) {
    if (typeof m.student_id !== "string" || typeof m.cohort_id !== "string") {
      console.error("[fw/ops] refusing a match resolution with an unreadable membership row");
      return { ok: false };
    }
    const bucket = byStudent.get(m.student_id) ?? [];
    bucket.push({ cohortId: m.cohort_id, slug: slugs.byId.get(m.cohort_id) ?? m.cohort_id });
    byStudent.set(m.student_id, bucket);
  }
  for (const entry of entries) {
    entry.memberships = byStudent.get(entry.profileId) ?? [];
    entry.inActiveCohort = entry.memberships.some((mem) => mem.cohortId === input.cohortId);
  }
  return { ok: true, kind: "matches", entries };
}

/** `cohortId → slug` for a set of cohort ids. */
async function loadFwCohortSlugs(
  db: SupabaseClient,
  cohortIds: readonly string[]
): Promise<{ ok: true; byId: Map<string, string> } | { ok: false }> {
  const byId = new Map<string, string>();
  if (cohortIds.length === 0) return { ok: true, byId };
  const res = await fetchAllRows<Record<string, unknown>>("match resolution slugs", (from, to) =>
    db
      .from("path_cohorts")
      .select("id, slug")
      .in("id", [...cohortIds])
      .order("id", { ascending: true })
      .range(from, to)
  );
  if (!res.ok) return { ok: false };
  for (const row of res.rows) {
    if (typeof row.id === "string") byId.set(row.id, typeof row.slug === "string" ? row.slug : row.id);
  }
  return { ok: true, byId };
}

export type LinkFwStudentToCohortResult =
  | { ok: true; alreadyMember: boolean }
  | {
      ok: false;
      reason:
        | "student_not_found"
        | "not_fw_profile"
        | "student_anonymized"
        | "cohort_not_fw"
        /** Unit 8: roster-building refuses on a retired weekend. */
        | "cohort_archived"
        | "unavailable";
    };

/**
 * Link an existing FW student into the active cohort — the "link membership" half
 * of the match resolution (the "confirm new student" half is just quick-create,
 * which already exists).
 *
 * Adds a `path_cohort_members` row and nothing else: progress is PER-STUDENT
 * (keyed on student_id, not cohort), so a returner's 125 rows already exist and
 * their record "arrives filled" the moment the membership lands — which is
 * Decision 16's resume affordance, not a thing to re-materialize here.
 *
 * NOT an audit action (Scope Boundaries: only anonymize and guide-grant changes
 * write audit rows). The membership row is its own attribution of what happened.
 *
 * Guards THREE ends: the target must be an FW-shaped profile (never enroll a Path
 * student into an FW cohort — the same shape gate `provisionFwStudent`'s resume
 * path holds); the cohort must be `kind='fw'` (never mint an FW membership
 * against a Path cohort); and the target must NOT be anonymized.
 *
 * ── The anonymize guard is the whole point (adversarial review, P1)
 *
 * `loadFwMatchResolution` already hides anonymized students (their normalized_name
 * is NULLed), but the match resolver renders its result into client state with no
 * TTL — so a candidate looked up BEFORE a concurrent anonymize can still be
 * clicked AFTER it. Anonymize NULLs normalized_name and tombstones the name but
 * touches neither `band` nor `child_id`, so a tombstoned profile sails through the
 * FW-shape gate. Without this check, linking that stale entry would insert a live
 * `path_cohort_members` row for a "Removed student" — a checkin-able roster ghost
 * that the guide surface would then let someone tap, resurrecting an identity
 * Decision 10 promises is permanently retired. Refuse it as its own reason.
 */
export async function linkFwStudentToCohort(
  db: SupabaseClient,
  input: { studentId: string; cohortId: string }
): Promise<LinkFwStudentToCohortResult> {
  const cohort = await loadFwOpsCohort(db, input.cohortId);
  if (!cohort) return { ok: false, reason: "unavailable" };
  if (cohort.kind !== FW_COHORT_KIND) return { ok: false, reason: "cohort_not_fw" };
  // Unit 8 (guard table: "link an existing student → refuse"). Roster-building on a
  // retired weekend; the read already carries the state.
  if (cohort.archivedAt !== null) return { ok: false, reason: "cohort_archived" };

  const profile = await fwRead(
    () =>
      db
        .from("path_student_profiles")
        .select("id, child_id, band, first_name, last_name")
        .eq("id", input.studentId)
        .maybeSingle(),
    `link profile (${input.studentId})`
  );
  if (profile.error) return { ok: false, reason: "unavailable" };
  if (!profile.data) return { ok: false, reason: "student_not_found" };
  if (profile.data.child_id !== null || typeof profile.data.band !== "string") {
    return { ok: false, reason: "not_fw_profile" };
  }
  if (isFwTombstoneName(profile.data.first_name, profile.data.last_name)) {
    return { ok: false, reason: "student_anonymized" };
  }

  const existing = await fwRead(
    () =>
      db
        .from("path_cohort_members")
        .select("student_id")
        .eq("cohort_id", input.cohortId)
        .eq("student_id", input.studentId)
        .maybeSingle(),
    `link membership probe (${input.studentId}/${input.cohortId})`
  );
  if (existing.error) return { ok: false, reason: "unavailable" };
  if (existing.data) return { ok: true, alreadyMember: true };

  const inserted = await fwWrite(
    () =>
      db
        .from("path_cohort_members")
        .insert([{ student_id: input.studentId, cohort_id: input.cohortId }]),
    `link membership insert (${input.studentId}/${input.cohortId})`
  );
  if (inserted.error) {
    // A unique violation means a concurrent link (or the probe raced) already
    // added it — success. Anything else: post-write verify, since a timed-out
    // insert may have landed.
    if (isUniqueViolation(inserted.error)) return { ok: true, alreadyMember: true };
    const present = await fwRead(
      () =>
        db
          .from("path_cohort_members")
          .select("student_id")
          .eq("cohort_id", input.cohortId)
          .eq("student_id", input.studentId)
          .maybeSingle(),
      `link membership verify (${input.studentId}/${input.cohortId})`
    );
    if (present.error || !present.data) {
      console.error(
        `[fw/ops] link membership failed for ${input.studentId}/${input.cohortId}: ${inserted.error.message}`
      );
      return { ok: false, reason: "unavailable" };
    }
    return { ok: true, alreadyMember: false };
  }
  return { ok: true, alreadyMember: false };
}

/* ═══════════════════════════════════════════════════ action result types ══ */

/**
 * The typed results the ops Server Actions return.
 *
 * Declared HERE, in a plain module, not in `actions/fw-ops.ts` — the house rule
 * from docs/solutions/runtime-errors/use-server-type-reexport-registers-server-
 * reference-referenceerror-2026-07-22.md. Next's use-server transform processes
 * exports SYNTACTICALLY and emits a `registerServerReference` wrapper for each
 * one, so a type leaving a `"use server"` file throws `X is not defined` at
 * module load and takes every action in the graph down with it. Client
 * components import these from here.
 */

export type CreateFwCohortActionResult =
  | { success: true; cohortId: string; slug: string }
  | { success: false; error: string };

export type MintBoardTokenActionResult =
  | {
      success: true;
      /** Shown ONCE. Never re-readable — only the hash is stored. */
      token: string;
      expiresAt: string;
      /** True when a live board was killed to make room. The copy must say so. */
      revokedPrior: boolean;
    }
  | { success: false; error: string };

export type RevokeBoardTokenActionResult =
  | { success: true }
  | { success: false; error: string };

export type UpdateCohortWindowActionResult =
  | { success: true; startsAt: string; endsAt: string }
  | { success: false; error: string };

/** Same success payload as mint — the re-mint IS a mint, and its URL has the
 *  same shown-once contract. */
export type RemintBoardTokenForWindowActionResult = MintBoardTokenActionResult;

export type RevokeGuideGrantActionResult =
  | { success: true; audited: boolean }
  | { success: false; error: string };

export type ResolveReplayRejectActionResult =
  | { success: true }
  | { success: false; error: string };

export type AnonymizeStudentActionResult =
  | { success: true; alreadyAnonymized: boolean; audited: boolean; openRejects: number }
  | { success: false; error: string };

export type LinkStudentActionResult =
  | { success: true; alreadyMember: boolean }
  | { success: false; error: string };

export type DeleteCohortActionResult =
  | {
      success: true;
      /** See `DeleteFwCohortResult` — `false` means the weekend IS deleted but
       *  an orphaned guide grant may remain (sweep failed). */
      grantSweep: boolean;
    }
  | { success: false; error: string };

export type MatchLookupActionResult =
  | { success: true; kind: "invalid_name" }
  | { success: true; kind: "matches"; entries: FwMatchResolutionEntry[] }
  | { success: false; error: string };
