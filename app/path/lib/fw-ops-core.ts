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
 * `fw-guide-core.ts` imports `recordFwOpsAudit` from HERE, not the reverse.
 * Provisioning a guide IS an ops action, and putting the audit write inside the
 * one function that mutates grants is what makes it un-bypassable — see that
 * function's note. Nothing here imports `fw-guide-core`, so there is no cycle:
 * the ops cohort read wants a wider column set than `loadFwCohort`'s
 * authorization read and is its own query.
 */

import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { FW_COHORT_KIND, fwGuideInviteVerdict } from "./fw-access-rules";
import {
  fwBoardTokenMintVerdict,
  fwBoardTokenVerdict,
  pickFwCurrentBoardToken,
} from "./fw-board-rules";
import { fetchAllRows, fwRead } from "./fw-call";
import { narrowFwEventTimeZone, type FwOpsAuditAction } from "./fw-ops-rules";

/** SHA-256 hex — the ONLY form a board token is ever stored in, so a database
 *  read can never reconstruct a live projector URL. Sibling of
 *  `hashGuideInviteToken`; Unit 6's board route hashes the presented token with
 *  this same function before looking it up. */
export function hashFwBoardToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Postgres unique-violation. Checked by CODE, not by matching an error
 *  message — the message is localized-ish, unstable, and varies by constraint. */
const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === UNIQUE_VIOLATION;
}

/* ══════════════════════════════════════════════════════════════════ the audit ══ */

export type RecordFwOpsAuditInput = {
  actor: string;
  action: FwOpsAuditAction;
  subjectUserId: string;
  cohortId: string;
  metadata?: Record<string, unknown>;
};

/**
 * Write one liability record.
 *
 * Returns a BOOLEAN rather than throwing or failing its caller, and the reason
 * is a genuine tension the plan does not get to dissolve: by the time this runs,
 * the grant has already been added or removed. Failing the caller would report
 * "the revoke didn't work" about a revoke that DID work, sending staff to do it
 * again; throwing would do the same, louder. So the mutation stands, the failure
 * is logged at error level, and the caller reports `audited: false` so the ops
 * copy can say "revoked — but the audit record didn't save; tell an engineer"
 * rather than quietly losing the record.
 *
 * The row itself is immutable at the database level (triggers, per the
 * migration), so nothing downstream can rewrite what does land.
 */
export async function recordFwOpsAudit(
  db: SupabaseClient,
  input: RecordFwOpsAuditInput
): Promise<boolean> {
  const res = await db.from("path_fw_ops_audit").insert([
    {
      actor: input.actor,
      action: input.action,
      subject_user_id: input.subjectUserId,
      cohort_id: input.cohortId,
      metadata: input.metadata ?? null,
    },
  ]);
  if (res.error) {
    console.error(
      `[fw/ops] AUDIT WRITE FAILED (${input.action} actor=${input.actor} subject=${input.subjectUserId} cohort=${input.cohortId}): ${res.error.message}`
    );
    return false;
  }
  return true;
}

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
};

