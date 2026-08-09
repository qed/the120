/**
 * fpv03 U3c username migration core — move every child whose `fp_username`
 * lacks an '@' onto the email-shaped convention:
 *
 *     fp_username_legacy := current fp_username   (the login alias)
 *     fp_username        := deduped firstname.lastname@firstprofit.school
 *
 * Pure planning over injected data (the backfill-fp-username-core pattern):
 * the CLI shell (migrate-fp-usernames.ts) loads the rows and applies the
 * writes; this module decides them, so the dedup behaviour is unit-tested
 * without a database.
 *
 * The dedup convention is EXACTLY the minter's (`mintUsernameFromNames`):
 * NFKD/NFKC fold via the shared slugger, `firstname.lastname` local part,
 * numeric suffix BEFORE the `@` (`remi.newal2@firstprofit.school`), `student`
 * fallback for an unfoldable first name. The taken-ledger must be seeded with
 * EVERY existing fp_username AND fp_username_legacy (lowercased) plus each
 * handle this plan issues, so a re-run or a collision can never double-issue.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { mintUsernameFromNames } from "@/app/lib/fp/fp-username-rules";

export type MigratableChild = {
  id: string;
  firstName: string;
  lastName: string | null;
  fpUsername: string | null;
  fpUsernameLegacy: string | null;
};

export type PlannedMove = {
  childId: string;
  /** Becomes fp_username_legacy. */
  oldUsername: string;
  /** The deduped email-shaped handle. */
  newUsername: string;
};

export type SkipReason =
  | "no_username"
  | "already_email_shaped"
  | "already_has_legacy"
  | "mint_exhausted";

export type PlannedSkip = { childId: string; reason: SkipReason };

export type MigrationPlan = { moves: PlannedMove[]; skips: PlannedSkip[] };

/**
 * Decide every move. `takenLowercase` MUST already contain every existing
 * fp_username and fp_username_legacy (lowercased); this function adds its own
 * issues as it goes. Deterministic for a given input order — the shell feeds
 * children ordered by id so re-runs replay identically.
 *
 * A child who already has a legacy value is SKIPPED, not overwritten: their
 * migration already happened (or someone hand-set an alias), and destroying
 * an alias kids may be typing is never this script's call.
 */
export function planUsernameMigration(
  children: readonly MigratableChild[],
  takenLowercase: ReadonlySet<string>
): MigrationPlan {
  const taken = new Set(takenLowercase);
  const moves: PlannedMove[] = [];
  const skips: PlannedSkip[] = [];

  for (const child of children) {
    const current = (child.fpUsername ?? "").trim();
    if (!current) {
      skips.push({ childId: child.id, reason: "no_username" });
      continue;
    }
    if (current.includes("@")) {
      skips.push({ childId: child.id, reason: "already_email_shaped" });
      continue;
    }
    if ((child.fpUsernameLegacy ?? "").trim()) {
      skips.push({ childId: child.id, reason: "already_has_legacy" });
      continue;
    }
    const mint = mintUsernameFromNames({
      firstName: child.firstName,
      lastName: child.lastName,
      isTaken: (c) => taken.has(c),
    });
    if (!mint.ok) {
      skips.push({ childId: child.id, reason: "mint_exhausted" });
      continue;
    }
    taken.add(mint.username.toLowerCase());
    moves.push({ childId: child.id, oldUsername: current, newUsername: mint.username });
  }

  return { moves, skips };
}

/**
 * The GUARDED apply of one planned move — extracted from the CLI shell so its
 * concurrent-change FAIL branch is unit-testable against the fake client
 * (previously it lived inline in main() and only ran against production).
 *
 * The write only lands if the row STILL carries the exact old username and no
 * legacy alias yet, so a change since the scan (another writer, a re-run that
 * already migrated this child) makes it a clean ZERO-ROW "changed" — never a
 * clobber of a value the kid may now be typing.
 *
 *   applied  — exactly this row was moved.
 *   changed  — the guard matched nothing: the row moved since the scan.
 *   error    — the DB returned an error (an infra fault, not a guard miss).
 */
export type ApplyMoveResult =
  | { status: "applied" }
  | { status: "changed" }
  | { status: "error"; message: string };

export async function applyPlannedMove(
  db: SupabaseClient,
  move: PlannedMove
): Promise<ApplyMoveResult> {
  const res = await db
    .from("children")
    .update({ fp_username: move.newUsername, fp_username_legacy: move.oldUsername })
    .eq("id", move.childId)
    .eq("fp_username", move.oldUsername)
    .is("fp_username_legacy", null)
    .select("id");
  if (res.error) return { status: "error", message: res.error.message };
  if ((((res.data as unknown[] | null) ?? []).length) === 0) return { status: "changed" };
  return { status: "applied" };
}
