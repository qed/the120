/**
 * Pure profile-creation decision rules for the First Profit login/signup
 * routes: handle derivation and 23505 (unique-violation) classification.
 *
 * Split out of login-rules.ts — which stays scoped to its name (request parse,
 * origin, rate-limit keys, refusal shaping). This is profile-CREATION logic,
 * and profile-core.ts (the impure core that Slice B's signup route will import
 * as a second caller) depends on it. No Next, no Supabase: only decisions.
 *
 * The random-suffix FALLBACK deliberately does NOT live here: minting entropy
 * is an impure act. This module only shapes a suffix the caller SUPPLIES
 * (`deriveHandleWithSuffix`), so every export stays a pure, deterministic
 * function of its inputs and remains trivially testable.
 */

/** Must match the fp_player_profiles.handle check constraint exactly. */
export const HANDLE_PATTERN = /^[a-z0-9]{1,30}$/;

const HANDLE_MAX_LENGTH = 30;
const HANDLE_FALLBACK = "player";

/**
 * NFKD-fold accents away, keep lowercase alphanumerics, bound to 30. A name
 * with no usable characters folds to a neutral base rather than an invalid
 * empty handle.
 */
function foldHandleBase(firstName: string): string {
  return (
    firstName
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, HANDLE_MAX_LENGTH) || HANDLE_FALLBACK
  );
}

/**
 * Sequential handle derivation. `attempt` 0 is the bare base; attempt N>0
 * appends the numeric suffix N+1 (maya, maya2, maya3 — the plan's
 * uniquification shape), truncating the base so the result always satisfies
 * HANDLE_PATTERN.
 */
export function deriveHandle(firstName: string, attempt: number): string {
  const base = foldHandleBase(firstName);
  if (attempt <= 0) return base;
  const suffix = String(attempt + 1);
  return base.slice(0, HANDLE_MAX_LENGTH - suffix.length) + suffix;
}

/**
 * Random-suffix handle, used once the sequential base..baseN attempts are
 * exhausted — otherwise a 6th child whose first name folds to an already-taken
 * base could never complete a first login (handle_exhausted forever). `suffix`
 * is minted by the IMPURE caller (profile-core, via crypto) so this stays
 * pure; the base is truncated so `base + suffix` always fits HANDLE_MAX_LENGTH
 * and satisfies HANDLE_PATTERN for any short lowercase-alphanumeric suffix.
 */
export function deriveHandleWithSuffix(firstName: string, suffix: string): string {
  const base = foldHandleBase(firstName);
  return base.slice(0, HANDLE_MAX_LENGTH - suffix.length) + suffix;
}

/* ---------------------------------------------------- 23505 classification */

export type InsertConflictKind = "handle" | "identity" | "unknown";

/**
 * Classify a fp_player_profiles unique-violation message (PostgREST surfaces
 * the constraint name): `handle` → re-derive with the next suffix and retry
 * (bounded); `identity` (user_id/child_id) → a concurrent login already
 * created the row — re-select and ADOPT it, never update it; anything else →
 * fail, don't guess.
 */
export function classifyInsertConflict(message: string): InsertConflictKind {
  if (message.includes("handle")) return "handle";
  if (message.includes("user_id") || message.includes("child_id")) return "identity";
  return "unknown";
}
