/**
 * First Profit CHILD USERNAME — the pure decision surface (Slice B Unit 12).
 *
 * Every The120 child logs into First Profit with a GLOBALLY-UNIQUE username, no
 * email (the login re-scope lands in later units; U12 only adds the column,
 * generation, and backfill). This module owns the two pure decisions that
 * generation needs, plus the one shared `generate-if-missing` primitive that
 * child-creation, the backfill script, AND the future U13 login-time lazy fill
 * all call — so the three can never disagree on what "a valid username for this
 * child" means.
 *
 * NO `server-only`, NO Next/Supabase imports — a sibling of provision-rules.ts,
 * so it is unit-testable in the node-only harness and safe to import from a
 * `tsx` script (the backfill). The impure shells (child-core's insert, the
 * backfill's paged writer) add I/O and the DB unique-index arbiter around it.
 *
 * The username base reuses the FW/funnel address slugger
 * (`buildFwLocalBaseFromFirstName`): the SAME fold-to-ASCII homoglyph/
 * control-char guard, the SAME first-name-only slug (`Álex` → `alex`), and the
 * SAME collision-suffix shape (`alex`, `alex2`, `alex3`, …) as
 * `pickStudentLocalPart`. One slugger, so a child's username base and any future
 * derived address can never drift.
 *
 * FAIL-CLOSED, then FALL BACK: `generateUsernameBase` refuses (verdict, never a
 * throw) an unfoldable / empty first name — the caller decides the fallback.
 * `mintUsername` is the caller most callers want: it applies the safe
 * `student`-base fallback so a child with an unnameable first name still gets a
 * unique, loginable username instead of being blocked.
 */

import { buildFwLocalBaseFromFirstName } from "@/app/fp/lib/fw-provision-rules";

/** The safe base for a first name that cannot be folded to an address-safe slug
 *  (empty, all-emoji, a non-Latin script the guard refuses). A child is NEVER
 *  blocked from getting a username; they get `student`, `student2`, … — unique
 *  via the same suffixer, and changeable later. */
export const USERNAME_FALLBACK_BASE = "student";

/** Bound on the collision search — mirrors MAX_LOCAL_PART_ATTEMPTS / the FW
 *  rule and its reasoning: reaching it means something is very wrong (hundreds
 *  of identically-named children) and guessing further would be worse. */
export const MAX_USERNAME_ATTEMPTS = 200;

/* ------------------------------------------------------------------- base */

export type UsernameBaseVerdict =
  | { ok: true; base: string }
  | { ok: false; reason: "underivable"; detail: string };

/**
 * The username base for a first name — `Álex` → `alex` — as a VERDICT, not a
 * throw. Reuses `buildFwLocalBaseFromFirstName` (fold + slug + the homoglyph/
 * control-char refusal), and turns its throw into `underivable` so a batch
 * caller (the backfill) or an inline caller (child-creation) never errors on a
 * genuinely empty / unfoldable first name — they choose a fallback instead.
 * Mirrors `deriveStudentLocalBaseFromFirstName`, kept separate so the username
 * vocabulary is not coupled to the deposit/address module.
 */
export function generateUsernameBase(firstName: string): UsernameBaseVerdict {
  try {
    return { ok: true, base: buildFwLocalBaseFromFirstName(firstName) };
  } catch (err) {
    return {
      ok: false,
      reason: "underivable",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/* ------------------------------------------------------------- suffixer */

export type UsernamePick =
  | { ok: true; username: string; attempt: number }
  | { ok: false; reason: "exhausted"; detail: string };

/**
 * Pick the first free username for a base, appending a numeric suffix until
 * `isTaken` returns false — `alex`, `alex2`, `alex3`, … The suffix starts at 2
 * (attempt 1 is the un-suffixed base) so the first child of a name gets the
 * clean handle, exactly as `pickStudentLocalPart` does.
 *
 * `isTaken` is the caller's in-memory ledger (existing usernames + everything
 * this run has already handed out). The database's partial-unique index on
 * `children.fp_username` remains the real arbiter under a race; this pick is
 * the fast path, and the caller retries on a 23505 conflict.
 */
export function pickUniqueUsername(input: {
  base: string;
  isTaken: (candidate: string) => boolean;
}): UsernamePick {
  for (let attempt = 1; attempt <= MAX_USERNAME_ATTEMPTS; attempt += 1) {
    const username = attempt === 1 ? input.base : `${input.base}${attempt}`;
    if (!input.isTaken(username)) return { ok: true, username, attempt };
  }
  return {
    ok: false,
    reason: "exhausted",
    detail: `no free username for "${input.base}" after ${MAX_USERNAME_ATTEMPTS} attempts`,
  };
}

/* --------------------------------------------- generate-if-missing primitive */

export type UsernameMint =
  | { ok: true; username: string; base: string; attempt: number; usedFallback: boolean }
  | { ok: false; reason: "exhausted"; detail: string };

/**
 * The shared "give this child a unique username" primitive — derive the base
 * from the first name, fall back to `student` when the name is unfoldable, then
 * suffix until free. This is the ONE function three callers share:
 *
 *   - child-creation (child-core): assigns `fp_username` at insert, retrying on
 *     the unique-index conflict;
 *   - the backfill script: fills every existing child that lacks one;
 *   - **U13 (login-time lazy fill, NOT wired this unit):** a child created by
 *     ANY product (funnel / FW / Path) before U12 has no `fp_username`. When
 *     such a child first logs into First Profit, U13 will call THIS function
 *     (with an `isTaken` backed by a `children.fp_username` probe) to mint one
 *     on the spot, then write it under the same 23505-retry the other two use.
 *     U12 deliberately does not touch app/api/fp/login — the primitive is here,
 *     tested, ready; the wiring is U13's.
 *
 * `isTaken` MUST reflect both the persisted usernames and everything the current
 * run has already issued, or two same-named children collide. The caller adds
 * each returned username to its own ledger before minting the next.
 */
export function mintUsername(input: {
  firstName: string;
  isTaken: (candidate: string) => boolean;
}): UsernameMint {
  const derived = generateUsernameBase(input.firstName);
  const base = derived.ok ? derived.base : USERNAME_FALLBACK_BASE;
  const pick = pickUniqueUsername({ base, isTaken: input.isTaken });
  if (!pick.ok) return pick;
  return {
    ok: true,
    username: pick.username,
    base,
    attempt: pick.attempt,
    usedFallback: !derived.ok,
  };
}