const COHORT_COLUMNS = "id, slug, kind, starts_at, ends_at, time_zone";

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

  const res = await db
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
    .maybeSingle();

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
): { expiresAt: string; revokedAt: string | null; createdAt: string | null } | null {
  if (typeof row.expires_at !== "string") return null;
  return {
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
        .range(from, to)
  );
  if (!rows.ok) return { ok: false };

  const current = pickFwCurrentBoardToken(
    rows.rows.map(narrowTokenRow).filter((t): t is NonNullable<typeof t> => t !== null)
  );
  if (!current) {
    return {
      ok: true,
      token: { status: "never_minted", expiresAt: null, revokedAt: null, createdAt: null },
    };
  }
  return {
    ok: true,
    token: {
      status: tokenStatus(current, input.now),
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
        | "no_event_window"
        | "window_passed"
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
  input: { cohortId: string; actorUserId: string; now: number }
): Promise<MintFwBoardTokenResult> {
  const cohort = await loadFwOpsCohort(db, input.cohortId);
  const verdict = fwBoardTokenMintVerdict({
    cohort: cohort ? { kind: cohort.kind, endsAt: cohort.endsAt } : null,
    now: input.now,
  });
  if (!verdict.ok) return { ok: false, reason: verdict.reason };

  const revokedAt = new Date(input.now).toISOString();
  const revoked = await db
    .from("path_fw_board_tokens")
    .update({ revoked_at: revokedAt, revoked_by: input.actorUserId })
    .eq("cohort_id", input.cohortId)
    .is("revoked_at", null)
    .select("id");
  if (revoked.error) {
    console.error(
      `[fw/ops] prior token revoke failed for ${input.cohortId}: ${revoked.error.message}`
    );
    return { ok: false, reason: "unavailable" };
  }
  const priorIds = (revoked.data ?? [])
    .map((r) => r.id)
    .filter((id): id is string => typeof id === "string");

  const token = randomBytes(32).toString("base64url");
  const inserted = await db.from("path_fw_board_tokens").insert([
    {
      cohort_id: input.cohortId,
      token_hash: hashFwBoardToken(token),
      expires_at: verdict.expiresAt,
      created_by: input.actorUserId,
    },
  ]);

  if (inserted.error) {
    console.error(
      `[fw/ops] token insert failed for ${input.cohortId}: ${inserted.error.message}`
    );
    if (priorIds.length > 0) {
      const restored = await db
        .from("path_fw_board_tokens")
        .update({ revoked_at: null, revoked_by: null })
        .in("id", priorIds);
      if (restored.error) {
        console.error(
          `[fw/ops] COULD NOT RESTORE the prior board token for ${input.cohortId}: ${restored.error.message} — this cohort now has NO live token; staff must mint a new one and re-enter the URL on the projector`
        );
      } else {
        console.warn(
          `[fw/ops] restored the prior board token for ${input.cohortId} after a failed mint — the projector URL in use is still valid`
        );
      }
    }
    return { ok: false, reason: "unavailable" };
  }

  return { ok: true, token, expiresAt: verdict.expiresAt, revokedPrior: priorIds.length > 0 };
}

export type RevokeFwBoardTokenResult =
  | { ok: true }
  | { ok: false; reason: "no_active_token" | "unavailable" };

/**
 * Kill the cohort's live board token with no replacement.
 *
 * Distinct from a re-mint, and the difference is the whole reason
 * `revoked_by` exists: a re-mint attributes itself through the replacement
 * row's `created_by`, while this leaves a board dark and previously named
 * nobody.
 *
 * `no_active_token` is reported rather than swallowed as success. "Nothing to
 * revoke" and "revoked" look identical on a surface that reports both as done,
 * and the question staff are actually asking is whether the projector URL in
 * somebody's browser history still works.
 */
export async function revokeFwBoardToken(
  db: SupabaseClient,
  input: { cohortId: string; actorUserId: string; now: number }
): Promise<RevokeFwBoardTokenResult> {
  const res = await db
    .from("path_fw_board_tokens")
    .update({ revoked_at: new Date(input.now).toISOString(), revoked_by: input.actorUserId })
    .eq("cohort_id", input.cohortId)
    .is("revoked_at", null)
    .select("id");
  if (res.error) {
    console.error(`[fw/ops] token revoke failed for ${input.cohortId}: ${res.error.message}`);
    return { ok: false, reason: "unavailable" };
  }
  if ((res.data ?? []).length === 0) return { ok: false, reason: "no_active_token" };
  return { ok: true };
}

/* ═══════════════════════════════════════════════════════════ the cohort list ══ */

export type FwOpsCohortSummary = FwOpsCohort & {
  studentCount: number;
  guideCount: number;
  boardTokenStatus: FwBoardTokenStatus;
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
  input: { now: number }
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
    if (narrowed && narrowed.kind === FW_COHORT_KIND) cohorts.push(narrowed);
  }
  if (cohorts.length === 0) return { ok: true, cohorts: [] };

  const ids = cohorts.map((c) => c.id);
  const [members, grants, tokens] = await Promise.all([
    fetchAllRows<Record<string, unknown>>("ops member counts", (from, to) =>
      db.from("path_cohort_members").select("cohort_id").in("cohort_id", ids).range(from, to)
    ),
    fetchAllRows<Record<string, unknown>>("ops guide counts", (from, to) =>
      db
        .from("path_role_grants")
        .select("scope_id")
        .eq("role", "guide")
        .eq("scope_type", "cohort")
        .in("scope_id", ids)
        .range(from, to)
    ),
    fetchAllRows<Record<string, unknown>>("ops token statuses", (from, to) =>
      db.from("path_fw_board_tokens").select(TOKEN_COLUMNS).in("cohort_id", ids).range(from, to)
    ),
  ]);
  if (!members.ok || !grants.ok || !tokens.ok) return { ok: false };

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
};

/**
 * Every guide granted into one cohort, with their credential state.
 *
 * TWO reads, not N+1: the grants, then every invite row for those user ids in
 * one `.in(...)`. The invite row also carries the guide's EMAIL, which is what
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
        .order("created_at", { ascending: true })
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
        .range(from, to)
  );
  if (!invites.ok) return { ok: false };

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
    };
  });

  // The rare tail: a grant with no invite row still has to be identifiable, or
  // staff cannot decide whether to revoke it. Bounded by the number of MISSING
  // rows (normally zero), so this is not an N+1 on the common path.
  const unnamed = guides.filter((g) => g.email === null);
  if (unnamed.length > 0) {
    await Promise.all(
      unnamed.map(async (guide) => {
        const account = await db.auth.admin.getUserById(guide.userId);
        if (account.error || !account.data?.user) {
          console.error(
            `[fw/ops] could not name guide ${guide.userId}: ${account.error?.message ?? "no user"}`
          );
          return;
        }
        const email = account.data.user.email;
        if (typeof email === "string") guide.email = email;
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
  const deleted = await db
    .from("path_role_grants")
    .delete()
    .eq("user_id", input.userId)
    .eq("role", "guide")
    .eq("scope_type", "cohort")
    .eq("scope_id", input.cohortId)
    .select("id");
  if (deleted.error) {
    console.error(
      `[fw/ops] grant revoke failed for ${input.userId}/${input.cohortId}: ${deleted.error.message}`
    );
    return { ok: false, reason: "unavailable" };
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

export type RevokeGuideGrantActionResult =
  | { success: true; audited: boolean }
  | { success: false; error: string };
