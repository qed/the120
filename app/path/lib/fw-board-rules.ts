/**
 * Pure board-token decisions (FW Unit 5; FW-R25, Decision 4, gap G18) — when a
 * cohort may have a projected board at all, how long that board's door stays
 * open, and whether a presented token is still live.
 *
 * Free of Next/Supabase imports per repo convention, alongside `fw-rules.ts`
 * and `fw-access-rules.ts`. Unit 6 extends this module with the board's READ
 * MODEL (weekend XP, grid shaping, freshness gating); the token decisions land
 * first and alone, because they are what Unit 5 mints against and what Unit 6
 * will validate against, and a disagreement between the two would be a room
 * staring at a 404.
 *
 * ── Why the expiry is DERIVED and then STORED
 *
 * Decision 4 puts the event window on `path_cohorts` as the single source of
 * truth and derives token expiry from it — but the derived value is written onto
 * the token row at mint rather than recomputed on every check. The difference
 * matters exactly once: when someone edits a cohort's `ends_at` mid-weekend. A
 * recomputed expiry would silently extend (or kill) a board that is currently
 * projected in a room; a stored one keeps the door the length it was issued
 * for, and staff re-mint deliberately if they want a different one.
 *
 * ── What is deliberately NOT here
 *
 * Token GENERATION and HASHING live in `fw-ops-core.ts`, next to the sequence
 * that writes them — the same split `fw-guide-core.ts` uses for
 * `hashGuideInviteToken`. `randomBytes` is not a decision, and `createHash` is
 * not one either; what IS a decision is everything below, and it is all a pure
 * function of values a caller can hand over in a test.
 */

/**
 * The grace period a board keeps working past its cohort's `ends_at`.
 *
 * Six hours, per Decision 4. The number is doing real work: a weekend's stated
 * end is when the last session is scheduled to finish, and the board stays up
 * through the closing ceremony, the photos, and the teardown conversation where
 * somebody asks to see the room's number one more time. An expiry pinned
 * exactly to `ends_at` would go dark in the middle of that.
 */
export const FW_BOARD_TOKEN_GRACE_MS = 6 * 60 * 60 * 1000;

/** Just the shape these decisions need from a `path_cohorts` row. `kind` is a
 *  bare string on purpose — it crosses the service-role boundary, and a value
 *  outside the union must be REFUSED here rather than cast into existence. */
export type FwBoardCohortLike = { kind: string; endsAt: string | null } | null;

/** Mirrors `FW_COHORT_KIND` in fw-access-rules.ts. Imported rather than
 *  redeclared so a renamed value cannot pass one module and fail the other. */
import { FW_COHORT_KIND } from "./fw-access-rules";

/**
 * The instant a board token minted for this cohort should stop working.
 *
 * Returns null — never a fabricated instant — when the end is absent or
 * unparseable. That is not defensive tidiness: `new Date(NaN).toISOString()`
 * THROWS, and a throw inside the mint sequence leaves a token row half-written
 * with the raw value already shown to staff.
 */
export function fwBoardTokenExpiry(endsAt: string | null): string | null {
  if (endsAt === null || endsAt.length === 0) return null;
  const endsMs = Date.parse(endsAt);
  if (Number.isNaN(endsMs)) return null;
  return new Date(endsMs + FW_BOARD_TOKEN_GRACE_MS).toISOString();
}

export type FwBoardTokenMintVerdict =
  | { ok: true; expiresAt: string }
  | {
      ok: false;
      reason:
        /** No such cohort (or the read failed) → fail closed. */
        | "cohort_not_found"
        /** G18: tokens are mintable ONLY for `kind='fw'` cohorts. */
        | "cohort_not_fw"
        /** An fw cohort whose `ends_at` is missing or unreadable. */
        | "no_event_window"
        /** The window (plus grace) is already behind us — the token would be
         *  born dead. */
        | "window_passed";
    };

/**
 * May a board token be minted for this cohort, and what expiry would it carry?
 *
 * Order is load-bearing, and each step is a refusal somebody could otherwise
 * work around:
 *
 *   1. **cohort_not_found** — an unresolvable cohort is never a permission.
 *   2. **cohort_not_fw (G18)** — checked BEFORE the window, deliberately. A
 *      board token is an UNAUTHENTICATED read door onto a cohort's students. A
 *      Path cohort's children live behind the gated, cascaded, parent-visible
 *      Path; opening a projector URL onto them is not a thing this system does.
 *      Ordering it first also means staff are never told a Path cohort merely
 *      "has no end date", which reads as an invitation to add one and retry.
 *   3. **no_event_window** — Decision 4 derives expiry from `ends_at`, so
 *      without one there is no door length to issue. Not defaulted to anything:
 *      every default here is either "expires too early" (a dark board mid-event)
 *      or "expires too late" (an unauthenticated read surface outliving its
 *      weekend), and both are worse than making staff type the dates.
 *   4. **window_passed** — the token would be expired the moment it existed.
 *      Refusing is what turns a silent 404 in front of a room into a sentence
 *      staff can act on before the doors open.
 *
 * Note the grace applies to step 4 as well as to the issued expiry, so a
 * re-mint during teardown still works — that is what the grace is FOR.
 */
export function fwBoardTokenMintVerdict({
  cohort,
  now,
}: {
  cohort: FwBoardCohortLike;
  now: number;
}): FwBoardTokenMintVerdict {
  if (!cohort) return { ok: false, reason: "cohort_not_found" };
  if (cohort.kind !== FW_COHORT_KIND) return { ok: false, reason: "cohort_not_fw" };

  const expiresAt = fwBoardTokenExpiry(cohort.endsAt);
  if (expiresAt === null) return { ok: false, reason: "no_event_window" };
  if (!(Date.parse(expiresAt) > now)) return { ok: false, reason: "window_passed" };

  return { ok: true, expiresAt };
}

/** One `path_fw_board_tokens` row, reduced to what the verdict needs. */
export type FwBoardTokenRecord = {
  expiresAt: string;
  revokedAt: string | null;
};

export type FwBoardTokenVerdict =
  | { ok: true }
  | { ok: false; reason: "not_found" | "revoked" | "expired" };

/**
 * Which of a cohort's board-token rows is THE one to report on.
 *
 * The rule, stated once here rather than as an `order by` in two queries:
 * **the live one if there is one, otherwise the most recently revoked.**
 *
 * Expressed as code rather than as SQL ordering deliberately. `order("created_at",
 * desc).limit(1)` looks equivalent and is not: two rows can carry the same
 * `created_at` (a mint and a re-mint inside one statement timestamp), and on a
 * tie the database is free to return either — which would flip a cohort's ops
 * status between "live" and "revoked" on consecutive page loads with nothing
 * changed. Picking on the field that actually decides the answer has no ties
 * that matter, because `path_fw_board_tokens_one_active_per_cohort` guarantees
 * at most one unrevoked row per cohort.
 *
 * Reporting the most recently REVOKED row when none is live is what lets staff
 * confirm their own revoke: with "active only", a killed board and a board
 * nobody ever minted are the same empty answer.
 */
export function pickFwCurrentBoardToken<T extends { revokedAt: string | null }>(
  tokens: readonly T[]
): T | null {
  let mostRecentlyRevoked: T | null = null;
  for (const token of tokens) {
    if (token.revokedAt === null) return token;
    if (
      mostRecentlyRevoked === null ||
      token.revokedAt > (mostRecentlyRevoked.revokedAt ?? "")
    ) {
      mostRecentlyRevoked = token;
    }
  }
  return mostRecentlyRevoked;
}

/**
 * Is this token still a working door? The `fwGuideInviteVerdict` sibling, and
 * the same order for the same reasons: existence, then the deliberate kill,
 * then the clock.
 *
 * **Revocation is reported ahead of expiry even when both hold.** They are
 * different facts for the person reading them — "revoked" means a human did
 * this on purpose (and a re-mint is the fix), while "expired" sends staff to
 * edit the cohort's dates. A revoked-and-long-expired token reporting "expired"
 * would send them to fix something that was never the problem.
 *
 * **Fails CLOSED on a malformed expiry**: `NaN > now` is false → expired. This
 * is why the comparison is written `!(x > now)` and not `x <= now`; the latter
 * reads a garbage timestamp as a live board.
 *
 * The three refusals are DISTINCT here on purpose, and Unit 6's board route
 * must collapse them into one 404 before they reach an unauthenticated caller —
 * distinguishing them at the door would tell whoever is guessing tokens whether
 * one ever existed. Unit 5's ops surface is the caller that needs them apart:
 * staff looking at their own cohort's token deserve to know which it is.
 */
export function fwBoardTokenVerdict({
  token,
  now,
}: {
  token: FwBoardTokenRecord | null;
  now: number;
}): FwBoardTokenVerdict {
  if (!token) return { ok: false, reason: "not_found" };
  if (token.revokedAt !== null) return { ok: false, reason: "revoked" };
  if (!(Date.parse(token.expiresAt) > now)) return { ok: false, reason: "expired" };
  return { ok: true };
}
